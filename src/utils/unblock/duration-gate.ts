/**
 * 胜者终审：换源胜出候选的同名异版闸门
 *
 * 三重校验与长青/落雪源内闸使用的动态容差（max(8, 6%)）对中长曲偏宽，
 * 同名同歌手异版（Live/DJ/伴奏等）只要元数据时长落在容差内仍可能胜出。
 * 本闸门对「元数据时长偏差超过固定终审容差」的灰区候选追加一次直链真实
 * 音频时长探测：真实时长同样超差才判定疑似同名异版并拒绝，交由竞速编排
 * 让位次胜者；直链读不出真实时长时按不可信拒绝。目标曲未声明时长或候选
 * 不携带元数据时长时无从比对，维持放行。
 */
import { probeAudio } from "./audio-probe";
import { unblockLog } from "./http";
import type { SongUrlResult } from "./types";

/**
 * 终审容差（秒）
 *
 * 固定值，窄于 durationSimilarity 的动态容差：正常跨平台元数据标注偏差
 * 普遍在 5 秒内，而典型同名异版（如现场版/并四版对原曲）偏差可达 8 秒级。
 */
export const DURATION_GATE_TOLERANCE_S = 5;

/** 真实时长同样超差时的拒绝原因（用户可读） */
export const DURATION_GATE_DEVIATION_REASON = "候选时长与原曲偏差过大，疑似同名异版";

/** 直链读不出真实时长时的拒绝原因（用户可读） */
export const DURATION_GATE_PROBE_FAIL_REASON = "未能读出真实音频时长";

/** 终审入参 */
export interface DurationGateInput {
    /** 目标曲声明时长（秒）；缺省视为无从比对 */
    targetDuration?: number;
    /** 胜出候选的元数据时长（秒）；缺省视为无从比对 */
    matchedDuration?: number;
    /** 音频直链 */
    url: string | null;
    /** 直链探测请求头 */
    headers?: Record<string, string>;
}

/** 终审结论 */
export interface DurationGateOutcome {
    /** true 时维持成功结果，false 时应拒绝该候选 */
    pass: boolean;
    /** 拒绝原因（pass 为 false 时给出） */
    reason?: string;
    /** 本次是否实际执行了真实时长探测 */
    probed: boolean;
}

const isValidSeconds = (value: number | null | undefined): value is number =>
    typeof value === "number" && Number.isFinite(value) && value > 0;

/**
 * 对换源胜出候选执行真实音频时长终审
 *
 * @param input 目标时长、候选元数据时长与直链
 * @param probe 直链真实时长探测函数，默认读音频头部解析
 * @returns 终审结论
 */
export const finalizeDurationGate = async (
    input: DurationGateInput,
    probe: (url: string, headers?: Record<string, string>) => Promise<{ durationSec: number | null }> = probeAudio,
): Promise<DurationGateOutcome> => {
    const { targetDuration, matchedDuration, url } = input;
    if (!url) return { pass: true, probed: false };
    if (!isValidSeconds(targetDuration) || !isValidSeconds(matchedDuration)) {
        return { pass: true, probed: false };
    }
    if (Math.abs(matchedDuration - targetDuration) <= DURATION_GATE_TOLERANCE_S) {
        return { pass: true, probed: false };
    }
    const probed = await probe(url, input.headers);
    if (!isValidSeconds(probed.durationSec)) {
        return { pass: false, reason: DURATION_GATE_PROBE_FAIL_REASON, probed: true };
    }
    if (Math.abs(probed.durationSec - targetDuration) > DURATION_GATE_TOLERANCE_S) {
        return { pass: false, reason: DURATION_GATE_DEVIATION_REASON, probed: true };
    }
    return { pass: true, probed: true };
};

/**
 * 对检索类源的成功取链结果执行胜者终审
 *
 * 长青/落雪在源内已有真实音频时长闸门，不在终审范围内。
 * @param result 检索类源的取链结果
 * @param targetDuration 目标曲声明时长（秒）
 * @param sourceName 源名称（日志用）
 * @returns 终审后的取链结果
 */
export const gateSearchResult = async (
    result: SongUrlResult,
    targetDuration: number | undefined,
    sourceName: string,
): Promise<SongUrlResult> => {
    if (result.code !== 200 || !result.url) return result;
    const gate = await finalizeDurationGate({
        targetDuration,
        matchedDuration: result.matchedDuration,
        url: result.url,
    });
    if (gate.pass) return result;
    unblockLog.warn(`⚠️ ${sourceName} 胜者终审拒绝: ${gate.reason}`);
    return { code: 404, url: null, reason: gate.reason };
};
