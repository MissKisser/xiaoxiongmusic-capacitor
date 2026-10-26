/**
 * 酷狗音乐平台数据层（渲染端）
 *
 * 调用链与网易云完全同构：axios → `/api/kugou/<模块名>` → 主进程平台模块。
 * 每个函数负责把酷狗原生字段归一成网易云字段形状，页面层无需区分平台。
 *
 * 字段对照见 `src/api/platform/types.ts` 顶部表格。
 *
 * 平台标识约定：
 * - `id`：酷狗的 `mixSongId`（`album_audio_id` 口径，数字），与网易云同为数字，便于复用 `SongType.id`；
 * - `platformId`：酷狗的 `hash`（字符串主键），播放地址 / 歌词等接口以它为键。
 */

import {
  normalizeArtistEntry,
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
  type PlatformAlbumDetail,
  type PlatformArtist,
  type PlatformArtistDetail,
  type PlatformBoardTrack,
  type PlatformComment,
  type PlatformCommentPage,
  type PlatformCoverEntry,
  type PlatformLeaderboardBoard,
  type PlatformLeaderboardDetail,
  type PlatformLeaderboardGroup,
  type PlatformLyric,
  type PlatformLyricTarget,
  type PlatformPlaylist,
  type PlatformPlaylistDetail,
  type PlatformSong,
  type PlatformSongUrl,
  type PlatformThemeCard,
} from "./types";

/** 酷狗平台标识 */
export const KUGOU = "kugou" as const;

/**
 * 规范化酷狗歌曲 hash
 *
 * 酷狗的内容哈希（`hash` / `FileHash`）在不同上游通道里大小写不一致，
 * 而应用内多处把它当身份键用（写操作定位、播放取链、原唱判据查表）。
 * 统一为大写后，同一首歌在各链路口径一致，不会因大小写不同而互相认不出。
 * @param hash 原始 hash
 * @returns 规范化后的 hash
 */
export const normalizeKgHash = (hash: unknown): string => String(hash ?? "").trim().toUpperCase();

/** 主进程酷狗搜索模块的原生返回 */
interface KgSearchResponse {
  code?: number;
  total?: number;
  songs?: Array<Record<string, any>>;
  /** 上游原始响应（原唱/翻唱判据取自这里） */
  raw?: unknown;
  message?: string;
}

/** 主进程酷狗歌单列表模块的原生返回 */
interface KgPlaylistListResponse {
  code?: number;
  total?: number;
  owned?: Array<Record<string, any>>;
  favorites?: Array<Record<string, any>>;
  message?: string;
}

/** 主进程酷狗歌单详情模块的原生返回 */
interface KgPlaylistDetailResponse {
  code?: number;
  id?: string;
  name?: string;
  cover?: string;
  total?: number;
  hasMore?: boolean;
  songs?: Array<Record<string, any>>;
  /** 上游原始响应（原唱/翻唱判据取自这里） */
  raw?: unknown;
  /** 是否为收藏（订阅）歌单 */
  subscribed?: boolean;
  /** 收藏歌单的源歌单是否可读 */
  sourceReadable?: boolean;
  /** 收藏歌单的源歌单名 */
  sourceName?: string;
  /** 收藏歌单的源歌单曲目数 */
  sourceCount?: number;
  message?: string;
}

/** 主进程酷狗播放地址模块的原生返回 */
interface KgSongUrlResponse {
  code?: number;
  url?: string;
  quality?: string;
  requestedQuality?: string;
  downgraded?: boolean;
  size?: number;
  bitrate?: number;
  status?: number;
  privilege?: number | null;
  isTrial?: boolean;
  trial?: { duration?: number };
  message?: string;
}

/** 主进程酷狗歌词模块的原生返回 */
interface KgLyricResponse {
  code?: number;
  hash?: string;
  fmt?: string;
  lrc?: string;
  krc?: string;
  trans?: string;
  roma?: string;
  message?: string;
}

/** 主进程酷狗评论模块的原生返回 */
interface KgCommentResponse {
  code?: number;
  total?: number;
  hasMore?: boolean;
  nextCursor?: string;
  comments?: Array<Record<string, any>>;
  /** 当前页码 */
  page?: number;
  /** 总页数 */
  maxPage?: number;
  message?: string;
}

/**
 * 填充酷狗图片模板里的尺寸占位符
 *
 * 酷狗的封面地址把尺寸写成 `{size}` 占位符，直接用会 404。
 * @param url 原始地址
 * @param size 实际尺寸
 * @returns 可直接访问的封面地址
 */
const fillCover = (url: unknown, size = 300): string =>
  secureUrl(String(url ?? "").replace(/\{size\}/g, String(size)));

/**
 * 归一化酷狗歌手条目
 * @param singer 歌手条目
 * @returns 归一化歌手
 */
const normalizeArtist = (singer: Record<string, any>): PlatformArtist =>
  normalizeArtistEntry(singer);

/** 酷狗授权位：完全免费可播 */
const KG_PRIVILEGE_FREE = 0;

/** 酷狗授权位：非会员可免费播放（低码率），会员可播高码率 */
const KG_PRIVILEGE_FREE_FOR_AD = 8;

/** 酷狗音质档位名（主进程归一化后的 `qualities` / `sizes` 键名） */
const KG_QUALITY_TIER = {
  /** Hi-Res（24bit） */
  hiRes: "flac24bit",
  /** 无损 */
  lossless: "flac",
  /** 高质量 320k */
  hq: "320k",
  /** 低质量 128k */
  lq: "128k",
} as const;

/**
 * 取酷狗曲目的基档授权位
 *
 * 判据优先级：
 * 1. 歌曲级基档授权位（`pay.privilege`，上游 `privilege` /
 *    `copyright.qualities['128'].privilege`）；
 * 2. 各音质档位里码率最低那一档的授权位（上游按档下发授权位时的口径）。
 *
 * 基档（最低码率）决定这首曲子能不能免费播：
 * 基档为 `0` 时账号可播，高档被锁只是会员权益差异。
 * @param song 酷狗原生歌曲
 * @returns 基档授权位，取不到时为 null
 */
