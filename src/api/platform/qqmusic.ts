/**
 * QQ 音乐平台数据层（渲染端）
 *
 * 调用链与网易云完全同构：axios → `/api/qqmusic/<模块名>` → 主进程平台模块。
 * 每个函数负责把 QQ 原生字段归一成网易云字段形状，页面层无需区分平台。
 *
 * 字段对照见 `src/api/platform/types.ts` 顶部表格。
 */

import {
  deriveStableId,
  secureUrl,
  splitArtistsByPlatform,
  toMillisDateTime,
  toMillisTimestamp,
  toNumericId,
} from "./common";
import { platformRequest, platformRequestBody } from "./http";
import { QualityType } from "@/types/main";
import {
  buildCoverSize,
  getAlbumName,
  getArtistNames,
  type PlatformAlbum,
  type PlatformAlbumDetail,
  type PlatformArtist,
  type PlatformArtistDetail,
  type PlatformBoardTrack,
  type PlatformComment,
  type PlatformCommentPage,
  type PlatformCoverEntry,
  type PlatformLeaderboard,
  type PlatformLeaderboardBoard,
  type PlatformLeaderboardDetail,
  type PlatformLeaderboardGroup,
  type PlatformLyric,
  type PlatformLyricTarget,
  type PlatformPlaylist,
  type PlatformPlaylistDetail,
  type PlatformSong,
  type PlatformSongUrl,
} from "./types";

/** QQ 音乐平台标识 */
export const QQ_MUSIC = "qqmusic" as const;

/** QQ 音乐「我喜欢的音乐」系统目录号 */
const LIKED_DIR_ID = 201;

/** QQ 音乐专辑封面直链模板（album.mid 取不到时回落到 album.pmid） */
const ALBUM_COVER_TEMPLATE = "https://y.gtimg.cn/music/photo_new/T002R300x300M000";

/** QQ 音乐歌手头像直链模板（歌手 mid） */
const ARTIST_COVER_TEMPLATE = "https://y.gtimg.cn/music/photo_new/T001R300x300M000";

/** QQ 音乐热歌榜榜单号 */
const HOT_TOPLIST_ID = 26;

/**
 * QQ 音乐搜索单页条数上限
 *
 * 上游移动端搜索在 `num_per_page` 超过该值时不再返回结果（总数也归零），
 * 页面按 50 条一页请求会拿到空结果，故在数据层收敛到上游可用上限。
 */
export const QQ_SEARCH_PAGE_LIMIT = 40;

/** 主进程 QQ 搜索模块的原生返回 */
interface QqSearchResponse {
  code?: number;
  total?: number;
  songs?: Array<Record<string, any>>;
  message?: string;
}

/** 主进程 QQ 歌单列表模块的原生返回 */
interface QqPlaylistListResponse {
  code?: number;
  total?: number;
  owned?: Array<Record<string, any>>;
  favorites?: Array<Record<string, any>>;
  message?: string;
}

/** 主进程 QQ 歌单详情模块的原生返回 */
interface QqPlaylistDetailResponse {
  code?: number;
  id?: string;
  name?: string;
  creator?: string;
  cover?: string;
  description?: string;
  total?: number;
  hasmore?: number;
  songs?: Array<Record<string, any>>;
  message?: string;
}

/** 主进程 QQ 播放地址模块的原生返回 */
interface QqSongUrlResponse {
  code?: number;
  mid?: string;
  available?: boolean;
  url?: string;
  level?: string;
  label?: string;
  format?: string;
  isFallback?: boolean;
  isTrial?: boolean;
  payPlay?: number;
  reason?: string;
  message?: string;
}

/** 主进程 QQ 歌词模块的原生返回 */
interface QqLyricResponse {
  code?: number;
  id?: string;
  lrc?: string;
  qrc?: string;
  trans?: string;
  roma?: string;
  message?: string;
}

/** 主进程 QQ 评论模块的原生返回 */
interface QqCommentResponse {
  code?: number;
  id?: string;
  total?: number;
  hasMore?: boolean;
  nextCursor?: string;
  comments?: Array<Record<string, any>>;
  message?: string;
}

/**
 * 拼 QQ 音乐歌手头像直链
 *
 * QQ 的歌手条目（歌曲条目 / 榜单条目 / 歌单条目）只带 `id` / `mid` / `name`，
 * 头像直链需按歌手 mid 从 CDN 拼出；上游给了直链时优先用上游的。
 * @param mid 歌手 mid
 * @param rawCover 上游给出的头像直链
 * @returns 头像直链，取不到时为空串
 */
const buildArtistCover = (mid: string, rawCover?: unknown): string => {
  const upstream = secureUrl(rawCover ?? "");
  if (upstream) return upstream;
  return mid ? `${ARTIST_COVER_TEMPLATE}${mid}.jpg` : "";
};

/**
 * 归一化 QQ 歌手条目
 *
 * 歌手头像按 mid 拼 CDN 直链，保证歌曲卡片与歌手列表都有头像。
 * @param singer 歌手条目
 * @returns 归一化歌手
 */
const normalizeArtist = (singer: Record<string, any>): PlatformArtist => {
  const mid = String(singer?.mid ?? "");
  return {
    id: String(singer?.id ?? ""),
    name: String(singer?.name ?? ""),
    mid: mid || undefined,
    picUrl: buildArtistCover(mid, singer?.cover),
  };
};

/**
 * 归一化 QQ 专辑
 *
 * QQ 的 `album` 有两种形态：
 * - 搜索模块给的是名称字符串，专辑 mid 单独放在 `albumMid`；
 * - 歌单详情模块给的是含 `id` / `mid` / `name` 的对象。
 * 两种形态统一成网易云的 `album` 形状，并按 album mid 拼出封面直链。
 *
 * 专辑数字 id 取上游的 `albumid` / `albumId` / `id`，
 * 都取不到时留空，由 `toSongType` 按 mid 派生稳定数字 id。
 * @param album 原始专辑字段
 * @param albumMid 单独给出的专辑 mid
 * @param albumId 单独给出的专辑 ID
 * @returns 归一化专辑
 */
