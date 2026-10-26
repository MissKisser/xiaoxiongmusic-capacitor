/**
 * QQ 音乐前端统一模块服务
 *
 * 统一调用入口：callQQMusic(name, params)
 * 具备请求内存缓存、账号隔离、凭据自动续期能力。
 *
 * @author Hackerdallas
 */

import {
  clearQQMusicCookies,
  mergeQQMusicCookies,
  replaceQQMusicCookies,
  startQQMusicCredentialScheduler,
  stopQQMusicCredentialScheduler,
} from "./core/request";
import { login_qr_check, login_qr_key } from "./modules/login_qr";
import { user_detail } from "./modules/user_detail";
import {
  playlist_detail,
  playlist_edit_info,
  song_detail,
  subscription_status,
  user_liked_songs,
  user_playlist_list,
} from "./modules/user_playlist";
import { song_url } from "./modules/song_url";
import { search } from "./modules/search";
import type { QMModule, QMParams } from "./core/types";
import {
  buildCacheKey,
  cacheGet,
  cacheSet,
  clearCache,
  resolveAccountId,
  syncAccountScope,
} from "./core/cache";
import { getQQMusicSession } from "./core/session";
import { coreLog } from "./core/logger";

export {
  clearQQMusicCookies,
  mergeQQMusicCookies,
  replaceQQMusicCookies,
  startQQMusicCredentialScheduler,
  stopQQMusicCredentialScheduler,
};

/** 默认缓存有效期：2 分钟 */
const DEFAULT_TTL = 2 * 60 * 1000;

/** 不走缓存的实时或敏感接口 */
const NON_CACHEABLE: ReadonlySet<string> = new Set([
  "login_qr_key",
  "login_qr_check",
  "user_detail",
  "song_url",
  "search",
  "user_playlist_list",
  "user_liked_songs",
  "subscription_status",
  "playlist_detail",
  "playlist_edit_info",
]);

/** 模块注册表 */
const modules: Record<string, QMModule> = {
  login_qr_key,
  login_qr_check,
  user_detail,
  user_playlist_list,
  user_liked_songs,
  song_detail,
  subscription_status,
  playlist_detail,
  playlist_edit_info,
  song_url,
  search,
};

/** 清空 QQ 音乐内存缓存 */
export const clearQQMusicCache = (): void => {
  clearCache();
};

/**
 * 构造与账号绑定的缓存键
 * @param name 接口名称
 * @param params 调用入参
 * @returns 缓存键
 */
const buildScopedCacheKey = (name: string, params: unknown): string => {
  const accountId = resolveAccountId(getQQMusicSession());
  const { changed } = syncAccountScope(accountId);
  if (changed) {
    coreLog.info(`账号维度发生变更，当前账号：${accountId}，旧缓存已清空`);
  }
  return buildCacheKey(accountId, name, params);
};

/**
 * 调用 QQ 音乐 API 模块
 * @param name 模块名称
 * @param params 请求参数
 * @returns 业务响应数据
 */
export const callQQMusic = async (name: string, params: QMParams = {}): Promise<any> => {
  const fn = Object.hasOwn(modules, name) ? modules[name] : undefined;
  if (!fn) throw new Error(`未知的 QQ 音乐接口: ${name}`);

  if (NON_CACHEABLE.has(name)) return fn(params);

  const key = buildScopedCacheKey(name, params);
  const hit = cacheGet(key);
  if (hit !== undefined) return hit;

  const value = await fn(params);
  cacheSet(key, value, DEFAULT_TTL);
  return value;
};

/**
 * 列出当前已注册的所有 QQ 音乐模块名称
 * @returns 模块名称列表
 */
export const listQQMusicModules = (): string[] => Object.keys(modules);