const pickBasePrivilege = (song: Record<string, any>): number | null => {
  const songLevel = Number(song?.pay?.privilege ?? song?.privilege ?? Number.NaN);
  if (Number.isFinite(songLevel)) return songLevel;
  const qualities = song?.qualities;
  if (!Array.isArray(qualities) || qualities.length === 0) return null;
  const tiers = qualities
    .map((item: Record<string, any>) => ({
      bitrate: Number(item?.bitrate ?? 0),
      privilege: Number(item?.privilege ?? 0),
    }))
    .sort((left, right) => left.bitrate - right.bitrate);
  // 优先取声明了码率的最低档，码率全缺时退回第一档
  const base = tiers.find((tier) => tier.bitrate > 0) ?? tiers[0];
  return base?.privilege ?? null;
};

/**
 * 按基档授权位推导酷狗歌曲的付费标记
 *
 * 口径与网易云一致：
 * 0 完全免费 / 8 非会员可免费播放低音质 / 其余为会员墙（VIP）。
 * @param privilege 基档授权位
 * @returns 付费标记
 */
const resolveKgFee = (privilege: number | null): 0 | 1 | 8 => {
  if (privilege === null) return 0;
  if (privilege === KG_PRIVILEGE_FREE) return 0;
  if (privilege === KG_PRIVILEGE_FREE_FOR_AD) return 8;
  return 1;
};

/**
 * 按网易云口径推导酷狗歌曲音质档位
 *
 * 取该歌曲实际提供的最高档位，优先级与网易云一致：
 * Hi-Res > 无损 > 320k > 128k。
 * @param song 酷狗原生歌曲
 * @returns 音质档位，上游未给任何档位时返回 undefined
 */
const resolveKgQuality = (song: Record<string, any>): QualityType | undefined => {
  const sizes = (song?.sizes ?? {}) as Record<string, number>;
  const qualities = Array.isArray(song?.qualities) ? (song.qualities as string[]) : [];
  const has = (tier: string): boolean => Number(sizes?.[tier] ?? 0) > 0 || qualities.includes(tier);
  if (has(KG_QUALITY_TIER.hiRes)) return QualityType.HiRes;
  if (has(KG_QUALITY_TIER.lossless)) return QualityType.SQ;
  if (has(KG_QUALITY_TIER.hq)) return QualityType.HQ;
  if (has(KG_QUALITY_TIER.lq)) return QualityType.LQ;
  return undefined;
};

/**
 * 酷狗原唱/翻唱索引：歌曲 hash → 1 原唱 | 2 翻唱
 */
type KgOriginalIndex = Map<string, number>;

/**
 * 读取酷狗上游条目的原唱/翻唱判据
 *
 * 判据来源：
 * - `isoriginal` / `IsOriginal`：1 原唱，0 非原创（翻唱 / 改编 / 现场版）；
 * - `trans_param.is_original`：1 原唱，其余非零值按非原创作（翻唱）处理。
 * @param item 酷狗上游条目
 * @returns 1 原唱 | 2 翻唱，上游没给判据时返回 undefined
 */
const readKgOriginalFlag = (item: Record<string, any>): number | undefined => {
  const top = item?.isoriginal ?? item?.IsOriginal;
  if (top === 0 || top === 1) return top === 1 ? 1 : 2;
  const nested = Number(item?.trans_param?.is_original);
  if (!Number.isFinite(nested) || nested <= 0) return undefined;
  return nested === 1 ? 1 : 2;
};

/**
 * 从上游原始响应里建立「原唱/翻唱」索引
 *
 * 主进程各模块把上游原始载荷放在 `raw` 里（搜索 / 歌手 / 专辑 / 歌单），
 * 曲目条目带 `hash`（兜底 `FileHash`）与原唱判据，按 hash 建索引供归一化查表。
 * @param raw 上游原始响应
 * @returns hash → 1 原唱 | 2 翻唱 的索引
 */
const buildKgOriginalIndex = (raw: unknown): KgOriginalIndex => {
  const index: KgOriginalIndex = new Map();
  const visit = (node: unknown, depth: number): void => {
    if (!node || typeof node !== "object" || depth > 6) return;
    if (Array.isArray(node)) {
      node.forEach((item) => visit(item, depth + 1));
      return;
    }
    const record = node as Record<string, any>;
    const hash = normalizeKgHash(record.hash ?? record.FileHash ?? "");
    if (hash) {
      const flag = readKgOriginalFlag(record);
      if (flag !== undefined) index.set(hash, flag);
      return;
    }
    Object.values(record).forEach((value) => visit(value, depth + 1));
  };
  visit(raw, 0);
  return index;
};

/**
 * 归一化酷狗歌曲
 *
 * 平台原生字段 → 网易云字段：
 * `mixSongId`（歌曲主键，album_audio_id 口径）→ `id`；`hash` → `platformId`；
 * `singername` → `artists[].name`；`album_name` → `album.name`；
 * `img` 模板 → `cover`；`duration` 已是毫秒。
 *
 * 歌曲主键说明：云歌单条目的 `audio_id` 恒为 0，不能作主键；
 * 真实主键是 `mixSongId`（`album_audio_id` 口径），播放地址 / 歌词 / 评论均以它为键。
 *
 * 可播性判据：取基档授权位 `privilege`（`0` 可免费播，`8` 低码率免费，其余为会员墙）。
 * `pay_type`（`media_pay_type`）描述的是单个音频文件的版权形态，与可播性无单调关系，不作判据。
 *
 * 音质档位取各档文件大小推导，口径与网易云一致（见 `resolveKgQuality`）。
 * 原唱/翻唱判据取上游原始响应（见 `buildKgOriginalIndex`），上游没给判据时留空。
 * @param song 酷狗原生歌曲
 * @param originalIndex 原唱/翻唱索引，按 hash 查表
 * @returns 归一化歌曲
 */
export const normalizeKgSong = (
  song: Record<string, any>,
  originalIndex?: KgOriginalIndex,
): PlatformSong => {
  const cover = fillCover(song?.cover ?? song?.img ?? "");
  const artists: PlatformArtist[] = Array.isArray(song?.artists)
    ? song.artists.map(normalizeArtist)
    : splitArtistsByPlatform(song?.artist, KUGOU);
  // 付费判据：基档授权位（歌曲级 `pay.privilege`，或各音质档位取最低码率那一档）
  const fee = resolveKgFee(pickBasePrivilege(song));
  const hash = normalizeKgHash(song?.hash ?? "");

  return {
    id: Number(song?.mixSongId ?? song?.albumAudioId ?? song?.audioId ?? song?.audio_id ?? 0) || 0,
    name: String(song?.name ?? song?.songname ?? ""),
    artists,
    album: {
      id: String(song?.albumId ?? song?.album_id ?? song?.albumid ?? ""),
      platformId: String(song?.albumId ?? song?.album_id ?? song?.albumid ?? "") || undefined,
      name: String(song?.album ?? song?.album_name ?? ""),
      picUrl: cover,
    },
    duration: Number(song?.duration ?? 0),
    // 酷狗：基档授权位非免费口径即视为不可免费播放
    fee,
    quality: resolveKgQuality(song),
    originCoverType: hash ? originalIndex?.get(hash) : undefined,
    mv: null,
    cover,
    coverSize: buildCoverSize(cover),
    platform: KUGOU,
    platformId: hash || undefined,
  };
};

