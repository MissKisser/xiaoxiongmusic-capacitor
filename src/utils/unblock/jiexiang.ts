/**
 * 吉祥音源（酷狗曲库通道）换源
 *
 * 吉祥是社区公益音源，酷狗通道把酷狗歌曲 hash 交给解析端点，
 * 端点回一个 CDN 代理直链（bdycdn 代理到酷狗官方对象存储）。
 *
 * 本模块只接酷狗通道：寻址主键是酷狗歌曲 hash。
 * 歌曲自带酷狗 hash 时零检索直查；没有 hash 直接失败 —— 酷狗曲库没有可用的公开检索入口，
 * 按「歌名 + 歌手」去猜 hash 只会得到另一首歌，不如不换源。
 *
 * 音质档位按「先高后低」尝试：exhigh（320k）取不到时降 standard（128k）。
 * 每档各发一次请求，取回直链后做三道把关：
 * 1. 业务校验 —— 业务码为 0 且直链非空；
 * 2. 音质校验 —— 直链路径内嵌对应音质标识（qu320 / qu128），确认拿到的确实是请求的档位；
 * 3. 时长与体积校验 —— 真实音频时长必须与目标时长在容差内，体积按「时长 × 码率」核对。
 *
 * 直链是 http 的代理 CDN 地址，按上游原样交付。
 *
 * 健壮性：公益上游无 SLA —— 传输层故障（HTTP 5xx、连接失败、超时）计入熔断，
 * 业务层的「无资源」结论属单曲问题，不计入（否则几首查不到的歌就会把整条源熔断掉）；
 * 连续失败到阈值即熔断，熔断期内零请求；失败日志按「同源同曲」节流，避免刷屏。
 *
 * 与服务端实现的差异仅在传输层：上游请求（含网关换票）经 http 封装层发起，
 * 语义为 validateStatus 恒真，状态码与业务码判读与服务端逐字一致；
 * 签名与票据协议见 qing-gateway.ts。
 */
import type { SongUrlResult } from './types'
import { unblockLog, unblockRequest } from './http'
import {
  FETCH_FAILED_REASON,
  MISSING_ARTIST_REASON,
  MISSING_TITLE_REASON,
  NO_CANDIDATE_REASON,
  UPSTREAM_UNAVAILABLE_REASON,
  isPlausibleAudioLength,
  type MatchTarget,
} from './match'
import { DURATION_GATE_TOLERANCE_S } from "./duration-gate"
import { probeAudio } from './audio-probe'
import { sanitizeUrl } from './sanitize'
import {
  CircuitBreaker,
  extractBusinessError,
  isBusinessFault,
  isUpstreamFault,
} from './resilience'
import { getQingGatewayHeaders, invalidateQingTicket } from './qing-gateway'

/** 吉祥解析端点 */
const JIEXIANG_API_URL = 'https://musicserver.haitangw.cc/v1/music/resolve-url'

/** 解析端点的平台标识（酷狗通道） */
const JIEXIANG_SOURCE = 'kg'

/** 单次取链请求超时（毫秒） */
const REQUEST_TIMEOUT_MS = 8000

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

/** 酷狗歌曲 hash 的形态：32 位十六进制 */
const KG_HASH_PATTERN = /^[a-f0-9]{32}$/i

/** 一个音质档位 */
type JiexiangTier = {
  /** 档位标识：向上游请求的 level */
  level: string
  /** 直链路径中必须出现的音质标识 */
  marker: string
  /** 该档位的标称码率（kbps），用于体积核对 */
  nominalBitrateKbps: number
  /** 该档位可接受的最低码率（kbps）：低于此值说明拿到的不是这一档 */
  minBitrateKbps: number
}

/** 取链时尝试的音质档位（按顺序尝试，前一个取不到就降一档） */
const JIEXIANG_TIERS: JiexiangTier[] = [
  { level: 'exhigh', marker: 'qu320', nominalBitrateKbps: 320, minBitrateKbps: 128 },
  { level: 'standard', marker: 'qu128', nominalBitrateKbps: 128, minBitrateKbps: 64 },
]

