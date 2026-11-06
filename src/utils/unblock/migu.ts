/**
 * 咪咕音乐换源
 *
 * 咪咕是第一方官方曲库：免登录即可检索与取链，站内非免费曲以 `code=440000` 干净拒绝，
 * 不会拿试听片段冒充整曲。
 *
 * 端点形态：
 * 1. 检索 `GET https://c.musicapp.migu.cn/v1.0/content/search_all.do?text=<关键词>&...`
 *    —— 响应整体带自有混淆（前导魔数 + 1 字节种子 + 固定密钥逐字节还原）；
 * 2. 取链 `GET https://c.musicapp.migu.cn/strategy/listen-url/h5/v2.4?contentId=&copyrightId=&resourceType=&toneFlag=...`
 *    —— `code=000000` 成功；响应里的 `data.song.duration` 是权威整曲时长（秒）。
 *
 * 检索结果不带时长字段，用各音质的字节数除以标称码率反推（取中位数，规避试听音质把时长拉偏）。
 *
 * 健壮性：
 * 1. 整条换源挂熔断器（检索层与取链层共用）：连续出现上游侧故障到阈值即熔断，
 *    熔断期内零请求，避免对死源逐首空等；
 * 2. 取链层按有界退避重试，救回瞬时故障；
 * 3. 成功的关键词检索结果按短缓存复用，连续切歌回到同一首歌时不再重复打检索。
 *
 * 故障归属：咪咕用 HTTP 200 裹着业务码返回失败结论，
 * 业务码语义按「谁该负责」划分：
 * - 参数校验失败（299999）是我方参数问题，请求侧，不计入；
 * - 歌曲下线（200000）、免登录态无播放权限（440000）是逐曲拒绝，不计入；
 * - 其余业务失败码是上游没能给出可用资源，上游侧，计入。
 * 传输层故障（5xx / 超时 / 连接异常）与响应体无法解析同样计入。
 *
 * 所有状态都是纯内存态：进程重启即重置，不落盘、不产生界面提示，只进日志。
 *
 * 上游请求经 http 封装层发起；混淆还原的字节运算与服务端逐字一致。
 *
 * 移动端原生环境（Capacitor 原生层）整源快速失败：原生桥接层对
 * application/json Content-Type 的响应体一律按文本读取并抢先解析，
 * responseType arraybuffer 被忽略，咪咕端点的混淆字节流无法保真取回，
 * 因此原生环境下不再发起请求，直接按源不可用交付，由换源竞速旁路。
 */
import type { SongUrlResult } from './types'
import { unblockLog, unblockRequest } from './http'
import { isCapacitor } from '@/utils/env'
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
import { probeContentLength } from './audio-length'
import { sanitizeUrl } from './sanitize'
import { CircuitBreaker, TTLCache, isUpstreamFault, sleep } from './resilience'

/** 咪咕检索端点 */
const MIGU_SEARCH_URL = 'https://c.musicapp.migu.cn/v1.0/content/search_all.do'

/** 咪咕取链端点 */
const MIGU_LISTEN_URL = 'https://c.musicapp.migu.cn/strategy/listen-url/h5/v2.4'

/** 咪咕响应混淆的固定密钥（公开接口的协议常量，非本机凭据） */
const MIGU_KEY = 'Jk8qzuePiJ1qE3mDYhLQ3T73DtDoAhLP'

/** 咪咕响应混淆的魔数（3 字节） */
const MIGU_MAGIC = [0xab, 0xcd, 0x01]

/** 咪咕音质档位 → 标称码率（kbps），用于把字节数换算成时长 */
const MIGU_TONE_KBPS: Record<string, number> = {
  LQ: 64,
  PQ: 128,
  HQ: 320,
  SQ: 800,
  ZQ: 1000,
  ZQ24: 2000,
}

/** 咪咕公共请求头（客户端标识随协议固定，非账号凭据） */
const MIGU_HEADERS: Record<string, string> = {
  Accept: 'application/json, text/plain, */*',
  Origin: 'https://h5.nf.migu.cn',
  Referer: 'https://h5.nf.migu.cn/',
  ua: 'Android_migu',
  version: '6.8.8',
  channel: '014021I',
  subchannel: '014021I',
}

