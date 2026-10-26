/**
 * 平台统一 HTTP 请求适配器
 *
 * 在原生平台（Capacitor）下走原生网络栈 CapacitorHttp，
 * 绕过浏览器同源策略并允许携带受限头（Cookie、Referer、User-Agent）；
 * 在 Node 运行环境与 Web 开发态下自动回退至 axios，确保自动化单测与冒烟脚本可用。
 *
 * @author Hackerdallas
 */

import { Capacitor, CapacitorHttp } from "@capacitor/core";
import axios, { type AxiosRequestConfig, type AxiosResponse } from "axios";

/** 平台 HTTP 请求选项 */
export interface PlatformRequestOptions {
  /** 目标请求 URL */
  url: string;
  /** 请求方法，默认 GET */
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD";
  /** 请求头键值对 */
  headers?: Record<string, string>;
  /** URL 查询参数 */
  params?: Record<string, unknown>;
  /** 请求体数据（JSON 对象、字符串或已编码表单） */
  data?: unknown;
  /** 超时时间（毫秒），默认 8000 */
  timeout?: number;
  /** 期望的响应类型：json、text、arraybuffer，默认 json */
  responseType?: "json" | "text" | "arraybuffer";
  /** 是否禁用自动重定向（用于需要捕获 302 跳转与其 Set-Cookie / Location） */
  disableRedirects?: boolean;
}

/** 平台 HTTP 响应统一结构 */
export interface PlatformResponse<T = any> {
  /** HTTP 状态码 */
  status: number;
  /** 归一化为小写键名的响应头映射 */
  headers: Record<string, string>;
  /** 解析后的 Set-Cookie 列表 */
  cookies: string[];
  /** 响应体数据 */
  data: T;
  /** 最终请求 URL */
  url?: string;
}

/**
 * 判断当前是否处于 Capacitor 原生环境
 * @returns 是否处于原生平台
 */
export const isNativePlatform = (): boolean =>
  typeof Capacitor !== "undefined" &&
  typeof Capacitor.isNativePlatform === "function" &&
  Capacitor.isNativePlatform();

/**
 * 将字节数组转换为 Base64 字符串
 * @param bytes 字节数组
 * @returns Base64 字符串
 */
export const uint8ArrayToBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  const len = bytes.byteLength;
  const chunkSize = 8192;
  for (let i = 0; i < len; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, len));
    binary += String.fromCharCode(...chunk);
  }
  return typeof btoa === "function" ? btoa(binary) : Buffer.from(bytes).toString("base64");
};

/**
 * 将 Base64 字符串解码为 Uint8Array
 * @param base64 Base64 字符串
 * @returns 字节数组
 */
export const base64ToUint8Array = (base64: string): Uint8Array => {
  const raw =
    typeof atob === "function"
      ? atob(base64)
      : Buffer.from(base64, "base64").toString("binary");
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    bytes[i] = raw.charCodeAt(i);
  }
  return bytes;
};

/**
 * 从响应头中提取 Cookie 键值对
 * @param headers 响应头对象
 * @param existing 已有的 Cookie 键值对，提取结果会合并写入
 * @returns 合并后的 Cookie 键值对
 */
export const extractSetCookies = (
  headers: Record<string, string | string[] | undefined>,
  existing: Record<string, string> = {},
): Record<string, string> => {
  const cookieMap: Record<string, string> = { ...existing };
  const raw = headers["set-cookie"] || headers["Set-Cookie"];
  if (!raw) return cookieMap;

  const list: string[] = Array.isArray(raw)
    ? raw
    : String(raw).split(/,\s*(?=[a-zA-Z0-9_.-]+=)/);

  for (const item of list) {
    const first = item.split(";")[0]?.trim();
    if (!first) continue;
    const eqIdx = first.indexOf("=");
    if (eqIdx > 0) {
      const name = first.slice(0, eqIdx).trim();
      const value = first.slice(eqIdx + 1).trim();
      if (name && value) {
        cookieMap[name] = value;
      }
    }
  }
  return cookieMap;
};

/**
 * 将原生响应头统一处理为小写键名
 * @param rawHeaders 原始响应头映射
 * @returns 小写化响应头映射及独立 Set-Cookie 列表
 */
