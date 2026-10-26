/**
 * QQ 音乐统一请求层与凭据续期调度器
 *
 * 核心设计：
 * - 统一走 u.y.qq.com/cgi-bin/musicu.fcg 的 { comm, request: { module, method, param } } 协议；
 * - 首次请求前先初始化客户端会话（GetSession 拿 uid/sid/userip，有效期 1 小时）；
 * - 自动注入 Cookie 与身份凭据（uin, qq, authst, tmeLoginType 等）；
 * - 鉴权失效（authExpired）时触发主动续期重试；
 * - 续期单飞并发保护、30 秒冷却防刷、qm_refresh_key 一次性保护；
 * - 调度器覆盖：冷启动主动探测 + App.addListener('appStateChange') 切回前台 + 30 分钟固定轮询。
 *
 * @author Hackerdallas
 */

import { App } from "@capacitor/app";
import type { PluginListenerHandle } from "@capacitor/core";
import { QM_API_URL, QM_HEADERS, SESSION_TTL, getCommonParams } from "./config";
import {
  resolveCredentialTTL,
  sessionToCookieHeader,
  shouldRefreshCredential,
} from "./credential";
import { QQMusicApiError, isAuthExpiredCode } from "./auth";
import { clearCache, resolveAccountId } from "./cache";
import {
  getQQMusicSession,
  mergeQQMusicSession,
  resetQQMusicSession,
  setQQMusicSession,
} from "./session";
import { platformRequest } from "../../http";
import { coreLog } from "./logger";

/** Session 字段缓存 */
interface SessionCache {
  uid?: string;
  sid?: string;
  userip?: string;
  expireAt: number;
}

let session: SessionCache = { expireAt: 0 };
let initPromise: Promise<void> | null = null;
let sessionGeneration = 0;

/** 使当前客户端会话失效 */
const invalidateSession = (): void => {
  sessionGeneration++;
  session = { expireAt: 0 };
};

/** 读取当前 QQ 音乐 Cookie 字典 */
export const getQQMusicCookies = (): Record<string, string> => getQQMusicSession();

/** 更新 QQ 音乐 Cookie 并持久化 */
export const mergeQQMusicCookies = (cookies: Record<string, string>): void => {
  const previousAccountId = resolveAccountId(getQQMusicCookies());
  const merged = mergeQQMusicSession(cookies);
  invalidateSession();
  if (resolveAccountId(merged) !== previousAccountId) clearCache();
  coreLog.info(`已更新 Cookie (${Object.keys(merged).length} 个字段)`);
};

/**
 * 整体替换当前 QQ 音乐会话（换号登录）
 * @param cookies 新账号会话字段
 */
export const replaceQQMusicCookies = (cookies: Record<string, string>): void => {
  resetQQMusicSession();
  setQQMusicSession(cookies);
  invalidateSession();
  clearCache();
  lastRefreshFailureAt = 0;
  coreLog.info(`已切换账号会话 (${Object.keys(cookies).length} 个字段)`);
};

/** 清空当前 QQ 音乐会话 */
export const clearQQMusicCookies = (): void => {
  resetQQMusicSession();
  invalidateSession();
  clearCache();
  coreLog.info("已清空 QQ 音乐会话");
};

/** 提取当前登录账号的纯数字 uin */
export const getQQMusicUin = (): string => {
  const cookies = getQQMusicCookies();
  const raw = cookies.qm_str_musicid || cookies.uin || cookies.wxuin || cookies.p_uin || "";
  return raw ? raw.replace(/^o/, "") : "0";
};

/** 重试配置 */
const MAX_RETRY = 2;
const RETRY_BACKOFF = 300;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface FcgResponse {
  code?: number;
  request?: { code?: number; data?: unknown };
  [key: string]: unknown;
}

/** 请求附加选项 */
export interface QMRequestOptions {
  /** 是否在请求前初始化客户端会话，默认 true */
  session?: boolean;
  /** 追加到 comm 的字段 */
  comm?: Record<string, unknown>;
  /** 是否使用网页端 comm（ct=24 / cv=0）与网页端 Referer（带尾斜杠） */
  webComm?: boolean;
  /** 覆盖请求的 Referer */
  referer?: string;
}

