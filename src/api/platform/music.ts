/**
 * 第三方音源平台（QQ 音乐 / 酷狗）渲染端封装与直调桥梁
 *
 * Capacitor 环境消灭 Electron IPC 边界，改为直调 src/utils/platform 核心模块，
 * 返回契约与 PC 端保持同构。
 *
 * @author Hackerdallas
 */

import type { ApiCallResponse, ApiPlatform, PlatformProfile } from "@/types/shared";
import { callQQMusic, clearQQMusicCookies, listQQMusicModules } from "@/utils/platform/qqmusic";
import { callKugou, clearKugouSession, listKugouModules } from "@/utils/platform/kugou";
import { QQMusicApiError } from "@/utils/platform/qqmusic/core/auth";
import { KugouApiError } from "@/utils/platform/kugou/core/auth";
import { clearSessionCookies } from "@/utils/platform/sessionStore";

/**
 * 平台登录凭据失效异常
 *
 * 区分「凭据失效」与「业务拒绝 / 网络故障」，
 * 渲染端据此决定是否提示重新登录，避免把网络抖动误判为登出。
 */
export class PlatformAuthExpiredError extends Error {
  /** 失效的平台 */
  readonly platform: ApiPlatform;
  /** 上游外层业务码 */
  readonly outer?: number;
  /** 上游内层业务码 */
  readonly inner?: number;

  /**
   * 构造登录凭据失效异常
   * @param platform 音源平台
   * @param message 失败说明
   * @param outer 上游外层业务码
   * @param inner 上游内层业务码
   */
  constructor(platform: ApiPlatform, message: string, outer?: number, inner?: number) {
    super(message);
    this.name = "PlatformAuthExpiredError";
    this.platform = platform;
    this.outer = outer;
    this.inner = inner;
  }
}

/**
 * 直调平台核心模块并封装为统一响应契约
 * @param platform 音源平台
 * @param name 接口名
 * @param params 接口参数
 * @returns 统一响应结构
 */
export const executePlatformCall = async (
  platform: ApiPlatform,
  name: string,
  params?: Record<string, unknown>,
): Promise<ApiCallResponse> => {
  try {
    if (platform === "qqmusic") {
      const data = await callQQMusic(name, params ?? {});
      return { ok: true, data };
    }
    if (platform === "kugou") {
      const data = await callKugou(name, params ?? {});
      return { ok: true, data };
    }
    return { ok: false, error: `本通道暂不支持平台: ${platform}`, errorCode: "UNKNOWN" };
  } catch (err) {
    if (err instanceof QQMusicApiError) {
      return {
        ok: false,
        error: err.message,
        errorCode: err.authExpired ? "AUTH_EXPIRED" : "BUSINESS_ERROR",
        outer: err.outer,
        inner: err.inner,
      };
    }
    if (err instanceof KugouApiError) {
      return {
        ok: false,
        error: err.message,
        errorCode: "AUTH_EXPIRED",
        inner: err.errorCode,
      };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      errorCode: "UNKNOWN",
    };
  }
};

/**
 * 清空指定平台的登录态与持久化会话
 * @param platform 音源平台
 */
export const clearPlatformSession = async (platform: ApiPlatform): Promise<void> => {
  if (platform === "qqmusic") {
    clearQQMusicCookies();
    clearSessionCookies("qqmusic");
  } else if (platform === "kugou") {
    clearKugouSession();
    clearSessionCookies("kugou");
  }
};

/** 清空平台登录态（别名，对齐 PC 契约） */
export const clearSession = clearPlatformSession;

/**
 * 列出指定平台当前已注册的模块名
 * @param platform 音源平台
 * @returns 模块名列表
 */
export const listPlatformModules = (platform: ApiPlatform): string[] => {
  if (platform === "qqmusic") return listQQMusicModules();
  if (platform === "kugou") return listKugouModules();
  return [];
};

/** 测试用调用拦截器签名 */
export type PlatformCallInterceptor = (
  platform: ApiPlatform,
  name: string,
  params?: Record<string, unknown>,
) => Promise<unknown> | unknown;

let testInterceptor: PlatformCallInterceptor | null = null;

/**
 * 设置平台接口调用拦截器（仅用于单测与冒烟桩件环境）
 * @param interceptor 拦截器函数或 null
 */
export const setPlatformCallInterceptor = (
  interceptor: PlatformCallInterceptor | null,
): void => {
  testInterceptor = interceptor;
};

/**
 * 调用平台接口
 * @param platform 音源平台
 * @param name 接口名
 * @param params 接口参数
 * @returns 业务数据，失败时抛出异常
 */
export const platformCall = async <T = unknown>(
  platform: ApiPlatform,
  name: string,
  params?: Record<string, unknown>,
): Promise<T> => {
  if (testInterceptor) {
    const intercepted = await testInterceptor(platform, name, params);
    if (intercepted !== undefined) return intercepted as T;
  }
  const res: ApiCallResponse = await executePlatformCall(platform, name, params);
  if (res.ok) return res.data as T;
  if (res.errorCode === "AUTH_EXPIRED") {
    throw new PlatformAuthExpiredError(platform, res.error, res.outer, res.inner);
  }
  throw new Error(res.error);
};

/** QQ 音乐平台标识 */
export const QQ_MUSIC: ApiPlatform = "qqmusic";
/** 酷狗平台标识 */
export const KUGOU: ApiPlatform = "kugou";

