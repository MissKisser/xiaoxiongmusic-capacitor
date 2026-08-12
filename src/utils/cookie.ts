import Cookies from "js-cookie";
import { isCapacitor } from "./env";
import { CapacitorCookies } from "@capacitor/core";

/**
 * Cookie 同步就绪信号
 *
 * 背景：App.vue onMounted 中的 syncNativeCookies 与 User.vue onBeforeMount 中的
 * 登录态校验存在并发竞态——后者可能早于前者完成，导致 CapacitorHttp 原生层
 * 尚未拿到 MUSIC_U，冷启动时用户信息加载失败。
 *
 * 方案：App.vue 完成 syncNativeCookies（含重试）后调用 markCookiesReady()，
 * 依赖 cookie 的组件（如 User.vue 的 checkLoginStatus）通过 whenCookiesReady()
 * 等待该信号，最多等待 3 秒后自动放行（避免 cookie 同步永久卡死阻塞登录态检查）。
 */
let cookiesReady = !isCapacitor; // 非 Capacitor 环境永远就绪
const cookiesReadyResolvers: Array<() => void> = [];

/** 标记原生层 Cookie 同步已完成 */
export const markCookiesReady = () => {
  if (cookiesReady) return;
  cookiesReady = true;
  console.log("🍪 [CookieReady] 原生 Cookie 同步就绪，通知所有等待方");
  // 复制一份再清空，防止回调中再次注册造成无限循环
  const pending = cookiesReadyResolvers.splice(0);
  pending.forEach((resolve) => resolve());
};

/**
 * 等待原生 Cookie 同步完成
 * - 已就绪：立即 resolve
 * - 未就绪：等待 markCookiesReady() 或 3 秒超时后 resolve（永不 reject）
 */
export const whenCookiesReady = (): Promise<void> => {
  if (cookiesReady) return Promise.resolve();
  return new Promise<void>((resolve) => {
    // 兜底超时：避免 cookie 同步异常导致登录态检查永久阻塞
    const timer = setTimeout(() => {
      console.warn("🍪 [CookieReady] 等待超时（3s），强制放行");
      resolve();
    }, 3000);
    cookiesReadyResolvers.push(() => {
      clearTimeout(timer);
      resolve();
    });
  });
};

// 获取 Cookie
export const getCookie = (key: string) => {
  // 优先从 localStorage 影子库获取（Capacitor 环境更可靠）
  const localValue = localStorage.getItem(`cookie-${key}`);
  if (localValue) {
    console.log(`🍪 [getCookie] 从 localStorage 获取 ${key}（长度 ${localValue.length}）`);
    return localValue;
  }
  const jsValue = Cookies.get(key);
  if (jsValue) {
    console.log(`🍪 [getCookie] 从 js-cookie 获取 ${key}（长度 ${jsValue.length}）`);
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
  // 不打印 cookie 内容（含 MUSIC_U 完整登录凭证）

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

    // 打印关键调试日志（只输出键名与长度，不输出值）
    const isKeyName = keyNames.some(k => name.toUpperCase().includes(k.toUpperCase()));
    console.log(`🍪 [setCookies] ${isKeyName ? '⭐ 关键' : '普通'}凭证: ${name}（长度 ${value.length}）`);

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
