/**
 * 酷狗云歌单协议层
 *
 * 覆盖两套协议：
 * - 协议 A（buildGatewayRequest / sendGatewayRequest）：Android 客户端签名 + 明文 JSON body
 * - 协议 B（buildCloudRequest / sendCloudRequest）：RSA 传参 + AES-128-CBC 加密 body
 *
 * 协议 A 用于 cloudlist 的创建、加歌、删歌、删除歌单；
 * 协议 B 用于修改歌单信息。
 *
 * @author Hackerdallas
 */

import {
  KG_ANDROID_UA,
  KG_CLOUDLIST_ROUTER,
  KG_GATEWAY_URL,
  KG_RF,
  getKgAppid,
  getKgClientver,
} from "./config";
import {
  cleanKgResponse,
  cryptoMd5,
  currentSalts,
  decryptCloudResponse,
  encryptCloudBody,
  getDeviceMid,
  rsaEncryptKugouPkcs1,
  signatureAndroidParams,
} from "./crypto";
import type { BuiltRequest, KgRequestContext, KgSendResult } from "./types";
import { getSessionCookies } from "../../sessionStore";
import { platformRequest } from "../../http";

export { KG_CLOUDLIST_ROUTER };

/** 云歌单 AES 会话串字符集 */
const KG_AES_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * 随机生成 6 位 AES 会话串
 * @returns 6 位会话串
 */
const randomAes = (): string => {
  let out = "";
  for (let i = 0; i < 6; i += 1) {
    out += KG_AES_ALPHABET[Math.floor(Math.random() * KG_AES_ALPHABET.length)];
  }
  return out;
};

/**
 * 解析响应 JSON 文本
 * @param text 待解析文本
 * @returns 解析后的对象，失败返回 undefined
 */
const parseJson = (text: string): any => {
  try {
    return JSON.parse(cleanKgResponse(text));
  } catch {
    return undefined;
  }
};

/**
 * 获取云歌单使用的设备 MID
 * @returns MID 十进制字符串
 */
export const getCloudDeviceMid = (): string => getDeviceMid();

/**
 * 从当前登录态动态构造写操作及协议请求上下文
 *
 * 客户端标识与签名盐值动态跟随当前登录版本（标准版 / 概念版），
 * 避免登录 token 与客户端标识不匹配触发网关 error_code=20017 错误。
 * @returns 请求上下文，未登录时返回 null
 */
export const createKugouRequestContext = (): KgRequestContext | null => {
  const session = getSessionCookies("kugou");
  if (!session.token || !session.userid) return null;
  const salts = currentSalts();
  return {
    appid: getKgAppid(),
    clientver: getKgClientver(),
    signSalt: salts.androidSign,
    publicKey: salts.publicKey,
    mid: getCloudDeviceMid(),
    dfid: session.dfid || "-",
    userid: session.userid,
    token: session.token,
    clienttime: Math.floor(Date.now() / 1000),
  };
};

/**
 * 构造协议 A 请求：Android 客户端签名 + 明文 JSON body
 * @param path 网关相对路径
 * @param body 业务请求体
 * @param ctx 请求上下文
 * @param options 附加查询参数与请求头
 * @returns 构造好的请求
 */
export const buildGatewayRequest = (
  path: string,
  body: Record<string, unknown>,
  ctx: KgRequestContext,
  options?: { params?: Record<string, unknown>; headers?: Record<string, string> },
): BuiltRequest => {
  const params: Record<string, unknown> = {
    dfid: ctx.dfid || "-",
    mid: ctx.mid,
    uuid: "-",
    appid: ctx.appid,
    clientver: ctx.clientver,
    clienttime: ctx.clienttime,
    ...(ctx.token ? { token: ctx.token } : {}),
    ...(ctx.userid ? { userid: ctx.userid } : {}),
    ...(options?.params ?? {}),
  };

  const bodyStr = JSON.stringify(body ?? {});
  const signature = signatureAndroidParams(params, bodyStr);

  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    query.append(key, typeof value === "object" ? JSON.stringify(value) : String(value));
  }
  query.append("signature", signature);

  const headers: Record<string, string> = {
    "User-Agent": KG_ANDROID_UA,
    "Content-Type": "application/json",
    dfid: ctx.dfid || "-",
    clienttime: String(ctx.clienttime),
    mid: ctx.mid,
    "kg-rc": "1",
    "kg-thash": "5d816a0",
    "kg-rec": "1",
    "kg-rf": KG_RF,
    ...(options?.headers ?? {}),
  };

  return { url: `${KG_GATEWAY_URL}${path}?${query.toString()}`, headers, body: bodyStr };
};

