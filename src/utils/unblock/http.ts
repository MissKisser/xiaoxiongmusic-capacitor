/**
 * 本地解锁模块 - HTTP 请求封装
 * 使用 CapacitorHttp 绕过 CORS 限制
 *
 * 分两层：
 * - 既有简易接口 unblockGet / unblockPost：满足旧实现（网易云 / 酷我 / 波点 / 歌曲宝 / remote）的取数需求；
 * - 通用接口 unblockRequest / unblockHead：为音源本地化移植补齐 per-request 超时、
 *   HEAD / 自定义方法、响应体类型（文本 / 二进制）与「只读响应头」探测能力，
 *   对齐服务端 axios 用法的语义（validateStatus 恒真：任何状态码都正常返回，由调用方判读 status）。
 */
import { CapacitorHttp, HttpResponse, HttpOptions } from "@capacitor/core";
import { isCapacitor } from "@/utils/env";

/** 移动端 UA 伪装（双端一致，兼容音源服务的反爬策略） */
const MOBILE_UA = "Mozilla/5.0 (Linux; Android 10; Mobile) AppleWebKit/537.36";

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
                // 保持移动端 UA 伪装以兼容音源服务的反爬策略，双端一致
                "User-Agent": MOBILE_UA,
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
                // 保持移动端 UA 伪装以兼容音源服务的反爬策略，双端一致
                "User-Agent": MOBILE_UA,
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

/** 通用请求支持的 HTTP 方法 */
export type UnblockHttpMethod = "GET" | "POST" | "HEAD";

/** 响应体类型：text 与 json 都按「文本 + JSON 自动解析」处理，arraybuffer 返回字节视图 */
export type UnblockResponseType = "text" | "json" | "arraybuffer";

/** 通用请求的响应体：JSON 文本自动解析为对象，二进制响应为 Uint8Array */
export type UnblockResponseData = string | Record<string, unknown> | Uint8Array;

/** 通用请求的统一响应结构（与 HttpResponse 同形，data 收窄为三种已知形态） */
export interface UnblockHttpResponse {
    /** HTTP 状态码；任何状态码都正常返回，由调用方判读 */
    status: number;
    /** 响应头（键大小写不保证归一，读取用 getResponseHeader） */
    headers: Record<string, string>;
    /** 最终响应 URL（跟随重定向后） */
    url: string;
    /** 响应体 */
    data: UnblockResponseData;
}

/** 通用请求选项 */
export interface UnblockRequestOptions {
    /** 请求地址 */
    url: string;
    /** HTTP 方法，默认 GET */
    method?: UnblockHttpMethod;
    /** 请求头（原生路径默认注入移动端 UA，同名头以调用方为准） */
    headers?: Record<string, string>;
    /** 请求体；字符串原样发送，对象按 JSON 序列化（Content-Type 由调用方指定） */
    data?: string | Record<string, unknown>;
    /** 连接与读取超时（毫秒）；缺省不设超时 */
    timeout?: number;
    /** 响应体类型，默认按文本处理并自动解析 JSON */
    responseType?: UnblockResponseType;
    /**
     * 只读取状态码与响应头：fetch 路径读完头即取消响应体下载，用于 HEAD/Range 体积探测。
     * 原生路径无流式取消能力，该标记仅免除响应体解析，不减少传输量。
     */
    headersOnly?: boolean;
}

/**
 * 传输层异常
 *
 * message 固定携带 timeout / network error 关键字、超时附带 axios 同名错误码 ECONNABORTED，
 * 使 resilience.isUpstreamFault / extractHttpStatus 对 fetch 与 Capacitor 原生异常保持
 * 与服务端 axios 异常一致的判定口径。
 */
export class UnblockHttpError extends Error {
    /** 错误码：超时为 ECONNABORTED，其余传输层失败不带错误码 */
    readonly code?: string;

    constructor(message: string, code?: string, options?: { cause?: unknown }) {
        super(message, options);
        this.name = "UnblockHttpError";
        this.code = code;
    }
}

/**
 * 发起通用 HTTP 请求
 *
 * 语义对齐服务端 axios 的 validateStatus 恒真用法：任何状态码都正常 resolve，
 * 仅传输层失败（连接失败 / 超时）抛 UnblockHttpError。
 * 原生层 arraybuffer 响应以 base64 字符串回传，此处解码为 Uint8Array；
 * 非二进制 Content-Type 的错误响应体在原生层以文本回传，arraybuffer 字节保真仅在成功响应下成立。
 * @param options 请求选项
 * @returns 统一响应
 */
