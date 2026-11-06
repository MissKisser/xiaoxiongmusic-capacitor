/**
 * 胜者终审闸门测试
 *
 * 探测函数以参数注入，全部用例离线运行：覆盖无从比对放行、
 * 容差内直放、灰区复核放行/拒绝与探测失败拒绝四类结论。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
    finalizeDurationGate,
    DURATION_GATE_TOLERANCE_S,
    DURATION_GATE_DEVIATION_REASON,
    DURATION_GATE_PROBE_FAIL_REASON,
} from "@/utils/unblock/duration-gate";

/** 注入用的假探测：固定返回给定真实时长 */
const fakeProbe =
    (durationSec: number | null) => async () => ({ durationSec });

test("目标曲未声明时长：无从比对，直接放行且不探测", async () => {
    let called = false;
    const outcome = await finalizeDurationGate(
        { targetDuration: undefined, matchedDuration: 200, url: "https://a/x.mp3" },
        async () => {
            called = true;
            return { durationSec: 100 };
        },
    );
    assert.equal(outcome.pass, true);
    assert.equal(outcome.probed, false);
    assert.equal(called, false);
});

test("候选不携带元数据时长：无从比对，直接放行且不探测", async () => {
    const outcome = await finalizeDurationGate(
        { targetDuration: 213, matchedDuration: undefined, url: "https://a/x.mp3" },
        fakeProbe(100),
    );
    assert.equal(outcome.pass, true);
    assert.equal(outcome.probed, false);
});

test("候选元数据时长在容差内：直接放行且不探测", async () => {
    let called = false;
    const outcome = await finalizeDurationGate(
        { targetDuration: 213, matchedDuration: 213 - DURATION_GATE_TOLERANCE_S, url: "https://a/x.mp3" },
        async () => {
            called = true;
            return { durationSec: 100 };
        },
    );
    assert.equal(outcome.pass, true);
    assert.equal(outcome.probed, false);
    assert.equal(called, false);
});

test("灰区候选真实时长在容差内：放行（元数据只是标注偏差）", async () => {
    const outcome = await finalizeDurationGate(
        { targetDuration: 213, matchedDuration: 220, url: "https://a/x.mp3" },
        fakeProbe(214),
    );
    assert.equal(outcome.pass, true);
    assert.equal(outcome.probed, true);
});

test("灰区候选真实时长超差：判定疑似同名异版并拒绝", async () => {
    const outcome = await finalizeDurationGate(
        { targetDuration: 213, matchedDuration: 205, url: "https://a/x.mp3" },
        fakeProbe(205.14),
    );
    assert.equal(outcome.pass, false);
    assert.equal(outcome.reason, DURATION_GATE_DEVIATION_REASON);
    assert.equal(outcome.probed, true);
});

test("灰区候选探测不出真实时长：按不可信拒绝", async () => {
    const outcome = await finalizeDurationGate(
        { targetDuration: 213, matchedDuration: 205, url: "https://a/x.mp3" },
        fakeProbe(null),
    );
    assert.equal(outcome.pass, false);
    assert.equal(outcome.reason, DURATION_GATE_PROBE_FAIL_REASON);
});

test("无直链：不适用终审，维持放行", async () => {
    const outcome = await finalizeDurationGate(
        { targetDuration: 213, matchedDuration: 205, url: null },
        fakeProbe(100),
    );
    assert.equal(outcome.pass, true);
    assert.equal(outcome.probed, false);
});

test("非正数时长视为缺失：放行且不探测", async () => {
    const zeroTarget = await finalizeDurationGate(
        { targetDuration: 0, matchedDuration: 205, url: "https://a/x.mp3" },
        fakeProbe(100),
    );
    const zeroMatched = await finalizeDurationGate(
        { targetDuration: 213, matchedDuration: 0, url: "https://a/x.mp3" },
        fakeProbe(100),
    );
    assert.equal(zeroTarget.pass, true);
    assert.equal(zeroMatched.pass, true);
});