const normalizeAlbum = (album: unknown, albumMid: string, albumId: string): PlatformAlbum => {
  if (album && typeof album === "object") {
    const source = album as Record<string, any>;
    const mid = String(source.mid ?? source.pmid ?? albumMid ?? "");
    const numericId = source.albumid ?? source.albumId ?? source.id ?? albumId;
    return {
      id: numericId === undefined || numericId === null ? "" : String(numericId),
      platformId: mid || undefined,
      name: String(source.name ?? source.title ?? ""),
      picUrl: mid ? `${ALBUM_COVER_TEMPLATE}${mid}.jpg` : "",
    };
  }
  return {
    id: albumId,
    platformId: albumMid || undefined,
    name: typeof album === "string" ? album : "",
    picUrl: albumMid ? `${ALBUM_COVER_TEMPLATE}${albumMid}.jpg` : "",
  };
};

/**
 * QQ 音乐各音质档位的文件大小与 Hi-Res 规格
 *
 * 主进程有两种下发形态：搜索 / 歌手 / 专辑模块给扁平字段，
 * 榜单 / 刷歌 / 单曲详情模块给上游原始 `file` 对象，此处统一读成同一形状。
 */
interface QqQualityInfo {
  /** 母带档（24bit/192kHz）文件大小 */
  sizeMaster: number;
  /** 128k MP3 文件大小 */
  size128: number;
  /** 320k MP3 文件大小 */
  size320: number;
  /** 无损 FLAC 文件大小 */
  sizeFlac: number;
  /** APE 文件大小 */
  sizeApe: number;
  /** 192k OGG 文件大小 */
  sizeOgg: number;
  /** Hi-Res 文件大小 */
  sizeHiRes: number;
  /** Hi-Res 采样率 */
  sampleRate: number;
  /** Hi-Res 位深 */
  bitDepth: number;
}

/**
 * 读取 QQ 音乐歌曲的各音质档位信息
 *
 * 扁平字段与上游原始 `file` 对象取同一份数据，缺哪边取哪边。
 * @param song QQ 原生歌曲
 * @returns 各音质档位信息
 */
const readQqQualityInfo = (song: Record<string, any>): QqQualityInfo => {
  const file = (song?.file ?? {}) as Record<string, any>;
  const num = (value: unknown): number => Number(value ?? 0) || 0;
  const sizeNew = Array.isArray(file.size_new) ? file.size_new : [];
  return {
    // 母带档：上游 `file.size_new[0]`（实测约 5.5Mbps，对应 24bit/192kHz），
    // 扁平字段 `sizeHiRes` 取的也是这个值。
    sizeMaster: num(song?.sizeHiRes ?? sizeNew[0]),
    size128: num(song?.size128 ?? file.size_128mp3),
    size320: num(song?.size320 ?? file.size_320mp3),
    sizeFlac: num(song?.sizeFlac ?? file.size_flac),
    sizeApe: num(song?.sizeApe ?? file.size_ape),
    sizeOgg: num(song?.sizeOgg ?? file.size_192ogg),
    // Hi-Res 只认上游 `file.size_hires` 与采样率位深，
    // 扁平字段的 `sizeHiRes` 取的是母带档，不是 Hi-Res。
    sizeHiRes: num(file.size_hires),
    sampleRate: num(song?.hiResSampleRate ?? file.hires_sample),
    bitDepth: num(song?.hiResBitDepth ?? file.hires_bitdepth),
  };
};

/**
 * 按网易云口径推导 QQ 音乐歌曲音质档位
 *
 * 取该歌曲实际提供的最高档位，优先级与网易云一致：
 * 超清母带 > Hi-Res > 无损 > 320k > 192k > 128k。
 * @param info 各音质档位信息
 * @returns 音质档位，上游未给任何档位时返回 undefined
 */
const resolveQqQuality = (info: QqQualityInfo): QualityType | undefined => {
  if (info.sizeMaster > 0) return QualityType.Master;
  if (info.sizeHiRes > 0 || (info.sampleRate > 0 && info.bitDepth > 0)) {
    return QualityType.HiRes;
  }
  if (info.sizeFlac > 0 || info.sizeApe > 0) return QualityType.SQ;
  if (info.size320 > 0) return QualityType.HQ;
  if (info.sizeOgg > 0) return QualityType.MQ;
  if (info.size128 > 0) return QualityType.LQ;
  return undefined;
};

/**
 * 归一化 QQ 歌曲
 *
 * 平台原生字段 → 网易云字段：
 * `id`（songid）→ `id`；`mid` → `platformId`；`artist` → `artists[].name`；
 * `album` → `album.name`；`cover` → `cover`；`duration` 已是毫秒。
 *
 * 付费判据取上游 `pay` 对象：`pay_play` 非 0 表示 VIP 专享，
 * `price_album` 非 0 表示需购买专辑。
 *
 * 音质档位取上游各音质文件大小推导，口径与网易云一致（见 `resolveQqQuality`）。
 * 原唱/翻唱上游没有判据，恒为空。
 * @param song QQ 原生歌曲
 * @returns 归一化歌曲
 */
export const normalizeQqSong = (song: Record<string, any>): PlatformSong => {
  const cover = secureUrl(song?.cover ?? "");
  const album = normalizeAlbum(
    song?.album,
    String(song?.albumMid ?? ""),
    String(song?.albumId ?? ""),
  );
  const albumCover = cover || album.picUrl;
  const artists: PlatformArtist[] = Array.isArray(song?.artists)
    ? song.artists.map(normalizeArtist)
    : splitArtistsByPlatform(song?.artist, QQ_MUSIC);
  // 付费标记：QQ 上游的 pay 字段是下划线口径
  const pay = (song?.pay ?? {}) as Record<string, any>;
  const payPlay = Number(pay.pay_play ?? pay.payplay ?? 0);
  const priceAlbum = Number(pay.price_album ?? pay.payalbum ?? 0);

  return {
    id: Number(song?.id) || 0,
    name: String(song?.name ?? ""),
    artists,
    album: {
      ...album,
      picUrl: albumCover,
    },
    duration: Number(song?.duration ?? 0),
    // QQ 付费标记：需购买专辑 → 4，VIP 专享 → 1
    fee: priceAlbum > 0 ? 4 : payPlay > 0 ? 1 : 0,
    quality: resolveQqQuality(readQqQualityInfo(song)),
    mv: null,
    cover: albumCover,
    coverSize: buildCoverSize(albumCover),
    platform: QQ_MUSIC,
    platformId: String(song?.mid ?? "") || undefined,
  };
};

