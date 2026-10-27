/**
 * 远程换源回退（MIGU / CHANGQING / LXMUSIC）
 *
 * 这三个源在移动端没有本地实现：咪咕官方曲库检索、长青公益聚合站、落雪自定义源协议
 * 都依赖服务端同源实现（服务端持有取链凭据、候选检索与直链体积校验逻辑），
 * 端侧直连既拿不到凭据也无法复刻校验链路。故端侧不再把三者当成未知源直接判死链，
 * 而是在本地直连分发层内回退到远程解锁服务，由服务端完成检索、取链与校验，
 * 端侧只负责组装查询参数与归一化返回结果。
 *
 * 远程端点与服务端实现一一对应：<站点>/api/unblock/<server>，
 * 查询参数为 keyword / songName / artist / duration / platform / platformId / noCookie，
 * 与 PC 端调用同一套服务端接口的形态保持一致。
 *
 * 结果归一口径：
 * - HTTP 200 且业务 code 为 200：透传直链（附带 lengthVerified 校验标记）；
 * - HTTP 200 且业务 code 为 404：业务侧确实没有可用直链，透传其失败原因；
 * - HTTP 层异常（404 路由缺失 / 405 / 5xx）或网络失败：归一为「源暂不可用」，
 *   不污染熔断器与失败日志口径，也不阻塞换源链继续尝试后续源。
 */

import { CapacitorHttp } from "@capacitor/core";
import { SongUnlockServer } from "@/types/shared";
import { isCapacitor } from "@/utils/env";
import { unblockLog } from "./http";
import type { SongUrlResult } from "./types";

/** 走远程回退的换源（端侧无本地实现，服务端有同源实现） */
export const REMOTE_UNLOCK_SERVERS: readonly SongUnlockServer[] = [
    SongUnlockServer.MIGU,
    SongUnlockServer.CHANGQING,
    SongUnlockServer.LXMUSIC,
];

/**
 * 各远程源的请求超时预算（毫秒）
 *
 * 与 PC 端解锁链的 UNLOCK_TIMEOUT 三源预算一致：服务端在一次请求内串行完成
 * 「检索 → 取链 → 体积校验」，咪咕需遍历音质档位、长青需探测真实音频时长，
 * 预算过短会把仍在处理中的慢源误判为失败。
 */
export const REMOTE_UNLOCK_TIMEOUT: Partial<Record<SongUnlockServer, number>> = {
    [SongUnlockServer.MIGU]: 30000,
    [SongUnlockServer.CHANGQING]: 40000,
    [SongUnlockServer.LXMUSIC]: 20000,
};

/** 未单独配置预算的远程源所用的默认超时（毫秒） */
const DEFAULT_REMOTE_TIMEOUT_MS = 30000;

/** 远程源暂不可用时的统一失败原因 */
export const SOURCE_UNAVAILABLE_REASON = "源暂不可用";

/** 移动端 UA 伪装：与本模块其它音源请求保持一致 */
const MOBILE_USER_AGENT = "Mozilla/5.0 (Linux; Android 10; Mobile) AppleWebKit/537.36";

/** 远程解锁服务基址 */
const REMOTE_UNLOCK_BASE = "https://music.viaxv.top/api/unblock";

/** 远程换源查询参数 */
export interface RemoteUnlockParams {
    /** 搜索关键词（歌名-歌手） */
    keyword: string;
    /** 歌曲名 */
    songName: string;
    /** 歌手名 */
    artist: string;
    /** 歌曲声明时长（秒），参与服务端歌名/歌手/时长三重校验 */
    duration?: number;
    /** 歌曲来源平台（netease / qqmusic / kugou） */
    platform?: string;
    /** 平台内歌曲主键（QQ mid / 酷狗 hash） */
    platformId?: string;
}

/** 一次远程请求的描述 */
export interface UnlockTransportRequest {
    /** 完整请求地址（含查询串） */
    url: string;
    /** 超时预算（毫秒） */
    timeoutMs: number;
}

/** 一次远程请求的响应 */
export interface UnlockTransportResponse {
    /** HTTP 状态码 */
    status: number;
    /** 响应体（已尽力解析为 JSON，未能解析时为原始文本） */
    body: unknown;
}

/** 远程请求的传输层（生产环境走原生 HTTP / fetch，测试可替换） */
export type UnlockTransport = (request: UnlockTransportRequest) => Promise<UnlockTransportResponse>;

/**
 * 判断某解锁源是否走远程回退
 * @param server 解锁源
 * @returns 是否走远程回退
 */
export const isRemoteUnlockServer = (server: SongUnlockServer): boolean =>
    REMOTE_UNLOCK_SERVERS.includes(server);

/**
 * 组装远程换源请求地址
 * @param server 解锁源
 * @param params 查询参数
 * @returns 完整请求地址
 */
