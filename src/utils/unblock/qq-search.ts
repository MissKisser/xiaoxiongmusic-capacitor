/**
 * QQ 音乐歌曲检索
 *
 * 长青聚合站的 QQ 通道按「QQ 歌曲 mid」取链，
 * 而请求侧拿到的是「歌名 + 歌手 + 时长」，因此需要先把目标换算成 QQ mid。
 *
 * 检索走 QQ 音乐移动端公开搜索接口（免登录、无需签名）：
 * `music.search.SearchCgiService` / `DoSearchForQQMusicMobile`。
 * 轻量端接口（`DoSearchForQQMusicLite`）已不再返回结果，不能使用。
 *
 * 该接口偶发以业务错误码（2001）拒绝查询——属请求侧被拒或被限流，
 * 不是接口整体不可用：退避重试一次，仍失败则按「无候选」处理，
 * 不计入上游熔断（熔断守的是长青取链站，检索接口不是它）。
 *
 * 搜索结果带高亮标签（`<em>`），比对前先剥掉；
 * 归一化成「mid / 歌名 / 歌手 / 时长」后交给匹配层做三重校验。
 *
 * 传输层经 http 封装层：其语义为任何状态码都正常返回（validateStatus 恒真），
 * 而服务端 axios 默认非 2xx 抛错并携带响应状态——这里在判定响应前把非 2xx
 * 还原成同形态异常（error.status），保证 isUpstreamFault 的归类（5xx 计入、4xx 不计入）
 * 与服务端逐字一致。
 */
import { unblockLog, unblockRequest } from './http'
import type { MatchCandidate } from './match'
import { sleep } from './resilience'

/** QQ 音乐移动端接口入口 */
const QM_API_URL = 'https://u.y.qq.com/cgi-bin/musicu.fcg'

/** 移动端客户端标识 */
const QM_HEADERS = {
  'Content-Type': 'application/json',
  'User-Agent': 'QQMusic 14090008(android 15)',
  Referer: 'https://y.qq.com',
}

/** 请求体公共字段（伪装移动端客户端） */
const QM_COMMON = {
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
}

/** 检索候选条数 */
const SEARCH_LIMIT = 20

/** 单次请求超时（毫秒） */
const REQUEST_TIMEOUT_MS = 10000

/** 业务错误后的重试次数 */
const SEARCH_RETRY = 1

/** 业务错误后的退避时长（毫秒） */
const RETRY_BACKOFF_MS = 300

/**
 * 剥掉搜索结果里的高亮标签
 * @param text 原始文本
 * @returns 去掉高亮标签后的文本
 */
const stripHighlight = (text: unknown): string =>
  typeof text === 'string' ? text.replace(/<\/?em>/g, '') : ''

/**
 * 生成移动端搜索所需的会话标识
 *
 * 该值参与服务端分页，必须每次请求都不同。
 * @returns 十进制字符串形式的会话标识
 */
const createSearchId = (): string => {
  const group = BigInt(Math.floor(Math.random() * 20) + 1)
  const random = BigInt(Math.floor(Math.random() * 4194305))
  const todayMs = BigInt(Date.now() % 86400000)
  return (group * 18014398509481984n + random * 4294967296n + todayMs).toString()
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
 * 发起一次 QQ 音乐检索
 *
 * 传输层异常（超时、连接失败等）直接抛出，由调用方按上游故障处理；
 * 业务错误码说明查询被拒或被限流，重试一次后按「无候选」收场。
 * @param keyword 检索词
 * @returns 候选歌曲原始条目
 */
const requestSongs = async (keyword: string): Promise<any[]> => {
  for (let attempt = 0; attempt <= SEARCH_RETRY; attempt += 1) {
    const response = await unblockRequest({
      url: QM_API_URL,
      method: 'POST',
      headers: QM_HEADERS,
      data: {
        comm: QM_COMMON,
        request: {
          module: 'music.search.SearchCgiService',
          method: 'DoSearchForQQMusicMobile',
          param: {
            searchid: createSearchId(),
            query: keyword,
            page_num: 1,
            num_per_page: SEARCH_LIMIT,
            search_type: 0,
            highlight: true,
            grp: 1,
            selectors: {},
            vec_selectors: [],
          },
        },
      },
      timeout: REQUEST_TIMEOUT_MS,
    })
    if (response.status < 200 || response.status >= 300) throwHttpStatus(response.status)
    const payload = (response.data || {}) as any
    const outerCode = Number(payload?.code ?? 0)
    const innerCode = Number(payload?.request?.code ?? 0)
    if (outerCode === 0 && innerCode === 0) {
      const list = payload?.request?.data?.body?.item_song
      return Array.isArray(list) ? list : []
    }
    unblockLog.warn(
      `⚠️ QQ 音乐检索返回业务错误码 ${innerCode || outerCode}（关键词：${keyword}）`,
    )
    if (attempt < SEARCH_RETRY) await sleep(RETRY_BACKOFF_MS)
  }
  return []
}

/**
 * 按关键词检索 QQ 音乐候选歌曲
 *
 * 上游正常应答但没有匹配项时返回空列表；
 * 上游传输不可用（超时、连接失败）时抛异常，由调用方按故障处理。
 * @param keyword 检索词
 * @returns 归一化后的候选列表
 */
export const searchQqCandidates = async (keyword: string): Promise<MatchCandidate[]> => {
  const text = keyword.trim()
  if (!text) return []
  const songs = await requestSongs(text)
  const candidates: MatchCandidate[] = []
  for (const song of songs) {
    const id = String(song?.mid ?? '')
    const title = stripHighlight(song?.title ?? '').trim()
    if (!id || !title) continue
    const singers: any[] = Array.isArray(song?.singer) ? song.singer : []
    const artist = singers
      .map((singer: any) => stripHighlight(singer?.name ?? '').trim())
      .filter(Boolean)
      .join(' / ')
    const duration = Math.round(Number(song?.interval ?? 0))
    candidates.push({
      id,
      title,
      artist,
      duration: duration > 0 ? duration : undefined,
    })
  }
  return candidates
}
