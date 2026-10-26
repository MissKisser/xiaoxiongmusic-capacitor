/**
 * 平台歌单 / 歌曲 / 收藏管理写操作分派层
 *
 * 页面层只认「当前平台」这一个维度：建歌单、改名、删除歌单、加歌、删歌、
 * 收藏歌单、喜欢歌曲七类写操作都从这里进：
 *
 * - 网易云：直调既有网易云封装（`src/api/playlist.ts` / `src/api/song.ts`），
 *   返回结构与原链路完全一致，页面行为零变化；
 * - QQ 音乐 / 酷狗：直调核心写操作模块组，
 *   模块内部遵循「写入 → 读回确认 → 才返回成功」。
 *
 * @author Hackerdallas
 */

import type { ApiPlatform } from "@/types/shared";
import type { CoverType, SongType } from "@/types/main";
import { notifyLikedSongsChanged } from "@/utils/likedEvents";
import { isSongLikedInScope } from "@/utils/songLiked";
import { type DispatchPlaylist, dispatchLikedSongIds } from "./dispatch";
import { describeFailure } from "./errorText";
import { platformRequest, platformRequestBody, platformWriteRequest } from "./http";
import { normalizeQqPlaylist } from "./qqmusic";
import { kgFindLikedPlaylist, normalizeKgHash, normalizeKgPlaylist } from "./kugou";
import type { PlatformPlaylist } from "./types";

/**
 * 延迟加载网易云相关写操作模块
 * 避免在无浏览器环境（如单测 node:test）下触发前端 SFC (.vue) 连带异常
 */
const loadNeteaseManageModules = async () => {
  const [playlistApi, songApi, dataStoreModule] = await Promise.all([
    import("@/api/playlist"),
    import("@/api/song"),
    import("@/stores/data"),
  ]);
  return {
    neteaseCreatePlaylist: playlistApi.createPlaylist,
    neteaseDeletePlaylist: playlistApi.deletePlaylist,
    neteaseLikePlaylist: playlistApi.likePlaylist,
    neteasePlaylistTracks: playlistApi.playlistTracks,
    neteaseUpdatePlaylist: playlistApi.updatePlaylist,
    neteaseLikeSong: songApi.likeSong,
    useDataStore: dataStoreModule.useDataStore,
  };
};

/** 写操作统一返回 */
export interface ManageResult<T = unknown> {
  /** 是否成功 */
  ok: boolean;
  /** 用户可读的失败提示（成功时为空） */
  message?: string;
  /** 平台返回的业务数据 */
  data?: T;
  /** 新建 / 定位到的歌单标识（平台内主键） */
  playlistId?: string;
}

/** 加歌弹窗需要的「可管理歌单」条目 */
export interface ManageablePlaylist {
  /** 歌单标识（平台内主键） */
  id: string;
  /** 歌单名 */
  name: string;
  /** 封面直链 */
  cover: string;
  /** 封面小图直链 */
  coverSmall?: string;
  /** 曲目数 */
  count: number;
  /** 是否为「我喜欢的音乐」（写入时走喜欢机制而非普通歌单写入） */
  isLiked: boolean;
}

/** 主进程平台写模块的返回形状 */
interface PlatformWriteResult {
  code?: number;
  message?: string;
  /** 路由层统一文案（服务端级失败时给出） */
  error?: string;
  tid?: number | string;
  dirId?: number | string;
  id?: number | string;
  name?: string;
  subscribed?: boolean;
  deleted?: boolean;
  verified?: boolean;
  items?: Array<{ id: string; status: string }>;
}

/** 主进程「我的歌单」模块的返回形状 */
interface PlatformPlaylistListResponse {
  code?: number;
  owned?: Array<Record<string, any>>;
  favorites?: Array<Record<string, any>>;
}

/**
 * 把平台模块的返回整理成统一结果
 * @param platform 音源平台
 * @param result 模块返回
 * @returns 统一结果
 */