/**
 * 归一化酷狗刷歌曲目
 *
 * 刷歌模块的 `pay.privilege` 是上游直给的基档授权位，
 * 付费判据与其它酷狗模块同口径（见 `pickBasePrivilege`）。
 * @param song 酷狗刷歌原生歌曲
 * @returns 归一化歌曲
 */
export const normalizeKgSongFM = (song: Record<string, any>): PlatformSong => normalizeKgSong(song);

/**
 * 归一化酷狗歌单条目
 *
 * `type` 区分目录语义：0 为自建歌单，1 为收藏歌单；
 * `isDefault` 标记系统默认歌单（「默认收藏」「我喜欢的歌」）。
 * 上游的创建 / 更新时间是秒级时间戳，这里统一换算为毫秒口径。
 * @param playlist 酷狗原生歌单条目
 * @returns 归一化歌单
 */
export const normalizeKgPlaylist = (playlist: Record<string, any>): PlatformPlaylist => {
  const cover = fillCover(playlist?.cover ?? playlist?.img ?? "");
  const subscribed = Number(playlist?.type ?? 0) === 1;
  return {
    id: playlist?.listid ?? playlist?.id ?? "",
    name: String(playlist?.name ?? ""),
    coverImgUrl: cover,
    coverSize: buildCoverSize(cover),
    trackCount: Number(playlist?.count ?? 0),
    playCount: Number(playlist?.playCount ?? playlist?.listenNum ?? 0),
    description: String(playlist?.intro ?? playlist?.description ?? ""),
    creator: {
      id: "",
      name: String(playlist?.creator ?? ""),
    },
    createTime: toMillisTimestamp(playlist?.createTime ?? playlist?.create_time),
    updateTime: toMillisTimestamp(playlist?.updateTime ?? playlist?.update_time),
    platform: KUGOU,
    platformId: String(playlist?.listid ?? playlist?.id ?? "") || undefined,
    owned: !subscribed,
    subscribed,
    // 系统歌单标记原始值：1 默认收藏，2 我喜欢的歌
    isDef: Number(playlist?.isDef ?? 0),
    isDefault: playlist?.isDefault === true,
    // 收藏歌单的真实标识是源歌单，本地 listid 只是收藏记录号
    originListid: String(playlist?.originListid ?? playlist?.list_create_listid ?? "") || undefined,
    originUserid: String(playlist?.originUserid ?? playlist?.list_create_userid ?? "") || undefined,
    originSpecialid: String(playlist?.originSpecialid ?? playlist?.musiclib_id ?? "") || undefined,
    globalCollectionId:
      String(playlist?.globalCollectionId ?? playlist?.global_collection_id ?? "") || undefined,
  };
};

/**
 * 归一化酷狗歌单详情
 * @param detail 酷狗原生歌单详情
 * @returns 归一化歌单详情
 */
export const normalizeKgPlaylistDetail = (
  detail: KgPlaylistDetailResponse,
): PlatformPlaylistDetail => {
  const cover = fillCover(detail?.cover ?? "");
  const originalIndex = buildKgOriginalIndex(detail?.raw);
  return {
    id: detail?.id ?? "",
    name: "",
    coverImgUrl: cover,
    coverSize: buildCoverSize(cover),
    trackCount: Number(detail?.total ?? 0),
    playCount: 0,
    creator: { id: "", name: "" },
    platform: KUGOU,
    platformId: String(detail?.id ?? "") || undefined,
    tracks: (detail?.songs ?? []).map((song) => normalizeKgSong(song, originalIndex)),
    hasMore: detail?.hasMore === true,
    // 收藏歌单的源歌单可读性：源歌单不可读时曲目为空，界面据此给出明确说明
    subscribed: detail?.subscribed === true,
    sourceReadable: detail?.sourceReadable,
    sourceName: detail?.sourceName,
    sourceCount: detail?.sourceCount,
  };
};

/**
 * 归一化酷狗播放地址
 *
 * 可播性判据全部透出：播放状态 `status`（1 可播 / 2 付费墙 / 3 无授权）、
 * 资源授权位 `privilege`、是否官方试听片段 `isTrial` 与试听时长 `trialDuration`。
 * @param raw 酷狗原生播放地址
 * @returns 归一化播放地址
 */
export const normalizeKgSongUrl = (raw: KgSongUrlResponse): PlatformSongUrl => ({
  id: "",
  available: Boolean(raw?.url),
  url: raw?.url ?? "",
  level: raw?.quality,
  isFallback: raw?.downgraded === true,
  isTrial: raw?.isTrial === true,
  status: raw?.status,
  privilege: raw?.privilege ?? null,
  trialDuration: Number(raw?.trial?.duration ?? 0) || undefined,
  // 未登录时模块返回 301，翻译成明确的登录缺失原因
  reason: raw?.code === 301 ? "need_login" : undefined,
  message: raw?.message,
});

/**
 * 归一化酷狗歌词
 * @param raw 酷狗原生歌词
 * @returns 归一化歌词
 */
export const normalizeKgLyric = (raw: KgLyricResponse): PlatformLyric => ({
  lrc: { lyric: raw?.lrc ?? "" },
  tlyric: { lyric: raw?.trans ?? "" },
  romalrc: { lyric: raw?.roma ?? "" },
  yrc: { lyric: raw?.krc ?? "" },
});

/**
 * 归一化酷狗评论条目
 * @param raw 酷狗原生评论
 * @returns 归一化评论
 */
export const normalizeKgComment = (raw: Record<string, any>): PlatformComment => ({
  id: raw?.id ?? "",
  content: String(raw?.content ?? ""),
  // 酷狗 addtime 为 `YYYY-MM-DD HH:mm:ss` 文本
  time: Date.parse(String(raw?.time ?? "").replace(/-/g, "/")) || 0,
  likedCount: Number(raw?.likedCount ?? 0),
  liked: false,
  user: {
    id: raw?.user?.id ?? "",
    name: String(raw?.user?.name ?? ""),
    avatarUrl: secureUrl(raw?.user?.avatar ?? ""),
  },
});

