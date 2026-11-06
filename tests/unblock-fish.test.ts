/**
 * 小鱼音源（QQ 音乐通道）换源单测
 *
 * 上游是社区公益接口，测试不连真实上游：通过替换全局 fetch 在本地 http 封装层之下
 * 打桩（封装层的 JSON 解析、状态码透传与超时归一都在真实代码路径上被覆盖），
 * 分别模拟取链响应、QQ 检索响应、体积探测（HEAD）与音频文件头探测，
 * 覆盖缺 mid、跨平台检索换 mid、回显不符、音质降级、时长闸门与首触超时重试等结论。
 */

import "./helpers/setup";
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import getFishSongUrl from "../src/utils/unblock/fish";
import { FETCH_FAILED_REASON, NO_CANDIDATE_REASON } from "../src/utils/unblock/match";

/** MPEG1 Layer3 码率索引表：下标即帧头里的码率位 */
const MPEG1_BITRATE_INDEX: Record<number, number> = {
    32: 1,
    40: 2,
    48: 3,
    56: 4,
    64: 5,
    80: 6,
    96: 7,
    112: 8,
    128: 9,
    160: 10,
    192: 11,
    224: 12,
    256: 13,
    320: 14,
};

/** 原始的全局 fetch：测试结束后恢复 */
const originalFetch = globalThis.fetch;

/**
 * 构造 MP3 帧头：探测模块按帧头码率推算真实时长
 * @param bitrateKbps 码率（kbps）
 * @returns 帧头字节
 */
const buildMp3Header = (bitrateKbps: number): Uint8Array =>
    Uint8Array.from([0xff, 0xfb, (MPEG1_BITRATE_INDEX[bitrateKbps] << 4) & 0xf0, 0x64]);

/**
 * 构造 JSON 响应桩
 * @param status HTTP 状态码
 * @param body 响应体
 * @returns fetch 响应桩
 */
const jsonResponse = (status: number, body: unknown): Response =>
    ({
        status,
        headers: new Headers(),
        url: "https://stub.local",
        text: async () => JSON.stringify(body),
        arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(body)).buffer,
    }) as Response;

/**
 * 构造音频直链的探测响应：只给文件头与总字节数
 * @param totalBytes 文件总字节数
 * @param bitrateKbps 文件码率（kbps）
 * @returns fetch 响应桩
 */
const buildAudioResponse = (totalBytes: number, bitrateKbps: number): Response =>
    ({
        status: 206,
        headers: new Headers({ "content-range": `bytes 0-127/${totalBytes}` }),
        url: "https://stub.local",
        text: async () => "",
        arrayBuffer: async () => buildMp3Header(bitrateKbps).slice().buffer,
    }) as Response;

/**
 * 构造体积探测（HEAD）响应桩
 * @param bytes 声明的文件总字节数
 * @returns fetch 响应桩
 */
const buildHeadResponse = (bytes: number): Response =>
    ({
        status: 200,
        headers: new Headers({ "content-length": String(bytes) }),
        url: "https://stub.local",
        text: async () => "",
    }) as Response;

/** 上游 URL 片段：用于区分各音质档位的直链 */
const HQ_URL = "http://isure6.stream.qqmusic.qq.com/C600003Qui1q2u1Zho.m4a";
const STANDARD_URL = "http://isure6.stream.qqmusic.qq.com/C400003Qui1q2u1Zho.m4a";

/** 目标曲目的时长（秒） */
const DURATION = 269;

/**
 * 按音质档位给出该档直链的实测体积与码率
 * @param url 直链地址
 * @returns 体积（字节）与码率（kbps）
 */
const resolveTierSize = (url: string): { bytes: number; bitrate: number } => {
    if (url.includes("C400")) {
        return { bytes: Math.round((DURATION * 96 * 1000) / 8), bitrate: 96 };
    }
    return { bytes: Math.round((DURATION * 192 * 1000) / 8), bitrate: 192 };
};

/**
 * 构造上游响应体
 * @param overrides 需要覆盖的字段
 * @returns 上游响应体
 */
