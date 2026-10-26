/**
 * 酷狗音乐平台通用常量与配置工具
 *
 * @author Hackerdallas
 */

import { getSessionCookies } from "../../sessionStore";

/** 酷狗网关地址 */
export const KG_GATEWAY_URL = "https://gateway.kugou.com";

/** 酷狗客户端标识（标准版） */
export const KG_APPID = 1005;
export const KG_CLIENTVER = 20489;

/** 概念版（lite）客户端标识 */
export const KG_LITE_APPID = 3116;
export const KG_LITE_CLIENTVER = 11440;

/** Android 客户端 User-Agent */
export const KG_ANDROID_UA = "Android15-1070-11083-46-0-DiscoveryDRADProtocol-wifi";

/** 酷狗固定网关验证头 kg-rf */
export const KG_RF = "B9EDA08A64250DEFFBCADDEE00F8F25F";

/** 云歌单服务路由头 x-router */
export const KG_CLOUDLIST_ROUTER = "cloudlist.service.kugou.com";

/** 主搜索（带封面）：mobilecdn 的 /api/v3/search/song */
export const KG_MOBILECDN_URL = "http://mobilecdn.kugou.com/api/v3/search/song";

/** 兜底搜索：老 songsearch */
export const KG_SEARCH_URL = "https://songsearch.kugou.com/song_search_v2";

/** 歌词搜索与下载接口 */
export const KG_LYRIC_SEARCH_URL = "http://lyrics.kugou.com/search";
export const KG_LYRIC_DOWNLOAD_URL = "http://lyrics.kugou.com/download";

/** 歌词接口伪装请求头 */
export const KG_LYRIC_HEADERS: Record<string, string> = {
  "KG-RC": "1",
  "KG-THash": "expand_search_manager.cpp:852736169:451",
  "User-Agent": "KuGou2012-9020-ExpandSearchManager",
};

/** 内存覆盖模式 */
let overrideLoginVersion: "standard" | "concept" | null = null;

/**
 * 设置酷狗登录版本
 * @param version 目标版本：standard 或 concept
 */
export const setKugouLoginVersion = (version: "standard" | "concept"): void => {
  overrideLoginVersion = version;
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("system.kugouLoginVersion", version);
    }
  } catch {
    // 忽略异常
  }
};

/**
 * 获取当前酷狗登录版本
 * @returns 登录版本标识（standard 或 concept）
 */
export const getKugouLoginVersion = (): "standard" | "concept" => {
  if (overrideLoginVersion) return overrideLoginVersion;
  try {
    const session = getSessionCookies("kugou");
    if (session.login_version === "standard" || session.login_version === "concept") {
      return session.login_version;
    }
    if (typeof localStorage !== "undefined") {
      const stored =
        localStorage.getItem("system.kugouLoginVersion") ||
        localStorage.getItem("kugouLoginVersion");
      if (stored === "standard" || stored === "concept") {
        return stored;
      }
    }
  } catch {
    // 忽略异常
  }
  return "concept";
};

/**
 * 判断当前是否处于概念版（lite）模式
 * @returns 是否处于概念版模式
 */
export const isKugouConceptMode = (): boolean => getKugouLoginVersion() === "concept";

/**
 * 按当前登录版本模式获取应用 appid
 * @returns appid
 */
export const getKgAppid = (): number => (isKugouConceptMode() ? KG_LITE_APPID : KG_APPID);

/**
 * 按当前登录版本模式获取客户端版本号 clientver
 * @returns clientver
 */
export const getKgClientver = (): number =>
  isKugouConceptMode() ? KG_LITE_CLIENTVER : KG_CLIENTVER;

/** HTML 实体反转义字典 */
const ENTITY_MAP: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&#039;": "'",
};

/**
 * HTML 实体反转义与清洗
 * @param str 原始字符串
 * @returns 清洗后的字符串
 */
export const decodeName = (str: string | null | undefined): string => {
  if (!str) return "";
  return str.replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;|&apos;|&#039;/g, (s) => ENTITY_MAP[s] ?? s);
};

/**
 * 安全升级 HTTP 链接为 HTTPS
 * @param url 原始 URL
 * @returns HTTPS URL
 */
export const secureUrl = (url: string | undefined): string =>
  url?.replace(/^http:\/\//, "https://") ?? "";

/**
 * 填充并安全化酷狗图片模板（如替换 {size} 占位符）
 * @param url 封面 URL 模板
 * @param size 封面尺寸，默认 300
 * @returns 最终封面 URL
 */
export const fillCover = (url: string | undefined, size = 300): string | undefined => {
  if (!url) return undefined;
  const replaced = url.replace(/\{size\}/g, String(size));
  return secureUrl(replaced);
};

/**
 * 格式化歌手数组为展示字符串
 * @param singers 歌手列表
 * @param join 分隔符，默认 " / "
 * @returns 格式化后的歌手名
 */
export const formatSingerName = (
  singers: Array<{ name?: string }> | undefined,
  join = " / ",
): string => {
  if (!singers?.length) return "";
  return singers
    .map((s) => s.name)
    .filter((n): n is string => !!n)
    .map(decodeName)
    .join(join);
};

/**
 * 将 MM:SS 或 HH:MM:SS 格式的时长转换为秒数
 * @param interval 时长数字或字符串
 * @returns 对应的秒数
 */
export const intervalToSeconds = (interval: string | number | undefined): number => {
  if (typeof interval === "number") return Math.floor(interval);
  if (!interval) return 0;
  const parts = String(interval).split(":").map(Number);
  let seconds = 0;
  let unit = 1;
  while (parts.length) {
    const v = parts.pop();
    if (Number.isFinite(v)) seconds += (v as number) * unit;
    unit *= 60;
  }
  return Math.floor(seconds);
};