/**
 * 归一化酷狗评论分页
 *
 * 酷狗评论接口不给 `hasMore`，改用「当前页 < 总页数」判定是否还有更多。
 * @param raw 酷狗原生评论分页
 * @returns 归一化评论分页
 */
export const normalizeKgCommentPage = (raw: KgCommentResponse): PlatformCommentPage => {
  const page = Number(raw?.page ?? 1);
  const maxPage = Number(raw?.maxPage ?? 0);
  return {
    comments: (raw?.comments ?? []).map(normalizeKgComment),
    total: Number(raw?.total ?? 0),
    more: raw?.hasMore === true || (maxPage > 0 && page < maxPage),
    cursor: raw?.nextCursor,
  };
};

/**
 * 搜索酷狗歌曲
 * @param keywords 搜索关键词
 * @param page 页码（从 1 开始）
 * @param limit 每页数量
 * @returns 归一化后的歌曲列表与总数
 */
export const kgSearch = async (
  keywords: string,
  page = 1,
  limit = 30,
): Promise<{ total: number; songs: PlatformSong[] }> => {
  const res = await platformRequest<KgSearchResponse>(KUGOU, "search", {
    keywords,
    page,
    limit,
    type: 0,
  });
  const originalIndex = buildKgOriginalIndex(res?.raw);
  return {
    total: Number(res?.total ?? 0),
    songs: (res?.songs ?? []).map((song) => normalizeKgSong(song, originalIndex)),
  };
};

/**
 * 读取当前酷狗账号的歌单列表（自建与收藏分开返回）
 *
 * 酷狗侧自建（type=0）与收藏（type=1）是两套目录语义，
 * 页面层需要区分「创建的歌单」与「收藏的歌单」两组，故分开返回。
 * @returns 自建歌单与收藏歌单
 */
export const kgUserPlaylistList = async (): Promise<{
  owned: PlatformPlaylist[];
  favorites: PlatformPlaylist[];
}> => {
  const res = await platformRequest<KgPlaylistListResponse>(KUGOU, "user_playlist_list");
  return {
    owned: (res?.owned ?? []).map(normalizeKgPlaylist),
    favorites: (res?.favorites ?? []).map(normalizeKgPlaylist),
  };
};

/**
 * 酷狗系统歌单标记（上游 `is_def` 原始值）
 *
 * 1 是「默认收藏」，2 是「我喜欢的歌」。
 * 「我喜欢的歌」的歌单号按账号分配，没有跨账号通用的固定值，
 * 因此读侧按这个语义定位，与写操作侧（`playlist_tracks` 的 `is_def === 2` 口径）一致。
 */
export const KG_SYSTEM_LIST_LIKED = 2;

/**
 * 酷狗「我喜欢的歌」歌单号候选（仅作兜底）
 *
 * 仅在上游没有回 `is_def` 字段时启用；系统歌单号在多数账号下落在 4 / 3 / 1，
 * 但歌单号是账号内分配的，换账号后不保证命中，故不能作为主判据。
 */
const LIKED_PLAYLIST_IDS = ["4", "3", "1"];

/**
 * 从自建歌单里定位「我喜欢的歌」
 *
 * 判据按可靠性排序：
 * 1. **系统歌单标记 `is_def === 2`**：上游直接标明「我喜欢的歌」，账号内唯一；
 * 2. **系统歌单号候选**：上游缺 `is_def` 时的兜底（歌单号按账号分配，可能指错）；
 * 3. **系统默认歌单**：最后的兜底。
 *
 * 定位始终在**当前账号自己的歌单列表**内进行，
 * 因此不会把上一个账号解析出的歌单号带到新账号。
 * @param owned 自建歌单列表
 * @returns 命中的歌单，未命中时为 null
 */
export const kgFindLikedPlaylist = (owned: PlatformPlaylist[]): PlatformPlaylist | null => {
  // 上游标明的「我喜欢的歌」（is_def === 2）
  const marked = owned.find((playlist) => Number(playlist.isDef ?? 0) === KG_SYSTEM_LIST_LIKED);
  if (marked) return marked;
  // 兜底：系统歌单号候选
  for (const listid of LIKED_PLAYLIST_IDS) {
    const hit = owned.find((playlist) => String(playlist.platformId ?? playlist.id) === listid);
    if (hit) return hit;
  }
  return owned.find((playlist) => playlist.isDefault) ?? null;
};

/**
 * 读取一张酷狗歌单的详情与曲目
 * @param id 歌单 listid
 * @param page 页码（从 1 开始）
 * @param pageSize 每页数量
 * @returns 归一化后的歌单详情
 */
export const kgPlaylistDetail = async (
  id: string | number,
  page = 1,
  pageSize = 300,
): Promise<PlatformPlaylistDetail> => {
  const res = await platformRequest<KgPlaylistDetailResponse>(KUGOU, "playlist_detail", {
    id,
    page,
    pageSize,
  });
  return normalizeKgPlaylistDetail(res);
};

/**
 * 解析酷狗歌曲的播放地址
 * @param song 归一化歌曲（或直接给歌曲 hash）
 * @param quality 首选音质档位
 * @param options 附加定位参数
 * @param options.albumId 专辑号，听书章节等需要带上
 * @param options.albumAudioId 专辑内曲目号，听书章节需要带上
 * @returns 归一化后的播放地址
 */
export const kgSongUrl = async (
  song: PlatformSong | string,
  quality = "hq",
  options: { albumId?: number; albumAudioId?: number } = {},
): Promise<PlatformSongUrl> => {
  const hash = normalizeKgHash(typeof song === "string" ? song : (song.platformId ?? song.id));
  // 播放状态（付费墙 / 无授权）与授权位放在响应体里，
  // 这里取回业务体而不直接抛异常，交给播放层翻译成用户可读提示。
  const res = await platformRequestBody<KgSongUrlResponse>(KUGOU, "song_url", {
    hash,
    quality,
    ...(options.albumId ? { albumId: options.albumId } : {}),
    ...(options.albumAudioId ? { albumAudioId: options.albumAudioId } : {}),
  });
  return { ...normalizeKgSongUrl(res), id: hash };
};

/**
 * 读取酷狗歌词
 * @param song 归一化歌曲、应用内歌曲或直接给歌曲 hash
 * @returns 归一化后的歌词
 */
