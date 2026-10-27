/**
 * 远程换源回退单测 (unblock/remote.ts 与 unblock/index.ts 分发)
 *
 * 覆盖四块判据：
 * 1. 远程成功：透传直链与 lengthVerified，请求地址、参数与超时预算和 PC 端解锁链同形态
 * 2. 业务 404：透传服务端给出的失败原因（保住探活上报的失败类别口径）
 * 3. HTTP 层异常（路由缺失 / 5xx / 网络失败 / 响应体不可解析）：归一为「源暂不可用」干净失败
 * 4. 本地四源分发回归：网易云 / 酷我 / 波点 / 歌曲宝仍走端侧直连，不受远程回退影响
 *
 * 远程请求通过注入传输层桩件或替换全局 fetch 验证，不发起真实网络请求。
 */

import "./helpers/setup";
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createPinia, setActivePinia } from "pinia";
import { SongUnlockServer } from "../src/types/shared";
import { localUnlockSongUrl } from "../src/utils/unblock";
import {
  buildRemoteUnlockUrl,
  isRemoteUnlockServer,
  REMOTE_UNLOCK_SERVERS,
  REMOTE_UNLOCK_TIMEOUT,
  requestRemoteUnlock,
  SOURCE_UNAVAILABLE_REASON,
  type UnlockTransport,
} from "../src/utils/unblock/remote";
import { classifyUnlockFailure } from "../src/utils/probeSampling";

/** 构造一个固定响应的传输层桩件，并记录收到的请求地址 */
const transportOf = (
  response: { status: number; body: unknown },
  captured: { urls: string[]; timeouts: number[] } = { urls: [], timeouts: [] },
): UnlockTransport =>
  async (request) => {
    captured.urls.push(request.url);
    captured.timeouts.push(request.timeoutMs);
    return { status: response.status, body: response.body };
  };

/** 构造一个直接抛异常的传输层桩件（模拟网络失败） */
const throwingTransport: UnlockTransport = async () => {
  throw new Error("network down");
};

/** fetch 桩件状态 */
const state = {
  requests: [] as string[],
  status: 200,
  /** 桩件响应体（文本） */
  bodyText: "{}",
  throws: false,
};

/** 原始 fetch 引用 */
const originalFetch = globalThis.fetch;

/** 替换全局 fetch 为记录型桩件 */
const installFetchStub = (): void => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    if (state.throws) throw new Error("network down");
    state.requests.push(String(input));
    return {
      ok: state.status >= 200 && state.status < 300,
      status: state.status,
      headers: new Headers(),
      text: async () => state.bodyText,
    } as Response;
  }) as typeof globalThis.fetch;
};