/** 吉祥音源熔断器 */
const breaker = new CircuitBreaker({
  name: '吉祥音源',
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
  const key = `jiexiang|${target.title}|${target.artist}`
  const now = Date.now()
  const last = failureLogAt.get(key) ?? 0
  if (now - last < FAIL_LOG_THROTTLE_MS) return
  if (failureLogAt.size >= FAIL_LOG_THROTTLE_MAX_ENTRIES) {
    for (const [itemKey, loggedAt] of failureLogAt) {
      if (now - loggedAt >= FAIL_LOG_THROTTLE_MS) failureLogAt.delete(itemKey)
    }
  }
  failureLogAt.set(key, now)
  unblockLog.warn(`⚠️ 吉祥音源 换源失败（${target.title} / ${target.artist}）：${reason}`)
}

/** 吉祥换源附加信息 */
export type JiexiangOptions = {
  /** 歌曲所属平台 */
  platform?: string
  /** 平台内歌曲原生 id（酷狗歌曲 hash） */
  platformId?: string
}

/** 吉祥端点返回的业务体 */
type JiexiangResponse = {
  /** 业务码：0 成功 */
  code?: number | string
  /** 失败描述 */
  message?: string
  /** 成功时的数据段 */
  data?: {
    /** 音频直链 */
    url?: string | null
  }
}

/**
 * 单次取链的结论
 */
type JiexiangFetchOutcome = {
  /** 取到的直链；失败时为 null */
  url: string | null
  /** 失败原因描述 */
  reason: string
  /** 本次失败是否属于上游故障（计入熔断计数） */
  fault: boolean
}

/**
 * 向吉祥端点请求一次直链
 *
 * 故障口径：HTTP 5xx（除 503 单曲无资源外）、连接失败、超时以及重试后仍鉴权失败计入上游故障；
 * 业务层无资源结论（HTTP 503 或 UPSTREAM_NO_RESOURCE）属单曲问题，不计入熔断；
 * 鉴权失效（HTTP 401 或 APP_UPGRADE_REQUIRED）作废票据后自动重试一次。
 * @param hash 酷狗歌曲 hash
 * @param tier 音质档位
 * @returns 取链结论
 */
const requestJiexiangUrl = async (
  hash: string,
  tier: JiexiangTier,
): Promise<JiexiangFetchOutcome> => {
  const bodyStr = JSON.stringify({ source: JIEXIANG_SOURCE, rid: hash, level: tier.level })

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const headers = await getQingGatewayHeaders('POST', '/v1/music/resolve-url', bodyStr)
      const response = await unblockRequest({
        url: JIEXIANG_API_URL,
        method: 'POST',
        headers: {
          ...headers,
          'User-Agent': UA,
        },
        data: bodyStr,
        timeout: REQUEST_TIMEOUT_MS,
      })

      const body = (response.data instanceof Uint8Array ? {} : typeof response.data === 'object' &&
        response.data !== null
        ? response.data
        : {}) as JiexiangResponse

      // 鉴权失效检测：HTTP 401 或业务码 APP_UPGRADE_REQUIRED
      const isAuthExpired =
        response.status === 401 || body.code === 'APP_UPGRADE_REQUIRED'
      if (isAuthExpired) {
        invalidateQingTicket()
        if (attempt === 0) {
          continue
        }
        return {
          url: null,
          reason: body.message || '鉴权失效',
          fault: true,
        }
      }

      // 单曲无资源检测：业务码 UPSTREAM_NO_RESOURCE（上游以 HTTP 503 交付）
      if (body.code === 'UPSTREAM_NO_RESOURCE') {
        return {
          url: null,
          reason: body.message || '播放地址解析失败',
          fault: false,
        }
      }

      // 成功判定：HTTP 200 或 201，且 code 为 0 或 "0"
      if (
        (response.status === 200 || response.status === 201) &&
        (body.code === 0 || body.code === '0')
      ) {
        const url = String(body.data?.url ?? '').trim()
        if (url) return { url, reason: '', fault: false }
        return { url: null, reason: '上游未返回直链', fault: false }
      }

      // 其余 HTTP 5xx 故障
      if (response.status >= 500) {
        return { url: null, reason: `上游 HTTP ${response.status}`, fault: true }
      }

      // 其余 HTTP 4xx 客户端错误
      if (response.status >= 400) {
        return { url: null, reason: `上游 HTTP ${response.status}`, fault: false }
      }

      // 其他业务错误
      const reason = body.message || `上游业务码 ${String(body.code ?? response.status)}`
      const business = extractBusinessError(body)
      const fault = business ? isBusinessFault(business) : false
      return { url: null, reason, fault }
    } catch (error) {
      return { url: null, reason: String(error), fault: isUpstreamFault(error) }
    }
  }

  return { url: null, reason: '鉴权失效', fault: true }
}

