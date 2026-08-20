/**
 * 网易云本地直连客户端。
 *
 * 在 WebView 内用纯 JS 完成 weapi/eapi 签名 + cookie 注入 + 请求头伪装,
 * 通过 CapacitorHttp 直连 music.163.com,不经 music.viaxv.top 服务器。
 *
 * 与 src/utils/request.ts 的 request() 对齐:接收 AxiosRequestConfig,
 * 返回 response.data(即 NCM 响应 body)。失败时抛错,由 request.ts
 * 的 try-catch 回退到服务器链路。
 *
 * 作者:Hackerdallas
 */

import { CapacitorHttp, HttpResponse } from "@capacitor/core";
import { useSettingStore } from "@/stores";
import { weapi, eapi, linuxapi } from "./crypto";
import { getEndpoint, resolveUri } from "./endpoints";
import type { CryptoType } from "./endpoints";

/** NCM 域名常量(来自 ncm 包 util/config.json) */
const DOMAIN = "https://music.163.com";
const EAPI_DOMAIN = "https://interfacepc.music.163.com";

/** weapi 用的 User-Agent(模仿浏览器) */
const WEAPI_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1";

/** eapi 用的 User-Agent(模仿 iPhone 客户端) */
const EAPI_UA =
  "NeteaseMusic/9.0.90.120317174335 (iPhone; iOS 16.2; Apple CPU iPhone14,3)";

/** eapi 默认设备配置(模仿 iPhone 客户端) */
const IPHONE_OS = {
  os: "iPhone OS",
  appver: "9.0.90",
  osver: "16.2",
  channel: "distribution",
};

/** 音质 level -> bitrate 映射(用于 /song/url/v1 重定向到旧版 /song/url) */
const LEVEL_TO_BR: Record<string, number> = {
  standard: 128000,
  higher: 192000,
  exhigh: 320000,
  lossless: 999000,
  hires: 999000,
  jyeffect: 999000,
  sky: 999000,
  jymaster: 999000,
  vivid: 999000,
};

/** 从 localStorage 影子库读取所有 cookie,返回对象 */
function readCookieObject(): Record<string, string> {
  const obj: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith("cookie-")) {
      obj[k.slice(7)] = localStorage.getItem(k) || "";
    }
  }
  return obj;
}