const toManageResult = (
  platform: ApiPlatform,
  result: PlatformWriteResult | undefined,
): ManageResult => {
  if (!result) return { ok: false, message: "操作失败，请重试" };
  if (result.code === 200) {
    const playlistId =
      result.tid !== undefined
        ? String(result.tid)
        : result.id !== undefined
          ? String(result.id)
          : undefined;
    return { ok: true, data: result, playlistId };
  }
  // 路由层统一文案（服务端级失败）：直接透出，不再二次翻译
  if (result.error) return { ok: false, message: result.error };
  return { ok: false, message: describeFailure(platform, result.code, result.message) };
};

/**
 * 调用平台写模块并兜住异常
 *
 * 写操作走数据面（HTTP），与读操作同源；
 * 业务失败由响应体里的 `code` 表达，请求本身失败才落到异常分支。
 * @param platform 音源平台
 * @param moduleName 模块名
 * @param params 业务参数
 * @returns 统一结果
 */
const callWriteModule = async (
  platform: ApiPlatform,
  moduleName: string,
  params: Record<string, unknown>,
): Promise<ManageResult> => {
  try {
    const result = await platformWriteRequest<PlatformWriteResult>(platform, moduleName, params);
    return toManageResult(platform, result);
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "操作失败，请重试",
    };
  }
};

/**
 * 把平台归一化歌单转为分派层统一条目（与分派层同口径）
 * @param playlist 平台归一化歌单
 * @returns 分派层统一歌单条目
 */
const toDispatchPlaylist = (playlist: PlatformPlaylist): DispatchPlaylist => ({
  id: playlist.id,
  name: playlist.name,
  cover: playlist.coverImgUrl,
  coverSize: playlist.coverSize,
  count: playlist.trackCount,
  playCount: playlist.playCount,
  description: playlist.description,
  creatorName: playlist.creator?.name,
  createTime: playlist.createTime,
  updateTime: playlist.updateTime,
  platform: playlist.platform,
  platformId: playlist.platformId,
  dirId: playlist.dirId,
  subscribed: playlist.subscribed === true,
  isLiked: playlist.isLiked === true,
  originListid: playlist.originListid,
  originSpecialid: playlist.originSpecialid,
});

/**
 * 强制拉取平台的最新歌单列表
 *
 * 主进程对读模块有 2 分钟响应缓存，分派层对用户歌单另有 30 秒缓存；
 * 写操作之后必须绕过这两层缓存重新取，否则界面拿到的仍是旧数据。
 * 这里带一个时间戳参数重新请求，读模块会忽略该参数。
 * @param platform 音源平台
 * @returns 自建歌单与收藏歌单
 */
const fetchFreshPlatformPlaylists = async (
  platform: ApiPlatform,
): Promise<{ owned: DispatchPlaylist[]; favorites: DispatchPlaylist[] }> => {
  const res = await platformRequest<PlatformPlaylistListResponse>(platform, "user_playlist_list", {
    _t: Date.now(),
  });
  if (platform === "qqmusic") {
    const owned = (res?.owned ?? []).map(normalizeQqPlaylist);
    const favorites = (res?.favorites ?? []).map(normalizeQqPlaylist);
    return {
      owned: owned.map(toDispatchPlaylist),
      favorites: favorites.map(toDispatchPlaylist),
    };
  }
  const owned = (res?.owned ?? []).map(normalizeKgPlaylist);
  const favorites = (res?.favorites ?? []).map(normalizeKgPlaylist);
  const ownedList = owned.map(toDispatchPlaylist);
  // 酷狗的「我喜欢的歌」是自建歌单里的一种，按平台语义定位后打标
  const liked = kgFindLikedPlaylist(owned);
  if (liked) {
    const target = ownedList.find(
      (item) => String(item.platformId ?? item.id) === String(liked.platformId ?? liked.id),
    );
    if (target) target.isLiked = true;
  }
  return { owned: ownedList, favorites: favorites.map(toDispatchPlaylist) };
};