/**
 * 获取吉祥音源的酷狗歌曲直链
 * @param target 目标歌曲信息（歌名 / 歌手 / 可选时长），由调用方按请求参数构造
 * @param options 平台信息（平台与平台原生 id）
 * @returns 歌曲直链结果
 */
const getJiexiangSongUrl = async (
  target: MatchTarget,
  options: JiexiangOptions = {},
): Promise<SongUrlResult> => {
  try {
    if (!target.title) return { code: 404, url: null, reason: MISSING_TITLE_REASON }
    if (!target.artist.trim()) return { code: 404, url: null, reason: MISSING_ARTIST_REASON }

    // 酷狗 hash 是本通道唯一的寻址主键：拿不到就不换源，不做检索猜测
    const hash = (options.platformId || '').trim().toLowerCase()
    if (!hash || !KG_HASH_PATTERN.test(hash)) {
      logUnlockFailure(target, NO_CANDIDATE_REASON)
      return { code: 404, url: null, reason: NO_CANDIDATE_REASON }
    }

    if (!breaker.canRequest()) {
      unblockLog.warn(
        `🔌 吉祥音源处于熔断状态，跳过本次换源（剩余 ${Math.ceil(
          breaker.remainingOpenMs() / 1000,
        )} 秒）`,
      )
      return { code: 404, url: null, reason: UPSTREAM_UNAVAILABLE_REASON }
    }

    const expectedDuration = target.duration || 0
    let upstreamFault = false
    for (const tier of JIEXIANG_TIERS) {
      const outcome = await requestJiexiangUrl(hash, tier)
      if (!outcome.url) {
        upstreamFault = upstreamFault || outcome.fault
        unblockLog.log(`🔎 吉祥音源取链失败（${tier.level}）：${outcome.reason}`)
        continue
      }
      // 音质校验：直链路径内嵌音质标识，确认拿到的确实是请求的档位
      if (!outcome.url.includes(tier.marker)) {
        unblockLog.warn(`⚠️ jiexiang candidate rejected: 直链缺少音质标识 ${tier.marker}`)
        continue
      }
      const probe = await probeAudio(outcome.url, { 'User-Agent': UA })
      if (!probe.durationSec) {
        unblockLog.warn('⚠️ jiexiang candidate rejected: 未能读出真实音频时长')
        continue
      }
      // 时长闸门：真实音频时长必须与请求声明的时长在容差内
      if (expectedDuration) {
        const delta = Math.abs(probe.durationSec - expectedDuration)
        if (delta > DURATION_GATE_TOLERANCE_S) {
          unblockLog.warn(
            `⚠️ jiexiang candidate rejected: 时长 ${probe.durationSec.toFixed(1)}s 偏离目标 ${expectedDuration}s`,
          )
          continue
        }
      }
      // 码率校验：低于该档下限说明实际拿到的是更低一档
      const bitrateKbps = probe.bitrateKbps ?? tier.nominalBitrateKbps
      if (bitrateKbps < tier.minBitrateKbps) {
        unblockLog.warn(
          `⚠️ jiexiang candidate rejected: 码率 ${bitrateKbps}k 低于 ${tier.level} 档下限 ${tier.minBitrateKbps}k`,
        )
        continue
      }
      const check = isPlausibleAudioLength(
        probe.bytes,
        expectedDuration || undefined,
        bitrateKbps,
        target.duration,
      )
      if (!check.ok) {
        unblockLog.warn(`⚠️ jiexiang candidate rejected: ${check.reason}`)
        continue
      }
      unblockLog.log('🔗 JiexiangSong URL:', sanitizeUrl(outcome.url))
      breaker.recordSuccess()
      return { code: 200, url: outcome.url, lengthVerified: check.verified }
    }
    if (upstreamFault) breaker.recordFailure()
    else breaker.recordSuccess()
    logUnlockFailure(target, FETCH_FAILED_REASON)
    return { code: 404, url: null, reason: FETCH_FAILED_REASON }
  } catch (error) {
    unblockLog.error('❌ Get JiexiangSong URL Error:', error)
    if (isUpstreamFault(error)) breaker.recordFailure()
    else breaker.recordSuccess()
    logUnlockFailure(target, UPSTREAM_UNAVAILABLE_REASON)
    return { code: 404, url: null, reason: UPSTREAM_UNAVAILABLE_REASON }
  }
}

export default getJiexiangSongUrl
