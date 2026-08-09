/**
 * 下一首歌曲预载服务
 *
 * Based on SPlayer-Next
 * Copyright (C) 2024 SPlayer-Dev
 * Licensed under AGPL-3.0
 *
 * 从 SPlayer-Next 的 `src/services/nextTrackPreloader.ts` 移植并适配到 capacitor 端。
 * 当前实现聚焦「封面预载」：提前解码下一首的封面图片，利用浏览器图片解码缓存，
 * 使切歌时封面即时显示，提升在线播放体验。零副作用、不发起音源请求。
 */
import { useDataStore, useStatusStore } from "@/stores";

let pendingCover: HTMLImageElement | null = null;
let currentToken = 0;

/**
 * 提前解码封面图片，仅利用浏览器渲染缓存
 * @param url 封面 URL
 */
const preloadCover = async (url: string): Promise<void> => {
  if (!url) return;
  if (pendingCover) pendingCover.src = "";
  const token = currentToken;
  const image = new Image();
  pendingCover = image;
  try {
    image.decoding = "async";
    image.src = url;
    await image.decode();
  } catch {
    // 忽略解码失败（网络异常或跨域），不影响主流程
  } finally {
    if (pendingCover === image && token === currentToken) {
      pendingCover = null;
    }
  }
};

/**
 * 计算下一首候选歌曲
 * 仅处理顺序/列表循环，随机与单曲循环时返回 null（随机无法预知，单曲无"下一首"）。
 */
const getNextCandidate = (): { id: number; cover: string | undefined } | null => {
  const dataStore = useDataStore();
  const statusStore = useStatusStore();
  const list = dataStore.playList;
  const index = statusStore.playIndex;
  if (!list?.length || index < 0 || index >= list.length) return null;
  // 单曲循环无"下一首"；随机模式无法预知下一首，均不预载
  if (statusStore.repeatMode === "one") return null;
  if (statusStore.shuffleMode !== "off") return null;
  const nextIndex = (index + 1) % list.length;
  if (nextIndex === index) return null;
  const next = list[nextIndex];
  if (!next || !next.id) return null;
  // 取封面：优先 coverSize.s（最小尺寸即可满足解码缓存），其次 cover
  const cover = next.coverSize?.s || next.coverSize?.m || next.cover || undefined;
  return { id: next.id, cover };
};

/**
 * 调度下一首预载任务（播放索引变化时调用）
 */
export const scheduleNextTrackPreload = (): void => {
  currentToken++;
  if (pendingCover) {
    pendingCover.src = "";
    pendingCover = null;
  }
  const candidate = getNextCandidate();
  if (!candidate || !candidate.cover) return;
  void preloadCover(candidate.cover);
};
