/**
 * 小鱼音源（QQ 音乐通道）换源
 *
 * 小鱼是社区公益音源，QQ 通道把 QQ 歌曲 mid 交给公开解析接口，
 * 接口回一整包音频直链与元数据。本模块只接 QQ 通道：
 * - 歌曲自带 QQ mid 时零检索直查；
 * - 歌曲来自其它平台（自带的是别家 id）时，按「歌名 + 歌手」走 QQ 检索换 mid，
 *   候选过站外源同一套三重校验（歌名 / 歌手 / 时长）后再取链；
 * - 声明是 QQ 平台来源却没有 mid，属请求侧信息不完整，直接拒绝，不猜。
 *
 * 上游一次请求即返回全部音质档位：320k 档（HQ，C600 AAC）与 128k 档（标准，C400 AAC）。
 * 交付前按「先高后低」逐档挑选，任一档通过校验即交付。
 * 首触（上游第一次遇到这首歌）要现查 QQ 曲库并换 vkey，耗时在亚秒到十秒级之间大幅波动，
 * 命中上游缓存后回落到 1s 内，因此取链超时后重试一次。
 *
 * 交付直链前做三道把关：
 * 1. 身份校验 —— 响应回显的 song_mid 必须与请求的 mid 一致，防错歌；
 * 2. 时长闸门 —— 上游声明的时长与真实音频时长都必须落在目标时长容差内，
 *    拦截片段、另一版本与试听；
 * 3. 体积校验 —— 直链实测体积与上游声明体积要对得上（拦截残缺与占位文件）。
 *
 * 健壮性：公益上游无 SLA —— 取链层与上游故障口径与既有几源一致
 * （HTTP 5xx、连接失败、超时与非 4xx 语义的业务码计入故障，4xx 属请求侧拒绝不计），
 * 连续失败到阈值即熔断，熔断期内零请求；失败日志按「同源同曲」节流，避免刷屏。
 *
 * 与服务端实现的差异仅在传输层：上游请求经 http 封装层发起
 * （语义为 validateStatus 恒真，状态码判读与服务端逐字一致；
 * 超时异常经封装层归一为含「超时 / timeout」文案与 ECONNABORTED 错误码，
 * 与服务端 axios 超时的判定口径一致）。
 */
import type { SongUrlResult } from './types'
import { unblockLog, unblockRequest } from './http'
import {
  FETCH_FAILED_REASON,
  MATCH_FAILED_REASON,
  MISSING_ARTIST_REASON,
  MISSING_TITLE_REASON,
  NO_CANDIDATE_REASON,
  UPSTREAM_UNAVAILABLE_REASON,
  isPlausibleAudioLength,
  rankCandidates,
  type MatchTarget,
} from './match'
import { DURATION_GATE_TOLERANCE_S } from "./duration-gate"
import { probeAudio } from './audio-probe'
import { probeContentLength } from './audio-length'
import { searchQqCandidates } from './qq-search'
import { sanitizeUrl } from './sanitize'
import {
  CircuitBreaker,
  extractBusinessError,
  isBusinessFault,
  isUpstreamFault,
} from './resilience'

/** 小鱼 QQ 通道的取链入口 */
const FISH_API_URL = 'https://tang.api.s01s.cn/music_open_api.php'

/** 单次取链请求超时（毫秒） */
const REQUEST_TIMEOUT_MS = 12000

/** 首触超时后的重试超时（毫秒）：重试时上游通常已写入缓存，回落快 */
const RETRY_TIMEOUT_MS = 8000

/** 检索候选条数 */
const SEARCH_LIMIT = 20

/** 连续失败多少次后熔断 */
const FAILURE_THRESHOLD = 3

/** 熔断持续时长（毫秒）：期间该源直接跳过，不发起任何请求 */
const BREAK_DURATION_MS = 10 * 60 * 1000

/** 同源同曲的失败日志节流窗口（毫秒） */
const FAIL_LOG_THROTTLE_MS = 10 * 1000

/** 失败日志节流表的最大条目数：超出后清理过期条目，避免长期运行内存无界增长 */
const FAIL_LOG_THROTTLE_MAX_ENTRIES = 64

/** 请求 UA */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'

/** QQ 音乐的平台标识：歌曲自带 mid 时可直接直查 */
const QQ_PLATFORMS = new Set(['qqmusic', 'qq', 'tx'])

