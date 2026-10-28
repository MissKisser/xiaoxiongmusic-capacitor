/**
 * 歌曲喜欢（红心）写操作统一入口
 *
 * 喜欢动作按歌曲归属平台分流：
 * - 网易云（含本地歌曲、电台）：沿用既有网易云红心链路（`toLikeSong`），
 *   未登录与 UID 模式的提示语义保持原样，本模块不做任何干预；
 * - QQ 音乐 / 酷狗：走平台「我喜欢的音乐」写操作（`likeSong`），
 *   未登录时引导登录并中止，不发起任何写入。
 *
 * 本模块只放路由逻辑：平台写操作、登录引导与界面提示均由依赖注入提供，
 * 这样单测可在无浏览器环境下覆盖各分支。界面层通过
 * `@/composables/useSongLike` 装配真实依赖后调用。
 *
 * @author Hackerdallas
 */

import type { SongType } from "@/types/main";
import type { ApiPlatform } from "@/types/shared";
import { resolveSongPlatform } from "@/utils/songPlatform";

/** 平台红心写入的统一返回 */
export interface SongLikeWriteResult {
  /** 是否写入成功 */
  ok: boolean;
  /** 用户可读的失败提示（成功时为空） */
  message?: string;
}

/** 喜欢动作依赖 */
export interface SongLikeDependencies {
  /** 平台登录态判定 */
  isPlatformLoggedIn: (platform: ApiPlatform) => boolean;
  /** 平台红心写入 */
  likeSong: (
    platform: ApiPlatform,
    song: SongType,
    liked: boolean,
  ) => Promise<SongLikeWriteResult>;
  /** 网易云红心写入 */
  toLikeSong: (song: SongType, liked: boolean) => Promise<void>;
  /** 未登录引导（拉起该平台登录弹窗） */
  promptPlatformLogin: (platform: ApiPlatform) => void;
  /** 当前红心状态读取 */
  isLiked: (song: SongType) => boolean;
  /** 成功提示 */
  onSuccess: (message: string) => void;
  /** 失败提示 */
  onError: (message: string) => void;
}

let dependencies: SongLikeDependencies | null = null;

/**
 * 设置喜欢动作的依赖实现
 * @param deps 依赖实现，传 null 表示清空
 */
export const setSongLikeDependencies = (deps: SongLikeDependencies | null): void => {
  dependencies = deps;
};

/**
 * 切换歌曲的喜欢状态
 *
 * 分流规则：
 * 1. 网易云歌曲（含本地歌曲、电台）走既有红心链路，未登录提示由该链路给出；
 * 2. 第三方平台未登录时引导登录并中止，不发起写入；
 * 3. 第三方平台已登录时写入平台「我喜欢的音乐」，按写入结果给出成功或失败提示。
 *
 * @param song 目标歌曲
 * @param liked 目标状态；缺省时按当前状态取反
 */
export const toggleSongLike = async (song: SongType, liked?: boolean): Promise<void> => {
  const deps = dependencies;
  if (!deps) throw new Error("喜欢动作依赖未初始化");

  const platform = resolveSongPlatform(song);

  // 网易云：沿用既有红心链路，提示语义保持原样
  if (platform === "netease") {
    await deps.toLikeSong(song, liked ?? !deps.isLiked(song));
    return;
  }

  // 第三方平台未登录：引导登录，不发起写入
  if (!deps.isPlatformLoggedIn(platform)) {
    deps.promptPlatformLogin(platform);
    return;
  }

  // 第三方平台：写入平台「我喜欢的音乐」
  const target = liked ?? !deps.isLiked(song);
  const result = await deps.likeSong(platform, song, target);
  if (!result?.ok) {
    deps.onError(result?.message || "操作失败，请重试");
    return;
  }
  deps.onSuccess(target ? "已添加到我喜欢的音乐" : "已取消喜欢");
};
