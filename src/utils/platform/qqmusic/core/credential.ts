/**
 * QQ 音乐登录凭据转换与有效期管理
 *
 * @author Hackerdallas
 */

/** QQ 音乐登录返回的凭据结构 */
export interface QQMusicCredential {
  musickey?: string;
  musicid?: number | string;
  str_musicid?: string;
  refresh_key?: string;
  refresh_token?: string;
  access_token?: string;
  encryptUin?: string;
  openid?: string;
  unionid?: string;
  expired_at?: number;
  musickeyCreateTime?: number;
  keyExpiresIn?: number;
  loginType?: number;
  nick?: string;
  nickname?: string;
  logo?: string;
  avatarUrl?: string;
}

/**
 * 生成发送给 QQ 音乐的 Cookie 请求头
 * @param session 本地保存的会话字典
 * @returns 格式化后的 Cookie 请求头；为空时返回 undefined
 */
export const sessionToCookieHeader = (session: Record<string, string>): string | undefined => {
  const entries = Object.entries(session).filter(([, value]) => !!value);
  return entries.length > 0
    ? entries.map(([key, value]) => `${key}=${value}`).join("; ")
    : undefined;
};

/**
 * 获取凭据对应的真实音乐账号 ID
 * @param credential QQ 音乐登录凭据
 * @param fallback 未返回账号 ID 时的兜底值
 * @returns 音乐账号 ID
 */
export const getCredentialMusicId = (credential: QQMusicCredential, fallback = ""): string =>
  String(credential.str_musicid || credential.musicid || fallback).replace(/^o/, "");

/**
 * 将登录凭据转换为可持久化的会话字段
 * @param credential QQ 音乐登录凭据
 * @param loginType 登录类型（1: 微信, 2: QQ）
 * @param fallbackMusicId 账号 ID 兜底值
 * @returns 可持久化的会话字段字典
 */
export const credentialToSession = (
  credential: QQMusicCredential,
  loginType: 1 | 2,
  fallbackMusicId = "",
): Record<string, string> => {
  const musicId = getCredentialMusicId(credential, fallbackMusicId);
  const session: Record<string, string> = {
    uin: musicId,
    qm_str_musicid: musicId,
    qm_keyst: credential.musickey || "",
    qqmusic_key: credential.musickey || "",
    tmeLoginType: String(credential.loginType || loginType),
  };

  if (loginType === 1) session.wxuin = musicId;
  if (credential.encryptUin) session.euin = credential.encryptUin;
  if (credential.openid) {
    session[loginType === 1 ? "wxopenid" : "psrf_qqopenid"] = credential.openid;
  }
  if (credential.unionid) session.psrf_qqunionid = credential.unionid;
  if (credential.refresh_token) {
    session[loginType === 1 ? "wxrefresh_token" : "psrf_qqrefresh_token"] =
      credential.refresh_token;
  }
  if (credential.access_token) session.psrf_qqaccess_token = credential.access_token;
  if (credential.refresh_key) session.qm_refresh_key = credential.refresh_key;
  if (credential.expired_at) session.psrf_access_token_expiresAt = String(credential.expired_at);
  if (credential.musickeyCreateTime) {
    session.psrf_musickey_createtime = String(credential.musickeyCreateTime);
  }
  if (credential.keyExpiresIn) session.qm_key_expires_in = String(credential.keyExpiresIn);

  return session;
};

/** 凭据有效期解析结果 */
export interface QQMusicCredentialTTL {
  /** 签发时刻（毫秒时间戳） */
  issuedAt: number;
  /** 有效期长度（毫秒） */
  expiresInMs: number;
  /** 到期时刻（毫秒时间戳） */
  expiresAt: number;
  /** 剩余有效期（毫秒） */
  remainingMs: number;
}

/** 秒级时间戳与毫秒级时间戳的分界限 */
const SECONDS_TIMESTAMP_LIMIT = 1e11;

/** 秒级时长与毫秒级时长的分界限 */
const SECONDS_DURATION_LIMIT = 1e6;

/** 续期触发阈值比例：剩余有效期低于总有效期的比例即触发续期 */
export const REFRESH_THRESHOLD_RATIO = 0.25;

/**
 * 将时间戳归一化为毫秒
 * @param value 原始时间戳数值
 * @returns 毫秒时间戳
 */
export const toTimestampMs = (value: number): number =>
  value > 0 && value < SECONDS_TIMESTAMP_LIMIT ? value * 1000 : value;

/**
 * 将时长归一化为毫秒
 * @param value 原始时长数值
 * @returns 毫秒时长
 */
export const toDurationMs = (value: number): number =>
  value > 0 && value < SECONDS_DURATION_LIMIT ? value * 1000 : value;

/**
 * 解析会话字段中的凭据有效期信息
 * @param cookies 会话字段字典
 * @param now 当前时刻毫秒时间戳
 * @returns 有效期详情；缺少必要字段时返回 null
 */
export const resolveCredentialTTL = (
  cookies: Record<string, string>,
  now: number = Date.now(),
): QQMusicCredentialTTL | null => {
  const rawIssued = cookies.psrf_musickey_createtime;
  const rawExpires = cookies.qm_key_expires_in;
  if (!rawIssued || !rawExpires) return null;

  const issuedNum = Number(rawIssued);
  const expiresNum = Number(rawExpires);
  if (Number.isNaN(issuedNum) || Number.isNaN(expiresNum) || issuedNum <= 0 || expiresNum <= 0) {
    return null;
  }

  const issuedAt = toTimestampMs(issuedNum);
  const expiresInMs = toDurationMs(expiresNum);
  if (!issuedAt || !expiresInMs) return null;

  const expiresAt = issuedAt + expiresInMs;
  return { issuedAt, expiresInMs, expiresAt, remainingMs: expiresAt - now };
};

/**
 * 判断凭据是否需要执行主动续期
 * @param ttl 凭据有效期解析结果
 * @param now 当前时刻毫秒时间戳
 * @param thresholdRatio 触发阈值比例
 * @returns 是否需要续期
 */
export const shouldRefreshCredential = (
  ttl: QQMusicCredentialTTL | null,
  now: number = Date.now(),
  thresholdRatio: number = REFRESH_THRESHOLD_RATIO,
): boolean => {
  if (!ttl) return false;
  return now >= ttl.issuedAt + ttl.expiresInMs * thresholdRatio;
};
