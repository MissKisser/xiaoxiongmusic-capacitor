/**
 * 星海音源（网易云通道）换源
 *
 * 星海是社区公益音源，提供 lx 协议后端：把平台、歌名、歌手、歌曲 id、时长、专辑与音质
 * 交给后端，后端返回音频直链。本模块只接后端的网易云通道（source=wy），
 * 命中后返回网易云官方 CDN 的直链。
 *
 * 与落雪通道（lxmusic.ts 的 QQ 通道）不同，本通道没有检索分支：
 * 网易云歌曲 id 就是寻址主键，拿不到 id 或 id 不是网易云形态就直接失败，
 * 不按「歌名 + 歌手」去猜，避免把别的平台的 id 喂进网易云编号空间、静默返回另一首歌。
 *
 * 交付直链前做两道把关：
 * 1. 时长闸门 —— 真实音频时长必须与请求声明的时长在容差内，拦截片段与另一版本；
 * 2. 体积校验 —— 按「时长 × 码率」核对文件体积，拦截占位与残缺文件。
 *
 * 健壮性：公益上游无 SLA —— 取链层与上游故障口径与既有几源一致
 * （HTTP 5xx、连接失败、超时与非 4xx 语义的业务码计入故障，4xx 属请求侧拒绝不计），
 * 连续失败到阈值即熔断，熔断期内零请求；音质档位按 320k → 128k 依次尝试，
 * 失败日志按「同源同曲」节流，避免刷屏。
 *
 * 与服务端实现的差异仅在传输与随机能力载体：上游请求经 http 封装层发起
 * （语义为 validateStatus 恒真，状态码判读与服务端逐字一致），
 * 设备标识 / token 随机源用 Web Crypto 的 getRandomValues（WebView 与 Node 均内置），
 * token 的 base64 编码用 TextEncoder + btoa，与服务端 Buffer.toString('base64') 同值。
 */
import type { SongUrlResult } from './types'
import { unblockLog, unblockRequest } from './http'
import {
  FETCH_FAILED_REASON,
  MISSING_ARTIST_REASON,
  MISSING_TITLE_REASON,
  NO_CANDIDATE_REASON,
  UPSTREAM_UNAVAILABLE_REASON,
  durationTolerance,
  isPlausibleAudioLength,
  type MatchTarget,
} from './match'
import { probeAudio } from './audio-probe'
import { sanitizeUrl } from './sanitize'
import {
  CircuitBreaker,
  extractBusinessError,
  isBusinessFault,
  isUpstreamFault,
} from './resilience'

/** 星海后端的平台标识（网易云通道） */
const XINGHAI_SOURCE = 'wy'

/** 星海 lx 协议后端入口 */
const XINGHAI_API_BASE = 'https://yy.zddyr.top/lx/api/'

/** 访问者 IP 的探测地址：token 里需要带上调用方 IP */
const XINGHAI_IP_ENDPOINT = 'https://yy.zddyr.top/ip.php'

/** 取链时尝试的音质档位（按顺序尝试，前一个取不到就降一档） */
const XINGHAI_QUALITIES = ['320k', '128k']

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

/** 上游要求的客户端标识 */
const X_CLIENT = 'XingHaiMusicSource/v3.2.15 (Windows)'

/** 设备标识：随进程生成，用于上游识别调用方 */
let deviceId = ''

/** 上游看到的访问者 IP（缓存复用，避免每次取链都多打一次探测） */
let cachedIp = ''

/** 访问者 IP 的缓存时刻 */
let cachedIpAt = 0

/** 访问者 IP 的缓存时长（毫秒） */
const IP_CACHE_TTL = 10 * 60 * 1000

/** 上游鉴权 token（缓存复用） */
let cachedToken = ''

/** 上游鉴权 token 的缓存时刻 */
let cachedTokenAt = 0

/** 上游鉴权 token 的复用时长（毫秒） */
const TOKEN_CACHE_TTL = 5 * 60 * 1000