/** 歌单列表刷新回调，供后续 store 层挂载触发 */
export type PlatformPlaylistRefreshCallback = (platform: ApiPlatform) => Promise<void>;
let onPlaylistRefresh: PlatformPlaylistRefreshCallback | null = null;

export const registerPlaylistRefreshCallback = (
  callback: PlatformPlaylistRefreshCallback | null,
): void => {
  onPlaylistRefresh = callback;
};

/**
 * 写操作后刷新当前平台的歌单列表
 * @param platform 音源平台
 */
const refreshPlatformPlaylists = async (platform: ApiPlatform): Promise<void> => {
  if (platform === "netease") return;
  try {
    if (onPlaylistRefresh) {
      await onPlaylistRefresh(platform);
    }
  } catch (error) {
    console.error("刷新平台歌单列表失败：", error);
  }
};

/**
 * 把歌曲转换成 QQ 音乐写操作需要的条目
 * @param song 歌曲
 * @returns QQ 写操作条目（数字歌曲 id）
 */
const toQqSongEntry = (song: SongType) => ({
  id: Number(song.id) || 0,
  type: 0,
});

/**
 * 把歌曲转换成酷狗写操作需要的条目
 *
 * 酷狗加歌接口要求 `hash`（内容哈希）与 `name`（歌名）均非空，
 * 缺歌名会被服务端以 `error_code=20010` 拒绝。
 *
 * `mixsongid` 是歌曲的逻辑 id（`album_audio_id` 口径），同一首歌的不同文件版本
 * （不同内容哈希）共享同一个逻辑 id，删歌时按它定位歌单里的条目最可靠；
 * `singer` 是歌手名，作为内容哈希与逻辑 id 都匹配不上时的兜底判据。
 * @param song 歌曲
 * @returns 酷狗写操作条目
 */
const toKgSongEntry = (song: SongType) => {
  const album = typeof song.album === "object" && song.album ? song.album : null;
  const artists = Array.isArray(song.artists) ? song.artists : [];
  const singer = artists
    .map((artist) => artist?.name ?? "")
    .filter(Boolean)
    .join(" / ");
  return {
    hash: normalizeKgHash(song.platformId ?? ""),
    name: String(song.name ?? ""),
    singer,
    album_id: Number(album?.id ?? 0),
    mixsongid: Number(song.id ?? 0),
  };
};

/**
 * 读取某平台「我喜欢的音乐」里的歌曲 id 集合
 *
 * 集合由平台 store 持有：平台可用时即全局装载，装载过程带 in-flight 去重，
 * 未装载时按需触发一次装载，因此任意页面的红心状态都可判定。
 * @param platform 音源平台
 * @returns 歌曲 id 集合
 */
export const getPlatformLikedSongIds = async (platform: ApiPlatform): Promise<Set<number>> => {
  if (platform === "netease") return new Set<number>();
  return dispatchLikedSongIds(platform);
};

/**
 * 判断某首歌在当前平台是否已被喜欢
 *
 * 仅对第三方平台有效；网易云的心跳状态由既有本地缓存维护。
 * @param platform 音源平台
 * @param song 歌曲
 * @returns 是否已喜欢
 */
export const isSongLiked = (platform: ApiPlatform, song: SongType): boolean => {
  if (platform === "netease") return false;
  return isSongLikedInScope(song);
};

/** 喜欢歌曲本地缓存修补回调，供后续 store 层挂载触发 */
export type PlatformLikedPatchCallback = (
  platform: ApiPlatform,
  songId: number,
  liked: boolean,
) => void;
let onLikedPatch: PlatformLikedPatchCallback | null = null;

export const registerLikedPatchCallback = (
  callback: PlatformLikedPatchCallback | null,
): void => {
  onLikedPatch = callback;
};

/**
 * 在本地缓存里增删一首喜欢歌曲
 * @param platform 音源平台
 * @param song 歌曲
 * @param liked 是否喜欢
 */
const patchLikedSongCache = (platform: ApiPlatform, song: SongType, liked: boolean): void => {
  if (platform === "netease") return;
  if (onLikedPatch) {
    onLikedPatch(platform, Number(song.id), liked);
  }
};

