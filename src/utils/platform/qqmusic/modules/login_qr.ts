/**
 * QQ 音乐二维码登录模块
 *
 * 支持 QQ 扫码与微信扫码两路原生扫码协议。
 *
 * @author Hackerdallas
 */

import { qmRequest, replaceQQMusicCookies } from "../core/request";
import {
  credentialToSession,
  getCredentialMusicId,
  type QQMusicCredential,
} from "../core/credential";
import { coreLog } from "../core/logger";
import type { QMModule, QMParams } from "../core/types";
import { extractSetCookies, platformRequest, uint8ArrayToBase64 } from "../../http";

const WEB_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/**
 * QQ 系哈希算法（计算 ptqrtoken 与 g_tk）
 * @param str 输入字符串
 * @param seed 哈希种子
 * @returns 32 位无符号整数
 */
const hash33 = (str: string, seed = 0): number => {
  let h = seed;
  for (let i = 0; i < str.length; i++) {
    h = (((h << 5) + h + str.charCodeAt(i)) & 0xffffffff) >>> 0;
  }
  return h & 2147483647;
};

/**
 * 生成随机 UUID
 * @returns UUID 字符串
 */
const generateUUID = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

/**
 * 序列化 Cookie 字典为请求头字符串
 * @param cookies Cookie 键值对字典
 * @returns 格式化后的 Header 字符串
 */
const stringifyCookies = (cookies: Record<string, string>): string =>
  Object.entries(cookies)
    .filter(([, v]) => !!v)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");

/**
 * 获取二维码 Key 及图片 Base64
 * @param params.type 扫码类型，'qq' 或 'wx'，默认 'qq'
 */