/** 网页端 comm */
const WEB_COMM: Record<string, unknown> = {
  ct: 24,
  cv: 0,
  format: "json",
  platform: "yqq.json",
};

/** 网页端 Referer（必须带尾斜杠） */
const WEB_REFERER = "https://y.qq.com/";

/** 发起一次原始 musicu.fcg POST 请求 */
const postRaw = async (
  body: unknown,
  extraHeaders?: Record<string, string>,
): Promise<FcgResponse> => {
  const cookies = getQQMusicCookies();
  const cookieStr = sessionToCookieHeader(cookies);

  const res = await platformRequest<FcgResponse>({
    url: QM_API_URL,
    method: "POST",
    headers: {
      ...QM_HEADERS,
      ...(cookieStr ? { Cookie: cookieStr } : {}),
      ...extraHeaders,
    },
    data: body,
    timeout: 8000,
  });

  let rawData = res.data;
  if (typeof rawData === "string") {
    try {
      rawData = JSON.parse(rawData);
    } catch {
      rawData = {};
    }
  }

  return (rawData ?? {}) as FcgResponse;
};

/**
 * 发送请求并在网络波动时重试
 * @param body 请求体
 * @param extraHeaders 附加请求头
 * @param module 业务 module
 * @param method 业务 method
 * @returns 业务数据段
 */
const postWithRetry = async <T>(
  body: unknown,
  extraHeaders: Record<string, string> | undefined,
  module: string,
  method: string,
): Promise<T> => {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
    try {
      const data = await postRaw(body, extraHeaders);
      const outerCode = data.code ?? 0;
      const innerCode = data.request?.code ?? 0;
      if (outerCode !== 0 || innerCode !== 0) {
        throw new QQMusicApiError({
          outer: outerCode,
          inner: innerCode,
          module,
          method,
          authExpired: isAuthExpiredCode(module, innerCode),
        });
      }
      return data.request?.data as T;
    } catch (err) {
      if (err instanceof QQMusicApiError) throw err;
      lastErr = err;
      if (attempt < MAX_RETRY) await delay(RETRY_BACKOFF);
    }
  }
  throw lastErr;
};

/** 初始化并缓存客户端会话 */
const ensureSession = (): Promise<void> => {
  if (session.uid && session.expireAt > Date.now()) return Promise.resolve();
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const generation = sessionGeneration;
    try {
      const uin = getQQMusicUin();
      const body = {
        comm: {
          ...getCommonParams(),
          ...(uin && uin !== "0" ? { uin } : {}),
        },
        request: {
          module: "music.getSession.session",
          method: "GetSession",
          param: { caller: 0, uid: uin, vkey: 0 },
        },
      };
      const data = await postRaw(body);
      if (generation === sessionGeneration && data.code === 0 && data.request?.code === 0) {
        const info =
          ((data.request.data as { session?: Partial<SessionCache> }) ?? {}).session ?? {};
        session = {
          uid: info.uid,
          sid: info.sid,
          userip: info.userip,
          expireAt: Date.now() + SESSION_TTL,
        };
      }
    } catch {
      // 客户端会话获取失败不阻断后续业务请求
    } finally {
      initPromise = null;
    }
  })();

  return initPromise;
};

/**
 * 发送一次 musicu.fcg 业务请求
 * @param module 业务 module
 * @param method 业务 method
 * @param param 业务 param
 * @param options 请求选项
 * @returns 业务数据段
 */
