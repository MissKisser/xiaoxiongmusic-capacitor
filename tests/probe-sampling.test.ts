/**
 * 音源可用性采样器单测 (probeSampling.ts)
 *
 * 覆盖三块采样判据：
 * 1. 窗口节流：每源每 10 分钟最多记录一条样本
 * 2. 失败优先：窗口内先记录成功、后出现失败时失败覆盖成功
 * 3. 多源独立：各换源源各自维护采样窗口，互不影响
 *
 * 外加失败类别映射：换源服务给出的失败原因与取链异常归入失败类别。
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ProbeSampler,
  PROBE_SAMPLE_WINDOW_MS,
  classifyUnlockError,
  classifyUnlockFailure,
  type ProbeSample,
} from "../src/utils/probeSampling";

/**
 * 构造一条样本
 * @param source 换源源
 * @param success 是否成功
 * @param durationMs 耗时
 * @param failCategory 失败类别
 * @returns 样本
 */
const makeSample = (
  source: ProbeSample["source"],
  success: boolean,
  durationMs = 100,
  failCategory: ProbeSample["failCategory"] = success ? "none" : "other",
): ProbeSample => ({ source, success, durationMs, failCategory });

describe("音源可用性采样器 probeSampling", () => {
  describe("窗口节流", () => {
    it("窗口内的第一条样本：上报", () => {
      const sampler = new ProbeSampler();
      const result = sampler.submit(makeSample("kuwo", true), 1000);
      assert.equal(result.type, "send");
    });

    it("同一源窗口内的第二条样本：跳过", () => {
      const sampler = new ProbeSampler();
      sampler.submit(makeSample("kuwo", true), 1000);
      const result = sampler.submit(makeSample("kuwo", true), 2000);
      assert.equal(result.type, "skip");
      assert.equal(result.type === "skip" ? result.reason : "", "window");
    });

    it("窗口到期后：重新开窗并上报", () => {
      const sampler = new ProbeSampler();
      sampler.submit(makeSample("kuwo", true), 1000);
      const result = sampler.submit(
        makeSample("kuwo", true),
        1000 + PROBE_SAMPLE_WINDOW_MS,
      );
      assert.equal(result.type, "send");
    });

    it("窗口边界前一刻：仍属同一窗口，样本被跳过", () => {
      const sampler = new ProbeSampler();
      sampler.submit(makeSample("kuwo", true), 1000);
      const result = sampler.submit(
        makeSample("kuwo", true),
        1000 + PROBE_SAMPLE_WINDOW_MS - 1,
      );
      assert.equal(result.type, "skip");
    });

    it("窗口内记录的样本可被读取，reset 后清空", () => {
      const sampler = new ProbeSampler();
      sampler.submit(makeSample("kuwo", false, 250, "timeout"), 1000);
      const record = sampler.getRecord("kuwo");
      assert.equal(record?.durationMs, 250);
      assert.equal(record?.failCategory, "timeout");
      sampler.reset();
      assert.equal(sampler.getRecord("kuwo"), undefined);
    });
  });

  describe("失败优先", () => {
    it("窗口内先成功后失败：失败覆盖成功并上报", () => {
      const sampler = new ProbeSampler();
      sampler.submit(makeSample("kuwo", true), 1000);
      const result = sampler.submit(makeSample("kuwo", false, 200, "timeout"), 2000);
      assert.equal(result.type, "send");
      assert.equal(sampler.getRecord("kuwo")?.success, false);
      assert.equal(sampler.getRecord("kuwo")?.failCategory, "timeout");
    });

    it("窗口内先失败后成功：失败保留，成功被跳过", () => {
      const sampler = new ProbeSampler();
      sampler.submit(makeSample("kuwo", false, 200, "url_fail"), 1000);
      const result = sampler.submit(makeSample("kuwo", true), 2000);
      assert.equal(result.type, "skip");
      assert.equal(sampler.getRecord("kuwo")?.success, false);
    });

    it("窗口内连续两次失败：只保留第一条失败", () => {
      const sampler = new ProbeSampler();
      sampler.submit(makeSample("kuwo", false, 200, "search_miss"), 1000);
      const result = sampler.submit(makeSample("kuwo", false, 300, "timeout"), 2000);
      assert.equal(result.type, "skip");
      assert.equal(sampler.getRecord("kuwo")?.failCategory, "search_miss");
    });
  });

  describe("多源独立", () => {
    it("不同源的采样窗口互不影响", () => {
      const sampler = new ProbeSampler();
      sampler.submit(makeSample("kuwo", true), 1000);
      const bodian = sampler.submit(makeSample("bodian", true), 1000);
      const netease = sampler.submit(makeSample("netease", true), 1000);
      const xinghai = sampler.submit(makeSample("xinghai", true), 1000);
      assert.equal(bodian.type, "send");
      assert.equal(netease.type, "send");
      assert.equal(xinghai.type, "send");
    });

    it("一个源的失败不会影响另一个源的成功", () => {
      const sampler = new ProbeSampler();
      sampler.submit(makeSample("kuwo", false, 100, "timeout"), 1000);
      const result = sampler.submit(makeSample("bodian", true), 1000);
      assert.equal(result.type, "send");
      assert.equal(sampler.getRecord("bodian")?.success, true);
    });
  });

  describe("失败类别映射 classifyUnlockFailure", () => {
    it("已登记的失败原因：归入对应类别", () => {
      assert.equal(classifyUnlockFailure("该源未检索到候选歌曲"), "search_miss");
      assert.equal(
        classifyUnlockFailure("候选未通过歌名/歌手/时长校验"),
        "verify_fail",
      );
      assert.equal(classifyUnlockFailure("候选未取到可用直链"), "url_fail");
      assert.equal(
        classifyUnlockFailure("该曲在此源仅提供试听片段，无完整版权资源"),
        "url_fail",
      );
      assert.equal(classifyUnlockFailure("上游检索服务不可用"), "other");
    });

    it("未登记或缺失的失败原因：归入 other", () => {
      assert.equal(classifyUnlockFailure("未知原因"), "other");
      assert.equal(classifyUnlockFailure(undefined), "other");
      assert.equal(classifyUnlockFailure(""), "other");
    });
  });

  describe("异常类别映射 classifyUnlockError", () => {
    it("超时类错误码：归入 timeout", () => {
      assert.equal(classifyUnlockError({ code: "ECONNABORTED" }), "timeout");
      assert.equal(classifyUnlockError({ code: "ETIMEDOUT" }), "timeout");
    });

    it("含超时字样的错误信息：归入 timeout", () => {
      assert.equal(classifyUnlockError(new Error("request timeout")), "timeout");
      assert.equal(classifyUnlockError(new Error("请求超时")), "timeout");
    });

    it("其余异常：归入 other", () => {
      assert.equal(classifyUnlockError(new Error("boom")), "other");
      assert.equal(classifyUnlockError(undefined), "other");
    });
  });
});
