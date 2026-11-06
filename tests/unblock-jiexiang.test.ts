/**
 * 吉祥音源（酷狗曲库通道）换源单测
 *
 * 上游是社区公益接口，测试不连真实上游：通过替换全局 fetch 在本地 http 封装层之下
 * 打桩（封装层的 JSON 解析、状态码透传与 POST 请求体都在真实代码路径上被覆盖），
 * 分别模拟网关换票、解析端点与音频文件头探测，覆盖缺 hash、业务码非 0、
 * 音质标识不符、正常取链、网关签名防篡改与熔断等结论。
 */

import "./helpers/setup";
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import getJiexiangSongUrl from "../src/utils/unblock/jiexiang";
import {
    FETCH_FAILED_REASON,
    NO_CANDIDATE_REASON,
    UPSTREAM_UNAVAILABLE_REASON,
} from "../src/utils/unblock/match";
import { invalidateQingTicket } from "../src/utils/unblock/qing-gateway";

/** 网关签名密钥常量（用于测试断言校验 HMAC） */
const SIGN_SECRET = "qm-gw-7c1f4e9a2b8d5360e1a7c4f9b2d8036c";

/** MPEG1 Layer3 码率索引表：下标即帧头里的码率位 */
const MPEG1_BITRATE_INDEX: Record<number, number> = {
    64: 5,
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

/** 目标曲目的时长（秒） */
const DURATION = 269;

/** 目标曲目的酷狗 hash */
const HASH = "b3a52a7a958bf0aed0ebfba2e9a818b7";

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
 * 构造上游解析响应体
 * @param url 直链地址
 * @param overrides 需要覆盖的字段
 * @returns 上游响应体
 */
const buildUpstreamBody = (
    url: string,
    overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
    code: 0,
    message: "ok",
    data: { url },
    ...overrides,
});

/**
 * 构造带音质标识的直链
 * @param marker 音质标识
 * @returns 直链地址
 */
const buildUrl = (marker: string): string =>
    `http://v3-32-yp-qqmusic.a.bdycdn.cn/fsdg360.hw.kugou.com/v3/${HASH}/yp/full/ap3293_qu${marker}_s123.mp3`;

/** 一次解析请求的记录（用于签名校验） */
interface CapturedPost {
    url: string;
    headers: Record<string, string>;
    body: string;
}

/**
 * 替换全局 fetch 为路由桩
 *
 * 网关换票走 /v1/gateway/ticket，解析走 /v1/music/resolve-url，
 * 其余地址按音频直链处理（qu320 对应 320k，其余按 128k）。
 * @param handler 按音质档位与请求记录给出解析响应
 * @param audioDurationSec 音频直链的真实时长（秒）
 */
const stubFetch = (
    handler: (
        level: string,
        captured: CapturedPost,
    ) => { status: number; body: Record<string, unknown> },
    audioDurationSec = DURATION,
): void => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/v1/gateway/ticket")) {
            return jsonResponse(200, {
                ticket: "mock-test-ticket",
                expiresAt: Date.now() + 43200 * 1000,
                ttlSeconds: 43200,
            });
        }
        if (url.includes("/v1/music/resolve-url")) {
            const body = typeof init?.body === "string" ? init.body : String(init?.body ?? "");
            const captured: CapturedPost = {
                url,
                headers: (init?.headers ?? {}) as Record<string, string>,
                body,
            };
            const level = String((JSON.parse(body) as { level?: unknown })?.level ?? "");
            const { status, body: responseBody } = handler(level, captured);
            return jsonResponse(status, responseBody);
        }
        if (url.includes("qu320")) {
            return buildAudioResponse(Math.round((audioDurationSec * 320 * 1000) / 8), 320);
        }
        return buildAudioResponse(Math.round((audioDurationSec * 128 * 1000) / 8), 128);
    }) as typeof globalThis.fetch;
};

afterEach(() => {
    globalThis.fetch = originalFetch;
    invalidateQingTicket();
});