/** QQ 歌曲 mid 的形态：数字与字母组成，长度与 QQ 现行 mid 一致 */
const QQ_MID_PATTERN = /^[0-9A-Za-z]{10,20}$/

/** 上游声明体积与实测体积的允许偏差比例 */
const SIZE_RATIO_TOLERANCE = 0.15

/** 小鱼音源熔断器：检索层与取链层共用 */
const breaker = new CircuitBreaker({
  name: '小鱼音源',
  failureThreshold: FAILURE_THRESHOLD,
  openDurationMs: BREAK_DURATION_MS,
  onStateChange: (message) => unblockLog.warn(`🔌 ${message}`),
})

/** 同源同曲的失败日志节流表：记录上一次写日志的时刻 */
const failureLogAt = new Map<string, number>()

/**
 * 记录一次换源失败
 *
 * 同源同曲在节流窗口内只写一条日志：换源链按优先级逐源尝试，
 * 同一首歌被反复重试时不至于刷屏。
 * @param target 目标歌曲信息
 * @param reason 失败原因（用户可读文案）
 */
const logUnlockFailure = (target: MatchTarget, reason: string): void => {
  const key = `fish|${target.title}|${target.artist}`
  const now = Date.now()
  const last = failureLogAt.get(key) ?? 0
  if (now - last < FAIL_LOG_THROTTLE_MS) return
  if (failureLogAt.size >= FAIL_LOG_THROTTLE_MAX_ENTRIES) {
    for (const [itemKey, loggedAt] of failureLogAt) {
      if (now - loggedAt >= FAIL_LOG_THROTTLE_MS) failureLogAt.delete(itemKey)
    }
  }
  failureLogAt.set(key, now)
  unblockLog.warn(`⚠️ 小鱼音源 换源失败（${target.title} / ${target.artist}）：${reason}`)
}

/** 小鱼 QQ 通道的响应体 */
type FishResponse = {
  /** 回显的歌曲 mid：身份校验锚点 */
  song_mid?: string | null
  /** 歌名 */
  song_name?: string | null
  /** 歌手 */
  singer_name?: string | null
  /** 时长（秒） */
  song_play_time?: number | null
  /** 320k 档直链（C600 AAC） */
  song_play_url_hq?: string | null
  /** 128k 档直链（C400 AAC） */
  song_play_url_standard?: string | null
  /** 320k 档声明体积（字节） */
  song_size_hq_str?: number | null
  /** 128k 档声明体积（字节） */
  song_size_standard_str?: number | null
  /** 320k 档声明码率（kbps） */
  kbps_hq?: number | null
  /** 128k 档声明码率（kbps） */
  kbps_standard?: number | null
}

/** 小鱼换源附加信息 */
export type FishOptions = {
  /** 歌曲所属平台 */
  platform?: string
  /** 平台内歌曲原生 id（QQ 歌曲 mid） */
  platformId?: string
}

/** 一个音质档位 */
type FishTier = {
  /** 档位名称 */
  name: string
  /** 该档位的音频直链 */
  url: string
  /** 上游声明的体积（字节）；上游未给时为 null */
  declaredBytes: number | null
  /** 上游声明的码率（kbps）；上游未给时为 null */
  declaredKbps: number | null
  /** 该档位可接受的最低码率（kbps）：低于此值说明拿到的不是这一档 */
  minBitrateKbps: number
}
/**
 * 把上游返回的数字字段读成数值
 * @param value 原始字段值
 * @returns 数值；非数值时返回 null
 */
const readNumber = (value: unknown): number | null => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return parsed
}

/**
 * 拼装小鱼取链地址
 * @param mid QQ 歌曲 mid
 * @returns 取链地址
 */
const buildApiUrl = (mid: string): string =>
  `${FISH_API_URL}?mid=${encodeURIComponent(mid)}`

/**
 * 把 QQ CDN 的 http 直链升级为 https
 *
 * 上游会给回 http 直链，播放页在 https 下会被混合内容策略拦掉；
 * QQ CDN 本身支持 https，同一条直链换协议即可。
 * @param url 上游返回的直链
 * @returns 可直接播放的直链
 */