/**
 * 归一化 QQ 歌单条目
 *
 * `dirType` 区分目录语义：0 为自建歌单，3 为收藏（订阅）歌单。
 * 上游的创建 / 更新时间是秒级时间戳，这里统一换算为毫秒口径。
 * @param playlist QQ 原生歌单条目
 * @returns 归一化歌单
 */
export const normalizeQqPlaylist = (playlist: Record<string, any>): PlatformPlaylist => {
  const cover = secureUrl(playlist?.cover ?? "");
  const dirType = Number(playlist?.dirType ?? 0);
  const subscribed = dirType === 3;
  const dirId = Number(playlist?.dirId ?? 0) || undefined;
  return {
    id: playlist?.tid ?? playlist?.id ?? "",
    name: String(playlist?.dirName ?? playlist?.name ?? ""),
    coverImgUrl: cover,
    coverSize: buildCoverSize(cover),
    trackCount: Number(playlist?.songNum ?? 0),
    playCount: Number(playlist?.listenNum ?? 0),
    description: String(playlist?.description ?? ""),
    creator: {
      id: "",
      name: String(playlist?.creator ?? ""),
    },
    createTime: toMillisTimestamp(playlist?.createTime),
    updateTime: toMillisTimestamp(playlist?.updateTime),
    platform: QQ_MUSIC,
    platformId: String(playlist?.tid ?? playlist?.id ?? "") || undefined,
    owned: !subscribed,
    subscribed,
    dirId,
    isLiked: dirId === LIKED_DIR_ID,
  };
};

/**
 * 归一化 QQ 歌单详情
 * @param detail QQ 原生歌单详情
 * @returns 归一化歌单详情
 */
export const normalizeQqPlaylistDetail = (
  detail: QqPlaylistDetailResponse,
): PlatformPlaylistDetail => {
  const cover = secureUrl(detail?.cover ?? "");
  return {
    id: detail?.id ?? "",
    name: String(detail?.name ?? ""),
    coverImgUrl: cover,
    coverSize: buildCoverSize(cover),
    trackCount: Number(detail?.total ?? 0),
    playCount: 0,
    description: String(detail?.description ?? ""),
    creator: {
      id: "",
      name: String(detail?.creator ?? ""),
    },
    platform: QQ_MUSIC,
    platformId: String(detail?.id ?? "") || undefined,
    tracks: (detail?.songs ?? []).map(normalizeQqSong),
    hasMore: Number(detail?.hasmore ?? 0) > 0,
  };
};

/**
 * 归一化 QQ 播放地址
 * @param raw QQ 原生播放地址
 * @returns 归一化播放地址
 */
export const normalizeQqSongUrl = (raw: QqSongUrlResponse): PlatformSongUrl => ({
  id: raw?.mid ?? "",
  available: raw?.available === true,
  url: raw?.url ?? "",
  level: raw?.level,
  label: raw?.label,
  format: raw?.format,
  isFallback: raw?.isFallback === true,
  isTrial: raw?.isTrial === true,
  payPlay: raw?.payPlay,
  reason: raw?.reason,
  message: raw?.message,
});

/**
 * 归一化 QQ 歌词
 * @param raw QQ 原生歌词
 * @returns 归一化歌词
 */
export const normalizeQqLyric = (raw: QqLyricResponse): PlatformLyric => ({
  lrc: { lyric: raw?.lrc ?? "" },
  tlyric: { lyric: raw?.trans ?? "" },
  romalrc: { lyric: raw?.roma ?? "" },
  yrc: { lyric: raw?.qrc ?? "" },
});

/**
 * 归一化 QQ 评论条目
 * @param raw QQ 原生评论
 * @returns 归一化评论
 */
export const normalizeQqComment = (raw: Record<string, any>): PlatformComment => ({
  id: raw?.id ?? "",
  content: String(raw?.content ?? ""),
  // QQ 的 publishTime 为秒，评论区按毫秒口径消费
  time: toMillisTimestamp(raw?.publishTime) ?? 0,
  likedCount: Number(raw?.praiseNum ?? 0),
  liked: false,
  user: {
    id: raw?.encryptedUin ?? "",
    name: String(raw?.nick ?? ""),
    avatarUrl: secureUrl(raw?.avatar ?? ""),
  },
});

/**
 * 归一化 QQ 评论分页
 * @param raw QQ 原生评论分页
 * @returns 归一化评论分页
 */
export const normalizeQqCommentPage = (raw: QqCommentResponse): PlatformCommentPage => ({
  comments: (raw?.comments ?? []).map(normalizeQqComment),
  total: Number(raw?.total ?? 0),
  more: raw?.hasMore === true,
  cursor: raw?.nextCursor,
});

/**
 * 搜索 QQ 音乐歌曲
 * @param keywords 搜索关键词
 * @param page 页码（从 1 开始）
 * @param limit 每页数量
 * @returns 归一化后的歌曲列表与总数
 */
export const qqSearch = async (
  keywords: string,
  page = 1,
  limit = 30,
): Promise<{ total: number; songs: PlatformSong[] }> => {
  const res = await platformRequest<QqSearchResponse>(QQ_MUSIC, "search", {
    keywords,
    page,
    limit: Math.min(limit, QQ_SEARCH_PAGE_LIMIT),
    type: 0,
  });
  return {
    total: Number(res?.total ?? 0),
    songs: (res?.songs ?? []).map(normalizeQqSong),
  };
};

/**
 * 解析 QQ 音乐歌曲的播放地址
 * @param song 归一化歌曲（或直接给歌曲 mid）
 * @param level 首选音质档位
 * @returns 归一化后的播放地址（含可播性与试听判据）
 */
export const qqSongUrl = async (
  song: PlatformSong | string,
  level = "hq",
): Promise<PlatformSongUrl> => {
  const mid = typeof song === "string" ? song : (song.platformId ?? String(song.id));
  // 失败原因（付费 / 无授权 / 凭证异常）放在响应体里，
  // 这里取回业务体而不直接抛异常，交给播放层翻译成用户可读提示。
  const res = await platformRequestBody<QqSongUrlResponse>(QQ_MUSIC, "song_url", { mid, level });
  return normalizeQqSongUrl(res);
};

/**
 * 读取 QQ 音乐歌词
 * @param song 归一化歌曲、应用内歌曲或直接给歌曲 ID
 * @returns 归一化后的歌词
 */
