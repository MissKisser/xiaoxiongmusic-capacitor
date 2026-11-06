/**
 * 本地 http 封装层单测 (unblock/http.ts)
 *
 * 上游打桩打在传输底座（globalThis.fetch，node 测试环境走 http.ts 的 fetch 路径）。
 * 覆盖两块判据：
 * 1. JSON 反序列化口径：tryParseJSON 对对象 / 数组 / 标量 / 非 JSON 文本的判定结果，
 *    该口径同时约束 fetch 路径与 Capacitor 原生路径（原生路径对字符串形态的响应体
 *    补做同一套反序列化，避免酷我 text/plain 响应在真机上恒判空）；
 * 2. 通用请求的响应体归一：JSON 文本解析为对象、非 JSON 文本保留字符串。
 */

import "./helpers/setup";
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { tryParseJSON, unblockRequest } from "../src/utils/unblock/http";

/** 原始 fetch 引用 */
const originalFetch = globalThis.fetch;

/**
 * 构造 fetch 桩响应
 * @param init 响应要素（状态码 / 响应头 / 文本体）
 * @returns 形如 Response 的桩对象
 */
const buildResponse = (init: {
    status?: number;
    headers?: Record<string, string>;
    text?: string;
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
        arrayBuffer: async () => new TextEncoder().encode(bodyText).buffer,
    } as unknown as Response;
};

describe("JSON 反序列化口径 tryParseJSON", () => {
    it("对象文本解析为对象", () => {
        assert.deepEqual(tryParseJSON('{"a":1}'), { a: 1 });
    });

    it("数组文本解析为数组", () => {
        assert.deepEqual(tryParseJSON("[1,2,3]"), [1, 2, 3]);
    });

    it("数字文本解析为数值", () => {
        assert.equal(tryParseJSON("42"), 42);
    });

    it("JSON 字符串标量解析为字符串并去引号", () => {
        assert.equal(tryParseJSON('"abc"'), "abc");
    });

    it("非 JSON 文本原样返回", () => {
        assert.equal(tryParseJSON("cid=xxx, version=123"), "cid=xxx, version=123");
    });

    it("空字符串原样返回", () => {
        assert.equal(tryParseJSON(""), "");
    });

    it("残缺 JSON 原样返回", () => {
        assert.equal(tryParseJSON('{"a":1,'), '{"a":1,');
    });
});

describe("通用请求响应体归一 unblockRequest", () => {
    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    it("text/plain 形态的 JSON 响应体仍解析为对象", async () => {
        globalThis.fetch = (async () =>
            buildResponse({
                status: 200,
                headers: { "content-type": "text/plain" },
                text: JSON.stringify({ status: "200", records: [{ rid: "1" }] }),
            })) as typeof globalThis.fetch;

        const response = await unblockRequest({ url: "https://stub.local/search" });
        assert.deepEqual(response.data, { status: "200", records: [{ rid: "1" }] });
    });

    it("application/json 响应体解析为对象", async () => {
        globalThis.fetch = (async () =>
            buildResponse({
                status: 200,
                headers: { "content-type": "application/json;charset=UTF-8" },
                text: JSON.stringify({ code: 0 }),
            })) as typeof globalThis.fetch;

        const response = await unblockRequest({ url: "https://stub.local/api" });
        assert.deepEqual(response.data, { code: 0 });
    });

    it("非 JSON 文本保留为字符串", async () => {
        globalThis.fetch = (async () =>
            buildResponse({
                status: 200,
                headers: { "content-type": "text/plain" },
                text: "plain body",
            })) as typeof globalThis.fetch;

        const response = await unblockRequest({ url: "https://stub.local/plain" });
        assert.equal(response.data, "plain body");
    });
});
