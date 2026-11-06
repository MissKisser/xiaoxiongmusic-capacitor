/**
 * 日志脱敏
 *
 * 播放直链的 query 里带播放凭证（vkey / hash_token / sign 等），
 * 直接落日志等于把凭证写进磁盘。这里统一把直链裁成
 * 「域名 + 路径前若干字符」，query 与 hash 一律不保留。
 */

/** 路径部分保留的最大字符数 */
const PATH_KEEP_LENGTH = 40

/**
 * 把播放直链脱敏成可安全落日志的摘要
 *
 * @param url 原始直链
 * @returns 脱敏后的摘要（域名 + 路径前 40 字符，无 query）
 */
export const sanitizeUrl = (url: unknown): string => {
  const text = typeof url === 'string' ? url.trim() : ''
  if (!text) return ''
  // 去掉协议（含协议相对地址）
  const withoutScheme = text.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/^\/\//, '')
  // 裁掉 query 与 hash
  const cutIndex = withoutScheme.search(/[?#]/)
  const pathOnly = cutIndex >= 0 ? withoutScheme.slice(0, cutIndex) : withoutScheme
  const slashIndex = pathOnly.indexOf('/')
  if (slashIndex < 0) return pathOnly
  const host = pathOnly.slice(0, slashIndex)
  const path = pathOnly.slice(slashIndex + 1)
  if (path.length <= PATH_KEEP_LENGTH) return `${host}/${path}`
  return `${host}/${path.slice(0, PATH_KEEP_LENGTH)}…`
}
