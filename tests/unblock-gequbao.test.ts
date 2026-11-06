/**
 * 歌曲宝换源打桩单测 (unblock/gequbao.ts)
 *
 * 覆盖七类结论：
 * 1. 成功取链：搜索页 → 详情页二轮校验 → 播放地址 → 体积校验，
 *    详情页与播放地址共用同一会话 cookie，成功结果与服务端一致不带 lengthVerified；
 * 2. 无候选：搜索页无结果时按无候选拒绝；
 * 3. 详情页不可解析：整轮按取链失败拒绝；
 * 4. 播放地址拒绝：业务码非 1 时按取链失败拒绝；
 * 5. 二轮校验失败：详情页给出错误歌手时按校验失败拒绝，不发起取链；
 * 6. 检索全失败：判定为上游不可用；
 * 7. 参数闸门：缺歌手直接拒绝且零上游请求。
 *
 * 上游请求通过替换全局 fetch 打桩（本地 http 封装层在测试环境走 fetch 路径），
 * 不发起真实网络请求。
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import getGequbaoSongUrl from "../src/utils/unblock/gequbao";

/** 捕获到的请求（地址 + 方法 + cookie 头） */
type CapturedRequest = { url: string; method: string; cookie?: string };

/** 捕获到的请求列表 */
const captured: CapturedRequest[] = [];

/** 原始 fetch 引用 */
const originalFetch = globalThis.fetch;

/** 搜索页条目 */
type SearchItem = { id: string; title: string; artist: string };

/** 构造搜索页 HTML（条目结构与站内搜索列表同形） */
const searchHtml = (items: SearchItem[]): string =>
  `<html><body><div class="music-list">${items
    .map(
      (item) =>
        `<a href="/music/${item.id}" class="music-link d-block" title="${item.title} - ${item.artist}">` +
        `<span class="text-primary font-weight-bold">${item.title}</span>` +
        `<small class="text-jade font-weight-bold">${item.artist}</small></a>`,
    )
    .join("")}</div></body></html>`;

/** 构造详情页 HTML（window.appData 为转义后的 JSON 字符串） */
const detailHtml = (data: Record<string, unknown>): string =>
  `<html><body><script>window.appData = JSON.parse('${JSON.stringify(data).replace(/'/g, "\\'")}')</script></body></html>`;

/** 正常详情页数据（时长 04:00 = 240 秒） */
const DETAIL_DATA = {
  play_id: "play-88001",
  mp3_title: "晴天",
  mp3_author: "周杰伦",
  mp3_duration: "04:00",
};

/** 文本响应 */
const textResponse = (body: string): Response =>
  new Response(body, { status: 200, headers: { "content-type": "text/html" } });

/** JSON 响应 */
const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

/** 体积探测响应（HEAD 只读响应头） */
const lengthResponse = (bytes: number): Response =>
  new Response(null, { status: 200, headers: { "content-length": String(bytes) } });

/** 播放地址（体积按 240s@128k 量级给出） */
const AUDIO_URL = "https://dl.gequbao.com/audio/88001.mp3";

/** 桩件路由：按地址分发响应 */
const installFetchStub = (options: {
  searchItems: SearchItem[];
  detail: () => Response;
  playBody: unknown;
  trackBytes?: number;
  searchFails?: boolean;
}): void => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const headers = (init?.headers ?? {}) as Record<string, string>;
    captured.push({ url, method, cookie: headers.cookie });
    if (url.startsWith("https://www.gequbao.com/s/")) {
      if (options.searchFails) throw new TypeError("fetch failed");
      return textResponse(searchHtml(options.searchItems));
    }
    if (url.startsWith("https://www.gequbao.com/music/")) {
      return options.detail();
    }
    if (url.includes("/member/common-play-url")) {
      return jsonResponse(options.playBody);
    }
    return lengthResponse(options.trackBytes ?? 3900000);
  }) as typeof globalThis.fetch;
};

/** 标准桩件配置 */
const standardStub = (overrides: Partial<Parameters<typeof installFetchStub>[0]> = {}) =>
  installFetchStub({
    searchItems: [{ id: "88001", title: "晴天", artist: "周杰伦" }],
    detail: () => textResponse(detailHtml(DETAIL_DATA)),
    playBody: { code: 1, data: { url: AUDIO_URL } },
    trackBytes: 3900000,
    ...overrides,
  });

