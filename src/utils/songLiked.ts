/**
 * 歌曲红心状态的平台维度判定
 *
 * 红心判据按平台分流：
 * - QQ 音乐 / 酷狗：取该平台「我喜欢的音乐」歌单的曲目集合（按平台分桶）；
 * - 网易云：取网易云本地红心缓存，且**仅在当前平台为网易云时**参与判据——
 *   网易云的收藏属于网易云平台，在其它平台的界面上不得参与判据。
 *
 * 本模块是红心判据的唯一真源：歌曲行、播放条、全屏播放器、右键菜单与
 * 原生「喜欢」按钮都从这里取结论，避免某一入口漏带平台维度造成串显。
 *
 * @author Hackerdallas
 */

import type { SongType } from "@/types/main";
import type { ApiPlatform } from "@/types/shared";
import { resolveSongPlatform } from "@/utils/songPlatform";
import { usePlatformStore } from "@/stores/platform";
import { useDataStore } from "@/stores/data";

/** 外部可注入的红心状态读取接口（用于单测与独立环境解耦） */
export interface LikedStoreReader {
  /** 当前选中的音源平台 */
  currentPlatform: ApiPlatform;
  /** 判断第三方平台歌曲是否已喜欢 */
  isLikedSong: (platform: ApiPlatform, songId: number) => boolean;
  /** 判断网易云歌曲是否已喜欢 */
  isNeteaseLiked: (songId: number) => boolean;
}

let customStoreReader: LikedStoreReader | null = null;

/**
 * 设置自定义红心状态读取器（单测与隔离环境使用）
 * @param reader 状态读取器，传 null 恢复默认 Store 机制
 */
export const setLikedStoreReader = (reader: LikedStoreReader | null): void => {
  customStoreReader = reader;
};

/**
 * 纯判据函数：判断歌曲在指定平台上下文与红心集合下是否已红心
 *
 * 核心不串台规则：
 * 1. 目标歌曲为第三方平台（QQ/酷狗）：按该平台的红心集合判定；
 * 2. 目标歌曲为网易云：只有当当前处于网易云平台时才参与判据；若当前处于第三方平台，返回 false（防串显）；
 * 3. 歌曲为空时恒返回 false。
 *
 * @param song 目标歌曲
 * @param currentPlatform 当前应用选中的平台
 * @param isPlatformLiked 第三方平台红心判据回调
 * @param isNeteaseLiked 网易云红心判据回调
 * @returns 是否已红心
 */
export const evaluateSongLiked = (
  song: SongType | null | undefined,
  currentPlatform: ApiPlatform,
  isPlatformLiked: (platform: ApiPlatform, songId: number) => boolean,
  isNeteaseLiked: (songId: number) => boolean,
): boolean => {
  if (!song) return false;
  const platform = resolveSongPlatform(song);
  if (platform !== "netease") {
    return isPlatformLiked(platform, Number(song.id));
  }
  if (currentPlatform !== "netease") return false;
  return isNeteaseLiked(Number(song.id));
};

/** 平台 Store 最小子集契约 */
export interface PlatformStoreSubset {
  currentPlatform: ApiPlatform;
  isLikedSong: (platform: ApiPlatform, songId: number) => boolean;
}

/** 网易云 Data Store 最小子集契约 */
export interface DataStoreSubset {
  isLikeSong: (songId: number) => boolean;
}

/**
 * 判断歌曲在当前平台下是否已红心
 *
 * @param song 歌曲
 * @returns 是否已红心
 */
export const isSongLikedInScope = (song?: SongType | null): boolean => {
  if (!song) return false;
  if (customStoreReader) {
    return evaluateSongLiked(
      song,
      customStoreReader.currentPlatform,
      (plat, id) => customStoreReader!.isLikedSong(plat, id),
      (id) => customStoreReader!.isNeteaseLiked(id),
    );
  }

  const platform = resolveSongPlatform(song);

  let pStore: PlatformStoreSubset | null = null;
  try {
    const glob = globalThis as unknown as { __piniaPlatformStore__?: PlatformStoreSubset };
    if (glob.__piniaPlatformStore__) {
      pStore = glob.__piniaPlatformStore__;
    } else {
      pStore = usePlatformStore();
    }
  } catch {
    pStore = null;
  }

  // 第三方平台：按该平台的红心集合判定
  if (platform !== "netease") {
    return pStore ? pStore.isLikedSong(platform, Number(song.id)) : false;
  }

  // 网易云红心缓存只在网易云平台下参与判据
  if (pStore && pStore.currentPlatform !== "netease") return false;

  // 获取网易云 Data Store
  try {
    const glob = globalThis as unknown as { __piniaDataStore__?: DataStoreSubset };
    if (glob.__piniaDataStore__) {
      return glob.__piniaDataStore__.isLikeSong(Number(song.id));
    }
    return useDataStore().isLikeSong(Number(song.id));
  } catch {
    return false;
  }
};
