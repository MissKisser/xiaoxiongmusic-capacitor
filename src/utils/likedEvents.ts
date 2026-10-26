/**
 * 「我喜欢的音乐」红心变更事件
 *
 * 红心（喜欢 / 取消喜欢）写操作成功后广播一次变更，载荷只描述
 * 「哪个平台的哪首歌变成喜欢 / 不喜欢」，不携带任何界面数据。
 *
 * 展示「我喜欢的音乐」的视图订阅该事件后自行做两件事：
 * 1. 立即按变更做乐观更新（曲目出现 / 消失、计数增减）；
 * 2. 在后台做有界重拉，直到上游读到的数据已反映该变更。
 *
 * 事件按平台隔离：QQ 音乐 / 酷狗 / 网易云各自维护自己的「我喜欢的音乐」，
 * 跨平台的事件互不影响。
 *
 * @author Hackerdallas
 */

import type { SongType } from "@/types/main";
import type { ApiPlatform } from "@/types/shared";

/** 红心变更事件载荷 */
export interface LikedSongsChange {
  /** 变更发生的音源平台 */
  platform: ApiPlatform;
  /** 变更的歌曲 */
  song: SongType;
  /** 变更后是否喜欢 */
  liked: boolean;
}

/** 红心变更事件订阅者 */
export type LikedSongsChangeListener = (change: LikedSongsChange) => void;

/** 红心变更事件订阅集合 */
const listeners = new Set<LikedSongsChangeListener>();

/**
 * 广播红心变更事件
 *
 * 单个订阅者抛错不影响其他订阅者，界面不会因一个视图出错而整体失联。
 * @param change 变更内容
 */
export const notifyLikedSongsChanged = (change: LikedSongsChange): void => {
  for (const listener of listeners) {
    try {
      listener(change);
    } catch (error) {
      console.error("红心变更事件处理失败：", error);
    }
  }
};

/**
 * 订阅红心变更事件
 * @param listener 订阅者
 * @returns 取消订阅函数
 */
export const onLikedSongsChanged = (listener: LikedSongsChangeListener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