export const kgLyric = async (
  song: PlatformSong | PlatformLyricTarget | string,
): Promise<PlatformLyric> => {
  const isRaw = typeof song === "string";
  const res = await platformRequest<KgLyricResponse>(KUGOU, "lyric", {
    hash: normalizeKgHash(isRaw ? song : (song.platformId ?? song.id)),
    name: isRaw ? "" : song.name,
    // 酷狗歌词接口的时长单位为秒
    duration: isRaw ? 0 : Math.round(song.duration / 1000),
  });
  return normalizeKgLyric(res);
};

/**
 * 读取酷狗歌曲评论
 *
 * 酷狗评论接口的业务主键是 **album_audio_id** 口径的歌曲主键（即 `mixSongId`），
 * 与播放地址 / 歌词使用的 hash 不是同一个键：传 hash 会直接 HTTP 400。
 *
 * 酷狗评论只有一套列表端点，没有独立的「热门评论」通道，
 * 热门与最新共用同一端点（热门取第一页）。
 * @param song 归一化歌曲（或直接给歌曲 mixSongId）
 * @param page 页码（从 1 开始）
 * @param limit 每页数量
 * @returns 归一化后的评论分页
 */
export const kgComment = async (
  song: PlatformSong | string,
  page = 1,
  limit = 20,
): Promise<PlatformCommentPage> => {
  const mixSongId = typeof song === "string" ? song : String(song.id ?? "");
  const res = await platformRequest<KgCommentResponse>(KUGOU, "comment", {
    mixsongid: mixSongId,
    // 酷狗侧按评论对象类型选评论池，歌曲评论固定走歌曲池
    type: "song",
    page,
    limit,
  });
  return normalizeKgCommentPage(res);
};

