/**
 * 本地解锁分发单测 (unblock/index.ts)
 *
 * 全部音源已在端侧本地化，本文件覆盖三块判据：
 * 1. 目标构造与关键词拼回：与 xiaoxiongmusic-server/unblock 路由层逐字一致的口径
 *    （显式歌名/歌手优先、只给歌名时歌手不凭空合成、缺歌手补「-」占位）；
 * 2. 全源路由：九个站外源各自路由到本地模块上游，网易云维持 GD 音乐台直取，
 *    任何源都不再请求自有服务端的 /api/unblock 远程解锁路由；
 * 3. lengthVerified 透传：分发层透传本地模块的直链体积校验标记。
 *
 * 上游打桩打在本地 http 封装层的传输底座（globalThis.fetch，node 测试环境走
 * http.ts 的 fetch 路径），不连真实上游，也不发起任何远程解锁请求。
 */

import "./helpers/setup";
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createPinia, setActivePinia } from "pinia";
import { SongUnlockServer } from "../src/types/shared";
import {
    buildMatchTarget,
    formatKeyword,
    localUnlockSongUrl,
    NETEASE_ID_SPACE_REASON,
} from "../src/utils/unblock";
import { API_BASE_URL } from "../src/utils/apiBase";

/** 咪咕检索端点（与服务端一致的地址形态，桩按前缀分发） */
const MIGU_SEARCH_URL = "https://c.musicapp.migu.cn/v1.0/content/search_all.do";

/** 咪咕取链端点 */
const MIGU_LISTEN_URL = "https://c.musicapp.migu.cn/strategy/listen-url/h5/v2.4";

/** 咪咕响应混淆的固定密钥（与被测还原算法互逆的协议常量） */
const MIGU_KEY = "Jk8qzuePiJ1qE3mDYhLQ3T73DtDoAhLP";

/** 咪咕成功直链（HEAD 体积探测按主机分发） */
const MIGU_DIRECT_URL = "https://freetyst.nf.migu.cn/public/product01/test.mp3";

/**
 * 构造咪咕混淆响应体（与被测还原算法互逆）
 * @param json 明文 JSON 文本
 * @returns 带魔数与种子的混淆字节
 */
const encodeMiguResponse = (json: string): Uint8Array => {
    const seed = 7;
    const plain = new TextEncoder().encode(json);
    const data = new Uint8Array(4 + plain.length);
    data.set([0xab, 0xcd, 0x01, seed], 0);
    for (let i = 0; i < plain.length; i += 1) {
        data[4 + i] = (plain[i] - seed + MIGU_KEY.charCodeAt(i % MIGU_KEY.length)) & 0xff;
    }
    return data;
};

/**
 * 构造一条能通过三重校验的咪咕检索响应（混淆体）
 * @param title 歌名
 * @param artist 歌手
 * @param durationSec 时长（秒）
 * @returns 混淆响应字节
 */
const buildMiguSearchPayload = (title: string, artist: string, durationSec: number): Uint8Array => {
    const pqSize = (durationSec * 128 * 1000) / 8;
    return encodeMiguResponse(
        JSON.stringify({
            code: "000000",
            songResultData: {
                result: [
                    {
                        contentId: "69905301122",
                        copyrightId: "1000",
                        name: title,
                        singers: [{ name: artist }],
                        rateFormats: [{ formatType: "PQ", resourceType: "PQ", size: pqSize }],
                    },
                ],
            },
        }),
    );
};

/**
 * 构造 fetch 桩响应
 * @param init 响应要素（状态码 / 响应头 / 文本或字节体）
 * @returns 形如 Response 的桩对象
 */
const buildResponse = (init: {
    status?: number;
    headers?: Record<string, string>;
    text?: string;
    bytes?: Uint8Array;
}): Response => {
    const status = init.status ?? 200;
    const bodyText = init.text ?? "";
    return {
        status,
        ok: status >= 200 && status < 300,
        headers: new Headers(init.headers ?? {}),
        url: "https://stub.local/",
        body: undefined,
        text: async () => bodyText,
        arrayBuffer: async () =>
            init.bytes
                ? (init.bytes.slice().buffer as ArrayBuffer)
                : new TextEncoder().encode(bodyText).buffer,
    } as unknown as Response;
};