const normalizeUrl = (url: string): string => {
  if (!/^http:\/\//i.test(url)) return url
  try {
    const parsed = new URL(url)
    if (!/(^|\.)qq\.com$/i.test(parsed.hostname)) return url
    parsed.protocol = 'https:'
    return parsed.toString()
  } catch {
    return url
  }
}

/**
 * 从上游响应里取出各音质档位
 * @param body 上游响应体
 * @returns 档位列表（按 320k → 128k 顺序）
 */
const extractTiers = (body: FishResponse): FishTier[] => {
  const tiers: FishTier[] = []
  const hqUrl = String(body.song_play_url_hq ?? '').trim()
  if (hqUrl) {
    tiers.push({
      name: '320k',
      url: hqUrl,
      declaredBytes: readNumber(body.song_size_hq_str),
      declaredKbps: readNumber(body.kbps_hq),
      minBitrateKbps: 96,
    })
  }
  const standardUrl = String(body.song_play_url_standard ?? '').trim()
  if (standardUrl) {
    tiers.push({
      name: '128k',
      url: standardUrl,
      declaredBytes: readNumber(body.song_size_standard_str),
      declaredKbps: readNumber(body.kbps_standard),
      minBitrateKbps: 64,
    })
  }
  return tiers
}

/**
 * 判断平台是否是 QQ 音乐
 * @param platform 平台标识
 * @returns 是否为 QQ 音乐
 */
const isQqPlatform = (platform?: string): boolean =>
  QQ_PLATFORMS.has((platform || '').trim().toLowerCase())

/**
 * 解析目标歌曲的 QQ mid
 *
 * 歌曲自带 QQ mid 时零检索直查（平台声明为 QQ 音乐，或平台未声明但自带 id 形如 QQ mid）；
 * 歌曲来自其它平台（自带的是别家 id）时，按「歌名 + 歌手」走 QQ 检索换 mid，
 * 候选必须过站外源同一套三重校验（歌名 / 歌手 / 时长）。
 * 声明是 QQ 音乐却没有 mid，属请求侧信息不完整，直接拒绝，不按关键词猜。
 * @param target 目标歌曲信息
 * @param options 平台信息
 * @returns mid；无法确定时返回 null 与原因
 */
const resolveSongMid = async (
  target: MatchTarget,
  options: FishOptions,
): Promise<{ mid: string | null; reason: string }> => {
  const platform = (options.platform || '').trim().toLowerCase()
  const platformId = (options.platformId || '').trim()
  if (isQqPlatform(platform)) {
    if (!platformId) return { mid: null, reason: NO_CANDIDATE_REASON }
    return { mid: platformId, reason: '' }
  }
  // 平台未声明时，形态像 QQ mid 的自带 id 可直接使用
  if (!platform && platformId && QQ_MID_PATTERN.test(platformId)) {
    return { mid: platformId, reason: '' }
  }
  const candidates = await searchQqCandidates(`${target.title}-${target.artist}`)
  if (!candidates.length) return { mid: null, reason: NO_CANDIDATE_REASON }
  const ranked = rankCandidates(candidates.slice(0, SEARCH_LIMIT), target).filter(
    (detail) => detail.passed,
  )
  if (!ranked.length) return { mid: null, reason: MATCH_FAILED_REASON }
  return { mid: ranked[0].candidate.id, reason: '' }
}

/** 单次取链请求的结论 */
type FishFetchOutcome = {
  /** 上游响应体；为 null 表示本次请求未拿到可用信息 */
  body: FishResponse | null
  /** 失败原因（用户可读文案） */
  reason: string
  /** 是否属于上游故障 */
  fault: boolean
  /** 是否为请求超时 */
  timedOut: boolean
}

/**
 * 判断异常是否为请求超时
 * @param error 异常对象
 * @returns 是否为超时
 */
const isTimeoutError = (error: unknown): boolean =>
  /timeout of \d+ms exceeded|超时/i.test(
    String((error as { message?: unknown })?.message ?? error),
  )

/**
 * 向小鱼接口发起一次取链请求
 *
 * 故障口径与 resilience.ts 一致：HTTP 5xx、连接失败、超时与非 4xx 语义的业务码
 * 计入上游故障；4xx 属请求侧拒绝，不计入。
 * @param mid QQ 歌曲 mid
 * @param timeout 本次请求的超时阈值（毫秒）
 * @returns 响应体与失败结论
 */
const fetchFishData = async (
  mid: string,
  timeout: number,
): Promise<FishFetchOutcome> => {
  try {
    const response = await unblockRequest({
      url: buildApiUrl(mid),
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      timeout,
    })
    if (response.status >= 500) {
      return { body: null, reason: `上游 HTTP ${response.status}`, fault: true, timedOut: false }
    }
    if (response.status >= 400) {
      return { body: null, reason: `上游 HTTP ${response.status}`, fault: false, timedOut: false }
    }
    const body = (response.data instanceof Uint8Array ? {} : response.data || {}) as FishResponse
    const business = extractBusinessError(body)
    if (business && isBusinessFault(business)) {
      return { body: null, reason: business.message, fault: true, timedOut: false }
    }
    return { body, reason: '', fault: false, timedOut: false }
  } catch (error) {
    return {
      body: null,
      reason: String(error),
      fault: isUpstreamFault(error),
      timedOut: isTimeoutError(error),
    }
  }
}

/**
 * 向小鱼接口请求歌曲信息，首触超时后重试一次
 *
 * 上游对每首歌的首次解析要现查 QQ 曲库并换 vkey，耗时在亚秒到十秒级之间大幅波动，
 * 命中上游缓存后回落到 1s 内。首触超时多是上游解析慢而非不可用，
 * 故超时后重试一次：此时上游通常已把解析结果写入缓存，重试可直接命中。
 * 服务端错误与连接失败不重试，交由熔断器统一降级。
 * @param mid QQ 歌曲 mid
 * @returns 响应体与失败结论
 */
const requestFishData = async (mid: string): Promise<FishFetchOutcome> => {
  const first = await fetchFishData(mid, REQUEST_TIMEOUT_MS)
  if (first.body || !first.timedOut) return first
  unblockLog.warn(`⏱️ 小鱼音源 首触超时（${mid}），重试一次`)
  const second = await fetchFishData(mid, RETRY_TIMEOUT_MS)
  if (second.body) unblockLog.log('🔗 小鱼音源重试命中上游缓存')
  return second
}

/**
 * 校验直链实测体积与上游声明体积是否一致
 * @param bytes 实测字节数
 * @param declaredBytes 上游声明字节数
 * @returns 是否一致
 */
const matchesDeclaredSize = (bytes: number, declaredBytes: number | null): boolean => {
  if (!declaredBytes) return true
  const ratio = bytes / declaredBytes
  return ratio >= 1 - SIZE_RATIO_TOLERANCE && ratio <= 1 + SIZE_RATIO_TOLERANCE
}

/**
 * 获取小鱼音源的 QQ 歌曲直链
 * @param target 目标歌曲信息（歌名 / 歌手 / 可选时长），由调用方按请求参数构造
 * @param options 平台信息（平台与平台原生 id）
 * @returns 歌曲直链结果
 */
const getFishSongUrl = async (
  target: MatchTarget,
  options: FishOptions = {},
): Promise<SongUrlResult> => {
  try {
    if (!target.title) return { code: 404, url: null, reason: MISSING_TITLE_REASON }
    if (!target.artist.trim()) return { code: 404, url: null, reason: MISSING_ARTIST_REASON }

    if (!breaker.canRequest()) {
      unblockLog.warn(
        `🔌 小鱼音源处于熔断状态，跳过本次换源（剩余 ${Math.ceil(
          breaker.remainingOpenMs() / 1000,
        )} 秒）`,
      )
      return { code: 404, url: null, reason: UPSTREAM_UNAVAILABLE_REASON }
    }

    let mid: string | null = null
    try {
      const resolved = await resolveSongMid(target, options)
      mid = resolved.mid
      if (!mid) {
        // 无候选 / 匹配失败是请求侧结论，不计入熔断
        breaker.recordSuccess()
        const reason = resolved.reason || NO_CANDIDATE_REASON
        logUnlockFailure(target, reason)
        return { code: 404, url: null, reason }
      }
    } catch (error) {
      const fault = isUpstreamFault(error)
      if (fault) breaker.recordFailure()
      else breaker.recordSuccess()
      logUnlockFailure(target, UPSTREAM_UNAVAILABLE_REASON)
      return { code: 404, url: null, reason: UPSTREAM_UNAVAILABLE_REASON }
    }

    const response = await requestFishData(mid)
    if (!response.body) {
      if (response.fault) breaker.recordFailure()
      else breaker.recordSuccess()
      logUnlockFailure(target, response.reason || FETCH_FAILED_REASON)
      return { code: 404, url: null, reason: FETCH_FAILED_REASON }
    }

    const body = response.body
    // 身份校验：上游回显的 mid 必须与请求一致，否则是另一首歌
    const echoedMid = String(body.song_mid ?? '').trim()
    if (!echoedMid || echoedMid !== mid) {
      unblockLog.warn(`⚠️ fish candidate rejected: 回显 mid 与请求不符`)
      breaker.recordSuccess()
      logUnlockFailure(target, FETCH_FAILED_REASON)
      return { code: 404, url: null, reason: FETCH_FAILED_REASON }
    }

    const upstreamDuration = readNumber(body.song_play_time)
    const expectedDuration = upstreamDuration || target.duration || 0
    // 上游声明的时长与请求声明的时长必须一致，否则是另一版本
    if (upstreamDuration && target.duration) {
      const delta = Math.abs(upstreamDuration - target.duration)
      if (delta > DURATION_GATE_TOLERANCE_S) {
        unblockLog.warn(
          `⚠️ fish candidate rejected: 上游时长 ${upstreamDuration}s 偏离目标 ${target.duration}s`,
        )
        breaker.recordSuccess()
        logUnlockFailure(target, FETCH_FAILED_REASON)
        return { code: 404, url: null, reason: FETCH_FAILED_REASON }
      }
    }

    const tiers = extractTiers(body)
    if (!tiers.length) {
      breaker.recordSuccess()
      logUnlockFailure(target, FETCH_FAILED_REASON)
      return { code: 404, url: null, reason: FETCH_FAILED_REASON }
    }

    for (const tier of tiers) {
      const url = normalizeUrl(tier.url)
      const bytes = await probeContentLength(url, { 'User-Agent': UA })
      if (bytes && tier.declaredBytes && !matchesDeclaredSize(bytes, tier.declaredBytes)) {
        unblockLog.warn(
          `⚠️ fish candidate rejected: 实测体积 ${bytes}B 与上游声明 ${tier.declaredBytes}B 不符`,
        )
        continue
      }
      const probe = await probeAudio(url, { 'User-Agent': UA })
      if (!probe.durationSec) {
        unblockLog.warn('⚠️ fish candidate rejected: 未能读出真实音频时长')
        continue
      }
      if (expectedDuration) {
        const delta = Math.abs(probe.durationSec - expectedDuration)
        if (delta > DURATION_GATE_TOLERANCE_S) {
          unblockLog.warn(
            `⚠️ fish candidate rejected: 时长 ${probe.durationSec.toFixed(1)}s 偏离目标 ${expectedDuration}s`,
          )
          continue
        }
      }
      // 码率闸门：实际码率低于该档下限说明拿到的不是这一档
      const bitrateKbps = probe.bitrateKbps ?? tier.declaredKbps ?? 128
      if (bitrateKbps < tier.minBitrateKbps) {
        unblockLog.warn(
          `⚠️ fish candidate rejected: 码率 ${bitrateKbps}k 低于 ${tier.name} 档下限 ${tier.minBitrateKbps}k`,
        )
        continue
      }
      const check = isPlausibleAudioLength(
        bytes ?? probe.bytes,
        expectedDuration || undefined,
        bitrateKbps,
        target.duration,
      )
      if (!check.ok) {
        unblockLog.warn(`⚠️ fish candidate rejected: ${check.reason}`)
        continue
      }
      unblockLog.log('🔗 FishSong URL:', sanitizeUrl(url))
      breaker.recordSuccess()
      return { code: 200, url, lengthVerified: check.verified }
    }

    breaker.recordSuccess()
    logUnlockFailure(target, FETCH_FAILED_REASON)
    return { code: 404, url: null, reason: FETCH_FAILED_REASON }
  } catch (error) {
    unblockLog.error('❌ Get FishSong URL Error:', error)
    if (isUpstreamFault(error)) breaker.recordFailure()
    else breaker.recordSuccess()
    logUnlockFailure(target, UPSTREAM_UNAVAILABLE_REASON)
    return { code: 404, url: null, reason: UPSTREAM_UNAVAILABLE_REASON }
  }
}

export default getFishSongUrl
