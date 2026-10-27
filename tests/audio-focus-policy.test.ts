/**
 * 音频焦点状态机测试 (audioFocusPolicy.ts)
 *
 * 覆盖：
 * 1. 永久抢占（loss）→ 暂停且不自动恢复
 * 2. 暂时抢占（transientLoss）→ 暂停，焦点回归后恢复
 * 3. 焦点回归（gain）→ 仅恢复由焦点事件引起的暂停，手动暂停不被错误恢复
 * 4. 耳机拔出（becomingNoisy）→ 暂停且不自动恢复
 * 5. 可压低抢占（canDuck）→ 压低音量，焦点回归后还原
 *
 * @author Hackerdallas
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AudioFocusPolicy, DUCK_VOLUME_FACTOR } from "../src/core/player/audioFocusPolicy";

describe("音频焦点状态机 AudioFocusPolicy", () => {
  it("永久抢占 loss：播放中暂停，且 gain 回归不自动恢复", () => {
    const policy = new AudioFocusPolicy();

    const lossActions = policy.handleEvent("loss", true, 0.8);
    assert.deepEqual(lossActions, [{ type: "pause" }]);

    // 永久抢占后焦点回归：不应自动恢复，需用户手动继续
    const gainActions = policy.handleEvent("gain", false, 0.8);
    assert.deepEqual(gainActions, []);
  });

  it("暂时抢占 transientLoss：播放中暂停，gain 回归后恢复", () => {
    const policy = new AudioFocusPolicy();

    const lossActions = policy.handleEvent("transientLoss", true, 0.8);
    assert.deepEqual(lossActions, [{ type: "pause" }]);

    // 焦点回归：恢复播放
    const gainActions = policy.handleEvent("gain", false, 0.8);
    assert.deepEqual(gainActions, [{ type: "resume" }]);
  });

  it("暂时抢占时未在播放：不产生任何动作，gain 回归也不恢复", () => {
    const policy = new AudioFocusPolicy();

    const lossActions = policy.handleEvent("transientLoss", false, 0.8);
    assert.deepEqual(lossActions, []);

    const gainActions = policy.handleEvent("gain", false, 0.8);
    assert.deepEqual(gainActions, []);
  });

  it("gain 恢复限定来源：手动暂停后 gain 不恢复，手动播放后 gain 也不重复恢复", () => {
    const policy = new AudioFocusPolicy();

    // 来电暂停（自动）
    assert.deepEqual(policy.handleEvent("transientLoss", true, 0.8), [{ type: "pause" }]);

    // 用户手动暂停（清除自动恢复资格）
    policy.onUserPause();
    assert.deepEqual(policy.handleEvent("gain", false, 0.8), []);

    // 再来一次：来电暂停后用户手动恢复播放（通话中强行播放）
    assert.deepEqual(policy.handleEvent("transientLoss", true, 0.8), [{ type: "pause" }]);
    policy.onUserPlay();
    assert.deepEqual(policy.handleEvent("gain", false, 0.8), []);
  });

  it("恢复资格对照：焦点代劳的暂停 gain 恢复，用户手动暂停 gain 不恢复", () => {
    // 场景 A：焦点事件引起的暂停 → 焦点回归恢复
    const focusPaused = new AudioFocusPolicy();
    assert.deepEqual(focusPaused.handleEvent("transientLoss", true, 0.8), [{ type: "pause" }]);
    assert.deepEqual(focusPaused.handleEvent("gain", false, 0.8), [{ type: "resume" }]);

    // 场景 B：来电暂停后用户又手动暂停 → 焦点回归不得顶掉用户意图
    const userPaused = new AudioFocusPolicy();
    assert.deepEqual(userPaused.handleEvent("transientLoss", true, 0.8), [{ type: "pause" }]);
    userPaused.onUserPause();
    assert.deepEqual(userPaused.handleEvent("gain", false, 0.8), []);
  });

  it("耳机拔出 becomingNoisy：播放中暂停，且 gain 回归不自动恢复", () => {
    const policy = new AudioFocusPolicy();

    const actions = policy.handleEvent("becomingNoisy", true, 0.8);
    assert.deepEqual(actions, [{ type: "pause" }]);

    const gainActions = policy.handleEvent("gain", false, 0.8);
    assert.deepEqual(gainActions, []);
  });

  it("耳机拔出时未在播放：不产生动作", () => {
    const policy = new AudioFocusPolicy();
    assert.deepEqual(policy.handleEvent("becomingNoisy", false, 0.8), []);
  });

  it("可压低抢占 canDuck：播放中压低音量，gain 回归后还原且不重复恢复", () => {
    const policy = new AudioFocusPolicy();

    const duckActions = policy.handleEvent("canDuck", true, 0.6);
    assert.equal(duckActions.length, 1);
    assert.equal(duckActions[0].type, "duck");
    assert.ok(Math.abs((duckActions[0] as { volume: number }).volume - 0.6 * DUCK_VOLUME_FACTOR) < 1e-9);

    // 焦点回归：还原音量；因未暂停，不应产生 resume
    const gainActions = policy.handleEvent("gain", true, 0.6);
    assert.deepEqual(gainActions, [{ type: "unduck", volume: 0.6 }]);
  });

  it("可压低抢占时未在播放：不产生动作", () => {
    const policy = new AudioFocusPolicy();
    assert.deepEqual(policy.handleEvent("canDuck", false, 0.6), []);
    assert.deepEqual(policy.handleEvent("gain", false, 0.6), []);
  });

  it("压低状态下来电抢占：仅暂停，gain 回归后一并还原音量并恢复", () => {
    const policy = new AudioFocusPolicy();

    assert.equal(policy.handleEvent("canDuck", true, 0.5)[0].type, "duck");

    // 暂时抢占到达：暂停（音量还原推迟到恢复时一并执行）
    const lossActions = policy.handleEvent("transientLoss", true, 0.5);
    assert.deepEqual(lossActions, [{ type: "pause" }]);

    // 焦点回归：还原音量并恢复播放
    const gainActions = policy.handleEvent("gain", false, 0.5);
    assert.deepEqual(gainActions, [
      { type: "unduck", volume: 0.5 },
      { type: "resume" },
    ]);
  });

  it("连续场景：来电暂停→通话中恢复→挂断 gain 不打断，再播后来电再暂停可恢复", () => {
    const policy = new AudioFocusPolicy();

    // 第一次来电
    assert.deepEqual(policy.handleEvent("transientLoss", true, 0.7), [{ type: "pause" }]);
    // 通话中用户强行播放
    policy.onUserPlay();
    // 挂断来电焦点回归：用户已在播放，不打断也不压低
    assert.deepEqual(policy.handleEvent("gain", true, 0.7), []);

    // 第二次来电：正常暂停并自动恢复
    assert.deepEqual(policy.handleEvent("transientLoss", true, 0.7), [{ type: "pause" }]);
    assert.deepEqual(policy.handleEvent("gain", false, 0.7), [{ type: "resume" }]);
  });
});