/**
 * 创建歌单
 * @param platform 音源平台
 * @param name 歌单名
 * @param privacy 是否隐私歌单（仅网易云支持，其余平台忽略）
 * @returns 统一结果
 */
export const createPlaylist = async (
  platform: ApiPlatform,
  name: string,
  privacy?: boolean,
): Promise<ManageResult> => {
  if (platform === "netease") {
    try {
      const { neteaseCreatePlaylist } = await loadNeteaseManageModules();
      const result = await neteaseCreatePlaylist(name, privacy ?? false);
      return {
        ok: result?.code === 200,
        message: result?.code === 200 ? undefined : result?.message || "新建歌单失败，请重试",
        data: result,
      };
    } catch {
      return { ok: false, message: "新建歌单失败，请重试" };
    }
  }
  const result = await callWriteModule(platform, "playlist_create", { name });
  if (result.ok) await refreshPlatformPlaylists(platform);
  return result;
};

/**
 * 改名歌单
 * @param platform 音源平台
 * @param playlistId 歌单标识
 * @param name 新歌单名
 * @param options.desc 歌单描述（仅网易云 / 酷狗支持）
 * @param options.tags 歌单标签（仅网易云支持）
 * @returns 统一结果
 */
export const renamePlaylist = async (
  platform: ApiPlatform,
  playlistId: string | number,
  name: string,
  options: { desc?: string; tags?: string[] } = {},
): Promise<ManageResult> => {
  if (platform === "netease") {
    try {
      const { neteaseUpdatePlaylist } = await loadNeteaseManageModules();
      const result = await neteaseUpdatePlaylist(
        Number(playlistId),
        name,
        options.desc ?? "",
        options.tags ?? [],
      );
      return {
        ok: result?.code === 200,
        message: result?.code === 200 ? undefined : result?.message || "歌单编辑失败，请重试",
        data: result,
      };
    } catch {
      return { ok: false, message: "歌单编辑失败，请重试" };
    }
  }
  if (platform === "qqmusic") {
    const result = await callWriteModule(platform, "playlist_rename", {
      tid: Number(playlistId),
      name,
    });
    if (result.ok) await refreshPlatformPlaylists(platform);
    return result;
  }
  const params: Record<string, unknown> = { id: String(playlistId), name };
  if (options.desc !== undefined) params.intro = options.desc;
  const result = await callWriteModule(platform, "playlist_rename", params);
  if (result.ok) await refreshPlatformPlaylists(platform);
  return result;
};

/**
 * 删除歌单
 * @param platform 音源平台
 * @param playlistId 歌单标识
 * @returns 统一结果
 */
export const deletePlaylist = async (
  platform: ApiPlatform,
  playlistId: string | number,
): Promise<ManageResult> => {
  if (platform === "netease") {
    try {
      const { neteaseDeletePlaylist } = await loadNeteaseManageModules();
      const result = await neteaseDeletePlaylist(Number(playlistId));
      return {
        ok: result?.code === 200,
        message: result?.code === 200 ? undefined : result?.message || "歌单删除失败，请重试",
        data: result,
      };
    } catch {
      return { ok: false, message: "歌单删除失败，请重试" };
    }
  }
  const params = platform === "qqmusic" ? { tid: Number(playlistId) } : { id: String(playlistId) };
  const result = await callWriteModule(platform, "playlist_delete", params);
  if (result.ok) await refreshPlatformPlaylists(platform);
  return result;
};

/**
 * 往歌单加歌
 * @param platform 音源平台
 * @param playlistId 歌单标识
 * @param songs 歌曲列表
 * @returns 统一结果
 */
