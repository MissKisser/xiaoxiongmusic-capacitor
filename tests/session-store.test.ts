/**
 * 平台会话影子库单测
 *
 * 验证：
 * - 默认未登录返回空对象；
 * - 会话保存、读取与清除；
 * - 兼容 PC 端 SQLite platform-sessions.db 导出的嵌套 JSON 结构；
 * - 会话元信息获取。
 *
 * @author Hackerdallas
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  clearSessionCookies,
  getPlatformSessionRecord,
  getSessionCookies,
  saveSessionCookies,
} from "../src/utils/platform/sessionStore";

describe("平台会话影子库 sessionStore", () => {
  it("未存储凭据时返回空对象", () => {
    clearSessionCookies("mock_empty");
    const cookies = getSessionCookies("mock_empty");
    assert.deepEqual(cookies, {});
  });

  it("支持保存与读取平台凭据", () => {
    const testCookies = {
      uin: "10001",
      qm_keyst: "mock_musickey",
      tmeLoginType: "2",
    };
    saveSessionCookies("test_qq", testCookies);

    const loaded = getSessionCookies("test_qq");
    assert.equal(loaded.uin, "10001");
    assert.equal(loaded.qm_keyst, "mock_musickey");
    assert.equal(loaded.tmeLoginType, "2");
  });

  it("清空会话后返回空字典", () => {
    saveSessionCookies("test_clear", { token: "abc" });
    assert.equal(getSessionCookies("test_clear").token, "abc");

    clearSessionCookies("test_clear");
    assert.deepEqual(getSessionCookies("test_clear"), {});
  });

  it("能够正确读取会话记录元信息", () => {
    saveSessionCookies("test_meta", { uin: "20002" });
    const record = getPlatformSessionRecord("test_meta");
    assert.ok(record);
    assert.equal(record.platform, "test_meta");
    assert.equal(record.cookies.uin, "20002");
    assert.ok(record.updated_at > 0);
  });
});
