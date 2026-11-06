/**
 * 酷我系（酷我 / 波点）共用的候选检索
 *
 * search.kuwo.cn 同时服务两套索引：
 * - 移动索引（带 mobi=1）：命中热门与翻唱版本，VIP 原版常被挤掉；
 * - 版权库索引（不带 mobi）：能命中 VIP 原版，但英文曲库几乎为空。
 * 两套索引都不支持翻页（固定返回 7~20 条），因此这里把「曲名+歌手 / 曲名」
 * ×「两套索引」四种组合的结果合并去重，交由三重校验排序。
 *
 * 四条子请求任意一条失败都可能被 `Promise.allSettled` 静默吞掉，
 * 表现为「同一首歌两次检索的候选池大小不一致」甚至偶发空池；
 * 因此这里记录失败的子请求，并在整池为空时整体重试一次。
 *
 * 故障归属：检索接口没有业务错误码载体，失败形态只有传输层故障（5xx / 超时 / 连接异常）
 * 与请求侧问题（4xx）两类。这里把「整池为空且全部子请求都因传输层故障失败」标记为上游故障，
 * 交由调用方计入熔断计数；上游仍有响应（哪怕没搜到歌）属业务拒绝，不计入。
 */
import type { MatchCandidate } from './match'
import { extractHttpStatus, isUpstreamFault } from './resilience'
import { requestStrict } from './http-strict'

/** 候选歌曲（酷我 rid 为其唯一标识） */
export type KuwoCandidate = MatchCandidate & {
  /** 酷我歌曲 rid */
  rid: string
}

/** 检索接口地址 */
const SEARCH_URL = 'http://search.kuwo.cn/r.s'

/** 检索请求 UA */
const SEARCH_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'

/**
 * 拼装检索地址
 * @param keyword 检索词
 * @param mobile 是否使用移动索引
 * @returns 检索地址
 */
const buildSearchUrl = (keyword: string, mobile: boolean): string => {
  const params = [
    'correct=1',
    'stype=comprehensive',
    'encoding=utf8',
    'rformat=json',
    mobile ? 'mobi=1' : '',
    'show_copyright_off=1',
    'searchapi=6',
    `all=${encodeURIComponent(keyword)}`,
  ].filter(Boolean)
  return `${SEARCH_URL}?${params.join('&')}`
}

/**
 * 从检索响应中取出候选列表（两套索引的响应层级不同）
 * @param data 检索响应体（JSON 对象或原始文本）
 * @returns 候选原始数组
 */
const parseSearchResponse = (data: any): any[] => {
  const page = data?.content?.[1]?.musicpage ?? data?.content?.[1] ?? data
  const list = page?.abslist
  return Array.isArray(list) ? list : []
}

/**
 * 判断检索子请求的失败是否属于上游侧故障
 *
 * 口径与长青一致：HTTP 5xx 计入上游故障，HTTP 4xx 属请求侧不计入；
 * 没有 HTTP 状态码时（连接异常 / 超时 / DNS 失败）回落到通用上游故障判定。
 * @param error 子请求异常
 * @returns 是否为上游侧故障
 */
const isSearchUpstreamFault = (error: unknown): boolean => {
  const status = extractHttpStatus(error)
  if (status > 0) return status >= 500
  return isUpstreamFault(error)
}

/**
 * 执行一轮检索并合并去重
 * @param keywords 检索词列表
 * @param onError 子请求失败时的回调
 * @returns 去重合并后的候选列表与上游故障标记
 */
const runSearch = async (
  keywords: string[],
  onError?: (message: string) => void,
): Promise<{ candidates: KuwoCandidate[]; upstreamFailed: boolean }> => {
  const urls = keywords.flatMap((keyword) => [
    buildSearchUrl(keyword, true),
    buildSearchUrl(keyword, false),
  ])
  const settled = await Promise.allSettled(
    urls.map(async (url) => {
      const response = await requestStrict({
        url,
        headers: { 'User-Agent': SEARCH_UA },
        timeout: 10000,
      })
      return parseSearchResponse(response.data)
    }),
  )
  const merged: KuwoCandidate[] = []
  const seen = new Set<string>()
  let failed = 0
  let fault = false
  settled.forEach((item, index) => {
    if (item.status !== 'fulfilled') {
      failed += 1
      if (isSearchUpstreamFault(item.reason)) fault = true
      onError?.(`酷我检索子请求失败（${index + 1}/${urls.length}）：${String(item.reason)}`)
      return
    }
    for (const raw of item.value) {
      const rid = String(raw?.MUSICRID ?? '').replace(/^MUSIC_/, '')
      if (!rid || seen.has(rid)) continue
      seen.add(rid)
      const duration = Number(raw?.DURATION)
      merged.push({
        id: rid,
        rid,
        title: String(raw?.SONGNAME ?? '').trim(),
        artist: String(raw?.ARTIST ?? '').trim(),
        duration: Number.isFinite(duration) && duration > 0 ? duration : undefined,
      })
    }
  })
  return { candidates: merged, upstreamFailed: failed === urls.length && fault }
}

/**
 * 检索候选歌曲
 *
 * 子请求失败会被记录，整池为空时整体重试一次；
 * 重试后仍为空才判定为「该源没有候选」。
 * @param title 歌名
 * @param artist 歌手，可为空
 * @param onError 子请求失败时的回调，用于记录日志
 * @returns 去重合并后的候选列表与上游故障标记
 */
export const searchKuwoCandidates = async (
  title: string,
  artist: string,
  onError?: (message: string) => void,
): Promise<{ candidates: KuwoCandidate[]; upstreamFailed: boolean }> => {
  const keywords = [artist ? `${title} ${artist}` : '', title].filter(Boolean)
  const first = await runSearch(keywords, onError)
  if (first.candidates.length) return first
  onError?.('酷我检索整池为空，重试一次')
  const retried = await runSearch(keywords, onError)
  if (retried.candidates.length) return retried
  return {
    candidates: retried.candidates,
    upstreamFailed: first.upstreamFailed || retried.upstreamFailed,
  }
}