export const addSongsToPlaylist = async (
  platform: ApiPlatform,
  playlistId: string | number,
  songs: SongType[],
): Promise<ManageResult> => {
  if (!songs?.length) return { ok: false, message: "请选择要添加的歌曲" };
  if (platform === "netease") {
    try {
      const { neteasePlaylistTracks } = await loadNeteaseManageModules();
      const ids = songs.map((song) => song.id).filter((id) => id !== 0);
      const result = await neteasePlaylistTracks(Number(playlistId), ids, "add");
      const ok = result?.status === 200 && result?.body?.code === 200;
      return {
        ok,
        message: ok ? undefined : result?.body?.message || "添加失败，请重试",
        data: result,
      };
    } catch {
      return { ok: false, message: "添加失败，请重试" };
    }
  }
  const params =
    platform === "qqmusic"
      ? {
          tid: Number(playlistId),
          op: "add",
          songs: songs.map(toQqSongEntry),
        }
      : {
          id: String(playlistId),
          op: "add",
          songs: songs.map(toKgSongEntry),
        };
  const result = await callWriteModule(platform, "playlist_tracks", params);
  if (result.ok) await refreshPlatformPlaylists(platform);
  return result;
};

/**
 * 从歌单删歌
 * @param platform 音源平台
 * @param playlistId 歌单标识
 * @param songs 歌曲列表
 * @returns 统一结果
 */
export const removeSongsFromPlaylist = async (
  platform: ApiPlatform,
  playlistId: string | number,
  songs: SongType[],
): Promise<ManageResult> => {
  if (!songs?.length) return { ok: false, message: "请选择要删除的歌曲" };
  if (platform === "netease") {
    try {
      const { neteasePlaylistTracks } = await loadNeteaseManageModules();
      const ids = songs.map((song) => song.id).filter((id) => id !== 0);
      const result = await neteasePlaylistTracks(Number(playlistId), ids, "del");
      const ok = result?.status === 200 && result?.body?.code === 200;
      return {
        ok,
        message: ok ? undefined : result?.body?.message || "删除失败，请重试",
        data: result,
      };
    } catch {
      return { ok: false, message: "删除失败，请重试" };
    }
  }
  const params =
    platform === "qqmusic"
      ? {
          tid: Number(playlistId),
          op: "del",
          songs: songs.map(toQqSongEntry),
        }
      : {
          id: String(playlistId),
          op: "del",
          songs: songs.map(toKgSongEntry),
        };
  const result = await callWriteModule(platform, "playlist_tracks", params);
  if (result.ok) await refreshPlatformPlaylists(platform);
  return result;
};

/**
 * 收藏 / 取消收藏歌单
 * @param platform 音源平台
 * @param playlistId 歌单标识（酷狗为公开歌单的原始歌单号）
 * @param subscribed 是否收藏
 * @returns 统一结果
 */
export const subscribePlaylist = async (
  platform: ApiPlatform,
  playlistId: string | number,
  subscribed: boolean,
): Promise<ManageResult> => {
  if (platform === "netease") {
    try {
      const { neteaseLikePlaylist } = await loadNeteaseManageModules();
      const result = await neteaseLikePlaylist(Number(playlistId), subscribed ? 1 : 2);
      return {
        ok: result?.code === 200,
        message: result?.code === 200 ? undefined : result?.message || "收藏歌单失败，请重试",
        data: result,
      };
    } catch {
      return { ok: false, message: "收藏歌单失败，请重试" };
    }
  }
  const params =
    platform === "qqmusic"
      ? { tid: Number(playlistId), subscribed }
      : { id: String(playlistId), subscribed };
  const result = await callWriteModule(platform, "playlist_subscribe", params);
  if (result.ok) await refreshPlatformPlaylists(platform);
  return result;
};

/**
 * 查询歌单的收藏（订阅）状态
 * @param platform 音源平台
 * @param playlistId 歌单标识
 * @returns 是否已收藏
 */
