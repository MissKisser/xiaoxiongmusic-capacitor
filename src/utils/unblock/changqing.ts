/**
 * 长青聚合站换源（QQ 通道）
 *
 * 长青是社区公益聚合站：把各平台曲库统一成「按平台内歌曲 id 取链」的接口，站内没有检索能力。
 * 本模块只接 QQ 通道：入参是 QQ 歌曲 mid。
 *
 * 酷狗通道已整条下线：酷狗官方老取链接口失效，新接口需要设备指纹与签名，
 * 公益站给不出这套凭据，站内酷狗取链端点对所有请求统一返回业务错误，
 * 留着它只会白等超时，因此不再保留该通道的主机与检索分支。
 *
 * 通道是 id 型的，id 的来源有两条：
 * 1. 歌曲本身来自 QQ 音乐时，直接用歌曲自带的 mid，无需检索；
 * 2. 歌曲来自其它平台时，按「歌名 + 歌手」走 QQ 音乐公开检索换到 mid，
 *    换到的候选先过站外源同一套三重校验（歌名 / 歌手 / 时长）再取链。
 *
 * 取链返回的是裸音频流（不是 JSON），因此直链就是取链地址本身。
 * 公益站返回的文件未必是请求的那一版（实测同一条 id 可返回时长明显不同的另一版），
 * 所以取链后按真实音频时长做闸门，偏差超容差即判为错版、拒绝交付。
 *
 * 公益站无 SLA：检索层挂熔断（连续失败到阈值即熔断，熔断期内零请求）；
 * 取链层按音质档位逐个尝试，单次尝试有硬性耗时上限，上游挂起时不让换源链干等。
 *
 * 上游请求经 http 封装层发起。失败取证请求在服务端禁止跟随重定向
 * （maxRedirects 0，30x 即判非业务错误）；http 封装层无法禁用重定向，
 * 以「最终响应地址是否偏离请求地址」判读跳转：偏离即按 30x 同义处理，
 * 只有原地返回的 200 + 业务错误 JSON 才计入熔断归因。该请求只用于熔断归因，
 * 不影响取链结论本身。
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
import { probeAudio, type AudioProbe } from './audio-probe'
import { searchQqCandidates } from './qq-search'
import { sanitizeUrl } from './sanitize'
import {
  CircuitBreaker,
  UpstreamBusinessError,
  extractBusinessError,
  isUpstreamFault,
  type BusinessError,
} from './resilience'

/** 长青取链的请求头 */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'

/** 检索层连续失败多少次后熔断 */
const SEARCH_FAILURE_THRESHOLD = 3

/** 熔断持续时长（毫秒）：期间该源直接跳过，不发起任何请求 */
const SEARCH_BREAK_DURATION_MS = 10 * 60 * 1000

/** 单次换源最多尝试的候选数 */
const MAX_CANDIDATE_TRY = 2

/** 长青 QQ 通道的取链主机 */
const CHANNEL_HOSTS: string[] = [
  // 唯一能出整曲的主域：另两台备援（kgqq 子域与直连 IP）对请求一律 302 到死链
  'https://musicapi.haitangw.net/music/qq_kw.php',
]

/** 长青 QQ 通道的音质档位（按顺序尝试） */
const CHANNEL_LEVELS: string[] = ['standard', 'exhigh']

/** 直链体积下限（字节）：小于该值的响应是错误页而非音频 */
const MIN_AUDIO_BYTES = 4096

/** 单次取链尝试的硬性耗时上限（毫秒） */
const FETCH_ATTEMPT_TIMEOUT_MS = 8000

/** 失败取证请求的耗时上限（毫秒） */
const FAILURE_INSPECT_TIMEOUT_MS = 3000

/** QQ 音乐的平台标识：歌曲自带 QQ mid 时可直接直查 */
const QQ_PLATFORM = 'qqmusic'

/** 长青检索层熔断器 */
const searchBreaker = new CircuitBreaker({
  name: '长青检索',
  failureThreshold: SEARCH_FAILURE_THRESHOLD,
  openDurationMs: SEARCH_BREAK_DURATION_MS,
  onStateChange: (message) => unblockLog.warn(`🔌 ${message}`),
})

