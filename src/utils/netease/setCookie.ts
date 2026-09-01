/**
 * Set-Cookie 响应头解析。
 *
 * CapacitorHttp 原生层(HttpRequestHandler.buildResponseHeaders)会把同名多个
 * Set-Cookie 头以", "拼接为单个字符串,而 Expires 等属性值自身含逗号
 * (如 "Sun, 19 Sep 2094 03:54:49 GMT"),故按"逗号后紧跟合法 Cookie 名 +"的
 * 模式切分,再取每段首个分号前的键值对,得到干净的 Cookie 键值表。
 *
 * 作者:Hackerdallas
 */

/**
 * 解析 Set-Cookie 响应头为 Cookie 键值对。
 * @param raw 原始 Set-Cookie 头值(合并字符串或数组),可空
 * @returns Cookie 名值表(仅含 k=v,不含 Path/Domain/Expires 等属性)
 */
export function parseSetCookie(
  raw?: string | string[] | null,
): Record<string, string> {
  if (!raw) return {};
  const inputs = Array.isArray(raw) ? raw : [raw];
  const cookies: Record<string, string> = {};
  for (const input of inputs) {
    // 逗号后必须紧跟 Cookie 名(RFC 6265 token,不含空格)与等号才算新条目,
    // Expires 值内的逗号(如 ", 19 Sep 2094 ...")不满足该模式
    const segments = input.split(/,\s*(?=[A-Za-z0-9_-]+=)/);
    for (const segment of segments) {
      const pair = segment.split(";")[0]?.trim();
      if (!pair) continue;
      const eq = pair.indexOf("=");
      if (eq <= 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (!name || !value) continue;
      cookies[name] = value;
    }
  }
  return cookies;
}

/**
 * 将 Cookie 键值表拼回请求侧 Cookie 头字符串。
 * @param cookies Cookie 名值表
 * @returns "k1=v1;k2=v2" 形式字符串(对齐 ncm module 的 cookie.join(';'))
 */
export function cookieObjectToString(
  cookies: Record<string, string>,
): string {
  return Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join(";");
}