export const qqLyric = async (
  song: PlatformSong | PlatformLyricTarget | string,
): Promise<PlatformLyric> => {
  const isRaw = typeof song === "string";
  const res = await platformRequest<QqLyricResponse>(QQ_MUSIC, "lyric", {
    id: isRaw ? song : song.id,
    name: isRaw ? "" : song.name,
    artist: isRaw ? "" : getArtistNames(song.artists),
    album: isRaw ? "" : getAlbumName(song.album),
    // QQ 歌词接口的 interval 单位为秒
    duration: isRaw ? 0 : Math.round(song.duration / 1000),
  });
  return normalizeQqLyric(res);
};

/**
 * 读取 QQ 音乐歌曲评论
 * @param song 归一化歌曲（或直接给歌曲 mid）
 * @param type 评论类型：hot 热门 / new 最新
 * @param page 页码（从 1 开始）
 * @param limit 每页数量
 * @param cursor 游标，取上一页返回的 nextCursor
 * @returns 归一化后的评论分页
 */
export const qqComment = async (
  song: PlatformSong | string,
  type: "hot" | "new" = "hot",
  page = 1,
  limit = 20,
  cursor = "",
): Promise<PlatformCommentPage> => {
  const mid = typeof song === "string" ? song : (song.platformId ?? String(song.id));
  const res = await platformRequest<QqCommentResponse>(QQ_MUSIC, "comment", {
    mid,
    type,
    page,
    limit,
    cursor,
  });
  return normalizeQqCommentPage(res);
};

/** 主进程 QQ「我喜欢的音乐」模块的原生返回 */
interface QqLikedSongsResponse {
  code?: number;
  tid?: string | number;
  dirId?: number;
  total?: number;
  hasmore?: number;
  songs?: Array<Record<string, any>>;
  message?: string;
}

/**
 * 读取当前 QQ 音乐账号的歌单列表（自建 + 收藏，两类分开返回）
 *
 * 自建与收藏在 QQ 侧是两套目录语义（`dirType` 0 / 3），
 * 页面层需要区分「创建的歌单」与「收藏的歌单」两组，故分开返回。
 * @returns 自建歌单与收藏歌单
 */
export const qqUserPlaylistList = async (): Promise<{
  owned: PlatformPlaylist[];
  favorites: PlatformPlaylist[];
}> => {
  const res = await platformRequest<QqPlaylistListResponse>(QQ_MUSIC, "user_playlist_list");
  return {
    owned: (res?.owned ?? []).map(normalizeQqPlaylist),
    favorites: (res?.favorites ?? []).map(normalizeQqPlaylist),
  };
};

/**
 * 读取一张 QQ 音乐歌单的详情与曲目（支持分页）
 *
 * QQ 歌单详情单页上限 100 首，超出部分按 `song_begin` 递增取后续分页。
 * @param id 歌单 tid
 * @param options.dirId 歌单目录号（自建歌单需要）
 * @param options.songBegin 起始曲目位置（从 0 开始）
 * @param options.songNum 本次取回的曲目数
 * @returns 归一化后的歌单详情
 */
export const qqPlaylistDetailPage = async (
  id: string | number,
  options: { dirId?: number; songBegin?: number; songNum?: number } = {},
): Promise<PlatformPlaylistDetail> => {
  const res = await platformRequest<QqPlaylistDetailResponse>(QQ_MUSIC, "playlist_detail", {
    id,
    dirId: options.dirId ?? 0,
    song_begin: options.songBegin ?? 0,
    song_num: options.songNum ?? 100,
  });
  return normalizeQqPlaylistDetail(res);
};

/**
 * 归一化 QQ「我喜欢的音乐」模块的返回
 *
 * 该模块只回曲目与总数，不回歌单名与封面，歌单名按平台语义补齐。
 * @param raw QQ 原生返回
 * @returns 归一化歌单详情
 */
export const normalizeQqLikedSongs = (raw: QqLikedSongsResponse): PlatformPlaylistDetail => ({
  id: String(raw?.tid ?? ""),
  name: "我喜欢的音乐",
  coverImgUrl: "",
  coverSize: buildCoverSize(""),
  trackCount: Number(raw?.total ?? 0),
  playCount: 0,
  creator: { id: "", name: "" },
  platform: QQ_MUSIC,
  platformId: String(raw?.tid ?? "") || undefined,
  tracks: (raw?.songs ?? []).map(normalizeQqSong),
  hasMore: Number(raw?.hasmore ?? 0) > 0,
});

/**
 * 读取 QQ 音乐账号「我喜欢的音乐」的曲目
 *
 * 「我喜欢的音乐」是系统目录（dirId=201），主进程模块按目录号定位其 tid 后取曲。
 * @param songBegin 起始曲目位置（从 0 开始）
 * @param songNum 本次取回的曲目数
 * @returns 归一化后的歌单详情
 */
export const qqUserLikedSongs = async (
  songBegin = 0,
  songNum = 100,
): Promise<PlatformPlaylistDetail> => {
  const res = await platformRequest<QqLikedSongsResponse>(QQ_MUSIC, "user_liked_songs", {
    song_begin: songBegin,
    song_num: songNum,
  });
  return normalizeQqLikedSongs(res);
};

/** QQ 音乐搜索分类（与主进程搜索模块的 type 口径一致） */
const QQ_SEARCH_TYPE = {
  /** 单曲 */
  song: 0,
  /** 专辑 */
  album: 8,
  /** 歌手 */
  artist: 9,
  /** 歌单 */
  playlist: 2,
} as const;

/**
 * QQ 搜索结果条目（网易云形状）
 *
 * 平台原生字段按网易云 `/cloudsearch` 的条目形状重排，
 * 渲染端再交给既有格式化函数（`formatCoverList` / `formatArtistsList`）归一。
 */
export interface QqSearchCoverEntry {
  /** 条目 id（歌单为 dissid，专辑为 album mid） */
  id: number | string;
  /** 专辑数字 id（仅专辑条目有） */
  albumId?: string;
  /** 名称 */
  name: string;
  /** 封面直链 */
  cover: string;
  /** 曲目数 */
  trackCount: number;
  /** 播放量 */
  playCount?: number;
  /** 创建者昵称 */
  creator?: { nickname: string };
  /** 简介 */
  description?: string;
  /** 发行时间（毫秒） */
  publishTime?: number;
}