/** 歌单条目（QQ 音乐自建 / 收藏歌单） */
export interface QQMusicPlaylistItem {
  /** 歌单 tid（写操作的定位键） */
  tid: number;
  /** 歌单目录号（写操作的实际目标） */
  dirId: number;
  /** 歌单名 */
  dirName: string;
  /** 目录类型：0 自建，3 收藏 */
  dirType: number;
  /** 歌曲数 */
  songNum: number;
  /** 播放量 */
  listenNum: number;
  /** 封面 */
  cover: string;
  /** 创建时间 */
  createTime: number;
}

/** 我的歌单列表响应 */
export interface QQMusicPlaylistList {
  code: number;
  total: number;
  bFinish: boolean;
  /** 自建歌单 */
  owned: QQMusicPlaylistItem[];
  /** 收藏的歌单 */
  favorites: QQMusicPlaylistItem[];
}

/** 歌单详情响应 */
export interface QQMusicPlaylistDetail {
  code: number;
  id: string;
  name: string;
  creator: string;
  cover: string;
  description: string;
  total: number;
  hasmore: number;
  songs: Array<{
    id: number;
    mid: string;
    name: string;
    artist: string;
    album: string;
    duration: number;
  }>;
}

/** 写操作统一返回 */
export interface QQMusicWriteResult {
  code: number;
  message?: string;
  tid?: number;
  dirId?: number;
  name?: string;
  changed?: boolean;
  subscribed?: boolean;
  deleted?: boolean;
  verified?: boolean;
}

/**
 * 读取 QQ 音乐账号的自建 + 收藏歌单
 */
export const fetchQQMusicPlaylists = async (): Promise<QQMusicPlaylistList> => {
  return platformCall<QQMusicPlaylistList>(QQ_MUSIC, "user_playlist_list");
};

/**
 * 读取「我喜欢的音乐」
 */
export const fetchQQMusicLikedSongs = async (
  songBegin = 0,
  songNum = 100,
): Promise<QQMusicPlaylistDetail> => {
  return platformCall<QQMusicPlaylistDetail>(QQ_MUSIC, "user_liked_songs", {
    song_begin: songBegin,
    song_num: songNum,
  });
};

/**
 * 读取一张歌单的详情
 * @param id 歌单 tid
 * @param dirId 歌单目录号（自己的歌单需要）
 */
export const fetchQQMusicPlaylistDetail = async (
  id: number | string,
  dirId = 0,
): Promise<QQMusicPlaylistDetail> => {
  return platformCall<QQMusicPlaylistDetail>(QQ_MUSIC, "playlist_detail", { id, dirId });
};

/**
 * 创建歌单
 * @param name 歌单名（最多 20 字）
 */
export const createQQMusicPlaylist = async (name: string): Promise<QQMusicWriteResult> => {
  return platformCall<QQMusicWriteResult>(QQ_MUSIC, "playlist_create", { name });
};

/**
 * 改名歌单
 * @param tid 歌单 tid
 * @param name 新名字
 */
export const renameQQMusicPlaylist = async (
  tid: number,
  name: string,
): Promise<QQMusicWriteResult> => {
  return platformCall<QQMusicWriteResult>(QQ_MUSIC, "playlist_rename", { tid, name });
};

/**
 * 删除歌单
 * @param tid 歌单 tid
 */
export const deleteQQMusicPlaylist = async (tid: number): Promise<QQMusicWriteResult> => {
  return platformCall<QQMusicWriteResult>(QQ_MUSIC, "playlist_delete", { tid });
};

/**
 * 往歌单加歌 / 从歌单删歌
 * @param tid 歌单 tid（传 undefined 表示写入「我喜欢」）
 * @param op add | del
 * @param songs 歌曲列表，type 目前仅支持 0
 */
export const updateQQMusicPlaylistTracks = async (
  tid: number | undefined,
  op: "add" | "del",
  songs: Array<{ id: number; type?: number }>,
): Promise<QQMusicWriteResult> => {
  return platformCall<QQMusicWriteResult>(QQ_MUSIC, "playlist_tracks", {
    tid,
    op,
    songs,
    like: tid === undefined,
  });
};

/**
 * 收藏 / 取消收藏歌单
 * @param tid 歌单 tid
 * @param subscribed true 收藏 / false 取消
 */
export const subscribeQQMusicPlaylist = async (
  tid: number,
  subscribed: boolean,
): Promise<QQMusicWriteResult> => {
  return platformCall<QQMusicWriteResult>(QQ_MUSIC, "playlist_subscribe", { tid, subscribed });
};

/**
 * 查询收藏状态
 * @param type playlist | album | song
 * @param ids 逗号分隔的 ID
 */
export const fetchQQMusicSubscriptionStatus = async (
  type: "playlist" | "album" | "song",
  ids: string,
): Promise<{ code: number; items: Array<{ id: string; status: string }> }> => {
  return platformCall(QQ_MUSIC, "subscription_status", { type, ids });
};

/**
 * 读取平台账号资料
 * @param platform 音源平台
 */
export const fetchPlatformProfile = async (
  platform: ApiPlatform,
): Promise<PlatformProfile | null> => {
  return platformCall<PlatformProfile | null>(platform, "user_detail");
};
