/**
 * 换源成功直链的进程内 TTL 缓存
 *
 * 换源链按优先级逐源串行取链，上游抖动时同一首歌会被整链重跑一遍
 * （每个源各一次检索 + 一次取链）。这里把换源成功的直链按歌曲缓存在进程内，
 * 命中即直接复用，避免上游抖动期反复重跑整条链。
 *
 * 与磁盘缓存是两套东西：磁盘缓存落的是音频文件本身，
 * 这里存的是「换源得到的直链」，只解决重播期的取链重复。
 *
 * 本模块只放纯逻辑，不依赖 store 与浏览器 API，可被 Node 脚本直接调用验证。
 *
 * @author Hackerdallas
 */

/** 缓存条目：换源成功的直链 */
export type UnlockedUrlEntry<TQuality = string> = {
  /** 换源得到的原始直链 */
  url: string;
  /** 音质 */
  quality?: TQuality;
  /** 解锁来源标识（换源服务） */
  unlockSource: string;
  /** 过期时刻（毫秒时间戳） */
  expiresAt: number;
};

/** 缓存写入时的条目（过期时刻由缓存按 TTL 计算） */
export type UnlockedUrlInput<TQuality = string> = {
  /** 换源得到的原始直链 */
  url: string;
  /** 音质 */
  quality?: TQuality;
  /** 解锁来源标识（换源服务） */
  unlockSource: string;
};

/** 缓存有效期（毫秒） */
export const UNLOCKED_URL_TTL_MS = 20 * 60 * 1000;

/** 缓存条目上限：超出后淘汰最早过期的一条 */
export const UNLOCKED_URL_MAX_ENTRIES = 100;

/**
 * 换源直链缓存
 *
 * 纯内存态：进程重启即清空，不落盘。
 */
export class UnlockUrlCache<TQuality = string> {
  /** 缓存条目 */
  private readonly entries = new Map<string, UnlockedUrlEntry<TQuality>>();

  /**
   * 创建缓存
   * @param ttlMs 缓存有效期（毫秒）
   * @param maxEntries 条目上限
   */
  constructor(
    private readonly ttlMs: number = UNLOCKED_URL_TTL_MS,
    private readonly maxEntries: number = UNLOCKED_URL_MAX_ENTRIES,
  ) {}

  /**
   * 读取一条缓存
   * @param key 缓存键
   * @param now 当前时间戳（毫秒）
   * @returns 命中且未过期的条目；未命中或已过期时为 null
   */
  public get(key: string, now: number = Date.now()): UnlockedUrlEntry<TQuality> | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= now) {
      this.entries.delete(key);
      return null;
    }
    return entry;
  }

  /**
   * 写入一条缓存
   *
   * 没有可用直链、或没有换源来源的结果不入缓存：
   * 试听片段只有片段地址、没有换源服务来源，不该被当成可复用的整曲直链。
   * @param key 缓存键
   * @param entry 直链与来源
   * @param now 当前时间戳（毫秒）
   */
  public set(key: string, entry: UnlockedUrlInput<TQuality>, now: number = Date.now()): void {
    if (!entry.url || !entry.unlockSource) return;
    const record: UnlockedUrlEntry<TQuality> = {
      url: entry.url,
      quality: entry.quality,
      unlockSource: entry.unlockSource,
      expiresAt: now + this.ttlMs,
    };
    // 先删后写：Map 按写入顺序迭代，重写同键时让条目落到队尾，淘汰顺序才与过期顺序一致
    this.entries.delete(key);
    this.entries.set(key, record);
    this.evictExpired(now);
    while (this.entries.size > this.maxEntries) {
      let oldestKey: string | undefined;
      let oldestAt = Number.POSITIVE_INFINITY;
      for (const [itemKey, item] of this.entries) {
        if (item.expiresAt < oldestAt) {
          oldestAt = item.expiresAt;
          oldestKey = itemKey;
        }
      }
      if (oldestKey === undefined) break;
      this.entries.delete(oldestKey);
    }
  }

  /**
   * 清空缓存
   */
  public clear(): void {
    this.entries.clear();
  }

  /**
   * 当前条目数
   */
  public get size(): number {
    return this.entries.size;
  }

  /**
   * 清理已过期的条目
   * @param now 当前时间戳（毫秒）
   */
  private evictExpired(now: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
  }
}