describe("远程换源回退 unblockRemote", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("成功响应透传直链与 lengthVerified", async () => {
    const result = await requestRemoteUnlock(SongUnlockServer.CHANGQING, {
      keyword: "晴天-周杰伦",
      songName: "晴天",
      artist: "周杰伦",
    }, transportOf({
      status: 200,
      body: { code: 200, url: "https://cdn.example.com/song.flac", lengthVerified: true },
    }));

    assert.deepEqual(result, {
      code: 200,
      url: "https://cdn.example.com/song.flac",
      lengthVerified: true,
    });
  });

  it("请求地址与参数和 PC 端解锁链同形态，可选寻址参数缺省时不携带", () => {
    const url = buildRemoteUnlockUrl(SongUnlockServer.CHANGQING, {
      keyword: "晴天-周杰伦",
      songName: "晴天",
      artist: "周杰伦",
      duration: 269.4,
      platform: "qqmusic",
      platformId: "0039MnYb0qxYhV",
    });
    assert.ok(url.startsWith("https://music.viaxv.top/api/unblock/changqing?"));
    const params = new URL(url).searchParams;
    assert.equal(params.get("keyword"), "晴天-周杰伦");
    assert.equal(params.get("songName"), "晴天");
    assert.equal(params.get("artist"), "周杰伦");
    assert.equal(params.get("duration"), "269");
    assert.equal(params.get("platform"), "qqmusic");
    assert.equal(params.get("platformId"), "0039MnYb0qxYhV");
    assert.equal(params.get("noCookie"), "true");

    const minimalUrl = new URL(buildRemoteUnlockUrl(SongUnlockServer.MIGU, {
      keyword: "晴天-周杰伦",
      songName: "晴天",
      artist: "周杰伦",
    }));
    assert.ok(minimalUrl.pathname.endsWith("/api/unblock/migu"));
    assert.equal(minimalUrl.searchParams.get("duration"), null);
    assert.equal(minimalUrl.searchParams.get("platform"), null);
    assert.equal(minimalUrl.searchParams.get("platformId"), null);
  });

  it("三源超时预算与 PC 端 UNLOCK_TIMEOUT 表一致", async () => {
    assert.deepEqual(REMOTE_UNLOCK_TIMEOUT, {
      [SongUnlockServer.MIGU]: 30000,
      [SongUnlockServer.CHANGQING]: 40000,
      [SongUnlockServer.LXMUSIC]: 20000,
    });

    const captured = { urls: [], timeouts: [] };
    await requestRemoteUnlock(SongUnlockServer.MIGU, {
      keyword: "晴天-周杰伦",
      songName: "晴天",
      artist: "周杰伦",
    }, transportOf({ status: 404, body: "" }, captured));
    assert.deepEqual(captured.timeouts, [30000]);
  });

  it("业务 404 透传服务端失败原因，探活失败类别不劣化", async () => {
    const result = await requestRemoteUnlock(SongUnlockServer.MIGU, {
      keyword: "晴天-周杰伦",
      songName: "晴天",
      artist: "周杰伦",
    }, transportOf({
      status: 200,
      body: { code: 404, url: null, reason: "该源未检索到候选歌曲" },
    }));

    assert.equal(result.code, 404);
    assert.equal(result.url, null);
    assert.equal(result.reason, "该源未检索到候选歌曲");
    assert.equal(classifyUnlockFailure(result.reason), "search_miss");
  });

  it("HTTP 404 / 5xx / 网络失败归一为源暂不可用，失败类别不落入 timeout", async () => {
    const routes = [404, 405, 500, 503] as const;
    for (const status of routes) {
      const result = await requestRemoteUnlock(SongUnlockServer.LXMUSIC, {
        keyword: "晴天-周杰伦",
        songName: "晴天",
        artist: "周杰伦",
      }, transportOf({ status, body: "Route not found" }));
      assert.deepEqual(result, {
        code: 404,
        url: null,
        reason: SOURCE_UNAVAILABLE_REASON,
      });
      assert.equal(classifyUnlockFailure(result.reason), "other");
    }

    const networkFailure = await requestRemoteUnlock(SongUnlockServer.LXMUSIC, {
      keyword: "晴天-周杰伦",
      songName: "晴天",
      artist: "周杰伦",
    }, throwingTransport);
    assert.deepEqual(networkFailure, {
      code: 404,
      url: null,
      reason: SOURCE_UNAVAILABLE_REASON,
    });
  });

  it("HTTP 200 但响应体不可解析时归一为源暂不可用", async () => {
    const result = await requestRemoteUnlock(SongUnlockServer.CHANGQING, {
      keyword: "晴天-周杰伦",
      songName: "晴天",
      artist: "周杰伦",
    }, transportOf({ status: 200, body: "not-json" }));

    assert.deepEqual(result, {
      code: 404,
      url: null,
      reason: SOURCE_UNAVAILABLE_REASON,
    });
  });
});

describe("本地与远程源分发回归 unblockDispatch", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    state.requests = [];
    state.status = 200;
    state.bodyText = "{}";
    state.throws = false;
    installFetchStub();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("本地四源不参与远程回退，远程集合恰为三源", () => {
    assert.deepEqual([...REMOTE_UNLOCK_SERVERS], [
      SongUnlockServer.MIGU,
      SongUnlockServer.CHANGQING,
      SongUnlockServer.LXMUSIC,
    ]);
    for (const server of [
      SongUnlockServer.NETEASE,
      SongUnlockServer.KUWO,
      SongUnlockServer.BODIAN,
      SongUnlockServer.GEQUBAO,
    ]) {
      assert.equal(isRemoteUnlockServer(server), false);
    }
  });

  it("长青源经分发层请求远程服务并透传结果", async () => {
    state.bodyText = JSON.stringify({
      code: 200,
      url: "https://cdn.example.com/changqing.flac",
      lengthVerified: true,
    });

    const result = await localUnlockSongUrl(123, "晴天", "周杰伦", SongUnlockServer.CHANGQING);

    assert.equal(result.code, 200);
    assert.equal(result.url, "https://cdn.example.com/changqing.flac");
    assert.equal(result.lengthVerified, true);
    assert.equal(state.requests.length, 1);
    assert.ok(state.requests[0].includes("https://music.viaxv.top/api/unblock/changqing"));
  });

  it("网易云源仍走本地直连（GD 音乐台），不经远程服务", async () => {
    state.bodyText = JSON.stringify({ url: "https://example.com/gd.mp3" });

    const result = await localUnlockSongUrl(123, "晴天", "周杰伦", SongUnlockServer.NETEASE);

    assert.equal(result.code, 200);
    assert.equal(result.url, "https://example.com/gd.mp3");
    assert.equal(state.requests.length, 1);
    assert.ok(state.requests[0].includes("music-api.gdstudio.xyz"));
    assert.ok(!state.requests[0].includes("music.viaxv.top"));
  });

  it("未知源保持原判死行为，不发起任何远程请求", async () => {
    const result = await localUnlockSongUrl(
      123,
      "晴天",
      "周杰伦",
      "not-a-server" as SongUnlockServer,
    );

    assert.deepEqual(result, { code: 404, url: null });
    assert.equal(state.requests.length, 0);
  });
});
