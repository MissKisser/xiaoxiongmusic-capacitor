/**
 * 歌曲喜欢（红心）界面入口
 *
 * 装配统一入口所需的真实依赖：平台红心写入、网易云红心链路、
 * 平台登录引导与界面提示。界面层只用这里的 `isSongLikedNow` 与
 * `toggleSongLike`，红心状态与红心写操作的唯一真源分别在
 * `@/utils/songLiked` 与 `@/utils/songLike`。
 *
 * @author Hackerdallas
 */

import type { SongType } from "@/types/main";
import { usePlatformStore } from "@/stores/platform";
import { likeSong as platformLikeSong } from "@/api/platform/manage";
import { PLATFORM_META } from "@/api/platform/capability";
import { toLikeSong } from "@/utils/auth";
import { openPlatformLogin } from "@/utils/modal";
import { isSongLikedInScope } from "@/utils/songLiked";
import { setSongLikeDependencies, toggleSongLike } from "@/utils/songLike";

/**
 * 提供歌曲红心状态判定与切换
 */
export const useSongLike = () => {
  const platformStore = usePlatformStore();

  // 装配真实依赖（依赖装配为幂等操作，重复调用无副作用）
  setSongLikeDependencies({
    // 第三方平台的登录态以账号资料是否存在为准
    isPlatformLoggedIn: (platform) => !!platformStore.platformProfiles[platform],
    likeSong: async (platform, song, liked) => {
      const result = await platformLikeSong(platform, song, liked);
      return { ok: result.ok, message: result.message };
    },
    toLikeSong: async (song, liked) => {
      await toLikeSong(song, liked);
    },
    promptPlatformLogin: (platform) => {
      window.$dialog.warning({
        title: "该平台未登录",
        content: `收藏该歌曲需要先登录${PLATFORM_META[platform].name}`,
        positiveText: "去登录",
        negativeText: "取消",
        onPositiveClick: () => openPlatformLogin(platform),
      });
    },
    isLiked: (song) => isSongLikedInScope(song),
    onSuccess: (message) => window.$message.success(message),
    onError: (message) => window.$message.error(message),
  });

  return {
    /**
     * 判断歌曲是否已红心（按平台维度判定）
     * @param song 歌曲
     * @returns 是否已红心
     */
    isSongLikedNow: (song?: SongType | null): boolean => isSongLikedInScope(song),
    /**
     * 切换歌曲的喜欢状态
     * @param song 歌曲
     * @param liked 目标状态，缺省时按当前状态取反
     */
    toggleSongLike: (song: SongType, liked?: boolean): Promise<void> =>
      toggleSongLike(song, liked),
  };
};
