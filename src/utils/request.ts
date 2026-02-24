import axios, { AxiosInstance, AxiosRequestConfig, AxiosError, AxiosResponse } from "axios";
import { isDev, isCapacitor } from "./env";
import { useSettingStore } from "@/stores";
import { getCookie } from "./cookie";
import axiosRetry from "axios-retry";
import { CapacitorHttp, HttpResponse } from "@capacitor/core";

// 全局地址配置
// 开发环境：使用相对路径，通过 Vite 代理转发到远程服务器
// 生产环境/Capacitor：使用绝对 URL 直接访问远程服务器
const baseURL: string = isDev && !isCapacitor
  ? "/api/netease"
  : String(import.meta.env["VITE_API_URL"] || "https://music.viaxv.top") + "/api/netease";

// 调试信息
console.log("🔧 环境检测:", {
  isDev,
  isCapacitor,
  baseURL,
  VITE_API_URL: import.meta.env["VITE_API_URL"]
});

// 自定义适配器：在 Capacitor 环境下直接调用原生 HTTP 插件
// 绕过 Webview 的 CORS 和 Header 限制 (如 Refused to set unsafe header "Cookie")
const capacitorAdapter = async (config: AxiosRequestConfig): Promise<AxiosResponse> => {
  const response: HttpResponse = await CapacitorHttp.request({
    method: config.method?.toUpperCase() || 'GET',
    url: config.url?.startsWith('http') ? config.url : `${config.baseURL?.replace(/\/$/, '')}${config.url}`,
    headers: config.headers as any,
    params: config.params,
    data: config.data,
    // 关键：告诉 CapacitorHttp 不要自动管理 Cookie，我们手动在 Header 里传了
    // 但 CapacitorHttp 文档未明确 disableCookies 选项，通常它会自动处理
    // 我们的 manual header injection 应该会覆盖自动行为
  });

  // 转换响应头
  const headers: Record<string, string> = {};
  for (const key in response.headers) {
    headers[key.toLowerCase()] = response.headers[key];
  }

  return {
    data: response.data,
    status: response.status,
    statusText: response.status.toString(),
    headers,
    config,
    request: {}
  };
};

// 基础配置
const server: AxiosInstance = axios.create({
  baseURL,
  // 允许跨域携带凭证（Cookie）
  withCredentials: true,
  // 超时时间
  timeout: 15000,
  // 适配器切换
  adapter: isCapacitor ? capacitorAdapter : undefined,
});

// 请求重试
axiosRetry(server, {
  // 重试次数
  retries: 3,
});

