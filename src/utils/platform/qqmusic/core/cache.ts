/**
 * QQ 音乐响应内存缓存管理
 *
 * 缓存键绑定当前登录账号维度 `${accountId}|${name}|${hash}`，
 * 换号后旧账号条目自然失效；换号事件触发时清空旧缓存。
 *
 * @author Hackerdallas
 */

import md5 from "md5";

/** 未登录时的匿名账号标识 */
export const ANONYMOUS_ACCOUNT_ID = "anonymous";

/** 默认缓存存活时间：2 分钟 */
const DEFAULT_TTL = 2 * 60 * 1000;

/** 最大缓存条目数 */
const MAX_ENTRIES = 200;

/** 缓存条目 */
interface CacheEntry {
  value: unknown;
  expireAt: number;
}

const cache = new Map<string, CacheEntry>();

/** 最近一次同步到的账号标识（null 表示尚未同步过） */
let syncedAccountId: string | null = null;

/** 账号维度同步结果 */
export interface AccountScope {
  /** 当前账号标识 */
  accountId: string;
  /** 本次同步是否发生了账号变化 */
  changed: boolean;
}

/**
 * 计算参数的 MD5 摘要哈希前缀
 * @param params 业务参数
 * @returns 8 位十六进制哈希
 */
const hashParams = (params: unknown): string => {
  try {
    const str = JSON.stringify(params ?? {});
    return md5(str).slice(0, 8);
  } catch {
    return "00000000";
  }
};

/**
 * 解析会话对应的账号标识
 * @param session 会话字段字典
 * @returns 账号标识（纯数字 uin 或 anonymous）
 */
export const resolveAccountId = (session: Record<string, string>): string => {
  const raw = session.qm_str_musicid || session.uin || session.wxuin || session.p_uin || "";
  const id = raw.replace(/^o/, "").trim();
  return id || ANONYMOUS_ACCOUNT_ID;
};

/**
 * 构造账号维度的缓存键
 * @param accountId 账号标识
 * @param name 模块名称
 * @param params 业务参数
 * @returns 组合缓存键
 */
export const buildCacheKey = (accountId: string, name: string, params: unknown): string =>
  `${accountId}|${name}|${hashParams(params)}`;

/**
 * 读取缓存
 * @param key 缓存键
 * @returns 缓存值；未命中或已过期时返回 undefined
 */
export const cacheGet = (key: string): unknown => {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (hit.expireAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }
  // LRU 刷新
  cache.delete(key);
  cache.set(key, hit);
  return hit.value;
};

/**
 * 写入缓存
 * @param key 缓存键
 * @param value 缓存值
 * @param ttl 存活时长（毫秒）
 */
export const cacheSet = (key: string, value: unknown, ttl = DEFAULT_TTL): void => {
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { value, expireAt: Date.now() + ttl });
};

/**
 * 同步账号维度，账号切换时清空旧缓存
 * @param accountId 当前账号标识
 * @returns 账号维度同步结果
 */
export const syncAccountScope = (accountId: string): AccountScope => {
  const changed = syncedAccountId !== null && syncedAccountId !== accountId;
  if (changed) cache.clear();
  syncedAccountId = accountId;
  return { accountId, changed };
};

/**
 * 清空所有缓存
 */
export const clearCache = (): void => {
  cache.clear();
  syncedAccountId = null;
};

/**
 * 获取当前缓存条目总数
 * @returns 缓存条目数
 */
export const cacheSize = (): number => cache.size;