const buildUpstreamBody = (
    overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
    song_mid: "0039MnYb0qxYhV",
    song_name: "晴天",
    singer_name: "周杰伦",
    song_play_time: DURATION,
    song_play_url_hq: HQ_URL,
    song_play_url_standard: STANDARD_URL,
    song_size_hq_str: Math.round((DURATION * 192 * 1000) / 8),
    song_size_standard_str: Math.round((DURATION * 96 * 1000) / 8),
    kbps_hq: 192,
    kbps_standard: 96,
    ...overrides,
});

/** QQ 检索的响应体：返回与目标一致的候选 */
const QQ_SEARCH_BODY = {
    code: 0,
    request: {
        code: 0,
        data: {
            body: {
                item_song: [
                    {
                        mid: "0039MnYb0qxYhV",
                        title: "晴天",
                        singer: [{ name: "周杰伦" }],
                        interval: DURATION,
                    },
                ],
            },
        },
    },
};

/**
 * 替换全局 fetch 为路由桩
 * @param body 上游取链响应体
 * @param status 上游取链 HTTP 状态码
 */
const stubFetch = (body: Record<string, unknown>, status = 200): void => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("tang.api.s01s.cn")) return jsonResponse(status, body);
        if (url.includes("u.y.qq.com")) return jsonResponse(200, QQ_SEARCH_BODY);
        if (init?.method === "HEAD") {
            const { bytes } = resolveTierSize(url);
            return buildHeadResponse(bytes);
        }
        const { bytes, bitrate } = resolveTierSize(url);
        return buildAudioResponse(bytes, bitrate);
    }) as typeof globalThis.fetch;
};

/** 上游取链请求的调用次数 */
let upstreamCalls = 0;

/**
 * 构造请求中止形态的传输异常（与封装层超时归一前的 fetch 形态一致）
 * @returns 中止异常
 */
const makeAbortError = (): Error => {
    const error = new Error("The operation was aborted");
    error.name = "AbortError";
    return error;
};

/**
 * 打桩上游取链：前若干次超时，其后正常返回
 * @param body 上游响应体
 * @param timeoutsBeforeOk 超时次数
 */
const stubUpstreamTimeoutThenOk = (
    body: Record<string, unknown>,
    timeoutsBeforeOk: number,
): void => {
    upstreamCalls = 0;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("tang.api.s01s.cn")) {
            upstreamCalls += 1;
            if (upstreamCalls <= timeoutsBeforeOk) throw makeAbortError();
            return jsonResponse(200, body);
        }
        if (url.includes("u.y.qq.com")) return jsonResponse(200, QQ_SEARCH_BODY);
        if (init?.method === "HEAD") {
            const { bytes } = resolveTierSize(url);
            return buildHeadResponse(bytes);
        }
        const { bytes, bitrate } = resolveTierSize(url);
        return buildAudioResponse(bytes, bitrate);
    }) as typeof globalThis.fetch;
};

afterEach(() => {
    globalThis.fetch = originalFetch;
});

