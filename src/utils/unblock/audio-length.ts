/**
 * 直链体积探测：用于拦截「非空 URL ≠ 可播」的占位文件
 *
 * 酷我的 128k 通道对无权播放的曲目会返回同一个固定文件
 * （实测 185,336 B、md5 86e42315600b9137e26ad17d54f3d622），与请求歌曲无关。
 * 因此拿到直链后先只读一次响应头，用「声明时长 × 码率」估算的体积做比对，
 * 不做全量预下载。
 *
 * 与服务端实现的差异仅在传输层：服务端用 axios 的 maxContentLength 截断 Range 兜底，
 * 本实现 fetch 路径读完响应头即取消响应体下载（更严格的「不下载」保证）；
 * 原生路径无流式取消能力，服务端忽略 Range 时响应体会完整进入内存，
 * 由 readTimeout 兜住时间上限。判定结果（读 content-length / content-range 响应头）
 * 与服务端逐字一致。
 */
import { getResponseHeader, unblockHead, unblockRequest } from './http'

/** 探测请求超时（毫秒） */
const PROBE_TIMEOUT = 8000

/**
 * 读取直链声明的文件长度
 * @param url 音频直链
 * @param headers 请求头
 * @param timeout 超时（毫秒）
 * @returns 字节数；无法确定时返回 null
 */
export const probeContentLength = async (
  url: string,
  headers: Record<string, string> = {},
  timeout: number = PROBE_TIMEOUT,
): Promise<number | null> => {
  try {
    const response = await unblockHead(url, headers, timeout)
    const length = Number(getResponseHeader(response.headers, 'content-length'))
    if (response.status >= 200 && response.status < 300 && Number.isFinite(length) && length > 0) {
      return length
    }
  } catch {
    // HEAD 不可用时退化为 Range 请求
  }
  try {
    const response = await unblockRequest({
      url,
      method: 'GET',
      headers: { ...headers, Range: 'bytes=0-0' },
      responseType: 'arraybuffer',
      timeout,
      headersOnly: true,
    })
    const range = getResponseHeader(response.headers, 'content-range')
    if (typeof range === 'string') {
      const total = Number(range.split('/')[1])
      if (Number.isFinite(total) && total > 0) return total
    }
  } catch {
    return null
  }
  return null
}
