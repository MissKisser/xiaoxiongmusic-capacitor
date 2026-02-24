/**
 * 本地解锁模块 - HTTP 请求封装
 * 使用 CapacitorHttp 绕过 CORS 限制
 */
import { CapacitorHttp, HttpResponse } from "@capacitor/core";
import { isCapacitor } from "@/utils/env";

/**
 * 发起 GET 请求
 */
export async function unblockGet(
    url: string,
    headers?: Record<string, string>
): Promise<HttpResponse> {
    if (isCapacitor) {
        return CapacitorHttp.get({
            url,
            headers: {
                "User-Agent": "Mozilla/5.0 (Linux; Android 10; Mobile) AppleWebKit/537.36",
                ...headers,
            },
        });
    } else {
        // 非 Capacitor 环境使用 fetch（主要用于开发调试）
        const response = await fetch(url, { headers });
        const data = await response.text();
        return {
            status: response.status,
            headers: Object.fromEntries(response.headers.entries()),
            url: response.url,
            data: tryParseJSON(data),
        };
    }
}

/**
 * 发起 POST 请求
 */
export async function unblockPost(
    url: string,
    body: string | Record<string, unknown>,
    headers?: Record<string, string>
): Promise<HttpResponse> {
    if (isCapacitor) {
        return CapacitorHttp.post({
            url,
            headers: {
                "User-Agent": "Mozilla/5.0 (Linux; Android 10; Mobile) AppleWebKit/537.36",
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                ...headers,
            },
            data: body,
        });
    } else {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                ...headers,
            },
            body: typeof body === "string" ? body : JSON.stringify(body),
        });
        const data = await response.text();
        return {
            status: response.status,
            headers: Object.fromEntries(response.headers.entries()),
            url: response.url,
            data: tryParseJSON(data),
        };
    }
}

/**
 * 尝试解析 JSON，失败则返回原始字符串
 */
function tryParseJSON(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

/**
 * 日志输出（统一格式）
 */
export const unblockLog = {
    log: (...args: unknown[]) => console.log("[LocalUnblock]", ...args),
    warn: (...args: unknown[]) => console.warn("[LocalUnblock]", ...args),
    error: (...args: unknown[]) => console.error("[LocalUnblock]", ...args),
};