describe("小鱼音源 getFishSongUrl", () => {
    it("缺少 QQ mid 时直接失败，且不请求上游", async () => {
        stubFetch(buildUpstreamBody());
        const result = await getFishSongUrl(
            { title: "晴天", artist: "周杰伦", duration: DURATION },
            { platform: "qqmusic" },
        );
        assert.equal(result.code, 404);
        assert.equal(result.url, null);
        assert.equal(result.reason, NO_CANDIDATE_REASON);
    });

    it("自带 id 不是 QQ mid 的其它平台来源走关键词检索换 mid", async () => {
        stubFetch(buildUpstreamBody());
        const result = await getFishSongUrl(
            { title: "晴天", artist: "周杰伦", duration: DURATION },
            { platform: "netease", platformId: "5257160" },
        );
        assert.equal(result.code, 200);
        assert.ok(result.url?.includes("qqmusic.qq.com"));
    });

    it("上游回显的 mid 与请求不符时拒绝交付", async () => {
        stubFetch(buildUpstreamBody({ song_mid: "004Fs2FP1EvZYc" }));
        const result = await getFishSongUrl(
            { title: "晴天", artist: "周杰伦", duration: DURATION },
            { platform: "qqmusic", platformId: "0039MnYb0qxYhV" },
        );
        assert.equal(result.code, 404);
        assert.equal(result.url, null);
        assert.equal(result.reason, FETCH_FAILED_REASON);
    });

    it("高音质档体积对不上时降级到标准档", async () => {
        stubFetch(
            buildUpstreamBody({
                song_size_hq_str: Math.round((DURATION * 192 * 1000) / 4),
            }),
        );
        const result = await getFishSongUrl(
            { title: "晴天", artist: "周杰伦", duration: DURATION },
            { platform: "qqmusic", platformId: "0039MnYb0qxYhV" },
        );
        assert.equal(result.code, 200);
        assert.ok(result.url?.includes("C400003Qui1q2u1Zho.m4a"));
        assert.equal(result.lengthVerified, true);
    });

    it("真实音频时长偏离目标时长时拒绝交付", async () => {
        // 体积与上游声明一致，但文件头算出的真实时长只有目标的四成：时长闸门应拒绝
        globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            if (url.includes("tang.api.s01s.cn")) {
                return jsonResponse(200, buildUpstreamBody());
            }
            if (url.includes("u.y.qq.com")) return jsonResponse(200, QQ_SEARCH_BODY);
            if (init?.method === "HEAD") {
                const { bytes } = resolveTierSize(url);
                return buildHeadResponse(bytes);
            }
            const { bytes, bitrate } = resolveTierSize(url);
            return buildAudioResponse(Math.round(bytes / 4), bitrate);
        }) as typeof globalThis.fetch;
        const result = await getFishSongUrl(
            { title: "晴天", artist: "周杰伦", duration: DURATION },
            { platform: "qqmusic", platformId: "0039MnYb0qxYhV" },
        );
        assert.equal(result.code, 404);
        assert.equal(result.url, null);
        assert.equal(result.reason, FETCH_FAILED_REASON);
    });

    it("首触超时后重试一次并命中上游缓存", async () => {
        stubUpstreamTimeoutThenOk(buildUpstreamBody(), 1);
        const result = await getFishSongUrl(
            { title: "晴天", artist: "周杰伦", duration: DURATION },
            { platform: "qqmusic", platformId: "0039MnYb0qxYhV" },
        );
        assert.equal(result.code, 200);
        assert.ok(result.url?.includes("qqmusic.qq.com"));
        assert.equal(upstreamCalls, 2, "首触超时后应再发一次请求");
    });

    it("重试仍超时时判失败", async () => {
        stubUpstreamTimeoutThenOk(buildUpstreamBody(), 2);
        const result = await getFishSongUrl(
            { title: "晴天", artist: "周杰伦", duration: DURATION },
            { platform: "qqmusic", platformId: "0039MnYb0qxYhV" },
        );
        assert.equal(result.code, 404);
        assert.equal(result.url, null);
        assert.equal(result.reason, FETCH_FAILED_REASON);
        assert.equal(upstreamCalls, 2, "只重试一次，不做无止境重试");
    });

    it("上游返回 HTTP 5xx 时不重试", async () => {
        upstreamCalls = 0;
        globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            if (url.includes("tang.api.s01s.cn")) {
                upstreamCalls += 1;
                return jsonResponse(500, "");
            }
            if (url.includes("u.y.qq.com")) return jsonResponse(200, QQ_SEARCH_BODY);
            if (init?.method === "HEAD") {
                const { bytes } = resolveTierSize(url);
                return buildHeadResponse(bytes);
            }
            const { bytes, bitrate } = resolveTierSize(url);
            return buildAudioResponse(bytes, bitrate);
        }) as typeof globalThis.fetch;
        const result = await getFishSongUrl(
            { title: "晴天", artist: "周杰伦", duration: DURATION },
            { platform: "qqmusic", platformId: "0039MnYb0qxYhV" },
        );
        assert.equal(result.code, 404);
        assert.equal(upstreamCalls, 1, "服务端故障由熔断器处理，不做即时重试");
    });
});