export const buildRemoteUnlockUrl = (server: SongUnlockServer, params: RemoteUnlockParams): string => {
    const query = new URLSearchParams();
    query.set("keyword", params.keyword);
    query.set("songName", params.songName);
    query.set("artist", params.artist);
    if (typeof params.duration === "number" && params.duration > 0) {
        query.set("duration", String(Math.round(params.duration)));
    }
    if (params.platform) {
        query.set("platform", params.platform);
    }
    if (params.platformId) {
        query.set("platformId", params.platformId);
    }
    query.set("noCookie", "true");
    return `${REMOTE_UNLOCK_BASE}/${server}?${query.toString()}`;
};

/**
 * 解析响应文本为 JSON，失败则返回原始文本
 * @param text 响应文本
 * @returns 解析结果
 */
const tryParseJson = (text: string): unknown => {
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
};

/**
 * 在超时预算内执行请求
 *
 * 原生层的连接/读取超时按单次读写计时，慢速滴流式响应可以无限拉长总耗时；
 * 这里再兜一层总时长闸门，保证换源链不会被单个慢源无限拖住。
 * @param task 请求任务
 * @param timeoutMs 超时预算（毫秒）
 * @returns 请求结果
 */
const withTimeout = async <T>(task: Promise<T>, timeoutMs: number): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            task,
            new Promise<never>((_resolve, reject) => {
                timer = setTimeout(() => reject(new Error(`请求超时（${timeoutMs}ms）`)), timeoutMs);
            }),
        ]);
    } finally {
        if (timer) {
            clearTimeout(timer);
        }
    }
};

/**
 * 默认传输层：Capacitor 端走原生 HTTP（绕过同源策略并支持超时预算），其余环境走 fetch
 * @param request 请求描述
 * @returns 响应
 */
export const defaultUnlockTransport: UnlockTransport = async ({ url, timeoutMs }) => {
    if (isCapacitor) {
        const response = await withTimeout(
            CapacitorHttp.get({
                url,
                connectTimeout: timeoutMs,
                readTimeout: timeoutMs,
                headers: {
                    // UA 伪装仅在原生栈注入，受限头在浏览器 fetch 中会被静默丢弃
                    "User-Agent": MOBILE_USER_AGENT,
                },
            }),
            timeoutMs,
        );
        // 原生层在响应非 JSON Content-Type 时会保留原始字符串，此处兜底解析
        return {
            status: response.status,
            body: typeof response.data === "string" ? tryParseJson(response.data) : response.data,
        };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, { signal: controller.signal });
        const text = await response.text();
        return { status: response.status, body: tryParseJson(text) };
    } finally {
        clearTimeout(timer);
    }
};

/**
 * 归一化远程换源的响应体
 *
 * 业务失败（服务端已给出原因）与源不可用（响应体不可解析）分开表达：
 * 前者保留服务端原因，后者统一为「源暂不可用」。
 * @param body 响应体
 * @returns 换源结果
 */
export const normalizeRemoteUnlockBody = (body: unknown): SongUrlResult => {
    if (!body || typeof body !== "object") {
        return { code: 404, url: null, reason: SOURCE_UNAVAILABLE_REASON };
    }

    const payload = body as Record<string, unknown>;
    const code = typeof payload.code === "number" ? payload.code : 0;
    const url = typeof payload.url === "string" ? payload.url.trim() : "";
    const reason = typeof payload.reason === "string" ? payload.reason.trim() : "";

    if (code === 200 && url) {
        const result: SongUrlResult = { code: 200, url };
        if (reason) {
            result.reason = reason;
        }
        if (typeof payload.lengthVerified === "boolean") {
            result.lengthVerified = payload.lengthVerified;
        }
        return result;
    }

    return {
        code: 404,
        url: null,
        reason: reason || SOURCE_UNAVAILABLE_REASON,
    };
};

/**
 * 请求远程换源服务
 * @param server 解锁源
 * @param params 查询参数
 * @param transport 传输层（默认走环境内置实现）
 * @returns 换源结果
 */
export const requestRemoteUnlock = async (
    server: SongUnlockServer,
    params: RemoteUnlockParams,
    transport: UnlockTransport = defaultUnlockTransport,
): Promise<SongUrlResult> => {
    const timeoutMs = REMOTE_UNLOCK_TIMEOUT[server] ?? DEFAULT_REMOTE_TIMEOUT_MS;
    const url = buildRemoteUnlockUrl(server, params);

    unblockLog.log(`🌐 远程换源请求: server=${server}, url=${url}`);
    try {
        const { status, body } = await transport({ url, timeoutMs });
        if (status !== 200) {
            unblockLog.warn(`⚠️ 远程换源 HTTP 异常: server=${server}, status=${status}`);
            return { code: 404, url: null, reason: SOURCE_UNAVAILABLE_REASON };
        }
        const result = normalizeRemoteUnlockBody(body);
        unblockLog.log(
            `🌐 远程换源结果: server=${server}, code=${result.code}, reason=${result.reason ?? "-"}`,
        );
        return result;
    } catch (error) {
        unblockLog.error(`❌ 远程换源请求失败: server=${server}`, error);
        return { code: 404, url: null, reason: SOURCE_UNAVAILABLE_REASON };
    }
};
