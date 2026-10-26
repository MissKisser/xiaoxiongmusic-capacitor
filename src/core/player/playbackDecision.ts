/**
 * 播放决策树
 *
 * 网易云 / QQ 音乐 / 酷狗音乐共用同一棵树，只有「取官方直链」与「解锁换源」
 * 两个取源动作按平台分派，决策顺序完全一致：
 *
 * 1. 官方完整可播 → 直接播；
 * 2. 否则解锁换源（解锁优先于试听 —— 解锁能拿到完整歌曲，试听只有 60 秒片段）；
 * 3. 解锁全败才考虑官方试听片段（受「播放试听」开关控制）；
 * 4. 再败走本地缓存；
 * 5. 全败返回空。
 *
 * 本模块只做「排步骤」，不碰网络与存储，便于单元级验证。
 *
 * @author Hackerdallas
 */

/** 播放决策步骤 */
export type PlaybackStep =
  /** 官方完整可播直链 */
  | "official"
  /** 解锁换源 */
  | "unlock"
  /** 官方下发的试听片段 */
  | "trial"
  /** 本地缓存兜底 */
  | "cache";

/** 播放决策树入参 */
export interface PlaybackDecisionInput {
  /** 官方直链是否存在 */
  hasOfficialUrl: boolean;
  /** 官方直链是否为官方下发的试听片段 */
  isTrial: boolean;
  /** 是否允许解锁换源 */
  canUnlock: boolean;
  /** 是否允许播放官方试听片段 */
  playSongDemo: boolean;
}

/**
 * 生成播放决策步骤序列
 *
 * 步骤按优先级排列，执行时命中第一步可用来源即返回。
 * @param input 决策入参
 * @returns 步骤序列
 */
export const planPlayback = (input: PlaybackDecisionInput): PlaybackStep[] => {
  const steps: PlaybackStep[] = [];
  // 官方完整可播
  if (input.hasOfficialUrl && !input.isTrial) steps.push("official");
  // 解锁换源
  if (input.canUnlock) steps.push("unlock");
  // 官方试听片段：解锁全败之后的兜底
  if (input.hasOfficialUrl && input.isTrial && input.playSongDemo) steps.push("trial");
  // 本地缓存
  steps.push("cache");
  return steps;
};