/**
 * 构造协议 B 请求：RSA 传参 + AES-128-CBC 加密 body
 * @param path 网关相对路径
 * @param body 业务请求体
 * @param ctx 请求上下文
 * @returns 构造好的请求，包含用于解密响应的 aes 字段
 */
export const buildCloudRequest = (
  path: string,
  body: Record<string, unknown>,
  ctx: KgRequestContext,
): BuiltRequest => {
  const aes = randomAes();
  const keyParam = cryptoMd5(
    `${ctx.appid}${ctx.signSalt}${ctx.clientver}${ctx.clienttime}`,
  ).toLowerCase();

  const p = rsaEncryptKugouPkcs1(
    { aes, uid: ctx.userid, token: ctx.token },
    ctx.publicKey,
  ).toUpperCase();

  const query = new URLSearchParams();
  query.append("appid", String(ctx.appid));
  query.append("clientver", String(ctx.clientver));
  query.append("mid", ctx.mid);
  query.append("clienttime", String(ctx.clienttime));
  query.append("key", keyParam);
  query.append("dfid", ctx.dfid || "-");
  query.append("p", p);

  const headers: Record<string, string> = {
    "x-router": KG_CLOUDLIST_ROUTER,
    "Content-Type": "application/json;charset=utf-8",
    dfid: ctx.dfid || "-",
    clienttime: String(ctx.clienttime),
    mid: ctx.mid,
    "kg-rc": "1",
    "kg-thash": "5d816a0",
    "kg-rec": "1",
    "kg-rf": KG_RF,
  };

  const cipherText = encryptCloudBody(body ?? {}, aes);

  return { url: `${KG_GATEWAY_URL}${path}?${query.toString()}`, headers, body: cipherText, aes };
};

/**
 * 发送协议 A 请求
 * @param path 网关相对路径
 * @param body 业务请求体
 * @param ctx 请求上下文
 * @param options 附加查询参数、请求头与超时配置
 * @returns HTTP 状态码与业务响应体
 */
export const sendGatewayRequest = async (
  path: string,
  body: Record<string, unknown>,
  ctx: KgRequestContext,
  options?: {
    params?: Record<string, unknown>;
    headers?: Record<string, string>;
    timeoutMs?: number;
  },
): Promise<KgSendResult> => {
  const built = buildGatewayRequest(path, body, ctx, options);
  const res = await platformRequest({
    url: built.url,
    method: "POST",
    headers: built.headers,
    data: built.body,
    timeout: options?.timeoutMs ?? 10000,
    responseType: "text",
  });
  const text = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
  return { status: res.status, body: parseJson(text) ?? text };
};

/**
 * 发送协议 B 请求
 * @param path 网关相对路径
 * @param body 业务请求体
 * @param ctx 请求上下文
 * @returns HTTP 状态码与业务响应体
 */
export const sendCloudRequest = async (
  path: string,
  body: Record<string, unknown>,
  ctx: KgRequestContext,
): Promise<KgSendResult> => {
  const built = buildCloudRequest(path, body, ctx);
  const res = await platformRequest({
    url: built.url,
    method: "POST",
    headers: built.headers,
    data: built.body,
    timeout: 10000,
    responseType: "arraybuffer",
  });
  const rawBytes =
    res.data instanceof ArrayBuffer
      ? new Uint8Array(res.data)
      : typeof res.data === "string"
        ? res.data
        : new Uint8Array(0);
  const text = decryptCloudResponse(rawBytes, built.aes ?? "");
  return { status: res.status, body: parseJson(text) ?? text };
};