beforeEach(() => {
  captured.length = 0;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("歌曲宝换源 gequbao", () => {
  it("成功取链：详情页与播放地址共用同一会话 cookie，成功结果不带 lengthVerified", async () => {
    standardStub();
    const result = await getGequbaoSongUrl("晴天 - 周杰伦", 240);

    assert.equal(result.code, 200);
    assert.equal(result.url, AUDIO_URL);
    // 与服务端口径一致：歌曲宝成功结果不携带 lengthVerified 字段
    assert.equal(result.lengthVerified, undefined);
    // 详情页与播放地址共用同一会话 cookie
    const detailRequest = captured.find((item) => item.url.endsWith("/music/88001"));
    const playRequest = captured.find((item) => item.url.includes("/member/common-play-url"));
    assert.ok(detailRequest);
    assert.ok(detailRequest.cookie?.startsWith("server_name_session="));
    assert.ok(playRequest?.cookie);
    assert.equal(playRequest.cookie, detailRequest.cookie);
    // 播放地址为 POST，直链体积探测使用 HEAD
    assert.equal(playRequest.method, "POST");
    assert.ok(
      captured.some((item) => item.url === AUDIO_URL && item.method === "HEAD"),
    );
  });

  it("无候选：搜索页无结果时按无候选拒绝", async () => {
    standardStub({ searchItems: [] });
    const result = await getGequbaoSongUrl("晴天 - 周杰伦", 240);

    assert.equal(result.code, 404);
    assert.equal(result.url, null);
    assert.equal(result.reason, "该源未检索到候选歌曲");
    assert.ok(!captured.some((item) => item.url.includes("/member/common-play-url")));
  });

  it("详情页不可解析：整轮按取链失败拒绝", async () => {
    standardStub({ detail: () => textResponse("<html><body>页面不存在</body></html>") });
    const result = await getGequbaoSongUrl("晴天 - 周杰伦", 240);

    assert.equal(result.code, 404);
    assert.equal(result.url, null);
    assert.equal(result.reason, "候选未取到可用直链");
    assert.ok(!captured.some((item) => item.url.includes("/member/common-play-url")));
  });

  it("播放地址拒绝：业务码非 1 时按取链失败拒绝", async () => {
    standardStub({ playBody: { code: 0, msg: "expired" } });
    const result = await getGequbaoSongUrl("晴天 - 周杰伦", 240);

    assert.equal(result.code, 404);
    assert.equal(result.url, null);
    assert.equal(result.reason, "候选未取到可用直链");
    assert.ok(!captured.some((item) => item.url === AUDIO_URL));
  });

  it("二轮校验失败：详情页给出错误歌手时拒绝，不发起取链", async () => {
    standardStub({
      detail: () =>
        textResponse(detailHtml({ ...DETAIL_DATA, mp3_author: "林俊杰", mp3_title: "晴天" })),
    });
    const result = await getGequbaoSongUrl("晴天 - 周杰伦", 240);

    assert.equal(result.code, 404);
    assert.equal(result.url, null);
    assert.equal(result.reason, "候选未通过歌名/歌手/时长校验");
    assert.ok(!captured.some((item) => item.url.includes("/member/common-play-url")));
  });

  it("检索全失败：判定为上游不可用", async () => {
    standardStub({ searchFails: true });
    const result = await getGequbaoSongUrl("晴天 - 周杰伦", 240);

    assert.equal(result.code, 404);
    assert.equal(result.url, null);
    assert.equal(result.reason, "上游检索服务不可用");
    assert.ok(!captured.some((item) => item.url.includes("/member/common-play-url")));
  });

  it("缺歌手：直接拒绝且零上游请求", async () => {
    standardStub();
    const result = await getGequbaoSongUrl("晴天", 240);

    assert.equal(result.code, 404);
    assert.equal(result.url, null);
    assert.equal(result.reason, "缺少歌手信息，无法安全换源");
    assert.equal(captured.length, 0);
  });

  it("空关键词：直接拒绝", async () => {
    const result = await getGequbaoSongUrl("", 240);

    assert.equal(result.code, 404);
    assert.equal(result.url, null);
    assert.equal(result.reason, "缺少歌名信息，无法安全换源");
  });
});