export const qmRequest = async <T = unknown>(
  module: string,
  method: string,
  param: Record<string, unknown>,
  options: QMRequestOptions = {},
): Promise<T> => {
  const useSession = options.session !== false;
  if (useSession) await ensureSession();

  const extraHeaders: Record<string, string> | undefined =
    options.referer || options.webComm ? { Referer: options.referer ?? WEB_REFERER } : undefined;

  const buildBody = (): Record<string, unknown> => {
    const uin = getQQMusicUin();
    const cookies = getQQMusicCookies();
    const musickey = cookies.qm_keyst || cookies.qqmusic_key;
    const loginType =
      cookies.tmeLoginType !== undefined
        ? Number(cookies.tmeLoginType)
        : musickey?.startsWith("W_X")
          ? 1
          : 2;

    const comm = {
      ...(options.webComm ? WEB_COMM : getCommonParams()),
      ...(uin && uin !== "0" ? { uin, qq: uin } : {}),
      ...(musickey ? { authst: musickey, tmeLoginType: loginType } : {}),
      ...(useSession && session.uid ? { uid: session.uid } : {}),
      ...(useSession && session.sid ? { sid: session.sid } : {}),
      ...(useSession && session.userip ? { userip: session.userip } : {}),
      ...(options.comm ?? {}),
    };

    return { comm, request: { module, method, param } };
  };

  try {
    return await postWithRetry<T>(buildBody(), extraHeaders, module, method);
  } catch (err) {
    if (!(err instanceof QQMusicApiError) || !err.authExpired) throw err;
    const refreshed = await refreshQQMusicCredential();
    if (!refreshed) throw err;
    return await postWithRetry<T>(buildBody(), extraHeaders, module, method);
  }
};

/** 获取当前内存 session 快照（调试用） */
export const getQMSession = (): Readonly<SessionCache> => session;

/** LoginServer.Login 刷新响应字段 */
interface RefreshCredentialData {
  musickey?: string;
  openid?: string;
  unionid?: string;
  refresh_token?: string;
  access_token?: string;
  expired_at?: number;
  musicid?: number;
  str_musicid?: string;
  refresh_key?: string;
  musickeyCreateTime?: number;
  keyExpiresIn?: number;
  encryptUin?: string;
  loginType?: number;
}

/** 续期失败后的冷却时长（30 秒） */
const REFRESH_COOLDOWN = 30_000;

/** 单飞凭据续期 Promise */
let refreshPromise: Promise<boolean> | null = null;

/** 上次续期失败时刻 */
let lastRefreshFailureAt = 0;

/** 执行一次凭据刷新 */
const doRefreshCredential = async (): Promise<boolean> => {
  const cookies = getQQMusicCookies();
  const uin = getQQMusicUin();
  const musickey = cookies.qm_keyst || cookies.qqmusic_key;
  if (!uin || uin === "0" || !musickey) return false;

  const loginType = Number(cookies.tmeLoginType) || (musickey.startsWith("W_X") ? 1 : 2);
  const refreshKey = cookies.qm_refresh_key || "";

  let param: Record<string, unknown>;
  if (loginType === 1) {
    param = {
      openid: cookies.wxopenid || cookies.psrf_qqopenid || "",
      refresh_token: cookies.wxrefresh_token || cookies.psrf_qqrefresh_token || "",
      str_musicid: cookies.qm_str_musicid || uin,
      musickey,
      unionid: cookies.psrf_qqunionid || "",
      refresh_key: refreshKey,
      loginMode: 2,
    };
  } else {
    param = {
      openid: cookies.psrf_qqopenid || cookies.wxopenid || "",
      access_token: cookies.psrf_qqaccess_token || "",
      refresh_token: cookies.psrf_qqrefresh_token || cookies.wxrefresh_token || "",
      expired_in: Number(cookies.psrf_access_token_expiresAt) || 0,
      musicid: Number(uin) || 0,
      musickey,
      refresh_key: refreshKey,
      loginMode: 2,
    };
  }

  try {
    const resp = await postRaw({
      comm: {
        ...getCommonParams(),
        ...(uin !== "0" ? { uin, qq: uin } : {}),
        authst: musickey,
        tmeLoginType: loginType,
      },
      request: {
        module: "music.login.LoginServer",
        method: "Login",
        param,
      },
    });

    const inner = resp.request;
    if (resp.code !== 0 || inner?.code !== 0) {
      coreLog.warn("凭据刷新被拒绝");
      return false;
    }

    const data = inner?.data as RefreshCredentialData | undefined;
    if (!data?.musickey) return false;

    const refreshed: Record<string, string> = {
      qm_keyst: data.musickey,
      qqmusic_key: data.musickey,
      tmeLoginType: String(data.loginType ?? loginType),
    };

    if (data.str_musicid || data.musicid) {
      const musicId = String(data.str_musicid || data.musicid).replace(/^o/, "");
      refreshed.qm_str_musicid = musicId;
      refreshed.uin = musicId;
      if (loginType === 1) refreshed.wxuin = musicId;
    }
    if (data.encryptUin) refreshed.euin = data.encryptUin;
    if (data.openid) refreshed[loginType === 1 ? "wxopenid" : "psrf_qqopenid"] = data.openid;
    if (data.unionid) refreshed.psrf_qqunionid = data.unionid;
    if (data.refresh_token) {
      refreshed[loginType === 1 ? "wxrefresh_token" : "psrf_qqrefresh_token"] = data.refresh_token;
    }
    if (data.access_token) refreshed.psrf_qqaccess_token = data.access_token;
    if (data.expired_at) refreshed.psrf_access_token_expiresAt = String(data.expired_at);
    if (data.musickeyCreateTime) {
      refreshed.psrf_musickey_createtime = String(data.musickeyCreateTime);
    }
    if (data.refresh_key) refreshed.qm_refresh_key = data.refresh_key;
    if (data.keyExpiresIn) refreshed.qm_key_expires_in = String(data.keyExpiresIn);

    mergeQQMusicCookies(refreshed);
    coreLog.info("musickey 刷新成功");
    return true;
  } catch (err) {
    coreLog.warn("musickey 刷新异常", err);
    return false;
  }
};