export const isPlaylistSubscribed = async (
  platform: ApiPlatform,
  playlistId: string | number,
): Promise<boolean> => {
  if (platform === "netease") {
    const { useDataStore } = await loadNeteaseManageModules();
    const dataStore = useDataStore();
    return dataStore.userLikeData.playlists.some(
      (playlist: { id?: string | number }) => Number(playlist.id) === Number(playlistId),
    );
  }
  if (platform === "qqmusic") {
    try {
      const result = await platformRequestBody<PlatformWriteResult>(
        platform,
        "subscription_status",
        {
          type: "playlist",
          ids: String(playlistId),
        },
      );
      return result?.items?.[0]?.status === "subscribed";
    } catch (error) {
      console.error("查询歌单收藏状态失败：", error);
      return false;
    }
  }
  try {
    const { favorites } = await fetchFreshPlatformPlaylists(platform);
    return favorites.some(
      (playlist) => String(playlist.platformId ?? playlist.id) === String(playlistId),
    );
  } catch (error) {
    console.error("查询歌单收藏状态失败：", error);
    return false;
  }
};

/**
 * 读取某平台「我喜欢的音乐」的曲目总数
 *
 * QQ 音乐走系统目录模块，酷狗的红心是「我喜欢」系统歌单。
 * @param platform 音源平台
 * @returns 曲目总数，读取失败时为 0
 */
const readLikedTotal = async (platform: ApiPlatform): Promise<number> => {
  try {
    if (platform === "qqmusic") {
      const res = await platformRequestBody<{ total?: number }>(platform, "user_liked_songs", {
        song_begin: 0,
        song_num: 1,
        _t: Date.now(),
      });
      return Number(res?.total ?? 0);
    }
    const { owned } = await fetchFreshPlatformPlaylists(platform);
    const liked = owned.find((playlist) => playlist.isLiked === true);
    if (!liked) return 0;
    const res = await platformRequestBody<{ total?: number }>(platform, "playlist_detail", {
      id: liked.platformId ?? liked.id,
      page: 1,
      pageSize: 1,
      _t: Date.now(),
    });
    return Number(res?.total ?? 0);
  } catch (error) {
    console.error("读取平台喜欢歌曲总数失败：", error);
    return 0;
  }
};

/**
 * 查询 QQ 音乐单曲的收藏（红心）状态
 * @param song 歌曲
 * @returns 是否已喜欢，读取失败时为 null
 */
const readQqSongLikedState = async (song: SongType): Promise<boolean | null> => {
  const mid = song.platformId;
  if (!mid) return null;
  try {
    const res = await platformRequestBody<PlatformWriteResult>("qqmusic", "subscription_status", {
      type: "song",
      ids: mid,
    });
    const status = res?.items?.[0]?.status;
    if (!status) return null;
    return status === "subscribed";
  } catch (error) {
    console.error("查询歌曲收藏状态失败：", error);
    return null;
  }
};

/**
 * 喜欢 / 取消喜欢歌曲
 *
 * QQ 音乐写入系统目录「我喜欢」，酷狗写入「我喜欢」系统歌单，
 * 两者都落到对应平台的曲目写操作上。
 *
 * 注意：QQ 音乐模块对「喜欢」路径的返回码校验不成立（写接口回的是
 * `dirId=201 / tid=<歌单号>`，而模块按普通歌单口径比对 `tid`），
 * 真实写入成功时模块仍会返回 502。故这里在模块返回失败时，
 * 用「我喜欢的总数变化 + 单曲收藏状态」读回确认实际效果。
 *
 * 写入确认生效后广播一次红心变更事件（`notifyLikedSongsChanged`），
 * 展示「我喜欢的音乐」的视图据此实时更新，不必手动刷新。
 * @param platform 音源平台
 * @param song 歌曲
 * @param liked 是否喜欢
 * @returns 统一结果
 */