const normalizeHeaders = (
  rawHeaders: Record<string, unknown> | undefined,
): { headers: Record<string, string>; cookies: string[] } => {
  const headers: Record<string, string> = {};
  const cookies: string[] = [];
  if (!rawHeaders) return { headers, cookies };

  for (const [key, val] of Object.entries(rawHeaders)) {
    const lowerKey = key.toLowerCase();
    if (Array.isArray(val)) {
      headers[lowerKey] = val.join(", ");
      if (lowerKey === "set-cookie") {
        for (const item of val) {
          if (typeof item === "string" && item.trim()) {
            cookies.push(item.trim());
          }
        }
      }
    } else if (typeof val === "string") {
      headers[lowerKey] = val;
      if (lowerKey === "set-cookie") {
        const parts = val.split(/,\s*(?=[a-zA-Z0-9_.-]+=)/);
        for (const part of parts) {
          if (part.trim()) cookies.push(part.trim());
        }
      }
    } else if (val !== undefined && val !== null) {
      headers[lowerKey] = String(val);
    }
  }

  return { headers, cookies };
};

/**
 * 经由 CapacitorHttp 原生插件发起请求
 * @param options 请求配置
 * @returns 统一响应结构
 */
const requestViaCapacitor = async <T>(
  options: PlatformRequestOptions,
): Promise<PlatformResponse<T>> => {
  const method = options.method ?? "GET";
  const timeout = options.timeout ?? 8000;

  // 将参数对象格式化为 CapacitorHttp 支持的 HttpParams
  const params: Record<string, string> = {};
  if (options.params) {
    for (const [key, value] of Object.entries(options.params)) {
      if (value !== undefined && value !== null) {
        params[key] = String(value);
      }
    }
  }

  const nativeResponse = await CapacitorHttp.request({
    url: options.url,
    method,
    headers: options.headers,
    params: Object.keys(params).length > 0 ? params : undefined,
    data: options.data,
    connectTimeout: timeout,
    readTimeout: timeout,
    disableRedirects: options.disableRedirects,
    responseType: options.responseType === "arraybuffer" ? "arraybuffer" : undefined,
  });

  const { headers, cookies } = normalizeHeaders(nativeResponse.headers);
  let data = nativeResponse.data as T;

  const expectedType = options.responseType ?? "json";
  if (expectedType === "json" && typeof data === "string") {
    try {
      data = JSON.parse(data) as T;
    } catch {
      // 保持原始字符串
    }
  } else if (options.responseType === "arraybuffer") {
    if (typeof data === "string") {
      // 原生层对 arraybuffer 可能返回 Base64 编码字符串，统一解码为 ArrayBuffer
      const bytes = base64ToUint8Array(data);
      data = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as unknown as T;
    }
  }

  return {
    status: nativeResponse.status,
    headers,
    cookies,
    data,
    url: nativeResponse.url,
  };
};

/**
 * 经由 axios 兜底发起请求（用于 Node.js 环境与 Web 开发态）
 * @param options 请求配置
 * @returns 统一响应结构
 */
const requestViaAxios = async <T>(
  options: PlatformRequestOptions,
): Promise<PlatformResponse<T>> => {
  const method = options.method ?? "GET";
  const timeout = options.timeout ?? 8000;

  const axiosConfig: AxiosRequestConfig = {
    url: options.url,
    method,
    headers: options.headers,
    params: options.params,
    data: options.data,
    timeout,
    // 接受所有状态码，避免 302/400/502 时直接抛错，对齐 PC fetch 语义
    validateStatus: () => true,
    maxRedirects: options.disableRedirects ? 0 : 5,
    responseType: options.responseType ?? "json",
  };

  const response: AxiosResponse = await axios.request(axiosConfig);
  const { headers, cookies } = normalizeHeaders(response.headers as Record<string, unknown>);

  let data = response.data as T;
  if (options.responseType === "json" && typeof data === "string") {
    try {
      data = JSON.parse(data) as T;
    } catch {
      // 保持原始字符串
    }
  }

  return {
    status: response.status,
    headers,
    cookies,
    data,
    url: response.config.url,
  };
};

/**
 * 发起一次平台网络请求
 *
 * 优先检测是否处于 Capacitor 原生环境：
 * - 原生端：经 CapacitorHttp 发出，支持受限 Header 注入与跨域直连；
 * - 非原生端：由 axios 发出，供 Node 自动化脚本及 Web 调试使用。
 *
 * @param options 请求配置项
 * @returns 规范化的平台响应体
 */
export const platformRequest = async <T = any>(
  options: PlatformRequestOptions,
): Promise<PlatformResponse<T>> => {
  if (isNativePlatform()) {
    return requestViaCapacitor<T>(options);
  }
  return requestViaAxios<T>(options);
};
