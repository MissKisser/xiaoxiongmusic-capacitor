/**
 * 酷狗听书数据层（渲染端）
 *
 * 与酷狗音乐数据层同构：axios → `/api/kugou/audiobook/*` → 主进程酷狗模块。
 * 听书专辑与普通音乐专辑共用一套 ID 空间（`album_id`），
 * 章节即专辑下的曲目，章节音频用条目里的 `hash` 走普通歌曲的播放链路。
 *
 * 章节在应用内按「酷狗普通歌曲」形态参与播放：
 * - `id`：章节在专辑内的曲目号（`album_audio_id` 口径），与酷狗歌曲口径一致；
 * - `platformId`：章节 `hash`，播放地址 / 歌词等接口以它为键；
 * - `album.platformId`：所属听书专辑号，取链时随请求带上。
 *
 * 章节额外用 `mediaKind: "audiobook"` 标记出来：界面据此把副标题显示为
 * 「听书」而不是歌手名（网易云播客走的是另一套 `type: "radio"` 语义，不受影响）。
 */

import type { CoverType, SongType } from "@/types/main";
import { platformRequest, platformRequestBody } from "./http";
import { KUGOU, normalizeKgSong } from "./kugou";
import { buildCoverSize, toSongType } from "./types";

/** 酷狗听书频道 */
export interface KGAudiobookChannel {
  /** 频道路径片段，同时是本平台对外的分类标识 */
  slug: string;
  /** 频道中文名 */
  name: string;
  /** 频道取材关键字 */
  keyword: string;
  /** 官网频道路径 */
  path: string;
}

/** 酷狗听书专辑（主进程模块的原生形状） */
export interface KGAudiobookAlbum {
  /** 专辑号（字符串） */
  id: string;
  /** 专辑号（数字） */
  albumId: number;
  /** 专辑名 */
  name: string;
  /** 封面 */
  cover: string;
  /** 原始封面 */
  coverOriginal: string;
  /** 播音者 */
  speaker: string;
  /** 播音者列表 */
  speakers: Array<{ id: string; name: string }>;
  /** 章节数 */
  episodeCount: number;
  /** 发行时间 */
  publishTime: string;
  /** 简介 */
  intro: string;
  /** 专辑分类（听书为 2） */
  category: number;
  /** 授权位 */
  privilege: number;
  /** 购买数 */
  buyCount: number;
}

/** 酷狗听书章节（主进程模块的原生形状） */
export interface KGAudiobookChapter {
  /** 章节序号 */
  index: number;
  /** 章节在专辑内的曲目号（字符串） */
  id: string;
  /** 章节在专辑内的曲目号（数字） */
  albumAudioId: number;
  /** 音频号 */
  audioId: number;
  /** 播放 hash */
  hash: string;
  /** 章节标题 */
  title: string;
  /** 播音者 */
  speaker: string;
  /** 时长（秒） */
  duration: number;
  /** 时长（毫秒） */
  durationMs: number;
  /** 文件大小 */
  size: number;
  /** 授权位 */
  privilege: number;
  /** 付费类型 */
  payType: number;
  /** 文件格式 */
  extName: string;
}

/** 主进程频道列表模块的原生返回 */
interface KgAudiobookCategoryResponse {
  code?: number;
  total?: number;
  categories?: KGAudiobookChannel[];
  message?: string;
}

/** 主进程专辑列表模块的原生返回 */
interface KgAudiobookListResponse {
  code?: number;
  category?: { slug: string; name: string; keyword: string };
  page?: number;
  limit?: number;
  total?: number;
  hasMore?: boolean;
  albums?: KGAudiobookAlbum[];
  message?: string;
}

/** 主进程专辑详情模块的原生返回 */
interface KgAudiobookDetailResponse {
  code?: number;
  id?: string;
  albumId?: number;
  name?: string;
  cover?: string;
  coverOriginal?: string;
  speaker?: string;
  speakers?: Array<{ id: string; name: string }>;
  intro?: string;
  publishTime?: string;
  playCount?: number;
  category?: number;
  privilege?: number;
  /** 章节总数 */
  total?: number;
  page?: number;
  limit?: number;
  hasMore?: boolean;
  chapters?: KGAudiobookChapter[];
  message?: string;
}

/**
 * 读取酷狗听书频道列表
 *
 * @returns 频道列表
 */
