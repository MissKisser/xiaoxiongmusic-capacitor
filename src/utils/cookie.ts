import Cookies from "js-cookie";
import { isCapacitor } from "./env";
import { CapacitorCookies } from "@capacitor/core";

// 获取 Cookie
export const getCookie = (key: string) => {
  // 优先从 localStorage 影子库获取（Capacitor 环境更可靠）
  const localValue = localStorage.getItem(`cookie-${key}`);
  if (localValue) {
    console.log(`🍪 [getCookie] 从 localStorage 获取 ${key}: ${localValue.slice(0, 20)}...`);
    return localValue;
  }
  const jsValue = Cookies.get(key);
  if (jsValue) {
    console.log(`🍪 [getCookie] 从 js-cookie 获取 ${key}: ${jsValue.slice(0, 20)}...`);
  }
  return jsValue;
};

// 移除 Cookie
export const removeCookie = (key: string) => {
  console.log(`🍪 [removeCookie] 移除 ${key}`);
  Cookies.remove(key);
  localStorage.removeItem(`cookie-${key}`);
  
  // Capacitor 环境下也移除原生层的 Cookie
  if (isCapacitor) {
    const domain = String(import.meta.env["VITE_API_URL"] || "https://music.viaxv.top");
    CapacitorCookies.deleteCookie({ url: domain, key }).catch(console.error);
  }
};

// 设置 Cookie
export const setCookies = (cookieValue: string) => {
  if (!cookieValue) {
    console.warn("🍪 [setCookies] 收到空的 cookie 值");
    return;
  }

  console.log(`🍪 [setCookies] 原始 cookie 长度: ${cookieValue.length}`);
  console.log(`🍪 [setCookies] 原始 cookie 预览: ${cookieValue.slice(0, 200)}...`);

  // URL解码整理
  let decodedCookie = cookieValue;
  try {
    if (cookieValue.includes("%")) {
      decodedCookie = decodeURIComponent(cookieValue);
    }
  } catch (e) {
    console.warn("Cookie 解码尝试失败:", e);
  }

  // 1. 分解多个 Cookie 条目 (处理后端返回的复合 Set-Cookie 字符串)
  // 网易云返回格式可能是: "MUSIC_U=xxx; Path=/; NMTID=yyy; Path=/; ..."
  const segments = decodedCookie.split(/;\s*/);
  const date = new Date();
  date.setFullYear(date.getFullYear() + 10); // 10年长效
  const expires = `expires=${date.toUTCString()}`;

  // 关键 Cookie 名称列表
  const keyNames = ["MUSIC_U", "__csrf", "NMTID", "MUSIC_A_T", "MUSIC_R_T", "__remember_me"];
  let savedCount = 0;

  segments.forEach((segment) => {
    const trimmed = segment.trim();
    if (!trimmed) return;
    
    // 跳过 Cookie 属性（不是键值对）
    const lowerTrimmed = trimmed.toLowerCase();
    if (lowerTrimmed.startsWith("expires=") || 
        lowerTrimmed.startsWith("path=") || 
        lowerTrimmed.startsWith("domain=") ||
        lowerTrimmed.startsWith("max-age=") ||
        lowerTrimmed === "httponly" ||
        lowerTrimmed === "secure" ||
        lowerTrimmed.startsWith("samesite=")) {
      return;
    }

    const [rawName, ...valueParts] = trimmed.split("=");
    const name = rawName?.trim();
    const value = valueParts.join("=").trim();

    // 确保是有效的键值对
    if (!name || !value || name.length < 2) return;

    // 打印关键调试日志
    const isKeyName = keyNames.some(k => name.toUpperCase().includes(k.toUpperCase()));
    console.log(`🍪 [setCookies] ${isKeyName ? '⭐ 关键' : '普通'}凭证: ${name}=${value.slice(0, 15)}...`);

    // A. 写入 Webview 运行时 Cookie
    document.cookie = `${name}=${value}; ${expires}; path=/; SameSite=Lax`;

    // B. 【核心】写入 localStorage 影子库 (作为 Android 原生同步的唯一信任源)
    localStorage.setItem(`cookie-${name}`, value);
    savedCount++;
  });

  console.log(`🍪 [setCookies] 共保存 ${savedCount} 个凭证到 localStorage`);

  // 2. 立即触发同步到原生层 (CapacitorCookies)
  if (isCapacitor) {
    syncNativeCookies();
  }
};

/**
 * 同步 Cookie 到原生层 (Android Jar)
 * 解决 CapacitorHttp 发起请求时不带 Webview Cookie 的问题
 */
export const syncNativeCookies = async () => {
  if (!isCapacitor) return;
  try {
    const domain = String(import.meta.env["VITE_API_URL"] || "https://music.viaxv.top");
    console.log(`🍪 [Native Sync] 正在从 localStorage 同步影子库到原生域名: ${domain}`);

    // 遍历 localStorage 中所有镜像出来的 Cookie
    let syncCount = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const storageKey = localStorage.key(i);
      if (storageKey?.startsWith("cookie-")) {
        const cookieKey = storageKey.replace("cookie-", "");
        const cookieValue = localStorage.getItem(storageKey);

        if (cookieValue) {
          await CapacitorCookies.setCookie({
            url: domain,
            key: cookieKey,
            value: cookieValue,
            path: "/",
            // 设置长效过期
            expires: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toUTCString(),
          });
          syncCount++;
        }
      }
    }

    console.log(`✅ [Native Sync] 原生层同步完成，共计注入 ${syncCount} 个凭证`);
  } catch (error) {
    console.error("❌ [Native Sync] 原生层同步失败:", error);
  }
};
