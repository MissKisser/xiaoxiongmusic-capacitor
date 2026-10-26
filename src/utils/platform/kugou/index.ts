/**
 * 酷狗音乐前端统一模块服务
 *
 * 统一调用入口：callKugou(name, params)
 * 具备请求内存缓存、账号隔离、动态客户端标识调度能力。
 *
 * @author Hackerdallas
 */

import { modules } from "./modules";
import type { KGParams } from "./core/types";
import { getSessionCookies, saveSessionCookies } from "../sessionStore";
import {
  buildCacheKey,
  cacheGet,
  cacheSet,
  clearCache,
  resolveAccountId,
  syncAccountScope,
} from "./core/cache";
import { coreLog } from "./core/logger";

export * from "./core";
export * from "./modules";

/**
 * 获取当前酷狗会话凭据字段字典
 * @returns 会话凭据字典
 */
export const getKugouSession = (): Record<string, string> => getSessionCookies("kugou");

/**
 * 合并并持久化酷狗会话字段
 * @param values 待合并的字段
 */
export const mergeKugouSession = (values: Record<string, string>): void => {
  saveSessionCookies("kugou", { ...getKugouSession(), ...values });
};

/**
 * 清除酷狗账号登录会话（保留设备指纹）
 */
export const clearKugouSession = (): void => {
  const session = getKugouSession();
  const device = {
    ...(session.guid ? { guid: session.guid } : {}),
    ...(session.dfid ? { dfid: session.dfid } : {}),
  };
  saveSessionCookies("kugou", device);
  clearCache();
};

/**
 * 清空酷狗模块内存缓存
 */
export const clearKugouCache = (): void => {
  clearCache();
};

/** 默认缓存存活时间：2 分钟 */
const DEFAULT_TTL = 2 * 60 * 1000;

/** 不走缓存的实时或敏感接口 */
const NON_CACHEABLE: ReadonlySet<string> = new Set([
  "login_qr_key",
  "login_qr_check",
  "user_detail",
  "user_profile",
  "song_url",
  "comment",
  "search",
  "leaderboard_list",
  "leaderboard_detail",
  "hot_artists",
  "songfm",
  "home/album",
  "home/theme",
  "playlist_detail",
  "user_playlist_list",
]);

/**
 * 判断响应值是否为空结果（空结果不写入缓存）
 * @param value 响应值
 * @returns 是否为空结果
 */
const isEmptyResult = (value: unknown): boolean => {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (Array.isArray(v.songs) && v.songs.length === 0) return true;
  if (Array.isArray(v.albums) && v.albums.length === 0) return true;
  if (Array.isArray(v.chapters) && v.chapters.length === 0) return true;
  if (Array.isArray(v.artists) && v.artists.length === 0) return true;
  if (Array.isArray(v.playlists) && v.playlists.length === 0) return true;
  return false;
};

/**
 * 构造与账号绑定的缓存键
 * @param name 接口名称
 * @param params 调用入参
 * @returns 缓存键
 */
const buildScopedCacheKey = (name: string, params: unknown): string => {
  const accountId = resolveAccountId(getKugouSession());
  const { changed } = syncAccountScope(accountId);
  if (changed) {
    coreLog.info(`账号维度发生变更，当前账号：${accountId}，旧缓存已清空`);
  }
  return buildCacheKey(accountId, name, params);
};

/**
 * 调用酷狗音乐 API 模块
 * @param name 模块名称
 * @param params 请求参数
 * @returns 业务响应数据
 */
export const callKugou = async <T = any>(name: string, params: KGParams = {}): Promise<T> => {
  const fn = Object.hasOwn(modules, name) ? modules[name] : undefined;
  if (!fn) throw new Error(`未知的酷狗音乐接口: ${name}`);

  if (NON_CACHEABLE.has(name)) {
    return (await fn(params)) as T;
  }

  const key = buildScopedCacheKey(name, params);
  const hit = cacheGet(key);
  if (hit !== undefined) return hit as T;

  const value = (await fn(params)) as T;
  if (!isEmptyResult(value)) {
    cacheSet(key, value, DEFAULT_TTL);
  }
  return value;
};

/**
 * 列出当前已注册的所有酷狗模块名称
 * @returns 模块名称列表
 */
export const listKugouModules = (): string[] => Object.keys(modules);
