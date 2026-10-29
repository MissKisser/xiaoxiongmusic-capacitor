/**
 * 换源解锁链的可用性采样
 *
 * 采样规则（各换源源分别独立计时）：
 * 1. 每源每 10 分钟最多记录 1 条样本，窗口内已有样本时后续样本被跳过；
 * 2. 失败优先：窗口内先记录成功、随后出现失败时，失败覆盖成功（失败才有诊断价值）；
 * 3. 样本只含「源 / 成败 / 耗时 / 失败类别」四个字段，不含歌名与任何身份信息。
 *
 * 本模块只放纯逻辑，不依赖 store 与浏览器 API，可被 Node 脚本直接调用验证。
 */

/** 可上报的换源源（与服务端契约枚举一致） */
export type ProbeSource =
  | "kuwo"
  | "bodian"
  | "netease"
  | "migu"
  | "changqing"
  | "lxmusic"
  | "xinghai"
  | "fish"
  | "jiexiang"
  | "gequbao";

/** 失败类别（与服务端契约枚举一致） */
export type ProbeFailCategory =
  | "none"
  | "timeout"
  | "search_miss"
  | "verify_fail"
  | "url_fail"
  | "audio_fail"
  | "other";

/** 一条可用性样本（上报载荷的全部内容） */
export type ProbeSample = {
  /** 换源源 */
  source: ProbeSource;
  /** 本次取链是否成功 */
  success: boolean;
  /** 本次取链耗时（毫秒） */
  durationMs: number;
  /** 失败类别（成功时恒为 none） */
  failCategory: ProbeFailCategory;
};

/** 样本提交结果 */
export type ProbeSubmitResult =
  | { type: "send"; sample: ProbeSample }
  | { type: "skip"; reason: "window" };

/** 采样窗口长度（毫秒）：每源每 10 分钟最多记录 1 条样本 */
export const PROBE_SAMPLE_WINDOW_MS = 10 * 60 * 1000;

/** 单个源的采样窗口状态 */
type SourceWindow = {
  /** 窗口起始时间戳（毫秒） */
  windowStart: number;
  /** 窗口内记录的样本 */
  record: ProbeSample;
};

/**
 * 可用性采样器
 *
 * 各源各自维护独立的窗口，互不影响；窗口到期后自动开新窗口。
 */
export class ProbeSampler {
  /** 窗口长度（毫秒） */
  private readonly windowMs: number;
  /** 各源当前的采样窗口 */
  private readonly windows = new Map<ProbeSource, SourceWindow>();

  /**
   * 创建采样器
   * @param options 采样配置
   */
  constructor(options: { windowMs?: number } = {}) {
    this.windowMs = options.windowMs ?? PROBE_SAMPLE_WINDOW_MS;
  }

  /**
   * 提交一条源内样本
   *
   * 窗口内已有样本时：已有失败样本则直接跳过；已有成功样本时，新的成功被跳过，
   * 新的失败覆盖成功样本（失败优先）。
   * @param sample 样本
   * @param now 当前时间戳（毫秒）
   * @returns 是否需要上报
   */
  public submit(sample: ProbeSample, now: number): ProbeSubmitResult {
    const current = this.windows.get(sample.source);
    // 无窗口或窗口已过期：开新窗口并记录
    if (!current || now - current.windowStart >= this.windowMs) {
      this.windows.set(sample.source, { windowStart: now, record: sample });
      return { type: "send", sample };
    }
    // 窗口内已有失败样本：失败优先，不再替换
    if (!current.record.success) return { type: "skip", reason: "window" };
    // 窗口内已有成功样本：新的成功跳过
    if (sample.success) return { type: "skip", reason: "window" };
    // 窗口内已有成功样本且新样本为失败：失败覆盖成功
    current.record = sample;
    return { type: "send", sample };
  }

  /**
   * 读取某源窗口内记录的样本
   * @param source 换源源
   * @returns 窗口内记录的样本，未记录时为 undefined
   */
  public getRecord(source: ProbeSource): ProbeSample | undefined {
    return this.windows.get(source)?.record;
  }

  /**
   * 清空全部采样窗口
   */
  public reset(): void {
    this.windows.clear();
  }
}

/**
 * 换源服务返回的失败原因 → 上报失败类别
 *
 * 失败原因由主进程的换源服务给出，键为原因原文；未登记的原因一律归入 other。
 */
const FAIL_CATEGORY_BY_REASON: Record<string, ProbeFailCategory> = {
  /** 该源未检索到候选歌曲 */
  "该源未检索到候选歌曲": "search_miss",
  /** 候选未通过歌名/歌手/时长校验 */
  "候选未通过歌名/歌手/时长校验": "verify_fail",
  /** 候选未取到可用直链（含直链体积校验未通过的候选） */
  "候选未取到可用直链": "url_fail",
  /** 该曲在此源仅提供试听片段，无完整版权资源 */
  "该曲在此源仅提供试听片段，无完整版权资源": "url_fail",
  /** 上游检索服务不可用 */
  "上游检索服务不可用": "other",
  /** 缺少歌名信息，无法安全换源 */
  "缺少歌名信息，无法安全换源": "other",
  /** 缺少歌手信息，无法安全换源 */
  "缺少歌手信息，无法安全换源": "other",
};

/**
 * 把换源服务给出的失败原因归入失败类别
 * @param reason 失败原因原文
 * @returns 失败类别，取不到原因时为 other
 */
export const classifyUnlockFailure = (reason?: string): ProbeFailCategory => {
  if (!reason) return "other";
  return FAIL_CATEGORY_BY_REASON[reason] ?? "other";
};

/**
 * 把取链异常归入失败类别
 *
 * 超时（连接超时 / 响应超时）归入 timeout，其余异常归入 other。
 * @param error 捕获到的异常
 * @returns 失败类别
 */
export const classifyUnlockError = (error: unknown): ProbeFailCategory => {
  const code = (error as { code?: string } | undefined)?.code;
  if (code === "ECONNABORTED" || code === "ETIMEDOUT") return "timeout";
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (message.includes("timeout") || message.includes("超时")) return "timeout";
  return "other";
};