/** QQ 搜索歌手条目（网易云形状） */
export interface QqSearchArtistEntry {
  /** 歌手 id（QQ 为 mid 字符串） */
  id: number | string;
  /** 歌手名 */
  name: string;
  /** 头像直链 */
  cover: string;
  /** 专辑数 */
  albumSize: number;
  /** 单曲数 */
  musicSize: number;
  /** 粉丝数 */
  fans?: number;
}

/** QQ 热搜条目 */
export interface QqHotSearchEntry {
  /** 排名 */
  rank: number;
  /** 热搜词 */
  keyword: string;
  /** 热度分 */
  score: number;
  /** 封面直链 */
  cover: string;
  /** 描述 */
  description: string;
}

/** 主进程 QQ 搜索模块的分类返回 */
interface QqSearchCategoryResponse {
  code?: number;
  total?: number;
  albums?: Array<Record<string, any>>;
  artists?: Array<Record<string, any>>;
  playlists?: Array<Record<string, any>>;
  message?: string;
}

/** 主进程 QQ 热搜模块的原生返回 */
interface QqHotSearchResponse {
  code?: number;
  total?: number;
  list?: Array<Record<string, any>>;
  message?: string;
}

/**
 * 归一化 QQ 搜索到的专辑
 * @param album QQ 原生专辑条目
 * @returns 网易云形状的专辑条目
 */
const normalizeQqSearchAlbum = (album: Record<string, any>): QqSearchCoverEntry => ({
  id: album?.id ?? album?.albumId ?? "",
  albumId: String(album?.albumId ?? ""),
  name: String(album?.name ?? ""),
  cover: secureUrl(album?.cover ?? ""),
  trackCount: Number(album?.trackCount ?? 0),
  creator: { nickname: String(album?.artist ?? "") },
});

/**
 * 归一化 QQ 搜索到的歌单
 * @param playlist QQ 原生歌单条目
 * @returns 网易云形状的歌单条目
 */
const normalizeQqSearchPlaylist = (playlist: Record<string, any>): QqSearchCoverEntry => ({
  id: playlist?.id ?? "",
  name: String(playlist?.name ?? ""),
  cover: secureUrl(playlist?.cover ?? ""),
  trackCount: Number(playlist?.trackCount ?? 0),
  playCount: Number(playlist?.playCount ?? 0),
  creator: { nickname: String(playlist?.creator ?? "") },
});

/**
 * 归一化 QQ 搜索到的歌手
 * @param artist QQ 原生歌手条目
 * @returns 网易云形状的歌手条目
 */
const normalizeQqSearchArtist = (artist: Record<string, any>): QqSearchArtistEntry => ({
  id: artist?.id ?? "",
  name: String(artist?.name ?? ""),
  // 上游给了 singerPic 直链时优先用上游的，否则按歌手 mid 拼 CDN 直链
  cover: buildArtistCover(String(artist?.id ?? ""), artist?.cover),
  albumSize: Number(artist?.albumCount ?? 0),
  musicSize: Number(artist?.songCount ?? 0),
});

/**
 * 搜索 QQ 音乐专辑
 * @param keywords 搜索关键词
 * @param page 页码（从 1 开始）
 * @param limit 每页数量
 * @returns 归一化后的专辑列表与总数
 */
export const qqSearchAlbums = async (
  keywords: string,
  page = 1,
  limit = 30,
): Promise<{ total: number; albums: QqSearchCoverEntry[] }> => {
  const res = await platformRequest<QqSearchCategoryResponse>(QQ_MUSIC, "search", {
    keywords,
    page,
    limit: Math.min(limit, QQ_SEARCH_PAGE_LIMIT),
    type: QQ_SEARCH_TYPE.album,
  });
  return {
    total: Number(res?.total ?? 0),
    albums: (res?.albums ?? []).map(normalizeQqSearchAlbum),
  };
};

/**
 * 搜索 QQ 音乐歌手
 * @param keywords 搜索关键词
 * @param page 页码（从 1 开始）
 * @param limit 每页数量
 * @returns 归一化后的歌手列表与总数
 */
export const qqSearchArtists = async (
  keywords: string,
  page = 1,
  limit = 30,
): Promise<{ total: number; artists: QqSearchArtistEntry[] }> => {
  const res = await platformRequest<QqSearchCategoryResponse>(QQ_MUSIC, "search", {
    keywords,
    page,
    limit: Math.min(limit, QQ_SEARCH_PAGE_LIMIT),
    type: QQ_SEARCH_TYPE.artist,
  });
  return {
    total: Number(res?.total ?? 0),
    artists: (res?.artists ?? []).map(normalizeQqSearchArtist),
  };
};

/**
 * 搜索 QQ 音乐歌单
 * @param keywords 搜索关键词
 * @param page 页码（从 1 开始）
 * @param limit 每页数量
 * @returns 归一化后的歌单列表与总数
 */
export const qqSearchPlaylists = async (
  keywords: string,
  page = 1,
  limit = 30,
): Promise<{ total: number; playlists: QqSearchCoverEntry[] }> => {
  const res = await platformRequest<QqSearchCategoryResponse>(QQ_MUSIC, "search", {
    keywords,
    page,
    limit: Math.min(limit, QQ_SEARCH_PAGE_LIMIT),
    type: QQ_SEARCH_TYPE.playlist,
  });
  return {
    total: Number(res?.total ?? 0),
    playlists: (res?.playlists ?? []).map(normalizeQqSearchPlaylist),
  };
};

/**
 * 读取 QQ 音乐站内热搜榜
 * @returns 归一化后的热搜条目与总数
 */
export const qqHotSearch = async (): Promise<{ total: number; list: QqHotSearchEntry[] }> => {
  const res = await platformRequest<QqHotSearchResponse>(QQ_MUSIC, "hot_search");
  return {
    total: Number(res?.total ?? 0),
    list: (res?.list ?? []).map((item) => ({
      rank: Number(item?.rank ?? 0),
      keyword: String(item?.keyword ?? ""),
      score: Number(item?.score ?? 0),
      cover: secureUrl(item?.cover ?? ""),
      description: String(item?.description ?? ""),
    })),
  };
};

/** 主进程 QQ 榜单模块的原生返回 */
interface QqLeaderboardResponse {
  code?: number;
  title?: string;
  subTitle?: string;
  cover?: string;
  updateTime?: string;
  total?: number;
  songs?: Array<Record<string, any>>;
  message?: string;
}