export async function unblockRequest(options: UnblockRequestOptions): Promise<UnblockHttpResponse> {
    const method = options.method ?? "GET";
    if (isCapacitor) {
        const requestOptions: HttpOptions = {
            url: options.url,
            method,
            headers: { "User-Agent": MOBILE_UA, ...options.headers },
            connectTimeout: options.timeout,
            readTimeout: options.timeout,
        };
        if (options.data !== undefined && method !== "GET" && method !== "HEAD") {
            requestOptions.data = options.data;
        }
        if (options.responseType === "arraybuffer") {
            requestOptions.responseType = "arraybuffer";
        }
        try {
            const response = await CapacitorHttp.request(requestOptions);
            let data: UnblockResponseData;
            if (options.responseType === "arraybuffer") {
                data = decodeArrayBufferData(response.data);
            } else if (
                typeof response.data === "object" &&
                response.data !== null
            ) {
                data = response.data as Record<string, unknown>;
            } else {
                // 原生层对非 JSON Content-Type 的响应体原样回传字符串，
                // JSON 文本在此统一反序列化，与 fetch 路径行为对齐
                data = tryParseJSON(String(response.data ?? "")) as UnblockResponseData;
            }
            return {
                status: response.status,
                headers: response.headers ?? {},
                url: response.url ?? options.url,
                data: options.headersOnly ? "" : data,
            };
        } catch (error) {
            throw normalizeTransportError(error);
        }
    }
    const controller = options.timeout !== undefined ? new AbortController() : undefined;
    const timer =
        controller !== undefined
            ? setTimeout(() => controller.abort(), options.timeout)
            : undefined;
    try {
        const response = await fetch(options.url, {
            method,
            headers: options.headers,
            body:
                options.data !== undefined && method !== "GET" && method !== "HEAD"
                    ? typeof options.data === "string"
                        ? options.data
                        : JSON.stringify(options.data)
                    : undefined,
            signal: controller?.signal,
        });
        const headers = Object.fromEntries(response.headers.entries());
        if (options.headersOnly) {
            // 响应头已读完，立即取消响应体下载（HEAD/Range 探测只关心头部）
            await response.body?.cancel().catch(() => undefined);
            return { status: response.status, headers, url: response.url, data: "" };
        }
        let data: UnblockResponseData;
        if (options.responseType === "arraybuffer") {
            data = new Uint8Array(await response.arrayBuffer());
        } else {
            data = tryParseJSON(await response.text()) as UnblockResponseData;
        }
        return { status: response.status, headers, url: response.url, data };
    } catch (error) {
        throw normalizeTransportError(error, controller?.signal.aborted === true);
    } finally {
        if (timer !== undefined) clearTimeout(timer);
    }
}

/**
 * 发起 HEAD 请求（读取体积 / 类型等响应头）
 * @param url 请求地址
 * @param headers 请求头
 * @param timeout 超时（毫秒）
 * @returns 统一响应（HEAD 无响应体，data 恒为空字符串）
 */
export async function unblockHead(
    url: string,
    headers: Record<string, string> = {},
    timeout?: number
): Promise<UnblockHttpResponse> {
    return unblockRequest({ url, method: "HEAD", headers, timeout, headersOnly: true });
}

/**
 * 大小写不敏感地读取响应头
 *
 * fetch 路径头键恒为小写，原生路径保留服务端原始大小写，读头前必须统一口径。
 * @param headers 响应头集合
 * @param name 头字段名（任意大小写）
 * @returns 命中的值；不存在时返回 undefined
 */
export function getResponseHeader(
    headers: Record<string, string> | undefined,
    name: string
): string | undefined {
    if (!headers) return undefined;
    const target = name.toLowerCase();
    for (const [key, value] of Object.entries(headers)) {
        if (key.toLowerCase() === target) return value;
    }
    return undefined;
}

/**
 * 把传输层异常归一为 UnblockHttpError
 * @param error 原始异常
 * @param aborted 是否为超时中止（fetch 路径）
 * @returns 归一后的异常
 */
const normalizeTransportError = (error: unknown, aborted = false): UnblockHttpError => {
    const isTimeout = aborted || (error as { name?: string } | null)?.name === "AbortError";
    if (isTimeout) {
        return new UnblockHttpError("请求超时(timeout)", "ECONNABORTED", { cause: error });
    }
    const detail = error instanceof Error ? error.message : String(error);
    return new UnblockHttpError(`网络请求失败(network error): ${detail}`, undefined, {
        cause: error,
    });
};

/**
 * 解码 base64 字符串为字节视图
 *
 * CapacitorHttp 的 arraybuffer 响应在 web 与原生实现里都以 base64 字符串回传。
 * @param base64 base64 编码的响应体
 * @returns 解码后的字节视图
 */
const base64ToBytes = (base64: string): Uint8Array => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
};

/**
 * 把原生层回传的 arraybuffer 响应体统一为字节视图
 *
 * 原生层对非 JSON Content-Type 的响应体以 base64 字符串回传，直接解码；
 * 对 JSON Content-Type 的响应体会抢先按文本读取并解析（responseType 被忽略），
 * 解析成功回传对象时序列化回文本再编码为字节，解析失败回传原始文本时
 * 按 UTF-8 编码为字节——任何形态都不向上游调用方抛出解码异常。
 * @param data 原生层回传的响应体（base64 字符串 / 已解析对象 / 文本）
 * @returns 字节视图
 */
const decodeArrayBufferData = (data: unknown): Uint8Array => {
    if (typeof data === "string") {
        try {
            return base64ToBytes(data);
        } catch {
            return new TextEncoder().encode(data);
        }
    }
    if (typeof data === "object" && data !== null) {
        return new TextEncoder().encode(JSON.stringify(data));
    }
    return new Uint8Array(0);
};

/**
 * 尝试解析 JSON，失败则返回原始字符串
 * @param text 待解析文本
 * @returns 解析结果（对象 / 数组 / 标量），非 JSON 文本原样返回
 */
export function tryParseJSON(text: string): unknown {
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