/** 咪咕客户端 UA */
const MIGU_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1'

/** 整条换源连续失败多少次后熔断 */
const FAILURE_THRESHOLD = 3

/** 熔断持续时长（毫秒）：期间该源直接跳过，不发起任何请求 */
const BREAK_DURATION_MS = 10 * 60 * 1000

/** 咪咕检索与取链的成功业务码 */
const SUCCESS_CODE = '000000'

/**
 * 咪咕逐曲拒绝的业务码
 *
 * 该曲在咪咕侧没有可播放资源（歌曲已下线、免登录态无播放权限），
 * 属逐曲拒绝而非源故障，不计入熔断计数。
 */
const PER_SONG_REJECT_CODES = new Set(['200000', '440000'])

/**
 * 咪咕请求侧的业务码
 *
 * 参数校验失败（检索词为空、音质档位非法等）是我方请求本身的问题，不计入熔断计数。
 */
const REQUEST_SIDE_CODES = new Set(['299999'])

/** 关键词检索结果缓存时长（毫秒） */
const SEARCH_CACHE_TTL_MS = 60000

/** 关键词检索结果缓存条目上限 */
const SEARCH_CACHE_MAX_ENTRIES = 64

/** 单次请求超时（毫秒） */
const REQUEST_TIMEOUT_MS = 10000

/** 取链阶段瞬时故障的重试次数 */
const FETCH_RETRY_LIMIT = 2

/** 取链阶段重试的退避阶梯（毫秒） */
const FETCH_BACKOFF_MS = [300, 600]

/** 单次换源最多尝试的候选数 */
const MAX_CANDIDATE_TRY = 3

/** 原生环境下咪咕源整源不可用的失败文案 */
const NATIVE_UNSUPPORTED_REASON = '移动端原生环境暂不支持咪咕音源'

/** 单个候选最多尝试的音质档位数 */
const MAX_FORMAT_TRY = 3