/** 主进程 QQ 歌手模块的原生返回 */
interface QqArtistResponse {
  code?: number;
  artist?: {
    mid?: string;
    name?: string;
    songCount?: number;
    albumCount?: number;
  };
  songs?: Array<Record<string, any>>;
  albums?: Array<Record<string, any>>;
  message?: string;
}

/** 主进程 QQ 专辑模块的原生返回 */
interface QqAlbumResponse {
  code?: number;
  mid?: string;
  albumMid?: string;
  total?: number;
  album?: { mid?: string; name?: string; artist?: string };
  songs?: Array<Record<string, any>>;
  message?: string;
}

/** 主进程 QQ 歌单广场模块的原生返回 */
interface QqSongListResponse {
  code?: number;
  mode?: string;
  total?: number;
  list?: Array<Record<string, any>>;
  message?: string;
}

/** 主进程 QQ 歌单广场详情模式的原生返回 */
interface QqSongListDetailResponse {
  code?: number;
  mode?: string;
  id?: string;
  name?: string;
  description?: string;
  creator?: string;
  cover?: string;
  createTime?: number;
  playCount?: number;
  commentCount?: number;
  total?: number;
  songs?: Array<Record<string, any>>;
  message?: string;
}

/**
 * 读取 QQ 音乐排行榜
 *
 * 榜单以 `topid` 定位，缺省取热歌榜（26）。
 * @param topid 榜单号
 * @param limit 本次取回的歌曲数
 * @param offset 歌曲偏移
 * @returns 归一化后的榜单
 */
export const qqLeaderboard = async (
  topid = HOT_TOPLIST_ID,
  limit = 50,
  offset = 0,
): Promise<PlatformLeaderboard> => {
  const res = await platformRequest<QqLeaderboardResponse>(QQ_MUSIC, "leaderboard", {
    topid,
    limit,
    offset,
  });
  return {
    title: String(res?.title ?? ""),
    subTitle: String(res?.subTitle ?? ""),
    cover: secureUrl(res?.cover ?? ""),
    total: Number(res?.total ?? 0),
    songs: (res?.songs ?? []).map(normalizeQqSong),
  };
};

/** 主进程 QQ 榜单清单模块的原生返回 */
interface QqLeaderboardListResponse {
  code?: number;
  total?: number;
  groups?: Array<{
    groupId?: number;
    groupName?: string;
    toplists?: Array<Record<string, any>>;
  }>;
  message?: string;
}

/** 主进程 QQ 榜单详情模块的原生返回 */
interface QqLeaderboardDetailResponse {
  code?: number;
  topid?: number;
  title?: string;
  subTitle?: string;
  intro?: string;
  period?: string;
  updateTime?: string;
  cover?: string;
  total?: number;
  songs?: Array<Record<string, any>>;
  message?: string;
}

/**
 * 归一化榜单卡片里的曲目预览
 *
 * 榜单清单源给出前几首时才有值，
 * 平台清单源不带曲目时返回空数组，卡片据此只保留信息位。
 * @param board 主进程返回的榜单条目
 * @returns 曲名 / 歌手两段式的预览条目
 */
const normalizeQqBoardTracks = (board: Record<string, any>): PlatformBoardTrack[] => {
  const list = Array.isArray(board?.tracks) ? board.tracks : [];
  return list.slice(0, 3).map((item) => ({
    first: String(item?.title ?? item?.name ?? ""),
    second: String(item?.singer ?? item?.artist ?? ""),
  }));
};

/**
 * 归一化 QQ 榜单条目
 *
 * 更新时间在归一化层统一转成毫秒时间戳：
 * 上游给的是日期文本（如 `2026-10-23`），直接渲染会显示成原始字符串。
 * @param board 主进程返回的榜单条目
 * @param groupName 所属分组名
 * @returns 归一化榜单条目
 */
const normalizeQqBoard = (
  board: Record<string, any>,
  groupName: string,
): PlatformLeaderboardBoard => ({
  topId: Number(board?.topId ?? 0),
  title: String(board?.title ?? ""),
  subTitle: String(board?.subTitle ?? ""),
  intro: String(board?.intro ?? ""),
  period: String(board?.period ?? ""),
  updateTime: toMillisDateTime(board?.updateTime),
  tracks: normalizeQqBoardTracks(board),
  cover: String(board?.cover ?? ""),
  total: Number(board?.total ?? 0),
  groupName,
});

/**
 * 读取 QQ 音乐榜单清单
 *
 * 榜单体系按分组下发（巅峰榜 / 地区榜 / 特色榜 / 全球榜 / 网络榜），
 * 先取清单，再按榜单号取详情。
 * @returns 按分组组织的榜单清单
 */
export const qqLeaderboardList = async (): Promise<PlatformLeaderboardGroup[]> => {
  const res = await platformRequest<QqLeaderboardListResponse>(QQ_MUSIC, "leaderboard_list");
  return (res?.groups ?? []).map((group) => ({
    groupId: Number(group?.groupId ?? 0),
    groupName: String(group?.groupName ?? ""),
    toplists: (group?.toplists ?? []).map((board) =>
      normalizeQqBoard(board, String(group?.groupName ?? "")),
    ),
  }));
};

/**
 * 读取 QQ 音乐单个榜单的详情
 * @param topId 榜单号
 * @param limit 取回的曲目数
 * @returns 榜单信息与曲目
 */
export const qqLeaderboardDetail = async (
  topId: number,
  limit = 100,
): Promise<PlatformLeaderboardDetail> => {
  const res = await platformRequest<QqLeaderboardDetailResponse>(QQ_MUSIC, "leaderboard_detail", {
    topid: topId,
    limit,
  });
  return {
    title: String(res?.title ?? ""),
    subTitle: String(res?.subTitle ?? ""),
    cover: String(res?.cover ?? ""),
    total: Number(res?.total ?? 0),
    songs: (res?.songs ?? []).map(normalizeQqSong),
  };
};

/**
 * 读取 QQ 音乐歌手详情、热门歌曲与专辑
 *
 * 歌手以 mid 定位；歌曲条目里的歌手同时带数字 id 与 mid，
 * 由此可补齐歌手的数字主键。
 * @param mid 歌手 mid
 * @param limit 本次取回的歌曲数
 * @param offset 歌曲偏移
 * @returns 归一化后的歌手详情、歌曲与专辑
 */
