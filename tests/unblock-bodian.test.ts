/**
 * 波点换源打桩单测 (unblock/bodian.ts)
 *
 * 覆盖六类结论：
 * 1. 成功取链：免广告请求 + 业务码 200 + 体积校验通过，回传 lengthVerified；
 * 2. 逐曲拒绝（20012 下线）：业务码不计熔断，连续多次仍不熔断；
 * 3. 业务故障码（300 等）：计入熔断，连续三次后整源熔断；
 * 4. 传输层 5xx：判为上游故障，直接放弃本源且不做体积探测；
 * 5. 体积校验拦截：占位体积的直链被拒；
 * 6. 参数闸门：缺歌手直接拒绝且零上游请求。
 *
 * 上游请求通过替换全局 fetch 打桩（本地 http 封装层在测试环境走 fetch 路径），
 * 不发起真实网络请求。
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import getBodianSongUrl from "../src/utils/unblock/bodian";
import { CircuitBreaker } from "../src/utils/unblock/resilience";

/** 捕获到的请求（地址 + 方法） */
type CapturedRequest = { url: string; method: string };

/** 捕获到的请求列表 */
const captured: CapturedRequest[] = [];

/** 原始 fetch 引用 */
const originalFetch = globalThis.fetch;

/** 酷我检索响应体构造器（波点检索共用酷我索引） */
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

/** JSON 响应 */
const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/** 体积探测响应（HEAD 只读响应头） */
const lengthResponse = (bytes: number): Response =>
  new Response(null, { status: 200, headers: { "content-length": String(bytes) } });

/** 波点取链业务响应 */
const CANDIDATES = [{ rid: "7001", name: "晴天", artist: "周杰伦", duration: 240 }];

/** 正常取链业务响应 */
const SUCCESS_PLAY_BODY = {
  code: 200,
  msg: "success",
  data: { audioUrl: "http://mobi.kuwo.cn/bodian-track.mp3" },
};

/** 桩件路由：按地址分发响应 */
const installFetchStub = (options: {
  playBody: unknown;
  playStatus?: number;
  trackBytes?: number;
}): void => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    captured.push({ url, method });
    if (url.startsWith("http://search.kuwo.cn/r.s")) {
      return jsonResponse(kuwoSearchBody(CANDIDATES));
    }
    if (url.includes("/api/service/advert/watch")) {
      return jsonResponse({});
    }
    if (url.includes("/api/play/music/v2/audioUrl")) {
      return jsonResponse(options.playBody, options.playStatus ?? 200);
    }
    return lengthResponse(options.trackBytes ?? 9600000);
  }) as typeof globalThis.fetch;
};

/** 构造注入用熔断器（隔离模块级实例的跨用例状态） */
const freshBreaker = (): CircuitBreaker =>
  new CircuitBreaker({ name: "波点测试", failureThreshold: 3, openDurationMs: 60000 });

beforeEach(() => {
  captured.length = 0;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("波点换源 bodian", () => {
  it("成功取链：免广告请求、业务码 200 与体积校验通过", async () => {
    installFetchStub({ playBody: SUCCESS_PLAY_BODY, trackBytes: 9600000 });
    const result = await getBodianSongUrl("晴天 - 周杰伦", 240, freshBreaker());

    assert.equal(result.code, 200);
    assert.equal(result.url, "http://mobi.kuwo.cn/bodian-track.mp3");
    assert.equal(result.lengthVerified, true);
    // 免广告请求与取链请求都真实发起，取链按候选 rid 寻址
    assert.ok(captured.some((item) => item.url.includes("/api/service/advert/watch")));
    const playRequest = captured.find((item) => item.url.includes("/api/play/music/v2/audioUrl"));
    assert.ok(playRequest);
    assert.ok(playRequest.url.includes("musicId=7001"));
    // 直链体积探测使用 HEAD
    assert.ok(
      captured.some(
        (item) => item.url === "http://mobi.kuwo.cn/bodian-track.mp3" && item.method === "HEAD",
      ),
    );
  });

  it("逐曲拒绝（20012 下线）：不计熔断，连续多次仍不熔断", async () => {
    installFetchStub({ playBody: { code: 20012, msg: "已下线" } });
    const breaker = freshBreaker();
    for (let round = 0; round < 3; round++) {
      const result = await getBodianSongUrl("晴天 - 周杰伦", 240, breaker);
      assert.equal(result.code, 404);
      assert.equal(result.url, null);
      assert.equal(result.reason, "候选未取到可用直链");
    }
    assert.equal(breaker.currentState, "closed");
  });

  it("业务故障码（300）：计入熔断，连续三次后整源熔断", async () => {
    installFetchStub({ playBody: { code: 300, msg: "上游无可用资源" } });
    const breaker = freshBreaker();
    for (let round = 0; round < 3; round++) {
      const result = await getBodianSongUrl("晴天 - 周杰伦", 240, breaker);
      assert.equal(result.code, 404);
      assert.equal(result.reason, "候选未取到可用直链");
    }
    assert.equal(breaker.currentState, "open");
  });

  it("传输层 5xx：判为上游故障，放弃本源且不做体积探测", async () => {
    installFetchStub({ playBody: { code: 200 }, playStatus: 500 });
    const breaker = freshBreaker();
    const result = await getBodianSongUrl("晴天 - 周杰伦", 240, breaker);

    assert.equal(result.code, 404);
    assert.equal(result.url, null);
    assert.equal(result.reason, "候选未取到可用直链");
    assert.ok(!captured.some((item) => item.url.includes("bodian-track.mp3")));
    assert.equal(breaker.currentState, "closed");
  });

  it("体积校验拦截：占位体积的直链被拒", async () => {
    installFetchStub({ playBody: SUCCESS_PLAY_BODY, trackBytes: 185336 });
    const breaker = freshBreaker();
    const result = await getBodianSongUrl("晴天 - 周杰伦", 240, breaker);

    assert.equal(result.code, 404);
    assert.equal(result.url, null);
    assert.equal(result.reason, "候选未取到可用直链");
    assert.equal(breaker.currentState, "closed");
  });

  it("缺歌手：直接拒绝且零上游请求", async () => {
    installFetchStub({ playBody: SUCCESS_PLAY_BODY });
    const result = await getBodianSongUrl("晴天", 240, freshBreaker());

    assert.equal(result.code, 404);
    assert.equal(result.url, null);
    assert.equal(result.reason, "缺少歌手信息，无法安全换源");
    assert.equal(captured.length, 0);
  });

  it("空关键词：直接拒绝", async () => {
    const result = await getBodianSongUrl("", 240, freshBreaker());

    assert.equal(result.code, 404);
    assert.equal(result.url, null);
    assert.equal(result.reason, "缺少歌名信息，无法安全换源");
  });
});