/** 咪咕源熔断器：检索层与取链层共用 */
const sourceBreaker = new CircuitBreaker({
  name: '咪咕',
  failureThreshold: FAILURE_THRESHOLD,
  openDurationMs: BREAK_DURATION_MS,
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
  const key = `migu|${target.title}|${target.artist}`
  const now = Date.now()
  const last = failureLogAt.get(key) ?? 0
  if (now - last < FAIL_LOG_THROTTLE_MS) return
  if (failureLogAt.size >= FAIL_LOG_THROTTLE_MAX_ENTRIES) {
    for (const [itemKey, loggedAt] of failureLogAt) {
      if (now - loggedAt >= FAIL_LOG_THROTTLE_MS) failureLogAt.delete(itemKey)
    }
  }
  failureLogAt.set(key, now)
  unblockLog.warn(`⚠️ 咪咕 换源失败（${target.title} / ${target.artist}）：${reason}`)
}

/** 关键词检索结果缓存 */
const searchCache = new TTLCache<MiguCandidate[]>(SEARCH_CACHE_TTL_MS, SEARCH_CACHE_MAX_ENTRIES)

/** 咪咕音质条目（检索结果里随歌返回） */
type MiguFormat = {
  /** 音质档位标识（PQ / LQ / HQ …） */
  formatType: string
  /** 音质资源类型，取链时按此参数取链 */
  resourceType: string
  /** 该音质的文件字节数 */
  size: number
}

/** 咪咕检索候选 */
type MiguCandidate = {
  /** 咪咕内容 id（取链用） */
  id: string
  /** 咪咕版权 id（取链时一并带上） */
  copyrightId: string
  /** 歌名 */
  title: string
  /** 歌手 */
  artist: string
  /** 由字节数反推的时长（秒） */
  duration?: number
  /** 该候选的音质列表（取链时遍历） */
  formats: MiguFormat[]
}

/**
 * 还原咪咕响应的混淆层
 *
 * 响应以 3 字节魔数开头，第 4 字节是种子，其后逐字节按「加种子、减密钥字节」还原。
 * 未带魔数的响应原样返回（上游偶尔会直接给明文 JSON）。
 * @param data 原始响应字节
 * @returns 还原后的字节
 */
const decodeMiguResponse = (data: Uint8Array): Uint8Array => {
  if (
    data.length < 5 ||
    data[0] !== MIGU_MAGIC[0] ||
    data[1] !== MIGU_MAGIC[1] ||
    data[2] !== MIGU_MAGIC[2]
  ) {
    return data
  }
  const seed = data[3]
  const plain = new Uint8Array(data.length - 4)
  for (let i = 0; i < plain.length; i++) {
    plain[i] = (data[4 + i] + seed - MIGU_KEY.charCodeAt(i % MIGU_KEY.length)) & 0xff
  }
  return plain
}

/**
 * 取出候选的音质列表
 * @param item 咪咕检索条目
 * @returns 音质列表
 */
const pickFormats = (item: any): MiguFormat[] => {
  const raw: any[] = [
    ...(item?.rateFormats ?? []),
    ...(item?.newRateFormats ?? []),
    ...(item?.audioFormats ?? []),
  ]
  const formats: MiguFormat[] = []
  for (const entry of raw) {
    const formatType = String(entry?.formatType ?? '')
    const size = Number(entry?.size ?? entry?.iosSize ?? 0)
    if (!formatType || !Number.isFinite(size) || size <= 0) continue
    // Z3D 是加密试听档，取链拿不到整曲
    if (formatType === 'Z3D') continue
    formats.push({ formatType, resourceType: String(entry?.resourceType ?? ''), size })
  }
  return formats
}

/**
 * 按各音质的字节数反推候选时长
 *
 * 咪咕检索结果不带时长字段：字节数 ÷ 该档标称码率即秒数。
 * 免费档（PQ 128k / LQ 64k）的标称码率与实际文件一致，优先采用；
 * 没有免费档时才退到各档估算值的中位数（试听档字节数很小，会把时长拉到几十秒）。
 * @param formats 音质列表
 * @returns 时长（秒）；无法估算时返回 undefined
 */
const estimateDuration = (formats: MiguFormat[]): number | undefined => {
  const byType = new Map(formats.map((format) => [format.formatType, format]))
  for (const type of ['PQ', 'LQ']) {
    const format = byType.get(type)
    const kbps = MIGU_TONE_KBPS[type]
    if (format && kbps) return Math.round(format.size / ((kbps * 1000) / 8))
  }
  const estimates: number[] = []
  for (const format of formats) {
    const kbps = MIGU_TONE_KBPS[format.formatType]
    if (!kbps) continue
    estimates.push(format.size / ((kbps * 1000) / 8))
  }
  if (!estimates.length) return undefined
  estimates.sort((a, b) => a - b)
  return Math.round(estimates[Math.floor(estimates.length / 2)])
}

/**
 * 判断咪咕的业务码是否属于上游侧故障
 *
 * 口径：
 * - 逐曲拒绝码（歌曲已下线、免登录态无播放权限）：该曲在此源无资源，不计入；
 * - 请求侧码（参数校验失败）：我方参数问题，不计入；
 * - 其余业务码（含缺失业务码的异常响应）：上游没能给出可用资源，计入。
 * @param code 咪咕业务码
 * @returns 是否计入熔断故障计数
 */
const isMiguBusinessFault = (code: string): boolean => {
  if (PER_SONG_REJECT_CODES.has(code)) return false
  if (REQUEST_SIDE_CODES.has(code)) return false
  return true
}

/**
 * 解析咪咕检索响应
 * @param data 原始响应字节
 * @returns 业务码与归一化后的候选列表
 */
const parseSearchResponse = (data: Uint8Array): { code: string; candidates: MiguCandidate[] } => {
  let payload: any = null
  try {
    payload = JSON.parse(new TextDecoder().decode(decodeMiguResponse(data)))
  } catch {
    return { code: '', candidates: [] }
  }
  const code = String(payload?.code ?? '')
  const list: any[] = payload?.songResultData?.result ?? []
  const candidates: MiguCandidate[] = []
  for (const item of list) {
    const id = String(item?.contentId ?? '')
    const title = String(item?.name ?? item?.songName ?? item?.title ?? '').trim()
    if (!id || !title) continue
    const singers = item?.singers ?? item?.singerList ?? []
    const artist = Array.isArray(singers)
      ? singers
          .map((singer: any) => String(singer?.name ?? singer ?? ''))
          .filter(Boolean)
          .join(' / ')
      : String(singers ?? '')
    const formats = pickFormats(item)
    const duration = estimateDuration(formats)
    candidates.push({
      id,
      copyrightId: String(item?.copyrightId ?? ''),
      title,
      artist,
      duration,
      formats,
    })
  }
  return { code, candidates }
}

/**
 * 检索咪咕候选歌曲
 *
 * 「歌名-歌手」与「歌名 歌手」两组关键词分别检索后合并去重：
 * 咪咕是全文检索，两种分隔形式命中的候选池不同，合并后召回更全。
 *
 * @param title 歌名
 * @param artist 歌手，可为空
 * @returns 候选列表、整轮检索是否失败与其中的上游故障标记
 */
const searchCandidates = async (
  title: string,
  artist: string,
): Promise<{ candidates: MiguCandidate[]; upstreamFailed: boolean; upstreamFault: boolean }> => {
  const keywords = artist ? [`${title}-${artist}`, `${title} ${artist}`] : [title]
  const merged: MiguCandidate[] = []
  const seen = new Set<string>()
  let failed = 0
  let fault = false
  for (const keyword of keywords) {
    const cacheKey = keyword
    const cached = searchCache.get(cacheKey)
    if (cached) {
      unblockLog.log(`♻️ 咪咕检索结果命中缓存（关键词：${keyword}）`)
      for (const candidate of cached) {
        if (seen.has(candidate.id)) continue
        seen.add(candidate.id)
        merged.push(candidate)
      }
      continue
    }
    try {
      const searchSwitch = JSON.stringify({
        song: 1,
        album: 0,
        singer: 0,
        tagSong: 1,
        mvSong: 0,
        bestShow: 1,
      })
      const query = new URLSearchParams({
        text: keyword,
        pageNo: '1',
        pageSize: '20',
        isCopyright: '1',
        sort: '1',
        searchSwitch,
      })
      const response = await unblockRequest({
        url: `${MIGU_SEARCH_URL}?${query.toString()}`,
        headers: MIGU_HEADERS,
        responseType: 'arraybuffer',
        timeout: REQUEST_TIMEOUT_MS,
      })
      if (response.status !== 200) {
        failed += 1
        if (response.status >= 500) fault = true
        continue
      }
      const bytes = response.data instanceof Uint8Array ? response.data : new Uint8Array(0)
      const parsed = parseSearchResponse(bytes)
      if (parsed.code && parsed.code !== SUCCESS_CODE) {
        // 上游以 HTTP 200 返回业务失败：按错误码语义区分归因
        failed += 1
        if (isMiguBusinessFault(parsed.code)) fault = true
        unblockLog.warn(`⚠️ Migu 检索业务错误（关键词：${keyword}）：code=${parsed.code}`)
        continue
      }
      const candidates = parsed.candidates
      unblockLog.log(`🔎 Migu 检索（关键词：${keyword}）：候选 ${candidates.length} 条`)
      if (candidates.length) searchCache.set(cacheKey, candidates)
      for (const candidate of candidates) {
        if (seen.has(candidate.id)) continue
        seen.add(candidate.id)
        merged.push(candidate)
      }
    } catch (error) {
      failed += 1
      if (isUpstreamFault(error)) fault = true
      unblockLog.warn(`⚠️ Migu 检索失败（关键词：${keyword}）：${String(error)}`)
    }
  }
  const upstreamFailed = failed === keywords.length
  // 整轮检索都因上游故障（5xx / 超时 / 连接失败 / 上游责任业务码）而失败时计入熔断计数；
  // 只要上游还有响应就认为源仍可达，清零失败计数。
  return { candidates: merged, upstreamFailed, upstreamFault: upstreamFailed && fault }
}

/**
 * 按音质档位取链
 *
 * 遍历候选的音质：免费档优先（PQ 128k → LQ 64k），其余按字节数降序；
 * 取链成功时一并带回上游给出的权威时长。
 * 故障归属：HTTP 5xx、超时、连接异常与响应体无法解析属上游侧故障；
 * HTTP 4xx、逐曲拒绝码（歌曲下线 / 无播放权限）、请求侧码（参数校验失败）
 * 与「成功码但没有直链」（该档位无资源）都不计入。
 * @param candidate 咪咕候选
 * @returns 直链、权威时长与该档码率；失败时 source 为 null，并给出上游故障标记
 */
const fetchMiguUrl = async (
  candidate: MiguCandidate,
): Promise<{
  source: { url: string; duration?: number; bitrate: number } | null
  fault: boolean
}> => {
  const rank = (format: MiguFormat) =>
    format.formatType === 'PQ' ? 0 : format.formatType === 'LQ' ? 1 : 2
  const formats = [...candidate.formats].sort((a, b) => {
    const byRank = rank(a) - rank(b)
    if (byRank !== 0) return byRank
    return b.size - a.size
  })
  const notes: string[] = []
  let fault = false
  for (const format of formats.slice(0, MAX_FORMAT_TRY)) {
    const params = {
      contentId: candidate.id,
      copyrightId: candidate.copyrightId,
      resourceType: format.resourceType,
      netType: '01',
      toneFlag: format.formatType,
      scene: '',
      lowerQualityContentId: candidate.id,
    }
    for (let attempt = 0; attempt <= FETCH_RETRY_LIMIT; attempt += 1) {
      try {
        const query = new URLSearchParams(params)
        const response = await unblockRequest({
          url: `${MIGU_LISTEN_URL}?${query.toString()}`,
          headers: {
            'Content-Type': 'application/json;charset=UTF-8',
            birth: 'h5page',
            signature: '1',
            ...MIGU_HEADERS,
          },
          responseType: 'arraybuffer',
          timeout: REQUEST_TIMEOUT_MS,
        })
        if (response.status >= 500) {
          if (attempt < FETCH_RETRY_LIMIT) {
            await sleep(FETCH_BACKOFF_MS[attempt])
            continue
          }
          notes.push(`${format.formatType}:HTTP${response.status}`)
          fault = true
          break
        }
        if (response.status !== 200) {
          notes.push(`${format.formatType}:HTTP${response.status}`)
          break
        }
        let payload: any = null
        try {
          const bytes = response.data instanceof Uint8Array ? response.data : new Uint8Array(0)
          payload = JSON.parse(new TextDecoder().decode(decodeMiguResponse(bytes)))
        } catch {
          notes.push(`${format.formatType}:非JSON`)
          fault = true
          break
        }
        const code = String(payload?.code ?? '')
        const url = String(payload?.data?.url ?? '')
        if (code === SUCCESS_CODE) {
          if (!url.startsWith('http')) {
            // 成功码但没有直链：该曲在这个档位没有资源，属逐曲拒绝
            notes.push(`${format.formatType}:无直链`)
            break
          }
          const duration = Math.round(Number(payload?.data?.song?.duration ?? 0))
          return {
            source: {
              url,
              duration: duration > 0 ? duration : undefined,
              bitrate: MIGU_TONE_KBPS[format.formatType] ?? 128,
            },
            fault,
          }
        }
        // 440000 表示免登录态无播放权限（站内非免费曲），属干净拒绝，不重试
        notes.push(`${format.formatType}:${code || '无业务码'}`)
        if (isMiguBusinessFault(code)) fault = true
        break
      } catch (error) {
        if (attempt < FETCH_RETRY_LIMIT) {
          await sleep(FETCH_BACKOFF_MS[attempt])
          continue
        }
        notes.push(`${format.formatType}:${String(error)}`)
        fault = true
        break
      }
    }
  }
  unblockLog.warn(
    `⚠️ Migu 未取到播放地址（${candidate.title} / ${candidate.artist}）：${notes.join(' / ')}`,
  )
  return { source: null, fault }
}

/**
 * 获取咪咕歌曲直链
 * @param target 目标歌曲信息（歌名 / 歌手 / 可选时长），由路由层按请求参数构造
 * @param breaker 熔断器；缺省使用模块级实例（测试可注入短熔断窗口的实例）
 * @returns 歌曲直链结果
 */
const getMiguSongUrl = async (
  target: MatchTarget,
  breaker: CircuitBreaker = sourceBreaker,
): Promise<SongUrlResult> => {
  try {
    // 原生环境兜底：混淆字节流经原生桥接无法保真取回，按源不可用快速失败，
    // 不发起任何请求，换源竞速编排会自动旁路该源
    if (isCapacitor) {
      unblockLog.warn(`⚠️ 咪咕 换源跳过：${NATIVE_UNSUPPORTED_REASON}`)
      return { code: 404, url: null, reason: NATIVE_UNSUPPORTED_REASON }
    }
    if (!target.title) return { code: 404, url: null, reason: MISSING_TITLE_REASON }
    if (!target.artist.trim()) return { code: 404, url: null, reason: MISSING_ARTIST_REASON }
    if (!breaker.canRequest()) {
      unblockLog.warn(
        `🔌 咪咕处于熔断状态，跳过本次换源（剩余 ${Math.ceil(
          breaker.remainingOpenMs() / 1000,
        )} 秒）`,
      )
      return { code: 404, url: null, reason: UPSTREAM_UNAVAILABLE_REASON }
    }
    const search = await searchCandidates(target.title, target.artist)
    if (search.upstreamFailed) {
      if (search.upstreamFault) breaker.recordFailure()
      else breaker.recordSuccess()
      logUnlockFailure(target, UPSTREAM_UNAVAILABLE_REASON)
      return { code: 404, url: null, reason: UPSTREAM_UNAVAILABLE_REASON }
    }
    if (!search.candidates.length) {
      breaker.recordSuccess()
      logUnlockFailure(target, NO_CANDIDATE_REASON)
      return { code: 404, url: null, reason: NO_CANDIDATE_REASON }
    }
    const ranked = rankCandidates(search.candidates, target).filter((detail) => detail.passed)
    unblockLog.log(`🔎 Migu 三重校验（歌名/歌手/时长）：通过 ${ranked.length} 条候选`)
    if (!ranked.length) {
      breaker.recordSuccess()
      logUnlockFailure(target, MATCH_FAILED_REASON)
      return { code: 404, url: null, reason: MATCH_FAILED_REASON }
    }
    let upstreamFault = false
    for (const detail of ranked.slice(0, MAX_CANDIDATE_TRY)) {
      const candidate = detail.candidate as MiguCandidate
      const outcome = await fetchMiguUrl(candidate)
      upstreamFault = upstreamFault || outcome.fault
      if (!outcome.source) continue
      const source = outcome.source
      // 上游给出的整曲时长优先；与请求时长偏差超容差即判为错版，拒绝交付
      const realDuration = source.duration ?? candidate.duration
      if (realDuration && target.duration) {
        const delta = Math.abs(realDuration - target.duration)
        if (delta > DURATION_GATE_TOLERANCE_S) {
          unblockLog.warn(
            `⚠️ Migu candidate rejected (${candidate.title}): 时长 ${realDuration}s 偏离请求 ${target.duration}s`,
          )
          continue
        }
      }
      const length = await probeContentLength(source.url, { 'User-Agent': MIGU_UA })
      const check = isPlausibleAudioLength(length, realDuration, source.bitrate, target.duration)
      if (!check.ok) {
        unblockLog.warn(`⚠️ Migu candidate rejected (${candidate.title}): ${check.reason}`)
        continue
      }
      if (!check.verified) {
        unblockLog.warn(`⚠️ Migu 直链体积未验证 (${candidate.title}): ${check.reason}`)
      }
      unblockLog.log('🔗 MiguSong URL:', sanitizeUrl(source.url))
      breaker.recordSuccess()
      return {
        code: 200,
        url: source.url,
        lengthVerified: check.verified,
        matchedDuration: realDuration,
      }
    }
    if (upstreamFault) breaker.recordFailure()
    else breaker.recordSuccess()
    logUnlockFailure(target, FETCH_FAILED_REASON)
    return { code: 404, url: null, reason: FETCH_FAILED_REASON }
  } catch (error) {
    unblockLog.error('❌ Get MiguSong URL Error:', error)
    if (isUpstreamFault(error)) breaker.recordFailure()
    else breaker.recordSuccess()
    logUnlockFailure(target, UPSTREAM_UNAVAILABLE_REASON)
    return { code: 404, url: null, reason: UPSTREAM_UNAVAILABLE_REASON }
  }
}

export default getMiguSongUrl
