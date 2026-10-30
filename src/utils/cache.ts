type StorageType = "localStorage" | "sessionStorage";

interface CacheOptions {
  key: string;
  time: number; // 缓存时长，单位为分钟
  storage?: StorageType; // 默认为 sessionStorage
  useCache?: boolean; // 是否使用缓存，默认为 true
  skipEmpty?: boolean; // 是否跳过空结果，默认为 false；开启后空数组不写入缓存，命中空数组缓存视为失效
}

/**
 * 获取接口请求缓存
 * @template T
 * @param {(...args: any[]) => Promise<T>} promiseFunc - 异步请求函数
 * @param {Object} options - 缓存选项
 * @param {string} options.key - 用于存储和检索缓存数据的键值
 * @param {number} options.time - 缓存有效时间（分钟）。如果为 -1，则表示永久有效
 * @param {string} [options.storage="sessionStorage"] - 储存方式，默认为 `sessionStorage`，可选 `localStorage`
 * @param {boolean} [options.skipEmpty=false] - 是否跳过空结果，开启后空数组不写入缓存，命中空数组缓存视为失效
 * @param {...any} args - 传递的参数
 * @returns {Promise<T>}
 * @returns
 */
export const getCacheData = async <T>(
  promiseFunc: (...args: any[]) => Promise<T>,
  options: CacheOptions,
  ...args: any[]
): Promise<T> => {
  const { key, time, storage = "sessionStorage", useCache = true, skipEmpty = false } = options;
  // 储存方式
  const storageObj = window[storage];
  // 读取缓存（独立处理：缓存损坏或读取异常仅告警，跳过缓存直接请求）
  try {
    // 获取缓存数据
    const cachedData = storageObj.getItem(key);
    if (cachedData && useCache) {
      // 判断缓存是否过期
      const { value, expiry } = JSON.parse(cachedData);
      if (expiry === 0 || new Date().getTime() < expiry) {
        // 命中缓存但值为空数组时视为失效，继续真实请求
        if (skipEmpty && Array.isArray(value) && value.length === 0) {
          console.log(`⚠️ Empty cached data found for key: ${key}, fetching fresh data`);
        } else {
          console.log(`✅ Cached data found for key: ${key}`, value);
          return value;
        }
      }
    }
  } catch (error) {
    // 缓存读取失败（如 JSON 损坏），跳过缓存直接请求
    console.warn(`⚠️ Failed to read cache for key: ${key}, fetching fresh data`, error);
  }
  // 请求数据
  const result = await promiseFunc(...args);
  // 写入缓存（独立处理：存储配额不足等异常仅告警，不影响请求结果）
  // 空结果不写回缓存，避免上游失败被固化
  if (!(skipEmpty && Array.isArray(result) && result.length === 0)) {
    try {
      const expiry = time === -1 ? -1 : new Date().getTime() + time * 60 * 1000;
      // 存储数据
      storageObj.setItem(key, JSON.stringify({ value: result, expiry }));
    } catch (error) {
      console.warn(`⚠️ Failed to write cache for key: ${key}`, error);
    }
  }
  return result;
};
