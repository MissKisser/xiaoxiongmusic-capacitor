/**
 * 耳机拔出暂停策略测试 (audioFocusPolicy.ts)
 *
 * 职责边界说明：系统音频焦点的唯一持有者是 WebView 内部的媒体会话（Chromium MediaSession），
 * 来电/他人抢占的暂停、通知类抢占的压低音量、焦点回归后的按需恢复均由其原生仲裁，
 * WebView 侧状态机仅剩耳机拔出（ACTION_AUDIO_BECOMING_NOISY）事件需要处理。
 *
 * 覆盖：
 * 1. 耳机拔出（becomingNoisy）→ 播放中暂停且不自动恢复
 * 2. 未在播放时收到事件 → 不产生动作
 * 3. 重复事件 → 每次独立决策，不残留状态
 *
 * @author Hackerdallas
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AudioFocusPolicy } from "../src/core/player/audioFocusPolicy";

describe("耳机拔出暂停策略 AudioFocusPolicy", () => {
  it("becomingNoisy：播放中暂停，且不产生自动恢复资格", () => {
    const policy = new AudioFocusPolicy();

    const actions = policy.handleEvent("becomingNoisy", true);
    assert.deepEqual(actions, [{ type: "pause" }]);

    // 暂停由用户/媒体会话恢复，策略自身不产生 resume 动作
    const againActions = policy.handleEvent("becomingNoisy", false);
    assert.deepEqual(againActions, []);
  });

  it("becomingNoisy 时未在播放：不产生动作", () => {
    const policy = new AudioFocusPolicy();
    assert.deepEqual(policy.handleEvent("becomingNoisy", false), []);
  });

  it("重复 becomingNoisy：每次独立决策，不残留状态", () => {
    const policy = new AudioFocusPolicy();

    assert.deepEqual(policy.handleEvent("becomingNoisy", true), [{ type: "pause" }]);
    // 播放已暂停后再次拔出（如切换输出设备）不应重复暂停
    assert.deepEqual(policy.handleEvent("becomingNoisy", false), []);
    // 用户恢复播放后再次拔出仍需暂停
    assert.deepEqual(policy.handleEvent("becomingNoisy", true), [{ type: "pause" }]);
  });
});