/** 酷狗音乐搜索分类（与主进程搜索模块的 type 口径一致） */
const KG_SEARCH_TYPE = {
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
 * 酷狗搜索结果条目（网易云形状）
 *
 * 平台原生字段按网易云 `/cloudsearch` 的条目形状重排，
 * 渲染端再交给既有格式化函数（`formatCoverList` / `formatArtistsList`）归一。
 */
export interface KgSearchCoverEntry {
  /** 条目 id */
  id: number | string;
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

/** 酷狗搜索歌手条目（网易云形状） */
export interface KgSearchArtistEntry {
  /** 歌手 id */
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

/** 主进程酷狗搜索模块的分类返回 */
interface KgSearchCategoryResponse {
  code?: number;
  total?: number;
  albums?: Array<Record<string, any>>;
  artists?: Array<Record<string, any>>;
  playlists?: Array<Record<string, any>>;
  message?: string;
}

/**
 * 归一化酷狗搜索到的专辑
 * @param album 酷狗原生专辑条目
 * @returns 网易云形状的专辑条目
 */
const normalizeKgSearchAlbum = (album: Record<string, any>): KgSearchCoverEntry => ({
  id: album?.id ?? "",
  name: String(album?.name ?? ""),
  cover: fillCover(album?.cover ?? ""),
  trackCount: Number(album?.trackCount ?? 0),
  creator: { nickname: String(album?.artist ?? "") },
  description: album?.intro ? String(album.intro) : undefined,
  publishTime: toMillisTimestamp(album?.publishTime),
});

/**
 * 归一化酷狗搜索到的歌单
 * @param playlist 酷狗原生歌单条目
 * @returns 网易云形状的歌单条目
 */
const normalizeKgSearchPlaylist = (playlist: Record<string, any>): KgSearchCoverEntry => ({
  id: playlist?.id ?? "",
  name: String(playlist?.name ?? ""),
  cover: fillCover(playlist?.cover ?? ""),
  trackCount: Number(playlist?.trackCount ?? 0),
  playCount: Number(playlist?.playCount ?? 0),
  creator: { nickname: String(playlist?.creator ?? "") },
});

/**
 * 归一化酷狗搜索到的歌手
 * @param artist 酷狗原生歌手条目
 * @returns 网易云形状的歌手条目
 */
const normalizeKgSearchArtist = (artist: Record<string, any>): KgSearchArtistEntry => ({
  id: artist?.id ?? "",
  name: String(artist?.name ?? ""),
  cover: fillCover(artist?.cover ?? ""),
  albumSize: Number(artist?.albumCount ?? 0),
  musicSize: Number(artist?.songCount ?? 0),
  fans: Number(artist?.fansCount ?? 0),
});

/**
 * 搜索酷狗音乐专辑
 * @param keywords 搜索关键词
 * @param page 页码（从 1 开始）
 * @param limit 每页数量
 * @returns 归一化后的专辑列表与总数
 */
export const kgSearchAlbums = async (
  keywords: string,
  page = 1,
  limit = 30,
): Promise<{ total: number; albums: KgSearchCoverEntry[] }> => {
  const res = await platformRequest<KgSearchCategoryResponse>(KUGOU, "search", {
    keywords,
    page,
    limit,
    type: KG_SEARCH_TYPE.album,
  });
  return {
    total: Number(res?.total ?? 0),
    albums: (res?.albums ?? []).map(normalizeKgSearchAlbum),
  };
};

/**
 * 搜索酷狗音乐歌手
 * @param keywords 搜索关键词
 * @param page 页码（从 1 开始）
 * @param limit 每页数量
 * @returns 归一化后的歌手列表与总数
 */
export const kgSearchArtists = async (
  keywords: string,
  page = 1,
  limit = 30,
): Promise<{ total: number; artists: KgSearchArtistEntry[] }> => {
  const res = await platformRequest<KgSearchCategoryResponse>(KUGOU, "search", {
    keywords,
    page,
    limit,
    type: KG_SEARCH_TYPE.artist,
  });
  return {
    total: Number(res?.total ?? 0),
    artists: (res?.artists ?? []).map(normalizeKgSearchArtist),
  };
};

/**
 * 搜索酷狗音乐歌单
 * @param keywords 搜索关键词
 * @param page 页码（从 1 开始）
 * @param limit 每页数量
 * @returns 归一化后的歌单列表与总数
 */
export const kgSearchPlaylists = async (
  keywords: string,
  page = 1,
  limit = 30,
): Promise<{ total: number; playlists: KgSearchCoverEntry[] }> => {
  const res = await platformRequest<KgSearchCategoryResponse>(KUGOU, "search", {
    keywords,
    page,
    limit,
    type: KG_SEARCH_TYPE.playlist,
  });
  return {
    total: Number(res?.total ?? 0),
    playlists: (res?.playlists ?? []).map(normalizeKgSearchPlaylist),
  };
};

/** 主进程酷狗歌手模块的原生返回 */
interface KgArtistResponse {
  code?: number;
  artist?: {
    id?: string;
    name?: string;
    cover?: string;
    avatar?: string;
    songCount?: number;
    albumCount?: number;
    mvCount?: number;
    fansCount?: number;
    intro?: string;
  };
  songs?: Array<Record<string, any>>;
  albums?: Array<Record<string, any>>;
  /** 上游原始响应（原唱/翻唱判据取自这里） */
  raw?: unknown;
  message?: string;
}

/** 主进程酷狗专辑模块的原生返回 */
interface KgAlbumResponse {
  code?: number;
  id?: string;
  name?: string;
  cover?: string;
  artist?: string;
  artists?: Array<Record<string, any>>;
  publishTime?: string;
  description?: string;
  total?: number;
  songs?: Array<Record<string, any>>;
  /** 上游原始响应（原唱/翻唱判据取自这里） */
  raw?: unknown;
  message?: string;
}

/** 主进程酷狗公开歌单模块的原生返回 */
interface KgPublicPlaylistResponse {
  code?: number;
  id?: string;
  name?: string;
  description?: string;
  creator?: string;
  cover?: string;
  playCount?: number;
  total?: number;
  songs?: Array<Record<string, any>>;
  /** 上游原始响应（原唱/翻唱判据取自这里） */
  raw?: unknown;
  message?: string;
}

/**
 * 读取酷狗歌手详情、热门歌曲与专辑
 *
 * 歌手以 author_id 定位（平台侧也接受歌手名，会自动反查 id）。
 * @param id 歌手 id
 * @returns 归一化后的歌手详情、歌曲与专辑
 */
export const kgArtistDetail = async (
  id: string | number,
): Promise<{
  artist: PlatformArtistDetail;
  songs: PlatformSong[];
  albums: PlatformCoverEntry[];
}> => {
  const res = await platformRequest<KgArtistResponse>(KUGOU, "artist", { id: String(id) });
  const originalIndex = buildKgOriginalIndex(res?.raw);
  const songs = (res?.songs ?? []).map((song) => normalizeKgSong(song, originalIndex));
  const albums: PlatformCoverEntry[] = (res?.albums ?? []).map((item) => {
    const albumId = String(item?.id ?? "");
    return {
      id: albumId,
      platformId: albumId,
      name: String(item?.name ?? ""),
      cover: fillCover(item?.cover ?? ""),
      count: Number(item?.trackCount ?? 0),
      creatorName: String(item?.artist ?? ""),
      platform: KUGOU,
    };
  });
  const cover = fillCover(res?.artist?.cover ?? "") || fillCover(res?.artist?.avatar ?? "");
  const artist: PlatformArtistDetail = {
    id: toNumericId(res?.artist?.id, String(res?.artist?.id ?? id)),
    platformId: String(res?.artist?.id ?? id),
    platform: KUGOU,
    name: String(res?.artist?.name ?? ""),
    cover,
    coverSize: buildCoverSize(cover),
    musicSize: Number(res?.artist?.songCount ?? songs.length),
    albumSize: Number(res?.artist?.albumCount ?? albums.length),
    mvSize: Number(res?.artist?.mvCount ?? 0),
    fansSize: Number(res?.artist?.fansCount ?? 0),
    description: String(res?.artist?.intro ?? ""),
  };
  return { artist, songs, albums };
};

/**
 * 读取酷狗专辑详情与专辑歌曲
 * @param id 专辑 id
 * @returns 归一化后的专辑详情与歌曲
 */
export const kgAlbumDetail = async (
  id: string | number,
): Promise<{ album: PlatformAlbumDetail; songs: PlatformSong[] }> => {
  const res = await platformRequest<KgAlbumResponse>(KUGOU, "album", { id: String(id) });
  const albumId = String(res?.id ?? id);
  const cover = fillCover(res?.cover ?? "");
  const originalIndex = buildKgOriginalIndex(res?.raw);
  const songs = (res?.songs ?? []).map((song) => normalizeKgSong(song, originalIndex));
  const album: PlatformAlbumDetail = {
    id: albumId,
    platformId: albumId,
    name: String(res?.name ?? ""),
    cover,
    coverSize: buildCoverSize(cover),
    artist: String(res?.artist ?? ""),
    count: Number(res?.total ?? songs.length),
    description: String(res?.description ?? ""),
  };
  return { album, songs };
};

/**
 * 读取酷狗公开歌单（精选歌单）
 *
 * 走 `playlist` 模块，对外公开的精选歌单，无需登录即可访问。
 * @param id 公开歌单 id
 * @param page 页码（从 1 开始）
 * @param pageSize 每页条数
 * @returns 归一化后的公开歌单
 */
export const kgPublicPlaylist = async (
  id: string | number,
  page = 1,
  pageSize = 100,
): Promise<{
  playlist: PlatformCoverEntry;
  songs: PlatformSong[];
  hasMore: boolean;
}> => {
  const res = await platformRequest<KgPublicPlaylistResponse>(KUGOU, "playlist", {
    id: String(id),
    page,
    pageSize,
  });
  const originalIndex = buildKgOriginalIndex(res?.raw);
  const songs = (res?.songs ?? []).map((song) => normalizeKgSong(song, originalIndex));
  const cover = fillCover(res?.cover ?? "");
  const playlist: PlatformCoverEntry = {
    id: String(res?.id ?? id),
    platformId: String(res?.id ?? id),
    name: String(res?.name ?? ""),
    cover,
    count: Number(res?.total ?? songs.length),
    playCount: Number(res?.playCount ?? 0),
    creatorName: String(res?.creator ?? ""),
    description: String(res?.description ?? ""),
    platform: KUGOU,
  };
  return {
    playlist,
    songs,
    hasMore: songs.length >= pageSize && songs.length < Number(res?.total ?? 0),
  };
};

/** 主进程酷狗歌单广场模块的原生返回 */
interface KgPlaylistSquareResponse {
  code?: number;
  total?: number;
  hasMore?: boolean;
  keyword?: string;
  keywordIndex?: number;
  playlists?: Array<Record<string, any>>;
  message?: string;
}

/**
 * 读取酷狗歌单广场
 *
 * 酷狗侧没有公开的广场列表端点，广场按「分类关键词 + 上游真实分页」轮换取材，
 * 页码与条数由主进程模块统一换算，渲染端只负责按页码递进取数。
 *
 * 传 `keyword` 时按该关键词固定翻页（不参与分类轮换），
 * 用于「按场景关键词查看歌单」的入口。
 * @param page 页码（从 1 开始）
 * @param limit 每页条数
 * @param keyword 固定关键词，缺省时按分类关键词轮换
 * @returns 归一化后的广场歌单、总数与是否还有更多
 */
export const kgPlaylistSquare = async (
  page = 1,
  limit = 30,
  keyword?: string,
): Promise<{ list: PlatformCoverEntry[]; total: number; hasMore: boolean }> => {
  const res = await platformRequest<KgPlaylistSquareResponse>(KUGOU, "playlist_square", {
    page,
    limit,
    ...(keyword ? { keyword } : {}),
  });
  const list: PlatformCoverEntry[] = (res?.playlists ?? []).map((item) => ({
    id: String(item?.id ?? ""),
    platformId: String(item?.id ?? ""),
    name: String(item?.name ?? ""),
    cover: String(item?.cover ?? ""),
    count: Number(item?.trackCount ?? 0),
    playCount: Number(item?.playCount ?? 0),
    creatorName: String(item?.creator ?? ""),
    platform: KUGOU,
  }));
  return {
    list,
    total: Number(res?.total ?? list.length),
    hasMore: res?.hasMore === true,
  };
};

/**
 * 归一化酷狗搜索到的歌手条目（补齐平台维度）
 * @param artist 酷狗原生歌手条目
 * @returns 归一化歌手
 */
export const toKgArtistEntry = (artist: Record<string, any>): PlatformArtistDetail => {
  const authorId = String(artist?.id ?? "");
  const cover = fillCover(artist?.cover ?? "");
  return {
    id: toNumericId(authorId, authorId),
    platformId: authorId,
    platform: KUGOU,
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
 * 归一化酷狗搜索到的歌单条目（补齐平台维度）
 * @param playlist 酷狗原生歌单条目
 * @returns 归一化封面条目
 */
export const toKgPlaylistEntry = (playlist: KgSearchCoverEntry): PlatformCoverEntry => ({
  id: playlist.id,
  platformId: String(playlist.id),
  name: playlist.name,
  cover: playlist.cover,
  count: playlist.trackCount,
  playCount: playlist.playCount,
  creatorName: playlist.creator?.nickname,
  platform: KUGOU,
});

/**
 * 归一化酷狗搜索到的专辑条目（补齐平台维度）
 * @param album 酷狗原生专辑条目
 * @returns 归一化封面条目
 */
export const toKgAlbumEntry = (album: KgSearchCoverEntry): PlatformCoverEntry => ({
  id: album.id,
  platformId: String(album.id),
  name: album.name,
  cover: album.cover,
  count: album.trackCount,
  creatorName: album.creator?.nickname,
  publishTime: album.publishTime,
  platform: KUGOU,
});

/** 酷狗默认榜单号（TOP500） */
export const KG_DEFAULT_RANK_ID = 8888;

/** 主进程酷狗榜单清单模块的原生返回 */
interface KgLeaderboardListResponse {
  code?: number;
  total?: number;
  groups?: Array<{
    groupId?: number;
    groupName?: string;
    toplists?: Array<Record<string, any>>;
  }>;
  message?: string;
}

/** 主进程酷狗榜单详情模块的原生返回 */
interface KgLeaderboardDetailResponse {
  code?: number;
  title?: string;
  subTitle?: string;
  intro?: string;
  cover?: string;
  period?: string;
  updateTime?: string;
  listenCount?: number;
  total?: number;
  page?: number;
  limit?: number;
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
const normalizeKgBoardTracks = (board: Record<string, any>): PlatformBoardTrack[] => {
  const list = Array.isArray(board?.tracks) ? board.tracks : [];
  return list.slice(0, 3).map((item) => ({
    first: String(item?.title ?? item?.name ?? ""),
    second: String(item?.singer ?? item?.artist ?? ""),
  }));
};

/**
 * 归一化酷狗榜单条目
 *
 * 榜单号取 `rankid`（主进程把清单条目的 `topId` 与 `rankId` 都归一到它），
 * 封面在主进程已替换好尺寸（300px），此处原样带出。
 *
 * 更新时间在归一化层统一转成毫秒时间戳：
 * 上游给的是日期文本（如 `2026-10-23 08:30:01`），直接渲染会显示成原始字符串。
 * @param board 主进程返回的榜单条目
 * @param groupName 所属分组名
 * @returns 归一化榜单条目
 */
const normalizeKgBoard = (
  board: Record<string, any>,
  groupName: string,
): PlatformLeaderboardBoard => ({
  topId: Number(board?.topId ?? board?.rankId ?? 0),
  title: String(board?.title ?? ""),
  subTitle: String(board?.subTitle ?? ""),
  intro: String(board?.intro ?? ""),
  period: String(board?.period ?? ""),
  updateTime: toMillisDateTime(board?.updateTime),
  tracks: normalizeKgBoardTracks(board),
  cover: String(board?.cover ?? ""),
  total: Number(board?.total ?? 0),
  groupName,
});

/**
 * 归一化酷狗榜单曲目
 *
 * 沿用歌单曲目的映射口径：`hash` → `platformId`（播放地址 / 歌词以它为键）、
 * `mixSongId` → 数字 `id`、封面 / 歌手 / 时长照既有映射。
 *
 * 付费判据的差异：榜单曲目只给歌曲级授权位（`pay.privilege`），
 * 不像歌单曲目那样按音质分档下发，故按歌曲级授权位判定
 * （`0` 完全免费、`8` 低码率免费，其余为会员墙）。
 * @param song 酷狗原生榜单曲目
 * @returns 归一化曲目
 */
const normalizeKgLeaderboardSong = (song: Record<string, any>): PlatformSong => {
  const normalized = normalizeKgSong(song);
  const fee = resolveKgFee(pickBasePrivilege(song));
  // 歌曲主键缺失时按 hash 派生稳定数字 id，保证列表内不出现重复 id
  const id = toNumericId(
    normalized.id || song?.mixSongId || song?.albumAudioId,
    String(song?.hash ?? ""),
  );
  return { ...normalized, id, fee };
};

/**
 * 读取酷狗音乐榜单清单
 *
 * 榜单体系按分组下发（巅峰榜 / 地区榜 / 特色榜 / 全球榜 / 曲风榜），
 * 先取清单，再按榜单号取详情。
 * @param groupId 分组号（classify），不传则返回全部分组
 * @returns 按分组组织的榜单清单
 */
export const kgLeaderboardList = async (groupId?: number): Promise<PlatformLeaderboardGroup[]> => {
  const res = await platformRequest<KgLeaderboardListResponse>(KUGOU, "leaderboard_list", {
    groupId,
  });
  return (res?.groups ?? []).map((group) => ({
    groupId: Number(group?.groupId ?? 0),
    groupName: String(group?.groupName ?? ""),
    toplists: (group?.toplists ?? []).map((board) =>
      normalizeKgBoard(board, String(group?.groupName ?? "")),
    ),
  }));
};

/**
 * 读取酷狗音乐单个榜单的详情
 *
 * 榜单以 `rankid` 定位，曲目按页取回（热门榜单动辄数百首）。
 * @param rankId 榜单号
 * @param page 页码（从 1 开始）
 * @param limit 每页曲目数
 * @returns 榜单信息与本页曲目
 */
export const kgLeaderboardDetail = async (
  rankId: number,
  page = 1,
  limit = 100,
): Promise<PlatformLeaderboardDetail> => {
  const res = await platformRequest<KgLeaderboardDetailResponse>(KUGOU, "leaderboard_detail", {
    rankid: rankId,
    page,
    limit,
  });
  const total = Number(res?.total ?? 0);
  return {
    title: String(res?.title ?? ""),
    subTitle: String(res?.subTitle ?? ""),
    cover: String(res?.cover ?? ""),
    total,
    songs: (res?.songs ?? []).map(normalizeKgLeaderboardSong),
    hasMore: page * limit < total,
  };
};

/** 酷狗歌手分类项 */
export interface KgArtistType {
  /** 分类标识（上游分类键，音乐人维度非 0 时带 `:musician` 后缀） */
  id: string;
  /** 分类名 */
  name: string;
}

/** 酷狗热门歌手列表结果 */
export interface KgHotArtistsResult {
  /** 分类清单（上游下发，页面据此切换筛选） */
  types: KgArtistType[];
  /** 歌手条目 */
  artists: PlatformArtistDetail[];
  /** 歌手总数（上游下发，页面据此判断是否还有下一页） */
  total: number;
}

/** 主进程酷狗热门歌手模块的原生返回 */
interface KgHotArtistsResponse {
  code?: number;
  total?: number;
  page?: number;
  limit?: number;
  types?: Array<{ id?: string; name?: string }>;
  artists?: Array<Record<string, any>>;
  message?: string;
}

/**
 * 归一化酷狗热门歌手条目（补齐平台维度）
 *
 * 歌手以 `singerid` 为主键，可直接定位酷狗歌手详情；
 * 列表接口不下发曲目数与专辑数（上游恒为 0），故不填。
 * @param artist 酷狗原生歌手条目
 * @returns 归一化歌手
 */
export const toKgHotArtistEntry = (artist: Record<string, any>): PlatformArtistDetail => {
  const singerId = String(artist?.platformId ?? artist?.id ?? "");
  const cover = fillCover(artist?.cover ?? "");
  return {
    id: toNumericId(singerId, singerId),
    platformId: singerId,
    platform: KUGOU,
    name: String(artist?.name ?? ""),
    cover,
    coverSize: buildCoverSize(cover),
    musicSize: 0,
    albumSize: 0,
    mvSize: 0,
    fansSize: Number(artist?.fansCount ?? 0),
    description: "",
  };
};

/**
 * 读取酷狗音乐热门歌手列表
 *
 * 分类标识取主进程下发的 `types[].id`（上游分类键，
 * 音乐人维度非 0 时形如 `0:3`），不传则取「全部」。
 * @param type 分类标识
 * @param page 页码（从 1 开始）
 * @param limit 每页条数
 * @returns 分类清单与歌手条目
 */
export const kgHotArtists = async (
  type?: string,
  page = 1,
  limit = 100,
): Promise<KgHotArtistsResult> => {
  const res = await platformRequest<KgHotArtistsResponse>(KUGOU, "hot_artists", {
    type,
    page,
    limit,
  });
  return {
    types: (res?.types ?? []).map((item) => ({
      id: String(item?.id ?? ""),
      name: String(item?.name ?? ""),
    })),
    artists: (res?.artists ?? []).map(toKgHotArtistEntry),
    total: Number(res?.total ?? 0),
  };
};

/** 主进程酷狗首页新碟模块的原生返回 */
interface KgHomeAlbumResponse {
  code?: number;
  total?: number;
  list?: Array<{
    id?: string;
    name?: string;
    artist?: string;
    publishTime?: string;
    cover?: string;
    trackCount?: number;
  }>;
  message?: string;
}

/** 主进程酷狗首页场景电台模块的原生返回 */
interface KgHomeThemeResponse {
  code?: number;
  total?: number;
  list?: Array<{
    id?: string;
    title?: string;
    tag?: string;
    subTitle?: string;
    cover?: string;
  }>;
  message?: string;
}

/**
 * 读取酷狗首页「新碟上架」
 *
 * 走主进程 `home/album` 模块（上游新碟列表），
 * 专辑号即专辑详情的主键，曲目数由主进程回查补齐。
 * @param limit 取回的条数
 * @returns 归一化后的封面条目
 */
export const kgHomeAlbums = async (limit?: number): Promise<PlatformCoverEntry[]> => {
  const res = await platformRequest<KgHomeAlbumResponse>(KUGOU, "home/album", { limit });
  return (res?.list ?? []).map((item) => ({
    id: item.id ?? "",
    platformId: item.id ?? "",
    name: item.name ?? "",
    cover: fillCover(item.cover ?? ""),
    count: Number(item.trackCount ?? 0),
    creatorName: item.artist ?? "",
    publishTime: toMillisDateTime(item.publishTime),
    platform: KUGOU,
  }));
};

/**
 * 读取酷狗首页「场景电台」主题卡
 *
 * 走主进程 `home/theme` 模块（上游主题目录）。
 * 主题卡是场景入口，点击后按标题关键词进入歌单广场看该场景的歌单。
 * @param limit 取回的条数
 * @returns 归一化后的主题卡
 */
export const kgHomeThemes = async (limit?: number): Promise<PlatformThemeCard[]> => {
  const res = await platformRequest<KgHomeThemeResponse>(KUGOU, "home/theme", { limit });
  return (res?.list ?? []).map((item) => ({
    id: item.id ?? "",
    title: item.title ?? "",
    tag: item.tag ?? "",
    subTitle: item.subTitle ?? "",
    cover: fillCover(item.cover ?? ""),
    platform: KUGOU,
  }));
};