/** 同源同曲的失败日志节流窗口（毫秒） */
const FAIL_LOG_THROTTLE_MS = 10 * 1000

/** 失败日志节流表的最大条目数：超出后清理过期条目，避免长期运行内存无界增长 */
const FAIL_LOG_THROTTLE_MAX_ENTRIES = 64

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
const logUnlockFailure = (target: { title: string; artist: string }, reason: string): void => {
  const key = `changqing|${target.title}|${target.artist}`
  const now = Date.now()
  const last = failureLogAt.get(key) ?? 0
  if (now - last < FAIL_LOG_THROTTLE_MS) return
  if (failureLogAt.size >= FAIL_LOG_THROTTLE_MAX_ENTRIES) {
    for (const [itemKey, loggedAt] of failureLogAt) {
      if (now - loggedAt >= FAIL_LOG_THROTTLE_MS) failureLogAt.delete(itemKey)
    }
  }
  failureLogAt.set(key, now)
  unblockLog.warn(`⚠️ 长青 换源失败（${target.title} / ${target.artist}）：${reason}`)
}

/** 长青取链请求的附加信息 */
export type ChangqingOptions = {
  /** 歌曲所属平台；缺省视为非 QQ 音乐来源 */
  platform?: string
  /** 平台内歌曲原生 id（QQ 音乐 mid） */
  platformId?: string
}

/** 长青通道候选 */
type ChangqingCandidate = {
  /** 平台内歌曲 id（QQ 音乐 mid） */
  id: string
  /** 歌名 */
  title: string
  /** 歌手 */
  artist: string
  /** 时长（秒） */
  duration?: number
}

/** 取链结果 */
type ChangqingFetch = {
  /** 直链地址 */
  url: string
  /** 直链探测结论 */
  probe: AudioProbe
}

/** 一次通道取链的结论 */
type ChangqingFetchOutcome = {
  /** 取到的直链；未取到可用直链时为 null */
  fetched: ChangqingFetch | null
  /** 本次取链是否遇到上游故障（用于熔断计数） */
  faulted: boolean
}

/**
 * 给异步操作加硬性耗时上限
 *
 * 上游挂起时不能无限等待：超过上限即按故障处理，
 * 让换源链尽快降级到下一个来源，而不是干等到探测超时。
 * @param operation 异步操作
 * @param limitMs 上限（毫秒）
 * @param label 超时日志里的操作名
 * @returns 操作结果
 */