// 请求拦截器
server.interceptors.request.use(
  (request) => {
    // pinia
    const settingStore = useSettingStore();
    if (!request.params) request.params = {};

    // Capacitor 下的 baseURL 处理：补全相对路径或缺失的域名
    if (isCapacitor && (!request.baseURL || request.baseURL.startsWith("/"))) {
      const domain = String(import.meta.env["VITE_API_URL"] || "https://music.viaxv.top");
      request.baseURL = domain + (request.baseURL || "/api/netease");
      console.log(`🌐 Capacitor 自动补全 baseURL: ${request.baseURL}`);
    }

    // Cookie 影子库处理 (针对 Capacitor 原生环境)
    if (!request.params.noCookie) {
      if (isCapacitor) {
        // 从 localStorage 影子库中提取所有保存的 Cookie
        const cookieParts: string[] = [];
        const keyNames: string[] = [];
        
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key?.startsWith("cookie-")) {
            const name = key.replace("cookie-", "");
            const value = localStorage.getItem(key);
            if (value) {
              cookieParts.push(`${name}=${value}`);
              keyNames.push(name);
            }
          }
        }
        
        const cookieStr = cookieParts.join("; ");

        if (cookieStr) {
          // 【关键】通过 URL 参数传递 cookie（服务器端已修改支持）
          request.params.cookie = cookieStr;
          
          // 同时尝试设置 Header（某些情况下可能有效）
          request.headers['Cookie'] = cookieStr;
          request.headers['cookie'] = cookieStr;
          
          console.log(`🍪 [Auth Manual] 已注入凭证到 URL 参数，包含: ${keyNames.join(", ")}`);
          
          // 特别检查 MUSIC_U 是否存在
          const hasMusicU = keyNames.some(k => k.toUpperCase() === "MUSIC_U");
          if (hasMusicU) {
            console.log("✅ [Auth Manual] MUSIC_U 凭证已包含");
          } else {
            console.warn("⚠️ [Auth Manual] 警告: 未发现 MUSIC_U 凭证，登录相关请求可能失败");
          }
        } else {
          console.warn("⚠️ [Auth Manual] 影子库为空，未发现有效凭证");
        }

        // 稳定性 Headers
        request.headers["X-Real-IP"] = "223.104.10.22";
        request.headers["User-Agent"] = "Mozilla/5.0 (Linux; Android 10; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.99 Mobile Safari/537.36";
      } else {
        // Web 生产环境/开发环境
        const musicU = getCookie("MUSIC_U");
        if (musicU) {
          request.params.cookie = `MUSIC_U=${musicU}`;
          console.log(`🍪 [Web] 已注入 MUSIC_U 凭证`);
        }
      }
    }

    // 记录最终请求快照 (结构化深拷贝打印)
    if (isCapacitor) {
      const snapshot = {
        method: request.method?.toUpperCase(),
        url: request.url,
        baseURL: request.baseURL,
        params: { ...request.params },
        headers: { ...request.headers }
      };
      // 隐藏敏感信息
      if (snapshot.headers['Cookie']) snapshot.headers['Cookie'] = '***';
      if (snapshot.headers['cookie']) snapshot.headers['cookie'] = '***';

      console.log(`🚀 [Request Snapshot]`, JSON.stringify(snapshot));
    }

    // 自定义 realIP
    if (settingStore.useRealIP) {
      if (settingStore.realIP) {
        request.params.realIP = settingStore.realIP;
      } else {
        request.params.randomCNIP = true;
      }
    }
    // proxy
    if (settingStore.proxyProtocol !== "off") {
      const protocol = settingStore.proxyProtocol.toLowerCase();
      const server = settingStore.proxyServe;
      const port = settingStore.proxyPort;
      const proxy = `${protocol}://${server}:${port}`;
      if (proxy) request.params.proxy = proxy;
    }
    // 发送请求
    return request;
  },
  (error: AxiosError) => {
    console.error("请求发送失败：", error);
    return Promise.reject(error);
  },
);

// 响应拦截器
server.interceptors.response.use(
  (response: AxiosResponse) => response,
  (error: AxiosError) => {
    const { response } = error;
    // 状态码处理
    switch (response?.status) {
      case 400:
        console.error("客户端错误：", response.status, response.statusText);
        // 执行客户端错误的处理逻辑
        break;
      case 401:
        console.error("未授权：", response.status, response.statusText);
        // 执行未授权的处理逻辑
        break;
      case 403:
        console.error("禁止访问：", response.status, response.statusText);
        // 执行禁止访问的处理逻辑
        break;
      case 404:
        console.error("未找到资源：", response.status, response.statusText);
        // 执行未找到资源的处理逻辑
        break;
      case 500:
        console.error("服务器错误：", response.status, response.statusText);
        // 执行服务器错误的处理逻辑
        break;
      default:
        // 处理其他状态码或错误条件
        console.error("未处理的错误：", error.message);
    }
    // 返回错误
    return Promise.reject(error);
  },
);

// 请求
const request = async <T = any>(config: AxiosRequestConfig): Promise<T> => {
  try {
    const response = await server.request(config);
    if (isCapacitor) {
      console.log(`📡 [Request Success] URL: ${config.url} | Status: ${response.status} | Data Keys: ${Object.keys(response.data || {}).join(', ')} | Data Preview: ${JSON.stringify(response.data).substring(0, 200)}`);
    }
    // 返回请求数据
    return response.data as T;
  } catch (error) {
    if (isCapacitor) {
      console.error(`📡 [Request Error] URL: ${config.url} | Error: ${JSON.stringify(error)}`);
    }
    throw error;
  }
};

export default request;
