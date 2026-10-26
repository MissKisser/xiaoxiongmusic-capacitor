/**
 * QQ 音乐通用配置与常量
 *
 * @author Hackerdallas
 */

/** 统一接口入口（移动端 musicu） */
export const QM_API_URL = "https://u.y.qq.com/cgi-bin/musicu.fcg";

/** 模拟移动端的默认请求头 */
export const QM_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  "Accept-Encoding": "gzip",
  "User-Agent": "QQMusic 14090008(android 15)",
  Referer: "https://y.qq.com",
};

/** 请求体 comm 字段（伪装 Android 客户端） */
export const getCommonParams = (): Record<string, string | number> => ({
  ct: 11,
  cv: 14090008,
  v: 14090008,
  chid: "10003505",
  os_ver: "15",
  phonetype: "24122RKC7C",
  tmeAppID: "qqmusic",
  nettype: "NETWORK_WIFI",
  udid: "0",
  OpenUDID: "0",
  QIMEI36: "0",
  uin: "0",
});

/** 客户端会话缓存有效期（毫秒） */
export const SESSION_TTL = 60 * 60 * 1000;

/**
 * 歌手数组格式化工具：`[{name:'A'},{name:'B'}]` → `A / B`
 * @param singers 歌手原始列表
 * @param key 取值字段名，默认 name
 * @param join 分隔符，默认 " / "
 * @returns 拼接后的歌手字符串
 */
export const formatSingerName = (
  singers: Array<{ name?: string; title?: string }> | undefined,
  key: "name" | "title" = "name",
  join = " / ",
): string => {
  if (!singers?.length) return "";
  return singers
    .map((item) => item[key])
    .filter((item): item is string => !!item)
    .join(join);
};
