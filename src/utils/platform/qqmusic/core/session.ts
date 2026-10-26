/**
 * QQ 音乐会话持有者
 *
 * 维护内存副本并同步持久化至 localStorage 平台会话影子库，
 * 保证缓存维度与网络请求读取到完全一致的会话数据。
 *
 * @author Hackerdallas
 */

import {
  clearSessionCookies,
  getSessionCookies,
  saveSessionCookies,
} from "../../sessionStore";

/** 内存中的会话副本（null 表示尚未从持久化层载入） */
let session: Record<string, string> | null = null;

/**
 * 读取当前 QQ 音乐会话字段
 * @returns 会话字段字典；未登录时返回空对象
 */
export const getQQMusicSession = (): Record<string, string> => {
  if (session !== null) return session;
  session = getSessionCookies("qqmusic");
  return session;
};

/**
 * 整体覆盖当前 QQ 音乐会话并持久化
 * @param cookies 新的会话字段
 * @returns 更新后的会话字段
 */
export const setQQMusicSession = (cookies: Record<string, string>): Record<string, string> => {
  session = { ...cookies };
  saveSessionCookies("qqmusic", session);
  return session;
};

/**
 * 合并增量字段到当前 QQ 音乐会话并持久化
 * @param cookies 待合并的字段
 * @returns 合并后的会话字段
 */
export const mergeQQMusicSession = (cookies: Record<string, string>): Record<string, string> => {
  session = { ...getQQMusicSession(), ...cookies };
  saveSessionCookies("qqmusic", session);
  return session;
};

/**
 * 清空当前 QQ 音乐会话并持久化
 */
export const resetQQMusicSession = (): void => {
  session = {};
  clearSessionCookies("qqmusic");
};
