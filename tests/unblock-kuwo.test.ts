/**
 * 酷我换源打桩单测 (unblock/kuwo.ts)
 *
 * 覆盖六类结论：
 * 1. 成功取链：两套索引检索 → 三重校验 → 体积校验通过，回传 lengthVerified；
 * 2. 试听占位资源：上游回低码率 / rid 不一致的占位应答，判为逐曲拒绝（TRIAL_ONLY），
 *    不触发体积探测、不计熔断；
 * 3. 三重校验失败：候选歌手不命中时整轮拒绝（MATCH_FAILED），不发起取链；
 * 4. 体积校验拦截：占位体积的直链被拒，落为取链失败（FETCH_FAILED）；
 * 5. 检索上游全失败：判定为上游不可用（UPSTREAM_UNAVAILABLE）并计熔断失败；
 * 6. 参数与熔断闸门：缺关键词 / 缺歌手直接拒绝，熔断期零上游请求。
 *
 * 上游请求通过替换全局 fetch 打桩（本地 http 封装层在测试环境走 fetch 路径），
 * 不发起真实网络请求。
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import getKuwoSongUrl from "../src/utils/unblock/kuwo";
import { CircuitBreaker } from "../src/utils/unblock/resilience";

/** 捕获到的请求（地址 + 方法） */
type CapturedRequest = { url: string; method: string };

/** 捕获到的请求列表 */
const captured: CapturedRequest[] = [];

/** 原始 fetch 引用 */
const originalFetch = globalThis.fetch;

/** 酷我检索响应体构造器 */
const kuwoSearchBody = (
  songs: Array<{ rid: string; name: string; artist: string; duration: number }>,
) => ({
  content: [
    null,
    {
      musicpage: {
        abslist: songs.map((song) => ({
          MUSICRID: `MUSIC_${song.rid}`,
          SONGNAME: song.name,
          ARTIST: song.artist,
          DURATION: song.duration,
        })),
      },
    },
  ],
});

/** 文本响应 */
const textResponse = (body: string): Response => new Response(body, { status: 200 });

/** JSON 响应 */
const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

/** 体积探测响应（HEAD 只读响应头） */
const lengthResponse = (bytes: number): Response =>
  new Response(null, { status: 200, headers: { "content-length": String(bytes) } });

/** 桩件路由：按地址分发响应；检索失败场景由 searchFails 控制 */
const installFetchStub = (options: {
  candidates: Array<{ rid: string; name: string; artist: string; duration: number }>;
  trackBody: string;
  trackBytes?: number;
  searchFails?: boolean;
}): void => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    captured.push({ url, method });
    if (options.searchFails && url.startsWith("http://search.kuwo.cn/r.s")) {
      throw new TypeError("fetch failed");
    }
    if (url.startsWith("http://search.kuwo.cn/r.s")) {
      return jsonResponse(kuwoSearchBody(options.candidates));
    }
    if (url.startsWith("http://mobi.kuwo.cn/mobi.s")) {
      return textResponse(options.trackBody);
    }
    return lengthResponse(options.trackBytes ?? 3900000);
  }) as typeof globalThis.fetch;
};

/** 构造注入用熔断器（隔离模块级实例的跨用例状态） */
const freshBreaker = (): CircuitBreaker =>
  new CircuitBreaker({ name: "酷我测试", failureThreshold: 3, openDurationMs: 60000 });

/** 正常取链应答（bitrate 128、rid 一致、type 0） */
const NORMAL_TRACK_BODY = [
  "format=mp3",
  "bitrate=128",
  "url=http://audio.kuwo.cn/kuwo-track.mp3",
  "sig=abc",
  "rid=7001",
  "type=0",
  "",
].join("\n");