/** 星海音源熔断器：取链层独用 */
const breaker = new CircuitBreaker({
  name: '星海音源',
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
  const key = `xinghai|${target.title}|${target.artist}`
  const now = Date.now()
  const last = failureLogAt.get(key) ?? 0
  if (now - last < FAIL_LOG_THROTTLE_MS) return
  if (failureLogAt.size >= FAIL_LOG_THROTTLE_MAX_ENTRIES) {
    for (const [itemKey, loggedAt] of failureLogAt) {
      if (now - loggedAt >= FAIL_LOG_THROTTLE_MS) failureLogAt.delete(itemKey)
    }
  }
  failureLogAt.set(key, now)
  unblockLog.warn(`⚠️ 星海音源 换源失败（${target.title} / ${target.artist}）：${reason}`)
}

/** 星海协议里的歌曲信息 */
type XinghaiMusicInfo = {
  /** 歌曲 id（网易云歌曲 id） */
  songmid: string
  /** 歌名 */
  name: string
  /** 歌手 */
  singer: string
  /** 时长（mm:ss） */
  interval: string
  /** 专辑名 */
  albumName: string
}

/** 星海后端返回的业务体 */
type XinghaiResponse = {
  /** 业务码：200 成功 */
  code?: number
  /** 音频直链 */
  url?: string
  /** 失败描述 */
  msg?: string
}

/** 星海换源附加信息 */
export type XinghaiOptions = {
  /** 歌曲所属平台；只有网易云平台的 id 才能当网易云歌曲 id 用 */
  platform?: string
  /** 平台内歌曲原生 id（网易云歌曲 id） */
  platformId?: string
}

/**
 * 生成指定字节数的随机十六进制串
 *
 * 与服务端 crypto.randomBytes(n).toString('hex') 同形态（小写 hex）。
 * @param byteLength 字节数
 * @returns 2*byteLength 长度的小写十六进制串
 */
const randomHex = (byteLength: number): string => {
  const bytes = new Uint8Array(byteLength)
  globalThis.crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * 把 UTF-8 字符串编码为 base64
 *
 * 与服务端 Buffer.from(text, 'utf8').toString('base64') 同值。
 * @param text 原始文本
 * @returns base64 编码
 */
const utf8ToBase64 = (text: string): string => {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/**
 * 生成设备标识
 * @returns 设备标识
 */
const getDeviceId = (): string => {
  if (!deviceId) deviceId = randomHex(16)
  return deviceId
}

/**
 * 读取上游看到的访问者 IP
 *
 * token 里需要带上调用方 IP；探测失败时退化为 0.0.0.0，不阻断取链。
 * @returns 访问者 IP
 */
const fetchClientIp = async (): Promise<string> => {
  if (cachedIp && Date.now() - cachedIpAt < IP_CACHE_TTL) return cachedIp
  try {
    const response = await unblockRequest({
      url: XINGHAI_IP_ENDPOINT,
      headers: { 'User-Agent': UA },
      timeout: 4000,
    })
    const payload = (response.data instanceof Uint8Array ? null : response.data) as
      | { ip?: unknown }
      | string
      | null
    const ip = String(payload && typeof payload === 'object' ? payload.ip : '').trim()
    if (ip) {
      cachedIp = ip
      cachedIpAt = Date.now()
      return ip
    }
  } catch {
    // 探测失败不阻断取链
  }
  return '0.0.0.0'
}

/**
 * 生成上游鉴权 token
 *
 * 上游要求请求带上本地生成的设备标识与访问者 IP，服务端据此判定调用来源。
 * @param ip 访问者 IP
 * @returns token
 */
const buildToken = (ip: string): string =>
  utf8ToBase64(
    JSON.stringify({
      device_id: getDeviceId(),
      ip: ip || '0.0.0.0',
      timestamp: Math.floor(Date.now() / 1000),
      random: randomHex(6).slice(0, 10),
    }),
  )

/**
 * 读取上游鉴权 token
 *
 * token 在复用时长内保持不变：上游按设备标识与 IP 判定调用来源，
 * 频繁取链时重复生成没有意义。
 * @param ip 访问者 IP
 * @returns token
 */
const getToken = (ip: string): string => {
  if (cachedToken && Date.now() - cachedTokenAt < TOKEN_CACHE_TTL) return cachedToken
  cachedToken = buildToken(ip)
  cachedTokenAt = Date.now()
  return cachedToken
}

/**
 * 把秒数格式化成协议里的 mm:ss
 * @param seconds 秒数
 * @returns mm:ss 字符串
 */
const formatInterval = (seconds?: number): string => {
  if (!seconds || seconds <= 0) return ''
  const total = Math.round(seconds)
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
}

/**
 * 拼装星海后端的取链地址
 *
 * 参数与星海音源发出的完全一致：平台、歌名、歌手、歌曲 id、时长、专辑、音质。
 * @param info 协议里的歌曲信息
 * @param quality 音质档位
 * @returns 取链地址
 */
const buildApiUrl = (info: XinghaiMusicInfo, quality: string): string => {
  const params = new URLSearchParams({
    source: XINGHAI_SOURCE,
    name: info.name,
    singer: info.singer,
    songmid: info.songmid,
    interval: info.interval,
    albumName: info.albumName,
    quality,
  })
  return `${XINGHAI_API_BASE}?${params.toString()}`
}

/**
 * 单次取链的结论
 */
type XinghaiFetchOutcome = {
  /** 取到的直链；失败时为 null */
  url: string | null
  /** 失败原因描述 */
  reason: string
  /** 本次失败是否属于上游故障（计入熔断计数） */
  fault: boolean
}

/**
 * 向星海后端请求音频直链
 *
 * 故障口径与 resilience.ts 一致：HTTP 5xx、连接失败、超时与非 4xx 语义的业务码
 * 计入上游故障；4xx 属请求侧拒绝，不计入。
 * @param info 协议里的歌曲信息
 * @param quality 音质档位
 * @returns 取链结论
 */
const requestXinghaiUrl = async (
  info: XinghaiMusicInfo,
  quality: string,
): Promise<XinghaiFetchOutcome> => {
  const ip = await fetchClientIp()
  const headers = {
    'User-Agent': UA,
    'X-Token': getToken(ip),
    'X-Client': X_CLIENT,
    Accept: 'application/json',
  }
  const url = buildApiUrl(info, quality)
  try {
    const response = await unblockRequest({
      url,
      headers,
      timeout: REQUEST_TIMEOUT_MS,
    })
    const body = (response.data instanceof Uint8Array ? {} : response.data || {}) as XinghaiResponse
    if (response.status >= 500) {
      return { url: null, reason: `上游 HTTP ${response.status}`, fault: true }
    }
    if (response.status >= 400) {
      return { url: null, reason: `上游 HTTP ${response.status}`, fault: false }
    }
    if (body.code === 200 && body.url) {
      return { url: body.url, reason: '', fault: false }
    }
    const reason = body.msg || `上游业务码 ${body.code ?? response.status}`
    const business = extractBusinessError(body)
    return { url: null, reason, fault: business ? isBusinessFault(business) : false }
  } catch (error) {
    return { url: null, reason: String(error), fault: isUpstreamFault(error) }
  }
}

/**
 * 把网易云 CDN 的 http 直链升级为 https
 *
 * 上游会给回 http 直链，播放页在 https 下会被混合内容策略拦掉；
 * 网易云 CDN 本身支持 https，同一条直链换协议即可。
 * @param url 上游返回的直链
 * @returns 可直接播放的直链
 */
const normalizeUrl = (url: string): string => {
  if (!/^http:\/\//i.test(url)) return url
  try {
    const parsed = new URL(url)
    if (!/(^|\.)music\.126\.net$/i.test(parsed.hostname)) return url
    parsed.protocol = 'https:'
    return parsed.toString()
  } catch {
    return url
  }
}

/** 网易云之外的平台标识：这些平台的歌曲 id 不能当网易云歌曲 id 用 */
const FOREIGN_PLATFORMS = new Set(['qqmusic', 'qq', 'tx', 'kugou', 'kg', 'kuwo', 'kw'])

/** 网易云歌曲 id 的形态：纯数字 */
const NETEASE_SONG_ID_PATTERN = /^\d+$/

/**
 * 判断平台内歌曲 id 能否当网易云歌曲 id 用
 *
 * 网易云歌曲 id 是纯数字，别的平台（QQ 音乐 / 酷狗 / 酷我）的 id 不是。
 * 把别的平台的 id 喂进网易云编号空间，上游既取不到链、又会以「取链失败」的业务码
 * 回报 —— 那是请求侧的问题，却会被计成上游故障并熔断整条源。
 * @param platform 歌曲所属平台
 * @param platformId 平台内歌曲原生 id
 * @returns 是否是可用于本通道的网易云歌曲 id
 */
const isNeteaseSongId = (platform: string | undefined, platformId: string): boolean => {
  const normalized = (platform || '').trim().toLowerCase()
  if (normalized && FOREIGN_PLATFORMS.has(normalized)) return false
  return NETEASE_SONG_ID_PATTERN.test(platformId)
}

/**
 * 获取星海音源的网易云歌曲直链
 * @param target 目标歌曲信息（歌名 / 歌手 / 可选时长），由调用方按请求参数构造
 * @param options 平台信息（平台与平台原生 id）
 * @returns 歌曲直链结果
 */
const getXinghaiSongUrl = async (
  target: MatchTarget,
  options: XinghaiOptions = {},
): Promise<SongUrlResult> => {
  try {
    if (!target.title) return { code: 404, url: null, reason: MISSING_TITLE_REASON }
    if (!target.artist.trim()) return { code: 404, url: null, reason: MISSING_ARTIST_REASON }

    // 网易云歌曲 id 是本通道唯一的寻址主键：拿不到就不换源，不做检索猜测
    const songId = (options.platformId || '').trim()
    if (!songId || !isNeteaseSongId(options.platform, songId)) {
      logUnlockFailure(target, NO_CANDIDATE_REASON)
      return { code: 404, url: null, reason: NO_CANDIDATE_REASON }
    }

    if (!breaker.canRequest()) {
      unblockLog.warn(
        `🔌 星海音源处于熔断状态，跳过本次换源（剩余 ${Math.ceil(
          breaker.remainingOpenMs() / 1000,
        )} 秒）`,
      )
      return { code: 404, url: null, reason: UPSTREAM_UNAVAILABLE_REASON }
    }

    const expectedDuration = target.duration || 0
    const info: XinghaiMusicInfo = {
      songmid: songId,
      name: target.title,
      singer: target.artist,
      interval: formatInterval(expectedDuration),
      albumName: '',
    }

    let upstreamFault = false
    for (const quality of XINGHAI_QUALITIES) {
      const outcome = await requestXinghaiUrl(info, quality)
      if (!outcome.url) {
        upstreamFault = upstreamFault || outcome.fault
        unblockLog.log(`🔎 星海音源取链失败（${quality}）：${outcome.reason}`)
        continue
      }
      const url = normalizeUrl(outcome.url)
      const probe = await probeAudio(url, { 'User-Agent': UA })
      // 时长闸门：请求侧声明了时长时，读不出真实时长就不交付 —— 宁可换源失败也不播错版本
      if (expectedDuration) {
        if (!probe.durationSec) {
          unblockLog.warn('⚠️ xinghai candidate rejected: 未能读出真实音频时长')
          continue
        }
        const delta = Math.abs(probe.durationSec - expectedDuration)
        if (delta > durationTolerance(expectedDuration)) {
          unblockLog.warn(
            `⚠️ xinghai candidate rejected: 时长 ${probe.durationSec.toFixed(1)}s 偏离目标 ${expectedDuration}s`,
          )
          continue
        }
      }
      const check = isPlausibleAudioLength(
        probe.bytes,
        expectedDuration || undefined,
        probe.bitrateKbps ?? 128,
        target.duration,
      )
      if (!check.ok) {
        unblockLog.warn(`⚠️ xinghai candidate rejected: ${check.reason}`)
        continue
      }
      unblockLog.log('🔗 XinghaiSong URL:', sanitizeUrl(url))
      breaker.recordSuccess()
      return { code: 200, url, lengthVerified: check.verified }
    }
    if (upstreamFault) breaker.recordFailure()
    else breaker.recordSuccess()
    logUnlockFailure(target, FETCH_FAILED_REASON)
    return { code: 404, url: null, reason: FETCH_FAILED_REASON }
  } catch (error) {
    unblockLog.error('❌ Get XinghaiSong URL Error:', error)
    if (isUpstreamFault(error)) breaker.recordFailure()
    else breaker.recordSuccess()
    logUnlockFailure(target, UPSTREAM_UNAVAILABLE_REASON)
    return { code: 404, url: null, reason: UPSTREAM_UNAVAILABLE_REASON }
  }
}

export default getXinghaiSongUrl