export const kgAudiobookCategories = async (): Promise<KGAudiobookChannel[]> => {
  const res = await platformRequest<KgAudiobookCategoryResponse>(
    KUGOU,
    "audiobook/category",
  );
  return res?.categories ?? [];
};

/**
 * 把听书专辑归一成应用内的封面条目
 * @param album 酷狗原生听书专辑
 * @returns 应用内封面条目
 */
export const toKgAudiobookCover = (album: KGAudiobookAlbum): CoverType => ({
  id: album.albumId,
  name: album.name,
  cover: album.cover,
  coverSize: buildCoverSize(album.cover),
  description: album.intro,
  creator: { id: 0, name: album.speaker, avatarUrl: undefined },
  count: album.episodeCount,
  playCount: 0,
  platform: KUGOU,
  platformId: String(album.albumId),
});

/**
 * 读取酷狗听书频道下的专辑列表
 * @param category 频道标识（slug、中文名或取材关键字）
 * @param page 页码，从 1 开始
 * @param limit 每页条数
 * @returns 专辑条目、总数与是否还有下一页
 */
export const kgAudiobookList = async (
  category: string,
  page = 1,
  limit = 20,
): Promise<{ albums: CoverType[]; total: number; hasMore: boolean }> => {
  const res = await platformRequestBody<KgAudiobookListResponse>(KUGOU, "audiobook/list", {
    category,
    page,
    limit,
  });
  if (!res || res.code !== 200) {
    throw new Error(res?.message || "读取酷狗听书专辑列表失败");
  }
  return {
    albums: (res.albums ?? []).map(toKgAudiobookCover),
    total: Number(res.total ?? 0),
    hasMore: res.hasMore === true,
  };
};

/**
 * 把听书章节归一成应用内的歌曲条目
 *
 * 章节按酷狗普通歌曲形态构造：平台为酷狗，歌曲号取章节在专辑内的曲目号，
 * 平台主键取章节 hash，专辑取所属听书专辑。
 *
 * 章节不构造 `size`：听书接口给的文件大小是章节音频的体积，
 * 与歌曲列表里「单曲大小」的口径不一致，列表不展示该字段。
 * @param chapter 酷狗原生章节
 * @param album 所属听书专辑
 * @returns 应用内歌曲条目
 */
export const toKgAudiobookChapterSong = (
  chapter: KGAudiobookChapter,
  album: { albumId: number; name: string; cover: string },
): SongType => {
  const song = normalizeKgSong({
    mixSongId: String(chapter.albumAudioId),
    albumAudioId: chapter.albumAudioId,
    hash: chapter.hash,
    name: chapter.title,
    artist: chapter.speaker,
    album: album.name,
    albumId: album.albumId,
    cover: album.cover,
    duration: chapter.durationMs,
    pay: { privilege: chapter.privilege },
  });
  return {
    ...toSongType(song),
    mediaKind: "audiobook",
  };
};

/**
 * 读取酷狗听书专辑详情与章节
 * @param albumId 专辑号（数字专辑号或官网 base36 别名）
 * @param page 章节页码，从 1 开始
 * @param limit 每页章节数
 * @returns 专辑头部、章节列表、章节总数与是否还有下一页
 */
export const kgAudiobookDetail = async (
  albumId: string | number,
  page = 1,
  limit = 30,
): Promise<{
  detail: CoverType;
  chapters: SongType[];
  total: number;
  hasMore: boolean;
}> => {
  const res = await platformRequestBody<KgAudiobookDetailResponse>(
    KUGOU,
    "audiobook/detail",
    { id: String(albumId), page, limit },
  );
  if (!res || res.code !== 200) {
    throw new Error(res?.message || "读取酷狗听书专辑详情失败");
  }
  const album = {
    albumId: Number(res.albumId ?? 0),
    name: String(res.name ?? ""),
    cover: String(res.cover ?? ""),
  };
  return {
    detail: {
      id: album.albumId,
      name: album.name,
      cover: album.cover,
      coverSize: buildCoverSize(album.cover),
      description: res.intro,
      creator: { id: 0, name: res.speaker ?? "", avatarUrl: undefined },
      count: Number(res.total ?? 0),
      playCount: Number(res.playCount ?? 0),
      platform: KUGOU,
      platformId: String(album.albumId),
    },
    chapters: (res.chapters ?? []).map((chapter) => toKgAudiobookChapterSong(chapter, album)),
    total: Number(res.total ?? 0),
    hasMore: res.hasMore === true,
  };
};
