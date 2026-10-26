/**
 * 酷狗音乐二维码登录模块
 *
 * @author Hackerdallas
 */

import { getKgAppid, getKgClientver } from "../core/config";
import { getDeviceMid, signatureWebParams } from "../core/crypto";
import type { KGModule, KGParams } from "../core/types";
import { getSessionCookies, saveSessionCookies } from "../../sessionStore";
import { clearCache } from "../core/cache";
import { platformRequest } from "../../http";

const BASE_URL = "https://login-user.kugou.com";
const SRC_APPID = 2919;

/**
 * 发起登录相关 Web 接口请求
 * @param path 接口相对路径
 * @param input 业务入参
 * @returns 业务响应 JSON
 */
const request = async (path: string, input: Record<string, unknown>): Promise<any> => {
  const params: Record<string, unknown> = {
    dfid: "-",
    mid: getDeviceMid(),
    uuid: "-",
    appid: 1001,
    clientver: getKgClientver(),
    clienttime: Math.floor(Date.now() / 1000),
    ...input,
  };
  params.signature = signatureWebParams(params);

  const queryParams: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      queryParams[key] = String(value);
    }
  }

  const response = await platformRequest({
    url: `${BASE_URL}${path}`,
    method: "GET",
    params: queryParams,
    timeout: 8000,
    responseType: "json",
  });

  if (response.status !== 200) {
    throw new Error(`KG login HTTP ${response.status}`);
  }

  return response.data;
};

/**
 * 获取登录二维码 Key 及扫码 URL
 */
export const login_qr_key: KGModule = async () => {
  const appid = getKgAppid();
  const body = await request("/v2/qrcode", {
    type: 1,
    plat: 4,
    qrcode_txt: `https://h5.kugou.com/apps/loginQRCode/html/index.html?appid=${appid}&`,
    srcappid: SRC_APPID,
  });
  const key = body?.data?.qrcode;
  if (!key) throw new Error("KG QR key missing");
  return {
    code: 200,
    key,
    content: `https://h5.kugou.com/apps/loginQRCode/html/index.html?qrcode=${key}`,
  };
};

/**
 * 轮询二维码扫码状态
 * @param params.key 二维码 key
 */
export const login_qr_check: KGModule = async (params: KGParams) => {
  const key = String(params.key ?? "");
  if (!key) throw new Error("KG QR key missing");

  const body = await request("/v2/get_userinfo_qrcode", {
    plat: 4,
    appid: getKgAppid(),
    srcappid: SRC_APPID,
    qrcode: key,
  });

  const data = body?.data ?? {};
  const nickname = data.username ?? data.nickname ?? data.nick_name ?? data.user_name;
  const avatarUrl =
    data.userpic ?? data.user_pic ?? data.avatar ?? data.avatar_url ?? data.pic ?? data.user_img;

  if (Number(data.status) === 4) {
    const previous = getSessionCookies("kugou");
    saveSessionCookies("kugou", {
      ...(previous.guid ? { guid: previous.guid } : {}),
      ...(previous.dfid ? { dfid: previous.dfid } : {}),
      token: String(data.token ?? ""),
      userid: String(data.userid ?? ""),
      vip_token: String(data.vip_token ?? ""),
      vip_type: String(data.vip_type ?? 0),
      nickname: String(nickname ?? `KG ${data.userid ?? ""}`),
      avatar: String(avatarUrl ?? "").replace(/^http:\/\//, "https://"),
    });
    clearCache();
  }

  return {
    code: 200,
    status: Number(data.status ?? 1),
    nickname,
    avatarUrl:
      typeof avatarUrl === "string" ? avatarUrl.replace(/^http:\/\//, "https://") : undefined,
  };
};
