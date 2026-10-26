/**
 * 收藏统计条目的唯一真源
 *
 * 收藏页头部与用户菜单展示的是同一份收藏统计，
 * 两处都从这里取条目，避免同一能力出现两套条目与两套计数口径。
 *
 * 计数与落地分组一一对应：
 * - 网易云的「歌单」计数取「我创建的」分组，落地即该分组；
 * - 第三方平台的自建与收藏分成两套目录，计数按目录分别给出，
 *   跳转带上分组参数，落地即对应分组。
 *
 * @author Hackerdallas
 */

import { computed } from "vue";
import { useDataStore, usePlatformStore } from "@/stores";
import { PLATFORM_PLAYLIST_TYPE_QUERY } from "@/api/platform/capability";
import type { CoverType } from "@/types/main";

/** 收藏统计条目 */
export interface LikeStatItem {
  /** 图标名 */
  icon: string;
  /** 文案 */
  label: string;
  /** 跳转路由名 */
  name: string;
  /** 数量 */
  length: number;
  /** 跳转时附带的查询参数 */
  query?: Record<string, string>;
}

/**
 * 网易云收藏歌单分组
 *
 * 与收藏页的歌单分组同口径：按歌单归属人分成「我创建的」与「我收藏的」，
 * 「我喜欢的音乐」是系统歌单，不计入「我创建的」。
 * @returns 两组歌单
 */
const useNeteasePlaylistGroups = () => {
  const dataStore = useDataStore();
  return computed<{ owned: CoverType[]; favorites: CoverType[] }>(() => {
    const userId = dataStore.userData.userId;
    const list = dataStore.userLikeData.playlists ?? [];
    return {
      owned: list.filter((item) => item.userId === userId).slice(1),
      favorites: list.filter((item) => item.userId !== userId),
    };
  });
};

/**
 * 收藏统计条目
 *
 * 收藏页头部与用户菜单共用同一份条目，
 * 两处展示的条目数、计数与落地分组保持一致。
 * @returns 收藏统计条目
 */
export const useLikeStats = () => {
  const dataStore = useDataStore();
  const platformStore = usePlatformStore();
  const neteaseGroups = useNeteasePlaylistGroups();

  return computed<LikeStatItem[]>(() => {
    // 第三方平台：平台把自建与收藏分成两套目录，两组各显示自己的条目数
    if (platformStore.currentPlatform !== "netease") {
      const items: LikeStatItem[] = [
        {
          icon: "PlaylistAdd",
          label: "创建",
          name: "like-playlists",
          length: platformStore.playlists.owned.length,
          query: { type: PLATFORM_PLAYLIST_TYPE_QUERY[0] },
        },
        {
          icon: "PlaylistAddCheck",
          label: "收藏",
          name: "like-playlists",
          length: platformStore.playlists.favorites.length,
          query: { type: PLATFORM_PLAYLIST_TYPE_QUERY[1] },
        },
      ];
      const liked = platformStore.playlists.owned.find((item) => item.isLiked);
      if (liked) {
        items.push({
          icon: "MusicList",
          label: "喜欢",
          name: "like-songs",
          length: liked.count,
        });
      }
      return items;
    }
    // 网易云：按收藏页的子页逐项给出计数，歌单计数与落地分组一致
    return [
      {
        icon: "MusicList",
        label: "歌单",
        name: "like-playlists",
        length: neteaseGroups.value.owned.length,
      },
      {
        icon: "Album",
        label: "专辑",
        name: "like-albums",
        length: dataStore.userLikeData.albums?.length || 0,
      },
      {
        icon: "Artist",
        label: "歌手",
        name: "like-artists",
        length: dataStore.userLikeData.artists?.length || 0,
      },
      {
        icon: "Video",
        label: "视频",
        name: "like-videos",
        length: dataStore.userLikeData.mvs?.length || 0,
      },
      {
        icon: "Record",
        label: "播客",
        name: "like-radios",
        length: dataStore.userLikeData.djs?.length || 0,
      },
    ];
  });
};
