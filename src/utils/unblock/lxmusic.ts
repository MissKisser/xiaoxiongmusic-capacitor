/**
 * LX Music（落雪音乐）自定义音源换源
 *
 * lxmusic 的自定义源是一套「JS 脚本 + 宿主事件」协议：音源脚本 send(inited) 声明自己支持的平台与音质，
 * 应用随后以 on(request) 事件把 (source, action, info) 交给脚本，脚本在 Promise 里返回音频直链。
 * 协议里 musicUrl 动作的 info 结构固定为 { type: 音质, musicInfo: { songmid, name, singer, ... } }。
 *
 * 本模块不加载第三方脚本（第三方脚本不入库，也不在正式产物里执行），而是按同一套协议口径
 * 直接对接提供 lx 协议后端的音源服务：请求参数与 lx 音源脚本发出的完全一致，
 * 响应体为 { code, url }，url 即音频直链。
 *
 * 上游：星海音源的 lx/api 后端（社区公益接口，无第三方密钥，token 为本地生成的设备标识）
 * - 主域：https://yy.zddyr.top/lx/api/（唯一可用入口，上游暂无其他在线备域；
 *   主域故障时依赖熔断器跳过整源，不做域名故障转移）
 *
 * 能力：只接 QQ 音乐（lx 协议里的 tx 通道）。
 * - 歌曲自带 QQ mid 时零检索直查；
 * - 否则按「歌名 + 歌手」走 QQ 检索换 mid，候选过站外源同一套三重校验后再取链。
 *
 * 交付直链前做三重把关：
 * 1. 身份校验 —— 直链里的 QQ 音频文件 id 必须属于目标曲目（歌曲 mid 或其 media mid），防错版；
 * 2. 时长闸门 —— 真实音频时长必须与目标曲目时长在容差内，拦截片段与另一版本；
 * 3. 体积校验 —— 按「时长 × 码率」核对文件体积，拦截占位与残缺文件。
 *
 * 健壮性：公益上游无 SLA，检索层与取链层共用一个熔断器 ——
 * 上游 HTTP 5xx、连接失败、超时与非 4xx 语义的业务码计入故障，
 * 无候选 / 匹配失败 / 取链失败不计（与既有几源口径一致）；
 * 连续失败到阈值即熔断，熔断期内零请求。失败日志按「同源同曲」节流，避免刷屏。
 *
 * 上游请求经 http 封装层发起。随机数与 base64 用 Web 标准接口生成
 * （crypto.getRandomValues / btoa，token 载荷为 ASCII，与服务端 Node 实现等值）；
 * QQ 接口非 2xx 时按服务端 axios 默认语义抛错（携带状态），保证熔断归类逐字一致。
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
  type MatchCandidate,
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

/** lx 后端使用的平台名（协议里的 tx 在后端叫 qq） */
const LX_PLATFORM = 'qq'

/** lx 后端主机（上游暂无可用备域，仅主域；主域故障由熔断器兜底） */
const LX_API_BASES = ['https://yy.zddyr.top/lx/api/']

/** 访问者 IP 的探测地址：token 里需要带上调用方 IP */
const LX_IP_ENDPOINT = 'https://yy.zddyr.top/ip.php'

/** 取链时尝试的音质档位（按顺序尝试，前一个取不到就降一档） */
const LX_QUALITIES = ['320k', '128k']

/** 单次取链请求超时（毫秒） */
const REQUEST_TIMEOUT_MS = 8000

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

/** QQ 音乐接口入口 */
const QM_API_URL = 'https://u.y.qq.com/cgi-bin/musicu.fcg'

/** QQ 音乐接口请求头 */
const QM_HEADERS = {
  'Content-Type': 'application/json',
  'User-Agent': 'QQMusic 14090008(android 15)',
  Referer: 'https://y.qq.com',
}

/** 设备标识：随进程生成，用于上游识别调用方 */
let deviceId = ''

/** 上游看到的访问者 IP（缓存复用，避免每次取链都多打一次探测） */
let cachedIp = ''

/** 访问者 IP 的缓存时刻 */
let cachedIpAt = 0

/** 访问者 IP 的缓存时长（毫秒） */
const IP_CACHE_TTL = 10 * 60 * 1000

