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

/** weapi 用的 User-Agent(对齐标准库 userAgentMap.weapi.pc,PC 桌面浏览器) */
const WEAPI_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0";

/** eapi 用的 User-Agent(模仿 iPhone 客户端) */
const EAPI_UA =
  "NeteaseMusic/9.0.90.120317174335 (iPhone; iOS 16.2; Apple CPU iPhone14,3)";

/** weapi 默认设备档(对齐标准库 osMap.pc,weapi 通道固定模拟 PC 网页端) */
const PC_WEAPI_OS = {
  os: "pc",
  appver: "3.1.17.204416",
  osver: "Microsoft-Windows-10-Professional-build-19045-64bit",
  channel: "netease",
};

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
  return getStableValue("ncm-local-device-id", () => randomHex(32));
}

/** 生成指定字符长度的随机 hex 串 */
function randomHex(length: number): string {
  const bytes = new Uint8Array(Math.ceil(length / 2));
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, length);
}

/** 生成 WNMCID(对齐标准库格式:6 位小写字母.时间戳.01.0) */
function generateWnmcid(): string {
  const letters = "abcdefghijklmnopqrstuvwxyz";
  let prefix = "";
  for (let i = 0; i < 6; i++) {
    prefix += letters[Math.floor(Math.random() * letters.length)];
  }
  return `${prefix}.${Date.now()}.01.0`;
}

/** 读取/生成 localStorage 持久化值,保证指纹字段设备级稳定 */
function getStableValue(key: string, generate: () => string): string {
  let value = localStorage.getItem(key);
  if (!value) {
    value = generate();
    localStorage.setItem(key, value);
  }
  return value;
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

  // IP 伪造头仅在用户显式配置 realIP 时携带(对齐标准库默认不携带;
  // 每请求随机 IP 属风控高危特征,不再默认注入)
  const realIP =
    settingStore.useRealIP && settingStore.realIP ? settingStore.realIP : "";

  // 单步请求;多步端点(followUp)通过 req 回调复用 ncmPost
  const req = async (u: string, c: CryptoType, d: Record<string, any>) =>
    (await ncmPost(u, c, d, cookie, realIP)).body;
  const { body, headers } = await ncmPost(uri, ep.crypto, data, cookie, realIP);
  let result = body;
  if (ep.followUp) {
    result = await ep.followUp(result, query, req);
  } else if (ep.transform) {
    result = ep.transform(result, query, headers);
  }
  return result as T;
}

/**
 * 内部单步请求:按 cryptoType 签名 -> CapacitorHttp 发送 -> parse 成对象。
 * localNcmRequest 主请求与 followUp 后续请求都走这里。
 *
 * @returns body 为 NCM 响应体;headers 为响应头(含合并后的 Set-Cookie),
 *          供需要读取登录 Cookie 的端点 transform 使用。
 */
async function ncmPost(
  uri: string,
  cryptoType: CryptoType,
  data: Record<string, any>,
  cookie: Record<string, string>,
  realIP: string,
): Promise<{ body: any; headers: Record<string, string> }> {
  let requestUrl: string;
  let headers: Record<string, string> = {};
  let body: string;

  if (cryptoType === "weapi") {
    // weapi: data.csrf_token = __csrf, POST /weapi/<uri去掉/api/>
    // Cookie 对齐标准库 processCookieObject:PC 网页端设备档 + 网页风控指纹字段
    data.csrf_token = cookie.__csrf || "";
    const nuid =
      cookie._ntes_nuid || getStableValue("ncm-local-ntes-nuid", () => randomHex(64));
    const weapiCookie: Record<string, any> = {
      ...cookie,
      __remember_me: "true",
      ntes_kaola_ad: "1",
      _ntes_nuid: nuid,
      _ntes_nnid: cookie._ntes_nnid || `${nuid},${Date.now()}`,
      WNMCID: cookie.WNMCID || getStableValue("ncm-local-wnmcid", generateWnmcid),
      WEVNSM: cookie.WEVNSM || "1.0.0",
      os: cookie.os || PC_WEAPI_OS.os,
      osver: cookie.osver || PC_WEAPI_OS.osver,
      deviceId: cookie.deviceId || getDeviceId(),
      channel: cookie.channel || PC_WEAPI_OS.channel,
      appver: cookie.appver || PC_WEAPI_OS.appver,
      __csrf: data.csrf_token,
      NMTID: cookie.NMTID || randomHex(32),
    };
    const signed = weapi(data);
    requestUrl = `${DOMAIN}/weapi/${uri.substr(5)}`;
    headers = {
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: DOMAIN,
      "User-Agent": WEAPI_UA,
      Origin: DOMAIN,
      Cookie: headerToCookieString(weapiCookie),
    };
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
    };
    if (cookie.MUSIC_U) headers["Cookie"] = `os=ios; MUSIC_U=${cookie.MUSIC_U}`;
    body = new URLSearchParams({ eparams: signed.eparams }).toString();
  }

  // IP 伪造头仅在显式配置 realIP 时携带(对齐标准库,同时伪造 X-Forwarded-For)
  if (realIP) {
    headers["X-Real-IP"] = realIP;
    headers["X-Forwarded-For"] = realIP;
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
  // 通道级失败(需要登录 code 301 / 风控拦截 code -460 或提示语含"风险")
  // 抛错交由 request.ts 回退服务器链路重试
  const code = Number(result?.code);
  const msg = String(result?.msg || result?.message || "");
  if (code === 301 || code === -460 || (code !== 200 && msg.includes("风险"))) {
    throw new Error(
      `localNcmRequest: NCM code ${code} for ${requestUrl} ${msg}`.trim(),
    );
  }
  return { body: result, headers: response.headers };
}