const withTimeout = async <T>(
  operation: Promise<T>,
  limitMs: number,
  label: string,
): Promise<T> => {
  // 竞速超时后原请求仍会自行结束，这里先挂一个空处理器，避免它的失败变成未处理异常
  operation.catch(() => undefined)
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label}超时（超过 ${Math.round(limitMs / 1000)} 秒未返回）`)),
          limitMs,
        )
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * 拼接取链地址
 * @param endpoint 取链端点
 * @param id 平台内歌曲 id
 * @param level 音质档位
 * @returns 取链地址
 */
const buildFetchUrl = (endpoint: string, id: string, level: string): string =>
  `${endpoint}?type=mp3&id=${encodeURIComponent(id)}&level=${encodeURIComponent(level)}`

/**
 * 读取一次失败响应的原始内容，判定故障类型
 *
 * 取链失败有两种含义截然不同的形态：
 * - 上游以 HTTP 200 返回业务错误 JSON：站方接口整体不可用，必须计入熔断故障；
 * - 其它形态（跳转死链、歌曲不存在等）：站方仍在正常应答，属单曲问题，不计入熔断。
 * @param url 取链地址
 * @returns 业务错误信息；不是业务错误时返回 null
 */
const inspectFailure = async (url: string): Promise<BusinessError | null> => {
  try {
    const response = await unblockRequest({
      url,
      headers: { 'User-Agent': UA, Range: 'bytes=0-1023' },
      responseType: 'text',
      timeout: FAILURE_INSPECT_TIMEOUT_MS,
    })
    if (response.status !== 200) return null
    // http 封装层无法禁用重定向（与服务端 maxRedirects 0 的等义替代）：
    // 最终响应地址偏离请求地址即发生过跳转，按 30x 同义判为非业务错误，
    // 不计入熔断归因。
    if (response.url !== url) return null
    return extractBusinessError(response.data)
  } catch {
    return null
  }
}

/**
 * 解析通道的候选列表
 *
 * 歌曲本身就是 QQ 音乐来源时，用歌曲自带的原生 mid（无需检索）；
 * 否则走 QQ 音乐公开检索按关键词换 mid，检索词两种分隔形式依次尝试。
 * @param target 目标歌曲信息
 * @param options 请求附带的平台信息
 * @returns 归一化后的候选列表
 */
const resolveCandidates = async (
  target: MatchTarget,
  options: ChangqingOptions,
): Promise<ChangqingCandidate[]> => {
  if (options.platform === QQ_PLATFORM && options.platformId) {
    return [
      {
        id: options.platformId,
        title: target.title,
        artist: target.artist,
        duration: target.duration,
      },
    ]
  }
  const keywords = target.artist
    ? [`${target.title} ${target.artist}`, `${target.title}-${target.artist}`]
    : [target.title]
  const merged: ChangqingCandidate[] = []
  const seen = new Set<string>()
  for (const keyword of keywords) {
    const candidates = await searchQqCandidates(keyword)
    unblockLog.log(`🔎 长青检索（关键词：${keyword}）：候选 ${candidates.length} 条`)
    for (const candidate of candidates) {
      if (seen.has(candidate.id)) continue
      seen.add(candidate.id)
      merged.push(candidate)
    }
    // 首个检索词已能换到通过校验的候选就不再换检索词
    if (rankCandidates(merged, target).some((detail) => detail.passed)) break
  }
  return merged
}

/**
 * 从某个主机取链
 *
 * 取链失败时补一次取证请求：只有「HTTP 200 + 业务错误 JSON」才按上游故障上报，
 * 其余失败形态属单曲问题，不触发熔断。
 * @param endpoint 取链端点
 * @param id 平台内歌曲 id
 * @param level 音质档位
 * @returns 直链与探测结论；失败返回 null
 */
const fetchFromEndpoint = async (
  endpoint: string,
  id: string,
  level: string,
): Promise<ChangqingFetch | null> => {
  const url = buildFetchUrl(endpoint, id, level)
  const runAttempt = async (): Promise<ChangqingFetch | null> => {
    const probe = await probeAudio(url, { 'User-Agent': UA })
    if (!probe.bytes || probe.bytes < MIN_AUDIO_BYTES) {
      const businessError = await inspectFailure(url)
      if (businessError) throw new UpstreamBusinessError(businessError)
      unblockLog.log(`🔎 长青取链（${endpoint} / ${level}）：未取到音频（${probe.bytes ?? 0} 字节）`)
      return null
    }
    unblockLog.log(
      `🔎 长青取链（${endpoint} / ${level}）：${probe.bytes} 字节，实测时长 ${
        probe.durationSec ?? '未知'
      }s`,
    )
    return { url, probe }
  }
  return withTimeout(runAttempt(), FETCH_ATTEMPT_TIMEOUT_MS, '长青取链')
}

/**
 * 在通道的各主机与音质档位上取链
 *
 * 遇到上游故障时继续尝试其余档位，但故障事实会带回调用方计入熔断。
 * @param id 平台内歌曲 id
 * @returns 取链结论与故障标记
 */
const fetchFromChannel = async (id: string): Promise<ChangqingFetchOutcome> => {
  let faulted = false
  for (const host of CHANNEL_HOSTS) {
    for (const level of CHANNEL_LEVELS) {
      try {
        const fetched = await fetchFromEndpoint(host, id, level)
        if (fetched) return { fetched, faulted }
      } catch (error) {
        if (isUpstreamFault(error)) {
          faulted = true
          unblockLog.warn(`⚠️ 长青取链失败（${host} / ${level}）：${String(error)}`)
        } else {
          unblockLog.warn(`⚠️ 长青取链异常（${host} / ${level}）：${String(error)}`)
        }
      }
    }
  }
  return { fetched: null, faulted }
}

/**
 * 获取长青歌曲直链
 * @param target 目标歌曲信息（歌名 / 歌手 / 可选时长），由路由层按请求参数构造
 * @param options 请求附带的平台信息（平台与平台原生 id）
 * @returns 歌曲直链结果
 */
const getChangqingSongUrl = async (
  target: MatchTarget,
  options: ChangqingOptions = {},
): Promise<SongUrlResult> => {
  try {
    if (!target.title) return { code: 404, url: null, reason: MISSING_TITLE_REASON }
    if (!target.artist.trim()) return { code: 404, url: null, reason: MISSING_ARTIST_REASON }
    if (!searchBreaker.canRequest()) {
      unblockLog.warn(
        `🔌 长青检索处于熔断状态，跳过本次换源（剩余 ${Math.ceil(
          searchBreaker.remainingOpenMs() / 1000,
        )} 秒）`,
      )
      return { code: 404, url: null, reason: UPSTREAM_UNAVAILABLE_REASON }
    }
    let upstreamFault = false
    let hasCandidate = false
    let hasPassedCandidate = false
    let candidates: ChangqingCandidate[] = []
    try {
      candidates = await resolveCandidates(target, options)
    } catch (error) {
      upstreamFault = upstreamFault || isUpstreamFault(error)
      unblockLog.warn(`⚠️ 长青 QQ 通道检索失败：${String(error)}`)
    }
    if (candidates.length) {
      hasCandidate = true
      const ranked = rankCandidates(candidates, target).filter((detail) => detail.passed)
      unblockLog.log(`🔎 长青三重校验（歌名/歌手/时长）：通过 ${ranked.length} 条候选`)
      if (ranked.length) {
        hasPassedCandidate = true
        for (const detail of ranked.slice(0, MAX_CANDIDATE_TRY)) {
          const candidate = detail.candidate as ChangqingCandidate
          const outcome = await fetchFromChannel(candidate.id)
          upstreamFault = upstreamFault || outcome.faulted
          const fetched = outcome.fetched
          if (!fetched) continue
          const { probe } = fetched
          // 真实音频时长闸门：公益站可能返回同一 id 的另一个版本，按字节数判断不出来。
          // 请求侧有时长时，读不出真实时长就不交付 —— 宁可换源失败也不播错版本。
          if (target.duration) {
            if (!probe.durationSec) {
              unblockLog.warn(`⚠️ 长青 candidate rejected (${candidate.title}): 未能读出真实音频时长`)
              continue
            }
            const delta = Math.abs(probe.durationSec - target.duration)
            if (delta > DURATION_GATE_TOLERANCE_S) {
              unblockLog.warn(
                `⚠️ 长青 candidate rejected (${candidate.title}): 时长 ${probe.durationSec.toFixed(
                  1,
                )}s 偏离请求 ${target.duration}s`,
              )
              continue
            }
          }
          const check = isPlausibleAudioLength(
            probe.bytes,
            candidate.duration ?? target.duration,
            probe.bitrateKbps ?? 128,
            target.duration,
          )
          if (!check.ok) {
            unblockLog.warn(`⚠️ 长青 candidate rejected (${candidate.title}): ${check.reason}`)
            continue
          }
          unblockLog.log('🔗 ChangqingSong URL:', sanitizeUrl(fetched.url))
          searchBreaker.recordSuccess()
          return { code: 200, url: fetched.url, lengthVerified: true }
        }
      }
    }
    if (upstreamFault) searchBreaker.recordFailure()
    else searchBreaker.recordSuccess()
    if (!hasCandidate) {
      logUnlockFailure(target, NO_CANDIDATE_REASON)
      return { code: 404, url: null, reason: NO_CANDIDATE_REASON }
    }
    if (!hasPassedCandidate) {
      logUnlockFailure(target, MATCH_FAILED_REASON)
      return { code: 404, url: null, reason: MATCH_FAILED_REASON }
    }
    logUnlockFailure(target, FETCH_FAILED_REASON)
    return { code: 404, url: null, reason: FETCH_FAILED_REASON }
  } catch (error) {
    unblockLog.error('❌ Get ChangqingSong URL Error:', error)
    logUnlockFailure(target, UPSTREAM_UNAVAILABLE_REASON)
    return { code: 404, url: null, reason: UPSTREAM_UNAVAILABLE_REASON }
  }
}

export default getChangqingSongUrl