/**
 * 刷新 QQ 音乐登录凭据
 *
 * 具备并发单飞与 30 秒失败冷却保护。
 * @returns 是否刷新成功
 */
export const refreshQQMusicCredential = async (): Promise<boolean> => {
  if (refreshPromise) return refreshPromise;
  if (lastRefreshFailureAt && Date.now() - lastRefreshFailureAt < REFRESH_COOLDOWN) return false;

  refreshPromise = doRefreshCredential()
    .then((ok) => {
      if (ok) lastRefreshFailureAt = 0;
      else lastRefreshFailureAt = Date.now();
      return ok;
    })
    .finally(() => {
      refreshPromise = null;
    });
  return refreshPromise;
};

/** 轮询检查间隔（30 分钟） */
const REFRESH_CHECK_INTERVAL = 30 * 60 * 1000;

/** 定时器句柄 */
let refreshTimer: ReturnType<typeof setInterval> | null = null;

/** 原生应用前后台切换监听器句柄 */
let appStateHandle: PluginListenerHandle | null = null;

/**
 * 按凭据有效期判断是否需要续期并在需要时立即触发
 * @returns 是否执行了续期
 */
export const refreshQQMusicCredentialIfNeeded = async (): Promise<boolean> => {
  const cookies = getQQMusicCookies();
  if (!shouldRefreshCredential(resolveCredentialTTL(cookies))) return false;
  return refreshQQMusicCredential();
};

/**
 * 启动凭据续期调度器
 *
 * 三重触发保障：
 * 1. 冷启动探测：启动瞬间检查并按需续期；
 * 2. 前台返回事件：监听到 App 从后台切回前台时探测；
 * 3. 定时轮询：每 30 分钟定时探测一次。
 */
export const startQQMusicCredentialScheduler = (): void => {
  if (refreshTimer) return;

  // 1. 冷启动触发
  void refreshQQMusicCredentialIfNeeded();

  // 2. 轮询定时器
  refreshTimer = setInterval(() => {
    void refreshQQMusicCredentialIfNeeded();
  }, REFRESH_CHECK_INTERVAL);
  if (typeof refreshTimer === "object" && "unref" in refreshTimer) {
    (refreshTimer as { unref: () => void }).unref();
  }

  // 3. 应用从后台恢复前台触发
  if (typeof App !== "undefined" && typeof App.addListener === "function") {
    try {
      App.addListener("appStateChange", ({ isActive }) => {
        if (isActive) {
          void refreshQQMusicCredentialIfNeeded();
        }
      })
        .then((handle) => {
          appStateHandle = handle;
        })
        .catch(() => {});
    } catch {
      // 忽略非移动端或无插件环境异常
    }
  }
};

/**
 * 停止凭据续期调度器
 */
export const stopQQMusicCredentialScheduler = (): void => {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
  if (appStateHandle) {
    appStateHandle.remove();
    appStateHandle = null;
  }
};
