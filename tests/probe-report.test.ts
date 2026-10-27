/**
 * 音源可用性上报单测 (probeReport.ts)
 *
 * 覆盖三块上报判据：
 * 1. 上报载荷只含四个字段（源 / 成败 / 耗时 / 失败类别），不含歌名与任何身份信息
 * 2. 采样窗口内不重复发请求（节流在采样器内生效）
 * 3. 上报失败静默：不抛异常、不重试
 *
 * 全程用桩件替换全局 fetch：只验证请求形状，不发起真实网络请求。
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

/** 记录到的上报请求 */
type CapturedRequest = {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  credentials?: RequestCredentials;
  body?: string;
};

/** fetch 桩件状态 */
const state = {
  requests: [] as CapturedRequest[],
  /** 桩件响应状态码 */
  status: 200,
  /** 桩件是否抛出异常 */
  throws: false,
};

/** 原始 fetch 引用 */
const originalFetch = globalThis.fetch;

/**
 * 替换全局 fetch 为记录型桩件
 */
const installFetchStub = (): void => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (state.throws) throw new Error("network down");
    state.requests.push({
      url: String(input),
      method: init?.method,
      headers: init?.headers as Record<string, string> | undefined,
      credentials: init?.credentials,
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    return {
      ok: state.status >= 200 && state.status < 300,
      status: state.status,
    } as Response;
  }) as typeof globalThis.fetch;
};

/** 等待上报请求写出（上报为异步发出） */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

describe("音源可用性上报 probeReport", () => {
  beforeEach(() => {
    state.requests = [];
    state.status = 200;
    state.throws = false;
    installFetchStub();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("上报载荷只含四个字段，不含歌名与身份信息", async () => {
    const { reportUnlockProbe } = await import("../src/utils/probeReport");
    reportUnlockProbe({
      source: "kuwo",
      success: false,
      durationMs: 1234,
      failCategory: "timeout",
    });
    await flush();

    assert.equal(state.requests.length, 1);
    const payload = JSON.parse(state.requests[0].body ?? "{}");
    assert.deepEqual(Object.keys(payload).sort(), [
      "durationMs",
      "failCategory",
      "source",
      "success",
    ]);
    assert.equal(payload.source, "kuwo");
    assert.equal(payload.success, false);
    assert.equal(payload.durationMs, 1234);
    assert.equal(payload.failCategory, "timeout");
  });

  it("成功样本的失败类别恒为 none", async () => {
    const { reportUnlockProbe } = await import("../src/utils/probeReport");
    reportUnlockProbe({
      source: "bodian",
      success: true,
      durationMs: 88,
      failCategory: "none",
    });
    await flush();

    assert.equal(state.requests.length, 1);
    const payload = JSON.parse(state.requests[0].body ?? "{}");
    assert.equal(payload.failCategory, "none");
  });

  it("请求不携带凭证（credentials 为 omit）", async () => {
    const { reportUnlockProbe } = await import("../src/utils/probeReport");
    reportUnlockProbe({
      source: "netease",
      success: true,
      durationMs: 50,
      failCategory: "none",
    });
    await flush();

    assert.equal(state.requests[0].credentials, "omit");
  });

  it("上报失败静默：不抛异常，也不重试", async () => {
    const { reportUnlockProbe } = await import("../src/utils/probeReport");
    state.throws = true;
    assert.doesNotThrow(() => {
      reportUnlockProbe({
        source: "migu",
        success: false,
        durationMs: 10,
        failCategory: "other",
      });
    });
    await flush();
    assert.equal(state.requests.length, 0);
  });

  it("服务端返回失败状态时只发一次请求，不重试", async () => {
    const { reportUnlockProbe } = await import("../src/utils/probeReport");
    state.status = 500;
    reportUnlockProbe({
      source: "changqing",
      success: false,
      durationMs: 10,
      failCategory: "other",
    });
    await flush();
    assert.equal(state.requests.length, 1);
  });
});