/** 打桩期间记录到的请求 */
let requests: { url: string; method: string }[] = [];

/** 原始 fetch 引用 */
const originalFetch = globalThis.fetch;

/**
 * 安装全失败桩：任何上游请求都返回 HTTP 500，只用于验证路由地址
 */
const installAllFailStub = (): void => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        requests.push({ url, method });
        return buildResponse({ status: 500, text: "{}" });
    }) as typeof globalThis.fetch;
};

/**
 * 断言一组请求全部不触达远程解锁服务
 * @param captured 打桩期间记录到的请求
 */
const assertNoRemoteUnlockCalls = (captured: { url: string }[]): void => {
    for (const item of captured) {
        assert.ok(!item.url.includes(API_BASE_URL), `不得请求自有服务端: ${item.url}`);
        assert.ok(!item.url.includes("/api/unblock"), `不得请求远程解锁路由: ${item.url}`);
    }
};

/**
 * 断言请求里出现指定上游主机
 * @param captured 打桩期间记录到的请求
 * @param marker 主机标记
 */
const assertHitHost = (captured: { url: string }[], marker: string): void => {
    assert.ok(
        captured.some((item) => item.url.includes(marker)),
        `应请求上游 ${marker}，实际请求: ${captured.map((item) => item.url).join(", ") || "(无)"}`,
    );
};

describe("目标构造 buildMatchTarget", () => {
    beforeEach(() => {
        setActivePinia(createPinia());
    });

    it("显式歌名与歌手优先于关键词拆分", () => {
        assert.deepEqual(buildMatchTarget("晴天-周杰伦", "晴天", "周杰伦", 269), {
            title: "晴天",
            artist: "周杰伦",
            duration: 269,
        });
    });

    it("歌名与歌手都缺省时按关键词整体拆分，时长不做取整", () => {
        assert.deepEqual(buildMatchTarget("晴天-周杰伦", "", "", 269.4), {
            title: "晴天",
            artist: "周杰伦",
            duration: 269.4,
        });
    });

    it("只给歌名且关键词整体就是「歌名-歌手」形式时沿用关键词歌手", () => {
        assert.deepEqual(buildMatchTarget("晴天-周杰伦", "晴天", "", undefined), {
            title: "晴天",
            artist: "周杰伦",
            duration: undefined,
        });
    });

    it("歌名自身带「-」时不凭空合成歌手，按缺歌手处理", () => {
        assert.deepEqual(buildMatchTarget("夜曲-周杰伦", "夜曲-周杰伦", "", undefined), {
            title: "夜曲-周杰伦",
            artist: "",
            duration: undefined,
        });
    });

    it("非法时长归一为不参与时长校验", () => {
        assert.equal(buildMatchTarget("晴天-周杰伦", "晴天", "周杰伦", 0).duration, undefined);
        assert.equal(buildMatchTarget("晴天-周杰伦", "晴天", "周杰伦", -3).duration, undefined);
    });
});

describe("关键词拼回 formatKeyword", () => {
    beforeEach(() => {
        setActivePinia(createPinia());
    });

    it("常规目标拼回「歌名 - 歌手」", () => {
        assert.equal(formatKeyword({ title: "晴天", artist: "周杰伦", duration: 269 }), "晴天 - 周杰伦");
    });

    it("歌手名含「-」时替换为空格，避免下游切分错位", () => {
        assert.equal(formatKeyword({ title: "海阔天空", artist: "Cui-Jian" }), "海阔天空 - Cui Jian");
    });

    it("缺歌手且歌名含「-」时补不带歌手的「-」占位", () => {
        assert.equal(formatKeyword({ title: "夜曲-周杰伦", artist: "" }), "夜曲-周杰伦 -");
    });

    it("缺歌手且歌名不含「-」时原样返回", () => {
        assert.equal(formatKeyword({ title: "晴天", artist: "" }), "晴天");
    });
});