describe("吉祥音源 getJiexiangSongUrl", () => {
    it("缺少酷狗 hash 时直接失败，且不请求上游", async () => {
        stubFetch(() => ({ status: 200, body: buildUpstreamBody(buildUrl("320")) }));
        const result = await getJiexiangSongUrl(
            { title: "晴天", artist: "周杰伦", duration: DURATION },
            { platform: "kugou" },
        );
        assert.equal(result.code, 404);
        assert.equal(result.url, null);
        assert.equal(result.reason, NO_CANDIDATE_REASON);
    });

    it("上游业务码非 0 时取链失败", async () => {
        stubFetch(() => ({
            status: 200,
            body: {
                code: "UPSTREAM_NO_RESOURCE",
                message: "播放地址解析失败",
            },
        }));
        const result = await getJiexiangSongUrl(
            { title: "晴天", artist: "周杰伦", duration: DURATION },
            { platform: "kugou", platformId: HASH },
        );
        assert.equal(result.code, 404);
        assert.equal(result.url, null);
        assert.equal(result.reason, FETCH_FAILED_REASON);
    });

    it("直链缺少对应音质标识时拒绝交付", async () => {
        stubFetch(() => ({ status: 200, body: buildUpstreamBody(buildUrl("flac")) }));
        const result = await getJiexiangSongUrl(
            { title: "晴天", artist: "周杰伦", duration: DURATION },
            { platform: "kugou", platformId: HASH },
        );
        assert.equal(result.code, 404);
        assert.equal(result.url, null);
        assert.equal(result.reason, FETCH_FAILED_REASON);
    });

    it("取链成功时返回酷狗 CDN 直链并完成体积校验", async () => {
        stubFetch((level) => ({
            status: 200,
            body: buildUpstreamBody(buildUrl(level === "exhigh" ? "320" : "128")),
        }));
        const result = await getJiexiangSongUrl(
            { title: "晴天", artist: "周杰伦", duration: DURATION },
            { platform: "kugou", platformId: HASH },
        );
        assert.equal(result.code, 200);
        assert.ok(result.url?.includes("qu320"));
        assert.equal(result.lengthVerified, true);
    });

    it("高音质档取不到时降级到标准档", async () => {
        stubFetch((level) =>
            level === "exhigh"
                ? { status: 200, body: { code: "UPSTREAM_NO_RESOURCE", message: "播放地址解析失败" } }
                : { status: 200, body: buildUpstreamBody(buildUrl("128")) },
        );
        const result = await getJiexiangSongUrl(
            { title: "晴天", artist: "周杰伦", duration: DURATION },
            { platform: "kugou", platformId: HASH },
        );
        assert.equal(result.code, 200);
        assert.ok(result.url?.includes("qu128"));
    });

    it("真实音频时长偏离目标时长时拒绝交付", async () => {
        stubFetch(() => ({ status: 200, body: buildUpstreamBody(buildUrl("320")) }), 100);
        const result = await getJiexiangSongUrl(
            { title: "晴天", artist: "周杰伦", duration: DURATION },
            { platform: "kugou", platformId: HASH },
        );
        assert.equal(result.code, 404);
        assert.equal(result.url, null);
        assert.equal(result.reason, FETCH_FAILED_REASON);
    });

    it("成功路径（HTTP 201 + 嵌套 data.url）正常出链且含 qu320 标识", async () => {
        stubFetch(() => ({
            status: 201,
            body: buildUpstreamBody(buildUrl("320")),
        }));
        const result = await getJiexiangSongUrl(
            { title: "晴天", artist: "周杰伦", duration: DURATION },
            { platform: "kugou", platformId: HASH },
        );
        assert.equal(result.code, 200);
        assert.ok(result.url?.includes("qu320"));
        assert.equal(result.lengthVerified, true);
    });

    it("HTTP 503 + UPSTREAM_NO_RESOURCE 判单曲拒绝且不推进熔断计数", async () => {
        stubFetch(() => ({
            status: 503,
            body: {
                code: "UPSTREAM_NO_RESOURCE",
                message: "播放地址解析失败",
            },
        }));
        for (let i = 0; i < 4; i++) {
            const result = await getJiexiangSongUrl(
                { title: "晴天", artist: "周杰伦", duration: DURATION },
                { platform: "kugou", platformId: HASH },
            );
            assert.equal(result.code, 404);
            assert.equal(result.reason, FETCH_FAILED_REASON);
        }
    });

    it("APP_UPGRADE_REQUIRED → 票据缓存被作废、自动换票重试一次后成功", async () => {
        let resolveCalls = 0;
        let ticketCalls = 0;

        globalThis.fetch = (async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url.includes("/v1/gateway/ticket")) {
                ticketCalls += 1;
                return jsonResponse(200, {
                    ticket: `mock-ticket-${ticketCalls}`,
                    expiresAt: Date.now() + 43200 * 1000,
                    ttlSeconds: 43200,
                });
            }
            if (url.includes("/v1/music/resolve-url")) {
                resolveCalls += 1;
                if (resolveCalls === 1) {
                    return jsonResponse(200, {
                        code: "APP_UPGRADE_REQUIRED",
                        message: "ticket expired",
                    });
                }
                return jsonResponse(200, buildUpstreamBody(buildUrl("320")));
            }
            return buildAudioResponse(Math.round((DURATION * 320 * 1000) / 8), 320);
        }) as typeof globalThis.fetch;

        const result = await getJiexiangSongUrl(
            { title: "晴天", artist: "周杰伦", duration: DURATION },
            { platform: "kugou", platformId: HASH },
        );
        assert.equal(result.code, 200);
        assert.ok(result.url?.includes("qu320"));
        assert.equal(resolveCalls, 2, "应重试一次解析请求");
        assert.equal(ticketCalls, 2, "作废缓存后应重新请求 ticket");
    });

    it("请求头完整性：捕获发出的请求头，重算 stringToSign 验证 X-Qing-Sign 并验证 nonce 防重放", async () => {
        const capturedRequests: CapturedPost[] = [];

        stubFetch((_level, captured) => {
            capturedRequests.push(captured);
            return { status: 200, body: buildUpstreamBody(buildUrl("320")) };
        });

        await getJiexiangSongUrl(
            { title: "晴天", artist: "周杰伦", duration: DURATION },
            { platform: "kugou", platformId: HASH },
        );
        await getJiexiangSongUrl(
            { title: "晴天", artist: "周杰伦", duration: DURATION },
            { platform: "kugou", platformId: HASH },
        );

        assert.equal(capturedRequests.length, 2);
        const [req1, req2] = capturedRequests;

        for (const req of [req1, req2]) {
            assert.equal(req.headers["X-Qing-App-Id"], "qingmusic-android");
            assert.equal(req.headers["X-Qing-App-Version"], "1.4.0");
            assert.ok(req.headers["X-Qing-Device-Id"].startsWith("qingmusic-android-"));
            assert.match(req.headers["X-Qing-Ts"], /^\d{13}$/);
            assert.match(req.headers["X-Qing-Nonce"], /^[a-f0-9]{32}$/);
            assert.match(req.headers["X-Qing-Sign"], /^[a-f0-9]{64}$/);
            assert.equal(req.headers["Authorization"], "Bearer mock-test-ticket");

            const bodySha256 = createHash("sha256").update(req.body).digest("hex");
            const stringToSign = [
                req.headers["X-Qing-App-Id"],
                req.headers["X-Qing-Ts"],
                req.headers["X-Qing-Nonce"],
                "POST",
                "/v1/music/resolve-url",
                bodySha256,
            ].join("\n");
            const expectedSign = createHmac("sha256", SIGN_SECRET)
                .update(stringToSign)
                .digest("hex");
            assert.equal(req.headers["X-Qing-Sign"], expectedSign);
        }

        assert.notEqual(req1.headers["X-Qing-Nonce"], req2.headers["X-Qing-Nonce"]);
    });

    it("重试后仍鉴权失败 → 判上游故障（计熔断）", async () => {
        stubFetch(() => ({
            status: 401,
            body: {
                code: "APP_UPGRADE_REQUIRED",
                message: "sign invalid",
            },
        }));

        for (let i = 0; i < 3; i++) {
            const res = await getJiexiangSongUrl(
                { title: "晴天", artist: "周杰伦", duration: DURATION },
                { platform: "kugou", platformId: HASH },
            );
            assert.equal(res.code, 404);
            assert.equal(res.reason, FETCH_FAILED_REASON);
        }

        const tripped = await getJiexiangSongUrl(
            { title: "晴天", artist: "周杰伦", duration: DURATION },
            { platform: "kugou", platformId: HASH },
        );
        assert.equal(tripped.code, 404);
        assert.equal(tripped.reason, UPSTREAM_UNAVAILABLE_REASON);
    });
});
