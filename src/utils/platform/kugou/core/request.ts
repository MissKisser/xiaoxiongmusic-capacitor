/**
 * 酷狗音乐平台请求层
 *
 * 提供两种请求方式：
 * - kgRequest: 基础 HTTP GET 请求（用于 mobilecdn、songsearch 等公开接口）
 * - kgGatewayRequest: 酷狗网关鉴权请求（自动注入设备标识、时间戳、签名与网关路由头）
 *
 * @author Hackerdallas
 */

import {
  KG_ANDROID_UA,
  KG_GATEWAY_URL,
  KG_RF,
  getKgAppid,
  getKgClientver,
} from "./config";
import { cleanKgResponse, getDeviceMid, signatureAndroidParams } from "./crypto";
import { KugouApiError } from "./auth";
import type { KGRawBody } from "./types";
import { getSessionCookies } from "../../sessionStore";
import { platformRequest } from "../../http";

/** 基础请求选项 */
export interface FetchOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** 业务错误码非 0 时不抛错，由调用方自行分流 */
  allowBusinessError?: boolean;
}

/** 网关请求选项 */
export interface GatewayRequestOptions {
  method?: "GET" | "POST";
  baseURL?: string;
  params?: Record<string, unknown>;
  data?: unknown;
  headers?: Record<string, string>;
  notSignature?: boolean;
  timeoutMs?: number;
  /** 业务错误码非 0 时不抛错，由调用方自行分流 */
  allowBusinessError?: boolean;
}

/**
 * 读取酷狗响应里的业务错误码
 * @param body 响应体对象
 * @returns 业务错误码，无错误码时返回 0
 */
export const kgErrorCode = (body: unknown): number => {
  if (!body || typeof body !== "object") return 0;
  const record = body as Record<string, unknown>;
  const code = record.error_code ?? record.errcode ?? record.err_code ?? 0;
  return Number(code) || 0;
};

/**
 * 基础 GET 请求
 * @param url 目标请求 URL
 * @param options 请求配置
 * @returns 解析后的业务响应对象
 */
export const kgRequest = async <T = unknown>(
  url: string,
  options: FetchOptions = {},
): Promise<T> => {
  const timeout = options.timeoutMs ?? 8000;
  const response = await platformRequest({
    url,
    method: "GET",
    headers: options.headers,
    timeout,
    responseType: "text",
  });

  if (response.status !== 200) {
    throw new Error(`KG HTTP ${response.status}`);
  }

  const rawText = typeof response.data === "string" ? response.data : JSON.stringify(response.data);
  const cleaned = cleanKgResponse(rawText);
  let body: KGRawBody;
  try {
    body = JSON.parse(cleaned) as KGRawBody;
  } catch {
    body = { raw: cleaned };
  }

  const code = body.error_code ?? body.errcode ?? body.err_code ?? 0;
  if (!options.allowBusinessError && code !== 0 && code !== 200) {
    throw new KugouApiError(code, String(body.msg ?? body.error ?? ""));
  }

  return body as T;
};

/**
 * 发送带 Android 签名的酷狗网关鉴权请求
 * @param path 网关相对路径（如 /v1/search/album）
 * @param options 网关请求配置项
 * @returns 解析后的业务响应数据
 */
export const kgGatewayRequest = async <T = KGRawBody>(
  path: string,
  options: GatewayRequestOptions = {},
): Promise<T> => {
  const {
    method = "GET",
    baseURL = KG_GATEWAY_URL,
    params = {},
    data,
    headers = {},
    notSignature = false,
    timeoutMs = 8000,
    allowBusinessError = false,
  } = options;

  const clienttime = Math.floor(Date.now() / 1000);
  const mid = getDeviceMid();
  const session = getSessionCookies("kugou");
  const dfid = session.dfid || "-";
  const uuid = "-";

  const defaultParams: Record<string, unknown> = {
    dfid,
    mid,
    uuid,
    appid: getKgAppid(),
    clientver: getKgClientver(),
    clienttime,
    ...(session.token ? { token: session.token } : {}),
    ...(session.userid ? { userid: session.userid } : {}),
  };

  const mergedParams: Record<string, unknown> = { ...defaultParams, ...params };

  const serializedData =
    data !== undefined
      ? typeof data === "string"
        ? data
        : data instanceof Uint8Array
          ? new TextDecoder("utf-8").decode(data)
          : JSON.stringify(data)
      : "";

  if (!mergedParams.signature && !notSignature) {
    mergedParams.signature = signatureAndroidParams(mergedParams, serializedData);
  }

  const queryParams: Record<string, string> = {};
  for (const [key, value] of Object.entries(mergedParams)) {
    if (value !== undefined && value !== null) {
      queryParams[key] = typeof value === "object" ? JSON.stringify(value) : String(value);
    }
  }

  const defaultHeaders: Record<string, string> = {
    "User-Agent": KG_ANDROID_UA,
    dfid,
    clienttime: String(clienttime),
    mid,
    "kg-rc": "1",
    "kg-thash": "5d816a0",
    "kg-rec": "1",
    "kg-rf": KG_RF,
  };

  if (method === "POST" && !headers["Content-Type"]) {
    defaultHeaders["Content-Type"] = "application/json";
  }

  const response = await platformRequest({
    url: `${baseURL}${path}`,
    method,
    params: queryParams,
    headers: { ...defaultHeaders, ...headers },
    data: method === "POST" ? (serializedData || undefined) : undefined,
    timeout: timeoutMs,
    responseType: "text",
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`KG Gateway HTTP ${response.status}`);
  }

  const rawText = typeof response.data === "string" ? response.data : JSON.stringify(response.data);
  const cleaned = cleanKgResponse(rawText);
  let body: KGRawBody;
  try {
    body = JSON.parse(cleaned) as KGRawBody;
  } catch {
    body = { raw: cleaned };
  }

  const code = body.error_code ?? body.errcode ?? body.err_code ?? 0;
  if (!allowBusinessError && code !== 0 && code !== 200) {
    throw new KugouApiError(code, String(body.msg ?? body.error ?? ""));
  }

  return body as T;
};