describe("全源本地分发 localDispatch", () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        requests = [];
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    it("咪咕路由到本地模块并透传 lengthVerified", async () => {
        const directUrl = MIGU_DIRECT_URL;
        globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            const method = init?.method ?? "GET";
            requests.push({ url, method });
            if (url.startsWith(MIGU_SEARCH_URL)) {
                return buildResponse({ status: 200, bytes: buildMiguSearchPayload("晴天", "周杰伦", 192) });
            }
            if (url.startsWith(MIGU_LISTEN_URL)) {
                return buildResponse({
                    status: 200,
                    bytes: new TextEncoder().encode(
                        JSON.stringify({ code: "000000", data: { url: directUrl, song: { duration: 192 } } }),
                    ),
                });
            }
            return buildResponse({
                status: 200,
                headers: { "content-length": String(3072000) },
                text: "",
            });
        }) as typeof globalThis.fetch;

        const result = await localUnlockSongUrl(123, "晴天", "周杰伦", SongUnlockServer.MIGU, {
            duration: 192,
        });

        assert.equal(result.code, 200);
        assert.equal(result.url, directUrl);
        assert.equal(result.lengthVerified, true);
        assertHitHost(requests, MIGU_SEARCH_URL);
        assertNoRemoteUnlockCalls(requests);
    });

    it("酷我路由到本地模块，不再请求远程解锁服务", async () => {
        installAllFailStub();
        const result = await localUnlockSongUrl(123, "晴天", "周杰伦", SongUnlockServer.KUWO, {
            duration: 269,
        });
        assert.equal(result.code, 404);
        assert.ok(requests.length > 0);
        assertHitHost(requests, "search.kuwo.cn");
        assertNoRemoteUnlockCalls(requests);
    });

    it("波点路由到本地模块，不再请求远程解锁服务", async () => {
        installAllFailStub();
        const result = await localUnlockSongUrl(123, "晴天", "周杰伦", SongUnlockServer.BODIAN, {
            duration: 269,
        });
        assert.equal(result.code, 404);
        assert.ok(requests.length > 0);
        assertHitHost(requests, "kuwo.cn");
        assertNoRemoteUnlockCalls(requests);
    });

    it("歌曲宝路由到本地模块，不再请求远程解锁服务", async () => {
        installAllFailStub();
        const result = await localUnlockSongUrl(123, "晴天", "周杰伦", SongUnlockServer.GEQUBAO, {
            duration: 269,
        });
        assert.equal(result.code, 404);
        assert.ok(requests.length > 0);
        assertHitHost(requests, "gequbao.com");
        assertNoRemoteUnlockCalls(requests);
    });

    it("长青路由到本地模块（QQ mid 直查），不再请求远程解锁服务", async () => {
        installAllFailStub();
        const result = await localUnlockSongUrl(123, "晴天", "周杰伦", SongUnlockServer.CHANGQING, {
            platform: "qqmusic",
            platformId: "0039MnYb0qxYhV",
            duration: 269,
        });
        assert.equal(result.code, 404);
        assert.ok(requests.length > 0);
        assertHitHost(requests, "musicapi.haitangw.net");
        assertNoRemoteUnlockCalls(requests);
    });

    it("落雪路由到本地模块（QQ mid 直查），不再请求远程解锁服务", async () => {
        installAllFailStub();
        const result = await localUnlockSongUrl(123, "晴天", "周杰伦", SongUnlockServer.LXMUSIC, {
            platform: "qqmusic",
            platformId: "0039MnYb0qxYhV",
            duration: 269,
        });
        assert.equal(result.code, 404);
        assert.ok(requests.length > 0);
        assertHitHost(requests, "yy.zddyr.top");
        assertNoRemoteUnlockCalls(requests);
    });

    it("星海路由到本地模块（网易云 id 直查），不再请求远程解锁服务", async () => {
        installAllFailStub();
        const result = await localUnlockSongUrl(123456, "晴天", "周杰伦", SongUnlockServer.XINGHAI, {
            platform: "netease",
            platformId: "123456",
            duration: 269,
        });
        assert.equal(result.code, 404);
        assert.ok(requests.length > 0);
        assertHitHost(requests, "yy.zddyr.top");
        assertNoRemoteUnlockCalls(requests);
    });

    it("小鱼路由到本地模块（QQ mid 直查），不再请求远程解锁服务", async () => {
        installAllFailStub();
        const result = await localUnlockSongUrl(97773, "晴天", "周杰伦", SongUnlockServer.FISH, {
            platform: "qqmusic",
            platformId: "0039MnYb0qxYhV",
            duration: 269,
        });
        assert.equal(result.code, 404);
        assert.ok(requests.length > 0);
        assertHitHost(requests, "tang.api.s01s.cn");
        assertNoRemoteUnlockCalls(requests);
    });

    it("吉祥路由到本地模块（酷狗 hash 直查），不再请求远程解锁服务", async () => {
        installAllFailStub();
        const result = await localUnlockSongUrl(12345, "素颜", "许嵩", SongUnlockServer.JIEXIANG, {
            platform: "kugou",
            platformId: "30C94AE2868E63B1058DA7685E0CDF3B",
            duration: 238,
        });
        assert.equal(result.code, 404);
        assert.ok(requests.length > 0);
        assertHitHost(requests, "musicserver.haitangw.cc");
        assertNoRemoteUnlockCalls(requests);
    });

    it("网易云维持现状：走 GD 音乐台直取，不经远程解锁服务", async () => {
        globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            const method = init?.method ?? "GET";
            requests.push({ url, method });
            return buildResponse({ status: 200, text: JSON.stringify({ url: "https://example.com/gd.mp3" }) });
        }) as typeof globalThis.fetch;

        const result = await localUnlockSongUrl(123, "晴天", "周杰伦", SongUnlockServer.NETEASE);

        assert.equal(result.code, 200);
        assert.equal(result.url, "https://example.com/gd.mp3");
        assert.equal(requests.length, 1);
        assert.ok(requests[0].url.includes("music-api.gdstudio.xyz"));
        assertNoRemoteUnlockCalls(requests);
    });

    it("A-05 纵深防御：第三方平台歌曲不按 ID 直查网易云，零请求判死", async () => {
        installAllFailStub();
        for (const platform of ["qqmusic", "kugou"]) {
            requests = [];
            const result = await localUnlockSongUrl(123, "晴天", "周杰伦", SongUnlockServer.NETEASE, {
                platform,
                platformId: "0039MnYb0qxYhV",
                duration: 269,
            });
            assert.equal(result.code, 404, `平台 ${platform} 应被拦截`);
            assert.equal(result.reason, NETEASE_ID_SPACE_REASON);
            assert.equal(requests.length, 0, `平台 ${platform} 不得发起任何上游请求`);
        }
    });

    it("A-05 纵深防御不误伤：网易云自身歌曲带 platform=netease 时仍直查 GD", async () => {
        globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            const method = init?.method ?? "GET";
            requests.push({ url, method });
            return buildResponse({ status: 200, text: JSON.stringify({ url: "https://example.com/gd.mp3" }) });
        }) as typeof globalThis.fetch;

        const result = await localUnlockSongUrl(5257160, "晴天", "周杰伦", SongUnlockServer.NETEASE, {
            platform: "netease",
            platformId: "5257160",
            duration: 269,
        });

        assert.equal(result.code, 200);
        assert.equal(result.url, "https://example.com/gd.mp3");
        assert.equal(requests.length, 1);
        assert.ok(requests[0].url.includes("music-api.gdstudio.xyz"));
    });

    it("未知源保持原判死行为，不发起任何请求", async () => {
        installAllFailStub();
        const result = await localUnlockSongUrl(
            123,
            "晴天",
            "周杰伦",
            "not-a-server" as SongUnlockServer,
        );
        assert.deepEqual(result, { code: 404, url: null });
        assert.equal(requests.length, 0);
    });
});