/** 把 cookie 对象拼成 HTTP Cookie 头字符串 */
function cookieObjToString(cookie: Record<string, string>): string {
  return Object.keys(cookie)
    .filter((k) => cookie[k])
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(cookie[k])}`)
    .join("; ");
}

/** 把 eapi header 对象拼成 Cookie 头字符串(对齐 createHeaderCookie) */
function headerToCookieString(header: Record<string, any>): string {
  return Object.keys(header)
    .filter((k) => header[k] !== undefined && header[k] !== null)
    .map(
      (k) =>
        `${encodeURIComponent(k)}=${encodeURIComponent(String(header[k]))}`,
    )
    .join("; ");
}

/**
 * 获取/生成持久化的 deviceId(32 位随机 hex)。
 * 持久化在 localStorage,避免每次请求都换设备 ID 触发风控。
 */
function getDeviceId(): string {
  const KEY = "ncm-local-device-id";
  let id = localStorage.getItem(KEY);
  if (!id) {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    id = Array.from(arr)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    localStorage.setItem(KEY, id);
  }
  return id;
}

/** 生成 requestId(对齐 ncm 的 generateRequestId) */
function generateRequestId(): string {
  return `${Date.now()}_${Math.floor(Math.random() * 1000)
    .toString()
    .padStart(4, "0")}`;
}

/**
 * 构造 eapi 请求需要的 header 对象(注入 data.header + Cookie 头)。
 * 对齐 ncm util/request.js 的 eapi case。
 */
function buildEapiHeader(
  cookie: Record<string, string>,
): Record<string, any> {
  const header: Record<string, any> = {
    osver: cookie.osver || IPHONE_OS.osver,
    deviceId: cookie.deviceId || getDeviceId(),
    os: cookie.os || IPHONE_OS.os,
    appver: cookie.appver || IPHONE_OS.appver,
    versioncode: "140",
    mobilename: cookie.mobilename || "",
    buildver: String(Math.floor(Date.now() / 1000)),
    resolution: cookie.resolution || "1920x1080",
    __csrf: cookie.__csrf || "",
    channel: cookie.channel || IPHONE_OS.channel,
    requestId: generateRequestId(),
  };
  if (cookie.MUSIC_U) header.MUSIC_U = cookie.MUSIC_U;
  if (cookie.MUSIC_A) header.MUSIC_A = cookie.MUSIC_A;
  return header;
}

/** 生成随机中国 IP(对齐 ncm 的 generateRandomChineseIP,简化版) */
function randomCNIP(): string {
  const ranges = [
    [36, 40, 112, 120],
    [58, 60, 16, 31],
    [59, 60, 110, 120],
    [60, 60, 200, 220],
    [110, 120, 144, 150],
    [180, 184, 128, 200],
    [182, 182, 140, 254],
    [210, 210, 0, 50],
  ];
  const r = ranges[Math.floor(Math.random() * ranges.length)];
  return `${r[0] + Math.floor(Math.random() * (r[1] - r[0] + 1))}.${r[2] + Math.floor(Math.random() * (r[3] - r[2] + 1))}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`;
}

/**
 * localNcmRequest 主入口。
 *
 * @param config axios 请求配置(url 是端点名,如 /playlist/detail)
 * @returns NCM 响应 body(对齐 request 返回 response.data)
 */
export async function localNcmRequest<T = any>(
  config: import("axios").AxiosRequestConfig,
): Promise<T> {
  let url = config.url || "";
  // 合并 query(params + data),data 优先(POST body 字段)
  const query: Record<string, any> = {
    ...(config.params || {}),
    ...(config.data || {}),
  };

  // /song/url/v1 是 xeapi,本地化重定向到旧版 /song/url(weapi/eapi)
  // 从 level 推导 br,保留 id
  if (url === "/song/url/v1") {
    url = "/song/url";
    if (query.level && !query.br) {
      query.br = LEVEL_TO_BR[query.level] ?? 320000;
    }
  }

  const ep = getEndpoint(url);
  if (!ep) {
    throw new Error(`localNcmRequest: unsupported endpoint ${url}`);
  }

  const cookie = readCookieObject();
  const settingStore = useSettingStore();
  const uri = resolveUri(ep, query);
  const data = ep.buildData(query);

  // realIP / X-Real-IP 伪装(缓解单 IP 风控)
  const realIP = settingStore.useRealIP
    ? settingStore.realIP || randomCNIP()
    : randomCNIP();

  // 单步请求;多步端点(followUp)通过 req 回调复用 ncmPost
  const req = (u: string, c: CryptoType, d: Record<string, any>) =>
    ncmPost(u, c, d, cookie, realIP);
  let result = await ncmPost(uri, ep.crypto, data, cookie, realIP);
  if (ep.followUp) {
    result = await ep.followUp(result, query, req);
  } else if (ep.transform) {
    result = ep.transform(result, query);
  }
  return result as T;
}

/**
 * 内部单步请求:按 cryptoType 签名 -> CapacitorHttp 发送 -> parse 成对象。
 * localNcmRequest 主请求与 followUp 后续请求都走这里。
 */
async function ncmPost(
  uri: string,
  cryptoType: CryptoType,
  data: Record<string, any>,
  cookie: Record<string, string>,
  realIP: string,
): Promise<any> {
  let requestUrl: string;
  let headers: Record<string, string> = {};
  let body: string;

  if (cryptoType === "weapi") {
    // weapi: data.csrf_token = __csrf, POST /weapi/<uri去掉/api/>
    data.csrf_token = cookie.__csrf || "";
    const signed = weapi(data);
    requestUrl = `${DOMAIN}/weapi/${uri.substr(5)}`;
    headers = {
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: DOMAIN,
      "User-Agent": WEAPI_UA,
      Origin: DOMAIN,
      "X-Real-IP": realIP,
    };
    if (cookie.MUSIC_U) headers["Cookie"] = `os=ios; MUSIC_U=${cookie.MUSIC_U}`;
    body = new URLSearchParams({
      params: signed.params,
      encSecKey: signed.encSecKey,
    }).toString();
  } else if (cryptoType === "eapi") {
    // eapi: data.header = header, POST /eapi/<uri去掉/api/>
    const header = buildEapiHeader(cookie);
    data.header = header;
    const signed = eapi(uri, data);
    requestUrl = `${EAPI_DOMAIN}/eapi/${uri.substr(5)}`;
    headers = {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": EAPI_UA,
      "X-Real-IP": realIP,
      Cookie: headerToCookieString(header),
    };
    body = new URLSearchParams({ params: signed.params }).toString();
  } else {
    // linuxapi: POST /api/linux/forward
    const signed = linuxapi({
      method: "POST",
      url: `${DOMAIN}${uri}`,
      params: data,
    });
    requestUrl = `${DOMAIN}/api/linux/forward`;
    headers = {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/60.0.3112.90 Safari/537.36",
      "X-Real-IP": realIP,
    };
    if (cookie.MUSIC_U) headers["Cookie"] = `os=ios; MUSIC_U=${cookie.MUSIC_U}`;
    body = new URLSearchParams({ eparams: signed.eparams }).toString();
  }

  // 用 CapacitorHttp 发请求(绕过 WebView CORS)
  const response: HttpResponse = await CapacitorHttp.request({
    method: "POST",
    url: requestUrl,
    headers,
    data: body,
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `localNcmRequest: HTTP ${response.status} for ${requestUrl}`,
    );
  }

  // response.data 可能是字符串(CapacitorHttp 未自动 parse)或对象,
  // 统一 parse 成对象,对齐 axios transformResponse 的行为,
  // 否则前端拿到字符串访问字段会 undefined。
  let result = response.data;
  if (typeof result === "string") {
    try {
      result = JSON.parse(result);
    } catch {
      // 非 JSON 字符串(如纯文本错误),保持原样由上层处理
    }
  }
  return result;
}