export const login_qr_key: QMModule = async (params: QMParams) => {
  const type = String(params.type ?? "qq").toLowerCase();

  if (type === "wx") {
    const searchParams = new URLSearchParams({
      appid: "wx48db31d50e334801",
      redirect_uri: "https://y.qq.com/portal/wx_redirect.html?login_type=2&surl=https://y.qq.com/",
      response_type: "code",
      scope: "snsapi_login",
      state: "STATE",
      href: "https://y.qq.com/mediastyle/music_v17/src/css/popup_wechat.css#wechat_redirect",
    });

    const res = await platformRequest<string>({
      url: `https://open.weixin.qq.com/connect/qrconnect?${searchParams.toString()}`,
      method: "GET",
      headers: { "User-Agent": WEB_UA },
      responseType: "text",
      timeout: 8000,
    });

    if (res.status < 200 || res.status >= 300) {
      throw new Error(`获取微信登录页面失败: HTTP ${res.status}`);
    }

    const html = String(res.data ?? "");
    const match = /uuid=([^"]+)"/.exec(html) || /uuid=([a-zA-Z0-9_-]+)/.exec(html);
    if (!match) throw new Error("获取微信登录二维码 uuid 失败");
    const uuid = match[1];

    const qrRes = await platformRequest<ArrayBuffer>({
      url: `https://open.weixin.qq.com/connect/qrcode/${uuid}`,
      method: "GET",
      headers: {
        Referer: "https://open.weixin.qq.com/connect/qrconnect",
        "User-Agent": WEB_UA,
      },
      responseType: "arraybuffer",
      timeout: 8000,
    });

    if (qrRes.status < 200 || qrRes.status >= 300) {
      throw new Error(`获取微信登录二维码图片失败: HTTP ${qrRes.status}`);
    }

    const base64 = uint8ArrayToBase64(new Uint8Array(qrRes.data));

    return {
      code: 200,
      key: uuid,
      content: `data:image/jpeg;base64,${base64}`,
      type: "wx",
    };
  }

  // 默认 QQ 扫码
  const url = `https://ssl.ptlogin2.qq.com/ptqrshow?appid=716027609&e=2&l=M&s=3&d=72&v=4&t=${Math.random()}&daid=383&pt_3rd_aid=100497308`;
  const res = await platformRequest<ArrayBuffer>({
    url,
    method: "GET",
    headers: {
      Referer: "https://xui.ptlogin2.qq.com/",
      "User-Agent": WEB_UA,
    },
    responseType: "arraybuffer",
    timeout: 8000,
  });

  if (res.status < 200 || res.status >= 300) {
    throw new Error(`获取 QQ 登录二维码失败: HTTP ${res.status}`);
  }

  const cookies = extractSetCookies(res.headers);
  const qrsig = cookies.qrsig;
  if (!qrsig) throw new Error("未能获取到 QQ 登录 qrsig");

  const base64 = uint8ArrayToBase64(new Uint8Array(res.data));

  return {
    code: 200,
    key: qrsig,
    content: `data:image/png;base64,${base64}`,
    type: "qq",
  };
};

/**
 * 轮询二维码扫描状态
 * @param params.key 二维码 Key（QQ 为 qrsig，微信为 uuid）
 * @param params.type 扫码类型，'qq' 或 'wx'
 */
export const login_qr_check: QMModule = async (params: QMParams) => {
  const key = String(params.key ?? "");
  const type = String(params.type ?? "qq").toLowerCase();
  if (!key) throw new Error("缺少二维码 key");

  if (type === "wx") {
    const query = new URLSearchParams({
      uuid: key,
      _: String(Date.now()),
    });

    const res = await platformRequest<string>({
      url: `https://lp.open.weixin.qq.com/connect/l/qrconnect?${query.toString()}`,
      method: "GET",
      headers: {
        Referer: "https://open.weixin.qq.com/",
        "User-Agent": WEB_UA,
      },
      responseType: "text",
      timeout: 35000,
    });

    const text = String(res.data ?? "");
    const match = /window\.wx_errcode=(\d+);window\.wx_code='([^']*)'/.exec(text);
    if (!match) {
      return { code: 200, status: 1 };
    }

    const errcode = Number(match[1]);
    const wxCode = match[2];

    if (errcode === 404) {
      return { code: 200, status: 2 }; // 已扫码待确认
    }
    if (errcode === 402 || errcode === 403) {
      return { code: 200, status: 0 }; // 已过期或已取消
    }
    if (errcode === 405 && wxCode) {
      const wxLoginData = await qmRequest<QQMusicCredential>(
        "music.login.LoginServer",
        "Login",
        { code: wxCode, strAppid: "wx48db31d50e334801" },
        { session: false, comm: { tmeLoginType: 1 } },
      );

      const uinStr = getCredentialMusicId(wxLoginData);
      if (!uinStr || !wxLoginData.musickey) throw new Error("微信登录响应缺少有效凭据");
      const savedCookies = credentialToSession(wxLoginData, 1);
      replaceQQMusicCookies(savedCookies);
      coreLog.info("微信扫码登录成功");

      return {
        code: 200,
        status: 4,
        nickname: wxLoginData.nick || wxLoginData.nickname,
        avatarUrl: wxLoginData.logo || wxLoginData.avatarUrl,
      };
    }

    return { code: 200, status: 1 };
  }

  // QQ 扫码检查
  const ptqrtoken = hash33(key, 0);
  const query = new URLSearchParams({
    u1: "https://graph.qq.com/oauth2.0/login_jump",
    ptqrtoken: String(ptqrtoken),
    ptredirect: "0",
    h: "1",
    t: "1",
    g: "1",
    from_ui: "1",
    ptlang: "2052",
    action: `0-0-${Date.now()}`,
    js_ver: "20102616",
    js_type: "1",
    pt_uistyle: "40",
    aid: "716027609",
    daid: "383",
    pt_3rd_aid: "100497308",
    has_onekey: "1",
  });

  const res = await platformRequest<string>({
    url: `https://ssl.ptlogin2.qq.com/ptqrlogin?${query.toString()}`,
    method: "GET",
    headers: {
      Referer: "https://xui.ptlogin2.qq.com/",
      Cookie: `qrsig=${key};`,
      "User-Agent": WEB_UA,
    },
    responseType: "text",
    timeout: 8000,
  });

  const text = String(res.data ?? "");
  const match = /ptuiCB\((.*?)\)/.exec(text);
  if (!match) return { code: 200, status: 1 };

  const args = [...match[1].matchAll(/'((?:\\.|[^'])*)'/g)].map((m) => m[1]);
  const statusCode = args[0];
  const nickname = args[5] || "";

  if (statusCode === "65") {
    return { code: 200, status: 0 }; // 已失效
  }
  if (statusCode === "67") {
    return { code: 200, status: 2, nickname }; // 正在验证中
  }
  if (statusCode === "0") {
    const jumpUrl = args[2] ?? "";
    if (!jumpUrl || !jumpUrl.startsWith("http")) {
      throw new Error(`无效的跳转链接: ${jumpUrl}`);
    }

    const initialCookies = extractSetCookies(res.headers, { qrsig: key });
    coreLog.info("正在执行 check_sig 授权...");

    const checkSigRes = await platformRequest<string>({
      url: jumpUrl,
      method: "GET",
      headers: {
        Referer: "https://xui.ptlogin2.qq.com/",
        Cookie: stringifyCookies(initialCookies),
        "User-Agent": WEB_UA,
      },
      disableRedirects: true,
      responseType: "text",
      timeout: 8000,
    });

    const sessionCookies = extractSetCookies(checkSigRes.headers, initialCookies);
    const p_skey =
      sessionCookies.p_skey || sessionCookies.p_sKey || sessionCookies.skey || sessionCookies.pskey;

    if (!p_skey) {
      coreLog.warn("check_sig 未提取到 p_skey");
      throw new Error("获取 p_skey 失败");
    }

    const authBody = new URLSearchParams({
      response_type: "code",
      client_id: "100497308",
      redirect_uri: "https://y.qq.com/portal/wx_redirect.html?login_type=1&surl=https://y.qq.com/",
      scope: "get_user_info,get_app_friends",
      state: "state",
      switch: "",
      from_ptlogin: "1",
      src: "1",
      update_auth: "1",
      openapi: "1010_1030",
      g_tk: String(hash33(p_skey, 5381)),
      auth_time: String(Date.now()),
      ui: generateUUID(),
    });

    const authRes = await platformRequest<string>({
      url: "https://graph.qq.com/oauth2.0/authorize",
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: "https://xui.ptlogin2.qq.com/",
        Cookie: stringifyCookies(sessionCookies),
        "User-Agent": WEB_UA,
      },
      data: authBody.toString(),
      disableRedirects: true,
      responseType: "text",
      timeout: 8000,
    });

    const location = authRes.headers["location"] || "";
    const codeMatch = /(?<=code=)(.+?)(?=&|$)/.exec(location);
    if (!codeMatch) {
      coreLog.warn("authorize 未返回 code");
      throw new Error("获取 QQ 授权 code 失败");
    }
    const code = codeMatch[1];

    const qqLoginData = await qmRequest<QQMusicCredential>(
      "QQConnectLogin.LoginServer",
      "QQLogin",
      { code },
      { session: false, comm: { tmeLoginType: 2 } },
    );

    const uinMatch = /(?:\?|&)uin=(.+?)&/.exec(jumpUrl);
    const uin = uinMatch?.[1] || "";
    const uinStr = getCredentialMusicId(qqLoginData, uin);
    if (!uinStr || !qqLoginData.musickey) throw new Error("QQ 登录响应缺少有效凭据");
    const savedCookies = credentialToSession(qqLoginData, 2, uin);

    const qqConnectCookies: Record<string, string> = {};
    for (const name of ["p_skey", "skey", "p_uin", "pt4_token", "supervisor"]) {
      const value = sessionCookies[name];
      if (value) qqConnectCookies[name] = value;
    }
    if (Object.keys(qqConnectCookies).length > 0) {
      coreLog.info(`已保留 QQ 互联 cookie：${Object.keys(qqConnectCookies).join(", ")}`);
    }

    replaceQQMusicCookies({ ...savedCookies, ...qqConnectCookies });
    coreLog.info("QQ 扫码登录成功");

    return {
      code: 200,
      status: 4,
      nickname: qqLoginData.nick || qqLoginData.nickname || nickname,
      avatarUrl:
        qqLoginData.logo ||
        qqLoginData.avatarUrl ||
        `https://q.qlogo.cn/headimg_dl?dst_uin=${uinStr}&spec=100`,
    };
  }

  return { code: 200, status: 1 };
};