export const qqArtistDetail = async (
  mid: string,
  limit = 50,
  offset = 0,
): Promise<{
  artist: PlatformArtistDetail;
  songs: PlatformSong[];
  albums: PlatformCoverEntry[];
}> => {
  const res = await platformRequest<QqArtistResponse>(QQ_MUSIC, "artist", { mid, limit, offset });
  const songs = (res?.songs ?? []).map(normalizeQqSong);
  const albums: PlatformCoverEntry[] = (res?.albums ?? []).map((item) => {
    const albumMid = String(item?.mid ?? "");
    return {
      id: albumMid,
      platformId: albumMid,
      name: String(item?.name ?? ""),
      cover: albumMid ? `${ALBUM_COVER_TEMPLATE}${albumMid}.jpg` : "",
      count: Number(item?.trackCount ?? 0),
      creatorName: String(item?.artist ?? ""),
      platform: QQ_MUSIC,
    };
  });
  // 歌手的数字 id：取歌曲条目里与自身 mid 对应的歌手数字 id，取不到时按 mid 派生
  const self = songs.flatMap((song) => song.artists).find((artist) => artist.mid === mid);
  const cover = buildArtistCover(mid);
  const artist: PlatformArtistDetail = {
    id: toNumericId(self?.id, mid),
    platformId: String(res?.artist?.mid ?? mid),
    platform: QQ_MUSIC,
    name: String(res?.artist?.name ?? ""),
    cover,
    coverSize: buildCoverSize(cover),
    musicSize: Number(res?.artist?.songCount ?? songs.length),
    albumSize: Number(res?.artist?.albumCount ?? albums.length),
    mvSize: 0,
    fansSize: 0,
    description: "",
  };
  return { artist, songs, albums };
};

/**
 * 读取 QQ 音乐专辑详情与专辑歌曲
 * @param mid 专辑 mid
 * @returns 归一化后的专辑详情与歌曲
 */
export const qqAlbumDetail = async (
  mid: string,
): Promise<{ album: PlatformAlbumDetail; songs: PlatformSong[] }> => {
  const res = await platformRequest<QqAlbumResponse>(QQ_MUSIC, "album", { mid });
  const albumMid = String(res?.albumMid ?? res?.mid ?? mid);
  const cover = albumMid ? `${ALBUM_COVER_TEMPLATE}${albumMid}.jpg` : "";
  const songs = (res?.songs ?? []).map(normalizeQqSong);
  const album: PlatformAlbumDetail = {
    id: albumMid,
    platformId: albumMid,
    name: String(res?.album?.name ?? ""),
    cover,
    coverSize: buildCoverSize(cover),
    artist: String(res?.album?.artist ?? ""),
    count: Number(res?.total ?? songs.length),
    description: "",
  };
  return { album, songs };
};

/**
 * 读取 QQ 音乐公开歌单详情（广场歌单）
 *
 * 广场歌单走 `song_list` 模块的详情模式，歌单名 / 封面 / 创建者都在该端点里。
 * 创建时间为秒级时间戳，这里统一换算为毫秒口径。
 * @param id 歌单号
 * @returns 归一化后的歌单详情
 */
export const qqPublicPlaylistDetail = async (
  id: string | number,
): Promise<PlatformPlaylistDetail> => {
  const res = await platformRequest<QqSongListDetailResponse>(QQ_MUSIC, "song_list", {
    id: String(id),
  });
  const cover = secureUrl(res?.cover ?? "");
  return {
    id: String(res?.id ?? id),
    name: String(res?.name ?? ""),
    coverImgUrl: cover,
    coverSize: buildCoverSize(cover),
    trackCount: Number(res?.total ?? 0),
    playCount: Number(res?.playCount ?? 0),
    description: String(res?.description ?? ""),
    creator: {
      id: "",
      name: String(res?.creator ?? ""),
    },
    createTime: toMillisTimestamp(res?.createTime),
    platform: QQ_MUSIC,
    platformId: String(res?.id ?? id),
    tracks: (res?.songs ?? []).map(normalizeQqSong),
    hasMore: false,
  };
};

/**
 * 读取 QQ 音乐歌单广场
 *
 * 走 `song_list` 模块的广场模式（不传歌单号）。
 * @param page 页码（从 1 开始）
 * @param limit 每页条数
 * @returns 归一化后的广场歌单与总数
 */
export const qqPlaylistSquare = async (
  page = 1,
  limit = 30,
): Promise<{ list: PlatformCoverEntry[]; total: number }> => {
  const res = await platformRequest<QqSongListResponse>(QQ_MUSIC, "song_list", { page, limit });
  const list: PlatformCoverEntry[] = (res?.list ?? []).map((item) => ({
    id: String(item?.id ?? ""),
    platformId: String(item?.id ?? ""),
    name: String(item?.name ?? ""),
    cover: secureUrl(item?.cover ?? ""),
    playCount: Number(item?.playCount ?? 0),
    creatorName: String(item?.creator ?? ""),
    description: String(item?.description ?? ""),
    platform: QQ_MUSIC,
  }));
  return { list, total: Number(res?.total ?? list.length) };
};

/** 主进程首页推荐模块的原生返回（歌单 / 专辑条目） */
interface QqHomeCoverResponse {
  code?: number;
  total?: number;
  list?: Array<{
    id?: string;
    name?: string;
    cover?: string;
    playCount?: number;
    creatorName?: string;
    createTime?: number;
  }>;
}

/** 主进程首页推荐模块的原生返回（歌手条目） */
interface QqHomeSingerResponse {
  code?: number;
  total?: number;
  list?: Array<{
    id?: string;
    mid?: string;
    name?: string;
    cover?: string;
  }>;
}

/** 主进程首页推荐模块的原生返回（专辑条目） */
interface QqHomeAlbumResponse {
  code?: number;
  total?: number;
  list?: Array<{
    id?: string;
    mid?: string;
    name?: string;
    artist?: string;
    releaseTime?: string;
    trackCount?: number;
  }>;
}

/**
 * QQ 音乐首页「精选歌单」的分类清单
 *
 * 分类 id 是上游歌单广场的分类号（`titleid`），
 * 五组分类对应广场的五类官方标签。
 */
export const QQ_HOME_SQUARE_CATEGORIES = [
  { id: 3317, name: "官方歌单" },
  { id: 59, name: "经典歌单" },
  { id: 71, name: "情感歌单" },
  { id: 3056, name: "网络歌单" },
  { id: 64, name: "KTV歌单" },
] as const;

