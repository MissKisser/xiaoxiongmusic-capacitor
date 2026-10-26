/**
 * 第三方音源平台会话存储（localStorage 影子库）
 *
 * 替代 PC 端基于 better-sqlite3 的 platform-sessions.db，
 * 提供持久化平台会话管理能力。对外 API 严格对齐 PC 侧 PlatformSessionDB，
 * 存储结构与 PC 端保持一致，数据格式化为 Record<string, string>。
 *
 * @author Hackerdallas
 */

/** 会话持久化记录结构 */
export interface PlatformSessionRecord {
  /** 平台标识（如 qqmusic、kugou） */
  platform: string;
  /** 会话 Cookie 键值对 JSON 字符串 */
  cookies: string;
  /** 更新时间戳（毫秒） */
  updated_at: number;
}

/** 内存回退存储（在无 localStorage 的 Node 测试环境自动生效） */
const memoryStorage = new Map<string, string>();

/**
 * 判断当前环境是否存在可用的 localStorage
 * @returns 是否可用
 */
const hasLocalStorage = (): boolean => {
  try {
    return typeof localStorage !== "undefined" && typeof localStorage.getItem === "function";
  } catch {
    return false;
  }
};

/**
 * 获取本地存储的特定键值
 * @param key 存储键名
 * @returns 存储的值，不存在时返回 null
 */
const getItem = (key: string): string | null => {
  if (hasLocalStorage()) {
    try {
      return localStorage.getItem(key);
    } catch {
      return memoryStorage.get(key) ?? null;
    }
  }
  return memoryStorage.get(key) ?? null;
};

/**
 * 设置本地存储的特定键值
 * @param key 存储键名
 * @param value 待写入的字符串
 */
const setItem = (key: string, value: string): void => {
  if (hasLocalStorage()) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // 捕获可能出现的存储配额或安全异常
    }
  }
  memoryStorage.set(key, value);
};

/**
 * 移除本地存储的特定键值
 * @param key 存储键名
 */
const removeItem = (key: string): void => {
  if (hasLocalStorage()) {
    try {
      localStorage.removeItem(key);
    } catch {
      // 忽略异常
    }
  }
  memoryStorage.delete(key);
};

/**
 * 获取平台的存储键名
 * @param platform 平台标识
 * @returns 本地存储键
 */
const getStorageKey = (platform: string): string => `platform_session_${platform}`;

/**
 * 读取某平台的 Cookie 键值对字典；未登录返回空对象
 * @param platform 音源平台名称（如 qqmusic、kugou）
 * @returns Cookie 键值对，未登录时为空对象
 */
export const getSessionCookies = (platform: string): Record<string, string> => {
  const primaryKey = getStorageKey(platform);
  const raw = getItem(primaryKey);
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};

    // 格式一：对齐 PC SQLite 结构 { platform, cookies: string(JSON), updated_at }
    if (typeof parsed.cookies === "string") {
      try {
        const inner = JSON.parse(parsed.cookies);
        return inner && typeof inner === "object" ? (inner as Record<string, string>) : {};
      } catch {
        return {};
      }
    }

    // 格式二：对象结构已直接反序列化为 cookies: Record<string, string>
    if (parsed.cookies && typeof parsed.cookies === "object") {
      return parsed.cookies as Record<string, string>;
    }

    // 格式三：直接存储了 Record<string, string>
    return parsed as Record<string, string>;
  } catch {
    return {};
  }
};

/**
 * 获取某平台的完整会话记录元信息
 * @param platform 音源平台名称
 * @returns 会话记录，未登录时返回 null
 */
export const getPlatformSessionRecord = (
  platform: string,
): { platform: string; cookies: Record<string, string>; updated_at: number } | null => {
  const primaryKey = getStorageKey(platform);
  const raw = getItem(primaryKey);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;

    let cookies: Record<string, string> = {};
    if (typeof parsed.cookies === "string") {
      cookies = JSON.parse(parsed.cookies);
    } else if (parsed.cookies && typeof parsed.cookies === "object") {
      cookies = parsed.cookies;
    } else {
      cookies = parsed;
    }

    const updatedAt =
      typeof parsed.updated_at === "number" && parsed.updated_at > 0
        ? parsed.updated_at
        : Date.now();

    return {
      platform,
      cookies,
      updated_at: updatedAt,
    };
  } catch {
    return null;
  }
};

/**
 * 整体保存某平台的 Cookie 会话（登出传空对象即可）
 * @param platform 音源平台名称
 * @param cookies Cookie 键值对
 */
export const saveSessionCookies = (
  platform: string,
  cookies: Record<string, string>,
): void => {
  const storageKey = getStorageKey(platform);
  const record: PlatformSessionRecord = {
    platform,
    cookies: JSON.stringify(cookies ?? {}),
    updated_at: Date.now(),
  };
  setItem(storageKey, JSON.stringify(record));
};

/**
 * 清除某平台的 Cookie 会话（登出）
 * @param platform 音源平台名称
 */
export const clearSessionCookies = (platform: string): void => {
  saveSessionCookies(platform, {});
};
