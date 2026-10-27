/**
 * 换源解锁链的可用性上报
 *
 * 上报内容只有四个字段（源 / 成败 / 耗时 / 失败类别），不含歌名、不含用户标识、
 * 不含任何可回溯到具体歌曲的内容；上报失败只写控制台，不影响播放，也不重试。
 *
 * 采样节流与失败优先的判定见 `@/utils/probeSampling`（纯逻辑，可单独验证）。
 */
import { ProbeSampler, type ProbeSample } from "./probeSampling";
import { API_BASE_URL } from "@/utils/apiBase";

/** 上报接口地址 */
const PROBE_REPORT_URL = `${API_BASE_URL}/api/probe/report`;

/** 全局采样器：各换源源各自独立的采样窗口 */
const sampler = new ProbeSampler();

/**
 * 上报一条换源结果
 *
 * 由采样器判定是否需要上报（每源每 10 分钟最多记录一条，失败优先），
 * 上报请求异步发出，不阻塞播放链路。
 * @param sample 换源结果样本
 */
export const reportUnlockProbe = (sample: ProbeSample): void => {
  try {
    const decision = sampler.submit(sample, Date.now());
    if (decision.type !== "send") return;
    void sendProbeSample(decision.sample);
  } catch (error) {
    console.warn("⚠️ 音源可用性采样上报异常:", error);
  }
};

/**
 * 发送上报请求
 *
 * 失败只写控制台：上报不可用不应影响播放，也不做重试。
 * @param sample 换源结果样本
 */
const sendProbeSample = async (sample: ProbeSample): Promise<void> => {
  try {
    const response = await fetch(PROBE_REPORT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "omit",
      body: JSON.stringify({
        source: sample.source,
        success: sample.success,
        durationMs: sample.durationMs,
        failCategory: sample.success ? "none" : sample.failCategory,
      }),
    });
    if (!response.ok) {
      console.warn(`⚠️ 音源可用性采样上报未成功：${response.status}`);
    }
  } catch (error) {
    console.warn("⚠️ 音源可用性采样上报失败:", error);
  }
};
