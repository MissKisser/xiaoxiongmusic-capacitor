/**
 * 星海音源（网易云通道）换源单测
 *
 * 上游是社区公益接口，测试不连真实上游：通过替换全局 fetch 在本地 http 封装层之下
 * 打桩（封装层的 JSON 解析、状态码透传与超时归一都在真实代码路径上被覆盖），
 * 分别模拟 IP 探测、取链响应与音频文件头探测，覆盖缺 id、外平台 id、
 * 正常取链、时长闸门拦截与音质降级五类结论。
 */

import "./helpers/setup";
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import getXinghaiSongUrl from "../src/utils/unblock/xinghai";
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

/** 打桩期间记录到的请求地址 */
let requestedUrls: string[] = [];

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
 * 替换全局 fetch 为路由桩
 *
 * IP 探测走 ip.php，取链走 /lx/api/，其余地址按音频直链处理。
 * @param handler 取链请求的响应构造器（按音质档位）
 * @param audioDurationSec 音频直链的真实时长（秒）
 * @param audioBitrateKbps 音频直链的码率（kbps）
 */
const stubFetch = (
    handler: (quality: string) => { status?: number; body: Record<string, unknown> },
    audioDurationSec = 192,
    audioBitrateKbps = 320,
): void => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = String(input);
        requestedUrls.push(url);
        if (url.includes("ip.php")) return jsonResponse(200, { ip: "203.0.113.7" });
        if (url.includes("/lx/api/")) {
            const quality = new URL(url).searchParams.get("quality") || "";
            const { status = 200, body } = handler(quality);
            return jsonResponse(status, body);
        }
        const totalBytes = Math.round((audioDurationSec * audioBitrateKbps * 1000) / 8);
        return buildAudioResponse(totalBytes, audioBitrateKbps);
    }) as typeof globalThis.fetch;
};

afterEach(() => {
    globalThis.fetch = originalFetch;
    requestedUrls = [];
});

describe("星海音源 getXinghaiSongUrl", () => {
    it("缺少网易云歌曲 id 时直接失败，且不请求上游", async () => {
        stubFetch(() => ({ body: { code: 200, url: "http://m804.music.126.net/a.mp3" } }));
        const result = await getXinghaiSongUrl(
            { title: "刀马旦", artist: "周杰伦", duration: 192 },
            { platform: "netease" },
        );
        assert.equal(result.code, 404);
        assert.equal(result.url, null);
        assert.equal(result.reason, NO_CANDIDATE_REASON);
        assert.equal(
            requestedUrls.some((url) => url.includes("/lx/api/")),
            false,
        );
    });

    it("歌曲 id 不属于网易云时直接失败，且不请求上游", async () => {
        stubFetch(() => ({ body: { code: 200, url: "http://m804.music.126.net/a.mp3" } }));
        const result = await getXinghaiSongUrl(
            { title: "刀马旦", artist: "周杰伦", duration: 192 },
            { platform: "qqmusic", platformId: "004Z8Ihr0JIu5" },
        );
        assert.equal(result.code, 404);
        assert.equal(result.url, null);
        assert.equal(result.reason, NO_CANDIDATE_REASON);
        assert.equal(
            requestedUrls.some((url) => url.includes("/lx/api/")),
            false,
        );
    });

    it("取链成功时返回网易云 CDN 直链并完成体积校验", async () => {
        stubFetch(() => ({
            body: { code: 200, url: "http://m804.music.126.net/2026/abc/320.mp3?param=1" },
        }));
        const result = await getXinghaiSongUrl(
            { title: "刀马旦", artist: "周杰伦", duration: 192 },
            { platform: "netease", platformId: "5257160" },
        );
        assert.equal(result.code, 200);
        assert.ok(result.url?.startsWith("https://m804.music.126.net/"));
        assert.equal(result.lengthVerified, true);
    });

    it("真实音频时长偏离目标时长时拒绝交付", async () => {
        stubFetch(
            () => ({
                body: { code: 200, url: "http://m804.music.126.net/2026/abc/short.mp3" },
            }),
            100,
        );
        const result = await getXinghaiSongUrl(
            { title: "刀马旦", artist: "周杰伦", duration: 192 },
            { platform: "netease", platformId: "5257160" },
        );
        assert.equal(result.code, 404);
        assert.equal(result.url, null);
        assert.equal(result.reason, FETCH_FAILED_REASON);
    });

    it("320k 取不到时降级 128k 重试", async () => {
        globalThis.fetch = (async (input: RequestInfo | URL) => {
            const url = String(input);
            requestedUrls.push(url);
            if (url.includes("ip.php")) return jsonResponse(200, { ip: "203.0.113.7" });
            if (url.includes("/lx/api/")) {
                const quality = new URL(url).searchParams.get("quality") || "";
                if (quality === "320k") return jsonResponse(200, { code: 500, msg: "获取失败" });
                return jsonResponse(200, { code: 200, url: "http://m704.music.126.net/128.mp3" });
            }
            return buildAudioResponse((192 * 128 * 1000) / 8, 128);
        }) as typeof globalThis.fetch;
        const result = await getXinghaiSongUrl(
            { title: "刀马旦", artist: "周杰伦", duration: 192 },
            { platform: "netease", platformId: "5257160" },
        );
        assert.equal(result.code, 200);
        assert.ok(result.url?.startsWith("https://m704.music.126.net/"));
        assert.equal(result.lengthVerified, true);
    });
});