/**
 * 拼接歌手头像直链
 *
 * 上游给的是 150 像素的小图，卡片里按 300 像素的模板重拼，
 * 歌手主键取不到时回落到上游直链。
 * @param mid 歌手主键
 * @param rawCover 上游头像直链
 * @returns 头像直链
 */
const buildHomeSingerCover = (mid: string, rawCover: unknown): string =>
  mid ? `${ARTIST_COVER_TEMPLATE}${mid}.jpg` : secureUrl(rawCover ?? "");

/**
 * 读取 QQ 音乐首页「为你推荐」歌单
 *
 * 走主进程 `home/recommend` 模块（上游编辑推荐歌单）。
 * @param limit 取回的条数
 * @returns 归一化后的封面条目
 */
export const qqHomeRecommend = async (limit?: number): Promise<PlatformCoverEntry[]> => {
  const res = await platformRequest<QqHomeCoverResponse>(QQ_MUSIC, "home/recommend", { limit });
  return (res?.list ?? []).map((item) => ({
    id: item.id ?? "",
    platformId: item.id ?? "",
    name: item.name ?? "",
    cover: secureUrl(item.cover ?? ""),
    playCount: Number(item.playCount ?? 0),
    creatorName: item.creatorName ?? "",
    publishTime: toMillisTimestamp(item.createTime),
    platform: QQ_MUSIC,
  }));
};

/**
 * 读取 QQ 音乐首页「精选歌单」的分类歌单
 *
 * 走主进程 `home/square` 模块（上游歌单广场）。
 * @param category 分类号
 * @param limit 取回的条数
 * @returns 归一化后的封面条目与总数
 */
export const qqHomeSquare = async (
  category: number,
  limit?: number,
): Promise<{ list: PlatformCoverEntry[]; total: number }> => {
  const res = await platformRequest<QqHomeCoverResponse>(QQ_MUSIC, "home/square", {
    category,
    limit,
  });
  const list: PlatformCoverEntry[] = (res?.list ?? []).map((item) => ({
    id: item.id ?? "",
    platformId: item.id ?? "",
    name: item.name ?? "",
    cover: secureUrl(item.cover ?? ""),
    playCount: Number(item.playCount ?? 0),
    creatorName: item.creatorName ?? "",
    publishTime: toMillisTimestamp(item.createTime),
    platform: QQ_MUSIC,
  }));
  return { list, total: Number(res?.total ?? list.length) };
};

/**
 * 读取 QQ 音乐首页「歌手推荐」
 *
 * 走主进程 `home/singer` 模块（上游歌手列表）。
 * @param limit 取回的条数
 * @returns 归一化后的歌手
 */
export const qqHomeSingers = async (limit?: number): Promise<PlatformArtistDetail[]> => {
  const res = await platformRequest<QqHomeSingerResponse>(QQ_MUSIC, "home/singer", { limit });
  return (res?.list ?? []).map((item) => {
    const mid = item.mid ?? "";
    const cover = buildHomeSingerCover(mid, item.cover);
    return {
      id: toNumericId(item.id, mid),
      platformId: mid,
      platform: QQ_MUSIC,
      name: item.name ?? "",
      cover,
      coverSize: buildCoverSize(cover),
      musicSize: 0,
      albumSize: 0,
      mvSize: 0,
      fansSize: 0,
      description: "",
    };
  });
};

/**
 * 读取 QQ 音乐首页「新碟上架」
 *
 * 走主进程 `home/album` 模块（上游新碟列表），曲目数由主进程回查补齐。
 * @param limit 取回的条数
 * @returns 归一化后的封面条目
 */
export const qqHomeAlbums = async (limit?: number): Promise<PlatformCoverEntry[]> => {
  const res = await platformRequest<QqHomeAlbumResponse>(QQ_MUSIC, "home/album", { limit });
  return (res?.list ?? []).map((item) => {
    const mid = item.mid ?? "";
    return {
      id: mid,
      platformId: mid,
      name: item.name ?? "",
      cover: mid ? `${ALBUM_COVER_TEMPLATE}${mid}.jpg` : "",
      count: Number(item.trackCount ?? 0),
      creatorName: item.artist ?? "",
      publishTime: toMillisDateTime(item.releaseTime),
      platform: QQ_MUSIC,
    };
  });
};

/**
 * 归一化 QQ 搜索到的歌手条目（补齐平台维度）
 * @param artist QQ 原生歌手条目
 * @returns 归一化歌手
 */
export const toQqArtistEntry = (artist: Record<string, any>): PlatformArtistDetail => {
  const mid = String(artist?.id ?? "");
  const cover = secureUrl(artist?.cover ?? "");
  return {
    // 搜索结果的歌手 id 就是 mid，没有平台数字 id，按 mid 派生稳定数字 id
    id: deriveStableId(mid),
    platformId: mid,
    platform: QQ_MUSIC,
    name: String(artist?.name ?? ""),
    cover,
    coverSize: buildCoverSize(cover),
    musicSize: Number(artist?.musicSize ?? 0),
    albumSize: Number(artist?.albumSize ?? 0),
    mvSize: 0,
    fansSize: Number(artist?.fans ?? 0),
    description: "",
  };
};

/**
 * 归一化 QQ 搜索到的歌单条目（补齐平台维度）
 * @param playlist QQ 原生歌单条目
 * @returns 归一化封面条目
 */
export const toQqPlaylistEntry = (playlist: QqSearchCoverEntry): PlatformCoverEntry => ({
  id: playlist.id,
  platformId: String(playlist.id),
  name: playlist.name,
  cover: playlist.cover,
  count: playlist.trackCount,
  playCount: playlist.playCount,
  creatorName: playlist.creator?.nickname,
  platform: QQ_MUSIC,
});

/**
 * 归一化 QQ 搜索到的专辑条目（补齐平台维度）
 * @param album QQ 原生专辑条目
 * @returns 归一化封面条目
 */
export const toQqAlbumEntry = (album: QqSearchCoverEntry): PlatformCoverEntry => ({
  id: album.id,
  platformId: String(album.id),
  name: album.name,
  cover: album.cover,
  count: album.trackCount,
  creatorName: album.creator?.nickname,
  platform: QQ_MUSIC,
});