export const likeSong = async (
  platform: ApiPlatform,
  song: SongType,
  liked: boolean,
): Promise<ManageResult> => {
  if (platform === "netease") {
    try {
      const { neteaseLikeSong } = await loadNeteaseManageModules();
      const result = await neteaseLikeSong(song.id, liked);
      return {
        ok: result?.code === 200,
        message: result?.code === 200 ? undefined : result?.message || "操作失败，请重试",
        data: result,
      };
    } catch {
      return { ok: false, message: "操作失败，请重试" };
    }
  }
  const params =
    platform === "qqmusic"
      ? { op: liked ? "add" : "del", like: true, songs: [toQqSongEntry(song)] }
      : { op: liked ? "add" : "del", like: true, songs: [toKgSongEntry(song)] };
  const before = await readLikedTotal(platform);
  const result = await callWriteModule(platform, "playlist_tracks", params);
  if (result.ok) {
    patchLikedSongCache(platform, song, liked);
    await refreshPlatformPlaylists(platform);
    notifyLikedSongsChanged({ platform, song, liked });
    return result;
  }
  // 模块返回失败：读回确认写入是否实际生效
  // 上游的读取是最终一致的（多节点复制延迟），这里轮询几次再下结论，
  // 避免写入其实已生效、只是读回拿到旧值时误报失败
  let after = await readLikedTotal(platform);
  let countChanged = liked ? after > before : after < before;
  for (let attempt = 0; attempt < 3 && !countChanged; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    after = await readLikedTotal(platform);
    countChanged = liked ? after > before : after < before;
  }
  let stateMatched = false;
  if (!countChanged && platform === "qqmusic") {
    const state = await readQqSongLikedState(song);
    stateMatched = state === liked;
  }
  if (countChanged || stateMatched) {
    patchLikedSongCache(platform, song, liked);
    await refreshPlatformPlaylists(platform);
    notifyLikedSongsChanged({ platform, song, liked });
    return { ok: true, message: undefined, data: result.data };
  }
  return result;
};

/**
 * 喜欢 / 取消喜欢一批歌曲
 *
 * 平台的「喜欢」是一次一首地写特殊歌单，故按顺序逐首写入。
 * @param platform 音源平台
 * @param songs 歌曲列表
 * @param liked 是否喜欢
 * @returns 统一结果
 */
export const likeSongs = async (
  platform: ApiPlatform,
  songs: SongType[],
  liked: boolean,
): Promise<ManageResult> => {
  if (!songs?.length) return { ok: false, message: "请选择歌曲" };
  if (platform === "netease") {
    const results = await Promise.all(songs.map((song) => likeSong(platform, song, liked)));
    const failed = results.find((result) => !result.ok);
    return failed ?? { ok: true };
  }
  let last: ManageResult = { ok: true };
  for (const song of songs) {
    last = await likeSong(platform, song, liked);
    if (!last.ok) return last;
  }
  return last;
};

/**
 * 读取当前平台「可管理」的歌单列表（加歌弹窗用）
 *
 * 只返回自建歌单（可写入的那些）；网易云沿用既有本地缓存口径，
 * 第三方平台走歌单数据源分派层取自建组。
 * @param platform 音源平台
 * @returns 可管理歌单列表
 */
export const getManageablePlaylists = async (
  platform: ApiPlatform,
): Promise<ManageablePlaylist[]> => {
  if (platform === "netease") {
    const { useDataStore } = await loadNeteaseManageModules();
    const dataStore = useDataStore();
    const userId = dataStore.userData?.userId;
    return (dataStore.userLikeData.playlists || [])
      .filter((playlist: CoverType) => playlist.userId === userId)
      .map((playlist: CoverType, index: number) => ({
        id: String(playlist.id),
        name: index === 0 ? "我喜欢的音乐" : playlist.name,
        cover: playlist.cover,
        coverSmall: playlist.coverSize?.s,
        count: playlist.count ?? 0,
        isLiked: index === 0,
      }));
  }
  try {
    const { owned } = await fetchFreshPlatformPlaylists(platform);
    return owned.map((playlist) => ({
      id: String(playlist.platformId ?? playlist.id),
      name: playlist.name,
      cover: playlist.cover,
      coverSmall: playlist.coverSize?.s,
      count: playlist.count,
      isLiked: playlist.isLiked === true,
    }));
  } catch (error) {
    console.error("读取平台可管理歌单失败：", error);
    return [];
  }
};