beforeEach(() => {
  captured.length = 0;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("酷我换源 kuwo", () => {
  it("成功取链：三重校验与体积校验通过，回传直链与 lengthVerified", async () => {
    installFetchStub({
      candidates: [{ rid: "7001", name: "晴天", artist: "周杰伦", duration: 240 }],
      trackBody: NORMAL_TRACK_BODY,
      trackBytes: 3900000,
    });
    const result = await getKuwoSongUrl("晴天 - 周杰伦", 240, freshBreaker());

    assert.equal(result.code, 200);
    assert.equal(result.url, "http://audio.kuwo.cn/kuwo-track.mp3");
    assert.equal(result.lengthVerified, true);
    // 检索与取链都真实发起
    assert.ok(captured.some((item) => item.url.startsWith("http://search.kuwo.cn/r.s")));
    assert.ok(captured.some((item) => item.url.startsWith("http://mobi.kuwo.cn/mobi.s")));
    // 直链体积探测使用 HEAD
    assert.ok(
      captured.some(
        (item) => item.url === "http://audio.kuwo.cn/kuwo-track.mp3" && item.method === "HEAD",
      ),
    );
  });

  it("试听占位资源：低码率且 rid 不一致时判为逐曲拒绝，不触发体积探测", async () => {
    installFetchStub({
      candidates: [{ rid: "7001", name: "晴天", artist: "周杰伦", duration: 240 }],
      trackBody: [
        "format=mp3",
        "bitrate=1",
        "url=http://resource.kuwo.cn/login-listen.mp3",
        "sig=abc",
        "rid=999999",
        "type=8",
        "",
      ].join("\n"),
    });
    const breaker = freshBreaker();
    const result = await getKuwoSongUrl("晴天 - 周杰伦", 240, breaker);

    assert.equal(result.code, 404);
    assert.equal(result.url, null);
    assert.equal(result.reason, "该曲在此源仅提供试听片段，无完整版权资源");
    // 占位直链不做体积探测
    assert.ok(!captured.some((item) => item.url.includes("login-listen")));
    // 逐曲拒绝不计熔断失败
    assert.equal(breaker.currentState, "closed");
  });

  it("三重校验失败：候选歌手不命中时整轮拒绝，不发起取链", async () => {
    installFetchStub({
      candidates: [{ rid: "7001", name: "晴天", artist: "林俊杰", duration: 240 }],
      trackBody: NORMAL_TRACK_BODY,
    });
    const result = await getKuwoSongUrl("晴天 - 周杰伦", 240, freshBreaker());

    assert.equal(result.code, 404);
    assert.equal(result.url, null);
    assert.equal(result.reason, "候选未通过歌名/歌手/时长校验");
    assert.ok(!captured.some((item) => item.url.startsWith("http://mobi.kuwo.cn/mobi.s")));
  });

  it("体积校验拦截：占位体积的直链被拒，落为取链失败", async () => {
    installFetchStub({
      candidates: [{ rid: "7001", name: "晴天", artist: "周杰伦", duration: 240 }],
      trackBody: NORMAL_TRACK_BODY,
      trackBytes: 185336,
    });
    const breaker = freshBreaker();
    const result = await getKuwoSongUrl("晴天 - 周杰伦", 240, breaker);

    assert.equal(result.code, 404);
    assert.equal(result.url, null);
    assert.equal(result.reason, "候选未取到可用直链");
    assert.equal(breaker.currentState, "closed");
  });

  it("检索上游全失败：判定为上游不可用并计入熔断失败", async () => {
    installFetchStub({
      candidates: [],
      trackBody: NORMAL_TRACK_BODY,
      searchFails: true,
    });
    const breaker = freshBreaker();
    const result = await getKuwoSongUrl("晴天 - 周杰伦", 240, breaker);

    assert.equal(result.code, 404);
    assert.equal(result.url, null);
    assert.equal(result.reason, "上游检索服务不可用");
    // 一次换源只计一次熔断失败，未到阈值不熔断
    assert.equal(breaker.currentState, "closed");
  });

  it("熔断期内：直接拒绝且零上游请求", async () => {
    installFetchStub({
      candidates: [{ rid: "7001", name: "晴天", artist: "周杰伦", duration: 240 }],
      trackBody: NORMAL_TRACK_BODY,
    });
    const breaker = freshBreaker();
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();
    assert.equal(breaker.currentState, "open");

    const result = await getKuwoSongUrl("晴天 - 周杰伦", 240, breaker);

    assert.equal(result.code, 404);
    assert.equal(result.url, null);
    assert.equal(result.reason, "上游检索服务不可用");
    assert.equal(captured.length, 0);
  });

  it("缺歌手：直接拒绝且零上游请求", async () => {
    installFetchStub({
      candidates: [{ rid: "7001", name: "晴天", artist: "周杰伦", duration: 240 }],
      trackBody: NORMAL_TRACK_BODY,
    });
    const result = await getKuwoSongUrl("晴天", 240, freshBreaker());

    assert.equal(result.code, 404);
    assert.equal(result.url, null);
    assert.equal(result.reason, "缺少歌手信息，无法安全换源");
    assert.equal(captured.length, 0);
  });

  it("空关键词：直接拒绝", async () => {
    const result = await getKuwoSongUrl("", 240, freshBreaker());

    assert.equal(result.code, 404);
    assert.equal(result.url, null);
    assert.equal(result.reason, "缺少歌名信息，无法安全换源");
  });
});