/** 落雪音源熔断器：检索层与取链层共用 */
const breaker = new CircuitBreaker({
  name: '落雪音源',
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
  const key = `lxmusic|${target.title}|${target.artist}`
  const now = Date.now()
  const last = failureLogAt.get(key) ?? 0
  if (now - last < FAIL_LOG_THROTTLE_MS) return
  if (failureLogAt.size >= FAIL_LOG_THROTTLE_MAX_ENTRIES) {
    for (const [itemKey, loggedAt] of failureLogAt) {
      if (now - loggedAt >= FAIL_LOG_THROTTLE_MS) failureLogAt.delete(itemKey)
    }
  }
  failureLogAt.set(key, now)
  unblockLog.warn(`⚠️ 落雪音源 换源失败（${target.title} / ${target.artist}）：${reason}`)
}

/** lx 协议里的歌曲信息（musicInfo） */
type LxMusicInfo = {
  /** 歌曲 id（QQ mid） */
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

/** lx 后端返回的业务体 */
type LxResponse = {
  /** 业务码：200 成功 */
  code?: number
  /** 音频直链 */
  url?: string
  /** 失败描述 */
  msg?: string
}

/** QQ 曲目详情（用于时长闸门与错版校验） */
type QqSongDetail = {
  /** 歌曲 mid */
  mid: string
  /** 歌名 */
  name: string
  /** 歌手 */
  artist: string
  /** 时长（秒） */
  duration: number
  /** 音频文件 id（media mid）：320k 一档的直链用的是它 */
  mediaMid: string
}

/** lxmusic 换源附加信息 */
export type LxmusicOptions = {
  /** 歌曲所属平台；只有 qqmusic 平台的 id 才能直接当 QQ mid 用 */
  platform?: string
  /** 平台内歌曲原生 id（QQ mid） */
  platformId?: string
}

/**
 * 生成指定字节数的随机十六进制串
 * @param bytes 字节数
 * @returns 小写十六进制字符串（每字节两字符）
 */
const randomHex = (bytes: number): string => {
  const buffer = new Uint8Array(bytes)
  crypto.getRandomValues(buffer)
  let hex = ''
  for (const byte of buffer) hex += byte.toString(16).padStart(2, '0')
  return hex
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
      url: LX_IP_ENDPOINT,
      headers: { 'User-Agent': UA },
      timeout: 4000,
    })
    const payload = (response.data || {}) as { ip?: unknown }
    const ip = String(payload?.ip || '').trim()
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
 * 上游要求每次请求带上本地生成的设备标识与访问者 IP，服务端据此判定调用来源。
 * 载荷字段全部为 ASCII，btoa 编码与服务端的 Buffer base64 等值。
 * @param ip 访问者 IP
 * @returns token
 */
const buildToken = (ip: string): string =>
  btoa(
    JSON.stringify({
      device_id: getDeviceId(),
      ip: ip || '0.0.0.0',
      timestamp: Math.floor(Date.now() / 1000),
      random: randomHex(6).slice(0, 10),
    }),
  )

/**
 * 把秒数格式化成 lx 协议里的 mm:ss
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
 * 拼装 lx 后端的取链地址
 *
 * 参数与 lx 音源脚本发出的完全一致：平台、歌名、歌手、歌曲 id、时长、专辑、音质。
 * @param base 后端主机
 * @param info lx 协议里的歌曲信息
 * @param quality 音质档位
 * @returns 取链地址
 */
const buildApiUrl = (base: string, info: LxMusicInfo, quality: string): string => {
  const params = new URLSearchParams({
    source: LX_PLATFORM,
    name: info.name,
    singer: info.singer,
    songmid: info.songmid,
    interval: info.interval,
    albumName: info.albumName,
    quality,
  })
  return `${base}?${params.toString()}`
}

/**
 * 单次取链的结论
 */
type LxFetchOutcome = {
  /** 取到的直链；失败时为 null */
  url: string | null
  /** 失败原因描述 */
  reason: string
  /** 本次失败是否属于上游故障（计入熔断计数） */
  fault: boolean
}

/**
 * 向 lx 后端请求音频直链
 *
 * 主域失败时按备域重试；两域都失败时返回失败原因。
 * 故障口径与 resilience.ts 一致：HTTP 5xx、连接失败、超时与非 4xx 语义的业务码
 * 计入上游故障；4xx 属请求侧拒绝，不计入。
 * @param info lx 协议里的歌曲信息
 * @param quality 音质档位
 * @returns 取链结论
 */
const requestLxMusicUrl = async (
  info: LxMusicInfo,
  quality: string,
): Promise<LxFetchOutcome> => {
  const ip = await fetchClientIp()
  const headers = { 'User-Agent': UA, 'X-Token': buildToken(ip), Accept: 'application/json' }
  let lastReason = '上游未返回直链'
  let fault = false
  for (const base of LX_API_BASES) {
    const url = buildApiUrl(base, info, quality)
    try {
      const response = await unblockRequest({
        url,
        headers,
        timeout: REQUEST_TIMEOUT_MS,
      })
      const body = (response.data || {}) as LxResponse
      if (response.status >= 500) {
        lastReason = `上游 HTTP ${response.status}`
        fault = true
        continue
      }
      if (response.status >= 400) {
        lastReason = `上游 HTTP ${response.status}`
        continue
      }
      if (body.code === 200 && body.url) {
        return { url: body.url, reason: '', fault: false }
      }
      lastReason = body.msg || `上游业务码 ${body.code ?? response.status}`
      const business = extractBusinessError(body)
      if (business && isBusinessFault(business)) fault = true
    } catch (error) {
      lastReason = String(error)
      fault = fault || isUpstreamFault(error)
    }
  }
  return { url: null, reason: lastReason, fault }
}

/**
 * 把 QQ CDN 的 http 直链升级为 https
 *
 * 上游会给回 http 直链，播放页在 https 下会被混合内容策略拦掉；
 * QQ CDN 本身支持 https，同一 vkey 换协议即可。
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
 * 提取 QQ 音频文件路径里的文件 id
 *
 * QQ 直链形如 .../M800000cZNr42YkLl1.mp3（M 前缀是 800k 一档，文件 id 是 media mid）
 * 或 .../M500002MXZNu1GToOk.mp3 / .../F000002MXZNu1GToOk.flac（文件 id 是歌曲 mid）。
 */
const QQ_FILE_PATTERN = /\/(?:M|F)\d{3}([A-Za-z0-9]+)\.(?:mp3|m4a|flac|aac|ogg)/i

/**
 * 校验直链指向的是不是目标曲目
 *
 * 非 QQ CDN 形态的直链无法提取文件 id，此时退化为只做时长闸门。
 * @param url 直链
 * @param songMid 目标曲目的歌曲 mid
 * @param mediaMid 目标曲目的音频文件 id
 * @returns 是否指向目标曲目
 */
const isSameSongFile = (url: string, songMid: string, mediaMid: string): boolean => {
  const matched = url.match(QQ_FILE_PATTERN)
  if (!matched) return true
  const fileId = matched[1]
  return fileId === songMid || (!!mediaMid && fileId === mediaMid)
}

/**
 * 把非 2xx 响应还原成服务端 axios 默认的失败形态
 *
 * 服务端 axios 对非 2xx 抛出携带响应状态的异常，isUpstreamFault 据此归类；
 * http 封装层恒真返回状态码，这里补抛同形态异常（error.status）对齐口径。
 * @param status HTTP 状态码
 */
const throwHttpStatus = (status: number): never => {
  const error = new Error(`QM API HTTP ${status}`) as Error & { status: number }
  error.status = status
  throw error
}

/**
 * 调用 QQ 音乐接口
 * @param method 接口方法
 * @param module 接口模块
 * @param param 接口参数
 * @returns 业务数据段
 */
const qmRequest = async (method: string, module: string, param: Record<string, unknown>) => {
  const response = await unblockRequest({
    url: QM_API_URL,
    method: 'POST',
    headers: QM_HEADERS,
    data: {
      comm: {
        ct: 11,
        cv: 14090008,
        v: 14090008,
        chid: '10003505',
        os_ver: '15',
        phonetype: '24122RKC7C',
        tmeAppID: 'qqmusic',
        nettype: 'NETWORK_WIFI',
        udid: '0',
        OpenUDID: '0',
        QIMEI36: '0',
        uin: '0',
      },
      request: { method, module, param },
    },
    timeout: 10000,
  })
  if (response.status < 200 || response.status >= 300) throwHttpStatus(response.status)
  const data = response.data as any
  if (data?.code !== 0 || data?.request?.code !== 0) {
    throw new Error(`QM API 错误: ${data?.code || data?.request?.code}`)
  }
  return data.request.data
}

/**
 * 去掉搜索结果的命中高亮标签
 * @param text 原始文本
 * @returns 去掉标签后的文本
 */
const stripHighlight = (text: unknown): string =>
  typeof text === 'string' ? text.replace(/<\/?em>/g, '') : ''

/**
 * 拼接歌手名
 * @param singer 歌手数组
 * @returns 歌手名
 */
const formatSingerName = (singer: unknown): string =>
  Array.isArray(singer)
    ? singer
        .map((item) => stripHighlight((item as { name?: string })?.name))
        .filter(Boolean)
        .join(' / ')
    : ''

/**
 * 检索 QQ 音乐候选
 * @param title 歌名
 * @param artist 歌手
 * @returns 归一化后的候选列表
 */
const searchQqCandidates = async (title: string, artist: string): Promise<MatchCandidate[]> => {
  const group = BigInt(Math.floor(Math.random() * 20) + 1)
  const random = BigInt(Math.floor(Math.random() * 4194305))
  const todayMs = BigInt(Date.now() % 86400000)
  const searchId = (group * 18014398509481984n + random * 4294967296n + todayMs).toString()
  const data = await qmRequest('DoSearchForQQMusicMobile', 'music.search.SearchCgiService', {
    searchid: searchId,
    query: `${title}-${artist}`,
    page_num: 1,
    num_per_page: SEARCH_LIMIT,
    search_type: 0,
    highlight: true,
    grp: 1,
    selectors: {},
    vec_selectors: [],
  })
  const songs = data?.body?.item_song || []
  const candidates: MatchCandidate[] = []
  for (const song of songs) {
    const id = String(song?.mid ?? '')
    const songTitle = stripHighlight(song?.title || song?.name || '').trim()
    if (!id || !songTitle) continue
    const duration = Math.round(Number(song?.interval ?? 0))
    candidates.push({
      id,
      title: songTitle,
      artist: formatSingerName(song?.singer),
      duration: duration > 0 ? duration : undefined,
    })
  }
  return candidates
}

/**
 * 读取 QQ 曲目详情
 *
 * 详情里的时长用于时长闸门，media mid 用于确认直链指向的是同一首曲子。
 * @param mid 歌曲 mid
 * @returns 曲目详情；读取失败时返回 null
 */
const fetchQqSongDetail = async (mid: string): Promise<QqSongDetail | null> => {
  try {
    const data = await qmRequest('get_song_detail_yqq', 'music.pf_song_detail_svr', {
      song_type: 0,
      song_mid: mid,
    })
    const track = data?.track_info
    if (!track) return null
    return {
      mid: String(track?.mid ?? mid),
      name: stripHighlight(track?.title || track?.name || ''),
      artist: formatSingerName(track?.singer),
      duration: Math.round(Number(track?.interval ?? 0)),
      mediaMid: String(track?.file?.media_mid ?? ''),
    }
  } catch {
    return null
  }
}

/**
 * 解析目标歌曲的 QQ mid
 *
 * 歌曲自带 QQ mid 时零检索直查；否则按「歌名 + 歌手」检索换 mid，
 * 候选必须过站外源同一套三重校验（歌名 / 歌手 / 时长）。
 * @param target 目标歌曲信息
 * @param options 平台信息
 * @returns mid；无法确定时返回 null 与原因
 */
const resolveSongMid = async (
  target: MatchTarget,
  options: LxmusicOptions,
): Promise<{ mid: string | null; reason: string }> => {
  if (options.platform === 'qqmusic' && options.platformId?.trim()) {
    return { mid: options.platformId.trim(), reason: '' }
  }
  const candidates = await searchQqCandidates(target.title, target.artist)
  if (!candidates.length) return { mid: null, reason: NO_CANDIDATE_REASON }
  const ranked = rankCandidates(candidates, target).filter((detail) => detail.passed)
  if (!ranked.length) return { mid: null, reason: MATCH_FAILED_REASON }
  return { mid: ranked[0].candidate.id, reason: '' }
}

/**
 * 获取 lxmusic 歌曲直链
 * @param target 目标歌曲信息（歌名 / 歌手 / 可选时长），由路由层按请求参数构造
 * @param options 平台信息（平台与平台原生 id）
 * @returns 歌曲直链结果
 */
const getLxmusicSongUrl = async (
  target: MatchTarget,
  options: LxmusicOptions = {},
): Promise<SongUrlResult> => {
  try {
    if (!target.title) return { code: 404, url: null, reason: MISSING_TITLE_REASON }
    if (!target.artist.trim()) return { code: 404, url: null, reason: MISSING_ARTIST_REASON }

    if (!breaker.canRequest()) {
      unblockLog.warn(
        `🔌 落雪音源处于熔断状态，跳过本次换源（剩余 ${Math.ceil(
          breaker.remainingOpenMs() / 1000,
        )} 秒）`,
      )
      return { code: 404, url: null, reason: UPSTREAM_UNAVAILABLE_REASON }
    }

    const resolved = await resolveSongMid(target, options)
    if (!resolved.mid) {
      // 无候选 / 匹配失败是请求侧结论，不计入熔断
      breaker.recordSuccess()
      const reason = resolved.reason || NO_CANDIDATE_REASON
      logUnlockFailure(target, reason)
      return { code: 404, url: null, reason }
    }
    const mid = resolved.mid

    const detail = await fetchQqSongDetail(mid)
    const expectedDuration = detail?.duration || target.duration || 0
    const info: LxMusicInfo = {
      songmid: mid,
      name: target.title,
      singer: target.artist,
      interval: formatInterval(expectedDuration),
      albumName: '',
    }

    let upstreamFault = false
    for (const quality of LX_QUALITIES) {
      const outcome = await requestLxMusicUrl(info, quality)
      if (!outcome.url) {
        upstreamFault = upstreamFault || outcome.fault
        unblockLog.log(`🔎 落雪音源取链失败（${quality}）：${outcome.reason}`)
        continue
      }
      const url = normalizeUrl(outcome.url)
      if (!isSameSongFile(url, mid, detail?.mediaMid ?? '')) {
        unblockLog.warn('⚠️ lxmusic candidate rejected: 直链文件不属于目标曲目')
        continue
      }
      const probe = await probeAudio(url, { 'User-Agent': UA })
      if (!probe.durationSec) {
        unblockLog.warn('⚠️ lxmusic candidate rejected: 未能读出真实音频时长')
        continue
      }
      if (expectedDuration) {
        const delta = Math.abs(probe.durationSec - expectedDuration)
        if (delta > DURATION_GATE_TOLERANCE_S) {
          unblockLog.warn(
            `⚠️ lxmusic candidate rejected: 时长 ${probe.durationSec.toFixed(1)}s 偏离目标 ${expectedDuration}s`,
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
        unblockLog.warn(`⚠️ lxmusic candidate rejected: ${check.reason}`)
        continue
      }
      unblockLog.log('🔗 LxmusicSong URL:', sanitizeUrl(url))
      breaker.recordSuccess()
      return { code: 200, url, lengthVerified: check.verified }
    }
    if (upstreamFault) breaker.recordFailure()
    else breaker.recordSuccess()
    logUnlockFailure(target, FETCH_FAILED_REASON)
    return { code: 404, url: null, reason: FETCH_FAILED_REASON }
  } catch (error) {
    unblockLog.error('❌ Get LxmusicSong URL Error:', error)
    if (isUpstreamFault(error)) breaker.recordFailure()
    else breaker.recordSuccess()
    logUnlockFailure(target, UPSTREAM_UNAVAILABLE_REASON)
    return { code: 404, url: null, reason: UPSTREAM_UNAVAILABLE_REASON }
  }
}

export default getLxmusicSongUrl
