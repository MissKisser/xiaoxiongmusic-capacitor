/**
 * AB 循环服务
 *
 * Based on SPlayer-Next
 * Copyright (C) 2024 SPlayer-Dev
 * Licensed under AGPL-3.0
 *
 * 用户在进度条上设两个标记 A、B，播放到 B 自动 seek 回 A
 * - 切歌时自动重置（per-song 状态）
 * - B <= A 视为非法配置，自动 disable
 */
import { useStatusStore } from "@/stores";

/** 设 A 点（毫秒）；自动校验 B 关系，非法则 disable */
export const setABPointA = (positionMs: number): void => {
  const { abLoop } = useStatusStore();
  abLoop.pointA = Math.max(0, Math.floor(positionMs));
  if (abLoop.pointB !== null && abLoop.pointB <= abLoop.pointA) {
    abLoop.enable = false;
  }
};

/** 设 B 点（毫秒）；自动校验 A 关系，非法则 disable */
export const setABPointB = (positionMs: number): void => {
  const { abLoop } = useStatusStore();
  abLoop.pointB = Math.max(0, Math.floor(positionMs));
  if (abLoop.pointA !== null && abLoop.pointB <= abLoop.pointA) {
    abLoop.enable = false;
  }
};

/** 微调 A 点（增量秒，可正可负） */
export const nudgeABPointA = (deltaSec: number): void => {
  const { abLoop } = useStatusStore();
  if (abLoop.pointA === null) return;
  setABPointA(abLoop.pointA + deltaSec * 1000);
};

/** 微调 B 点 */
export const nudgeABPointB = (deltaSec: number): void => {
  const { abLoop } = useStatusStore();
  if (abLoop.pointB === null) return;
  setABPointB(abLoop.pointB + deltaSec * 1000);
};

/** 清除 A 点 */
export const clearABPointA = (): void => {
  const { abLoop } = useStatusStore();
  abLoop.pointA = null;
  abLoop.enable = false;
};

/** 清除 B 点 */
export const clearABPointB = (): void => {
  const { abLoop } = useStatusStore();
  abLoop.pointB = null;
  abLoop.enable = false;
};

/** 启用 / 关闭循环；启用前校验两点存在且 B > A */
export const setABEnabled = (on: boolean): void => {
  const { abLoop } = useStatusStore();
  if (on) {
    if (abLoop.pointA === null || abLoop.pointB === null) return;
    if (abLoop.pointB <= abLoop.pointA) return;
  }
  abLoop.enable = on;
};

/** 切歌时调用：清空两点和启用状态 */
export const resetABLoop = (): void => {
  const { abLoop } = useStatusStore();
  abLoop.enable = false;
  abLoop.pointA = null;
  abLoop.pointB = null;
};

/**
 * 位置事件钩子：到达 B 点跳回 A
 * 由 PlayerController 每次拿到位置时调用
 * @param positionMs 当前播放进度（毫秒）
 * @param seek 跳转回调（由调用方注入，避免本模块反向依赖 PlayerController 造成循环依赖）
 */
export const checkABLoop = (positionMs: number, seek: (timeMs: number) => void): void => {
  const { abLoop } = useStatusStore();
  if (!abLoop.enable) return;
  if (abLoop.pointA === null || abLoop.pointB === null) return;
  if (abLoop.pointB <= abLoop.pointA) return;
  if (positionMs >= abLoop.pointB) {
    seek(abLoop.pointA);
  }
};
