/**
 * 平台数据层归一化类型
 *
 * QQ 音乐 / 酷狗的原生返回统一归一成网易云字段形状，
 * 页面层只按网易云口径取字段，不必为每个平台各写一套取字段逻辑。
 *
 * @author Hackerdallas
 */

import type { ApiPlatform } from "@/types/shared";
import {
  QualityType,
  type ArtistType,
  type CoverSize,
  type CoverType,
  type MetaData,
  type SongType,
} from "@/types/main";
import { toNumericId, resolveArtistPlatformId } from "./common";

/** 归一化后的歌手（网易云形状） */
export interface PlatformArtist {
  /** 歌手 ID（网易云为数字，第三方平台可能是字符串） */
  id: number | string;
  /** 歌手名 */
  name: string;
  /** 头像地址 */
  picUrl?: string;
  /** 平台内字符串标识（QQ 音乐 mid） */
  mid?: string;
}

/** 归一化后的歌手详情 */
export interface PlatformArtistDetail {
  /** 歌手数字 ID（平台侧给出的数值主键，取不到时为 0） */
  id: number;
  /** 平台内字符串主键（QQ 音乐 mid / 酷狗 author_id） */
  platformId: string;
  /** 来源平台 */
  platform: ApiPlatform;
  /** 歌手名 */
  name: string;
  /** 头像地址 */
  cover: string;
  /** 封面尺寸 */
  coverSize?: CoverSize;
  /** 单曲数 */
  musicSize: number;
  /** 专辑数 */
  albumSize: number;
  /** MV 数 */
  mvSize: number;
  /** 粉丝数 */
  fansSize: number;
  /** 歌手简介 */
  description: string;
}

/** 归一化后的专辑详情 */
export interface PlatformAlbumDetail {
  /** 专辑 ID */
  id: number | string;
  /** 平台内字符串主键（QQ 音乐 mid / 酷狗 album_id） */
  platformId: string;
  /** 专辑名 */
  name: string;
  /** 专辑封面 */
  cover: string;
  /** 封面尺寸 */
  coverSize?: CoverSize;
  /** 专辑歌手名 */
  artist: string;
  /** 曲目数 */
  count: number;
  /** 发行时间（毫秒） */
  publishTime?: number;
  /** 专辑简介 */
  description?: string;
}

/**
 * 归一化后的封面条目
 *
 * 歌单 / 专辑 / 榜单卡片共用的条目形状，字段与网易云 `CoverType` 对齐，
 * 额外带上平台维度，便于详情页选择数据源。
 */
export interface PlatformCoverEntry {
  /** 条目 ID */
  id: number | string;
  /** 平台内字符串主键 */
  platformId?: string;
  /** 条目名 */
  name: string;
  /** 封面直链 */
  cover: string;
  /** 曲目数 */
  count?: number;
  /** 播放量 */
  playCount?: number;
  /** 创建者昵称 */
  creatorName?: string;
  /** 简介 */
  description?: string;
  /** 发行 / 创建时间（毫秒） */
  publishTime?: number;
  /** 来源平台 */
  platform: ApiPlatform;
}

/**
 * 归一化后的场景电台主题卡
 *
 * 主题卡是「场景入口」而非内容条目：标题与标签用于识别场景，
 * 关键词用于按场景取对应的歌单列表，点击主题卡即以该关键词进入歌单广场。
 */
export interface PlatformThemeCard {
  /** 主题标识（平台内主键） */
  id: string;
  /** 主题标题 */
  title: string;
  /** 主题标签 */
  tag: string;
  /** 主题副标题 */
  subTitle: string;
  /** 主题封面直链 */
  cover: string;
  /** 来源平台 */
  platform: ApiPlatform;
}

/** 归一化后的榜单 */
export interface PlatformLeaderboard {
  /** 榜单名 */
  title: string;
  /** 榜单副标题 */
  subTitle: string;
  /** 榜单封面 */
  cover: string;
  /** 榜单曲目总数 */
  total: number;
  /** 榜单歌曲 */
  songs: PlatformSong[];
}

/**
 * 榜单卡片里的曲目预览条目
 *
 * 与网易云榜单卡片的曲名 / 歌手两段式一致，
 * 便于两平台共用同一套卡片结构。
 */
export interface PlatformBoardTrack {
  /** 曲名 */
  first: string;
  /** 歌手 */
  second: string;
}

/**
 * 归一化后的分组榜单条目
 *
 * QQ 音乐与酷狗的榜单清单同构：条目自带榜单号、标题、副标题、简介、
 * 期数、更新时间、封面与曲目总数，榜单号即该平台定位榜单详情的参数
 * （QQ 音乐为 `topid`，酷狗为 `rankid`）。
 */
export interface PlatformLeaderboardBoard {
  /** 榜单号（平台内定位榜单详情用） */
  topId: number;
  /** 榜单名 */
  title: string;
  /** 榜单副标题 */
  subTitle: string;
  /** 榜单简介 */
  intro: string;
  /** 榜单期数 */
  period: string;
  /** 更新时间（毫秒时间戳，平台给日期文本时在归一化层解析） */
  updateTime?: number;
  /**
   * 曲目预览
   *
   * 榜单清单源给出前几首时才有值（与网易云榜单卡片同结构），
   * 平台清单源不带曲目时为空，卡片据此保留信息位但不出预览。
   */
  tracks?: PlatformBoardTrack[];
  /** 榜单封面 */
  cover: string;
  /** 榜单曲目总数 */
  total: number;
  /** 所属分组名 */
  groupName: string;
}

/** 归一化后的榜单分组（分组榜单清单的一组） */
export interface PlatformLeaderboardGroup {
  /** 分组号 */
  groupId: number;
  /** 分组名 */
  groupName: string;
  /** 分组内榜单 */
  toplists: PlatformLeaderboardBoard[];
}

/** 归一化后的榜单详情（单页曲目） */
export interface PlatformLeaderboardDetail {
  /** 榜单名 */
  title: string;
  /** 榜单副标题 */
  subTitle: string;
  /** 榜单封面 */
  cover: string;
  /** 榜单曲目总数 */
  total: number;
  /** 本页曲目 */
  songs: PlatformSong[];
  /**
   * 是否还有下一页
   *
   * 平台一次给全量榜单曲目（无翻页概念）时为 undefined，
   * 页面据此不显示「没有更多」页脚。
   */
  hasMore?: boolean;
}

/** 归一化后的专辑（网易云形状） */
export interface PlatformAlbum {
  /** 专辑 ID */
  id: number | string;
  /** 平台内字符串主键（QQ 音乐 mid / 酷狗 album_id） */
  platformId?: string;
  /** 专辑名 */
  name: string;
  /** 专辑封面（网易云字段名为 picUrl） */
  picUrl: string;
}

/** 归一化后的歌曲（网易云形状 + 平台扩展字段） */
export interface PlatformSong {
  /** 歌曲数字 ID（与网易云同为数字，便于直接复用 SongType.id） */
  id: number;
  /** 歌曲名 */
  name: string;
  /** 歌手列表 */
  artists: PlatformArtist[];
  /** 专辑 */
  album: PlatformAlbum;
  /** 时长（毫秒） */
  duration: number;
  /** 免费或无版权标记：0 正常 / 1 VIP / 4 购买专辑 / 8 非会员可免费播放低音质 */
  fee: 0 | 1 | 4 | 8;
  /** 音质档位（网易云 QualityType 口径，取该歌曲实际提供的最高档） */
  quality?: QualityType;
  /**
   * 原唱/翻唱标记
   *
   * 1 原唱 | 2 翻唱（网易云 `originCoverType` 口径）。
   * 上游没有该判据时留空，界面不显示原唱/翻唱标签。
   */
  originCoverType?: number;
  /** MV 编号 */
  mv: number | null;
  /** 封面 */
  cover: string;
  /** 封面尺寸 */
  coverSize?: CoverSize;
  /** 发布时间（毫秒） */
  publishTime?: number;
  /** 文件大小（字节） */
  size?: number;
  /** 来源平台 */
  platform: ApiPlatform;
  /** 平台内字符串主键（QQ 音乐 mid / 酷狗 hash） */
  platformId?: string;
}

/** 归一化后的歌单创建者（网易云形状） */
export interface PlatformCreator {
  /** 创建者 ID */
  id: number | string;
  /** 创建者昵称 */
  name: string;
  /** 创建者头像 */
  avatarUrl?: string;
}

/** 归一化后的歌单（网易云 `playlist` 形状） */
export interface PlatformPlaylist {
  /** 歌单 ID */
  id: number | string;
  /** 歌单名 */
  name: string;
  /** 歌单封面（网易云字段名为 coverImgUrl） */
  coverImgUrl: string;
  /** 封面尺寸 */
  coverSize?: CoverSize;
  /** 曲目数 */
  trackCount: number;
  /** 播放量 */
  playCount: number;
  /** 歌单描述 */
  description?: string;
  /** 创建者 */
  creator: PlatformCreator;
  /** 创建时间（毫秒） */
  createTime?: number;
  /** 更新时间（毫秒） */
  updateTime?: number;
  /** 来源平台 */
  platform: ApiPlatform;
  /** 平台内字符串标识（歌单号） */
  platformId?: string;
  /** 是否为自建歌单 */
  owned?: boolean;
  /** 是否为收藏（订阅）歌单 */
  subscribed?: boolean;
  /** 歌单目录号（QQ 自建歌单读详情时需要） */
  dirId?: number;
  /** 系统歌单标记原始值（酷狗：1 默认收藏 / 2 我喜欢的歌） */
  isDef?: number;
  /** 是否为系统默认歌单（如「我喜欢的音乐」「默认收藏」） */
  isDefault?: boolean;
  /** 是否为「我喜欢的音乐」歌单 */
  isLiked?: boolean;
  /** 源歌单号（酷狗收藏歌单：源歌单在源账号下的歌单号） */
  originListid?: string;
  /** 源歌单的精选号（酷狗收藏歌单：公开歌单通道按此取曲目） */
  originSpecialid?: string;
  /** 源歌单作者 userid（酷狗收藏歌单） */
  originUserid?: string;
  /** 收藏记录的全局标识（酷狗收藏歌单） */
  globalCollectionId?: string;
}

/** 归一化后的歌单详情（网易云 `playlist` + `tracks` 形状） */
export interface PlatformPlaylistDetail extends PlatformPlaylist {
  /** 曲目列表 */
  tracks: PlatformSong[];
  /** 是否还有更多曲目 */
  hasMore: boolean;
  /** 收藏歌单的源歌单是否可读（酷狗收藏歌单） */
  sourceReadable?: boolean;
  /** 收藏歌单的源歌单名（酷狗收藏歌单） */
  sourceName?: string;
  /** 收藏歌单的源歌单曲目数（酷狗收藏歌单） */
  sourceCount?: number;
}

/** 归一化后的播放地址（网易云 `song/url/v1` 形状 + 判据字段） */
export interface PlatformSongUrl {
  /** 歌曲 ID */
  id: number | string;
  /** 是否有可播地址 */
  available: boolean;
  /** 播放地址 */
  url: string;
  /** 音质档位 */
  level?: string;
  /** 音质中文名 */
  label?: string;
  /** 文件格式 */
  format?: string;
  /** 是否降级取到的地址 */
  isFallback: boolean;
  /** 是否为官方下发的试听片段 */
  isTrial: boolean;
  /** 歌曲付费标记 */
  payPlay?: number;
  /** 酷狗播放状态：1 可播 / 2 付费墙 / 3 该账号完全无授权 */
  status?: number;
  /** 资源授权位（酷狗 privilege） */
  privilege?: number | null;
  /** 试听片段时长（毫秒，酷狗取自 hash_offset.end_ms） */
  trialDuration?: number;
  /** 失败原因（need_pay / no_authorization / filename_rejected / vkey_error） */
  reason?: string;
  /** 提示文案 */
  message?: string;
}

/**
 * 歌词查询入参
 *
 * 归一化歌曲与应用内歌曲模型的公共子集：
 * 平台歌词接口需要「歌曲 ID + 歌名 + 歌手 + 专辑 + 时长」五项才能匹配准歌词。
 */
export interface PlatformLyricTarget {
  /** 歌曲数字 ID */
  id: number;
  /** 歌曲名 */
  name: string;
  /** 歌手（数组或字符串） */
  artists: PlatformArtist[] | MetaData[] | string;
  /** 专辑（对象或名称字符串） */
  album: PlatformAlbum | MetaData | string;
  /** 时长（毫秒） */
  duration: number;
  /** 平台内字符串主键（QQ 音乐 mid / 酷狗 hash） */
  platformId?: string;
}

/** 归一化后的歌词（网易云 `/lyric/new` 形状） */
export interface PlatformLyric {
  /** 普通歌词 */
  lrc: { lyric: string };
  /** 翻译歌词 */
  tlyric: { lyric: string };
  /** 罗马音歌词 */
  romalrc: { lyric: string };
  /** 逐字歌词 */
  yrc: { lyric: string };
}

/** 归一化后的评论条目（网易云 `comment` 形状） */
export interface PlatformComment {
  /** 评论 ID */
  id: number | string;
  /** 评论内容 */
  content: string;
  /** 评论时间（毫秒） */
  time: number;
  /** 点赞数 */
  likedCount: number;
  /** 是否已点赞 */
  liked: boolean;
  /** 评论者 */
  user: {
    /** 用户 ID */
    id: number | string;
    /** 昵称 */
    name: string;
    /** 头像 */
    avatarUrl?: string;
  };
  /** 被回复的评论 */
  beReplied?: {
    /** 回复内容 */
    content: string;
    /** 回复者 */
    user: {
      /** 用户 ID */
      id: number | string;
      /** 昵称 */
      name: string;
      /** 头像 */
      avatarUrl?: string;
    };
  };
}

/** 归一化后的评论分页（网易云 `comment/new` 形状） */
export interface PlatformCommentPage {
  /** 评论列表 */
  comments: PlatformComment[];
  /** 评论总数 */
  total: number;
  /** 是否还有更多 */
  more: boolean;
  /** 游标（下一页传入） */
  cursor?: string;
}

/**
 * 取歌曲的歌手名
 * @param artists 歌手（数组或字符串）
 * @returns 歌手名，多个歌手用 ` / ` 连接
 */
export const getArtistNames = (
  artists: PlatformArtist[] | MetaData[] | string | undefined,
): string => {
  if (!artists) return "";
  if (typeof artists === "string") return artists;
  return artists
    .map((artist) => artist.name)
    .filter(Boolean)
    .join(" / ");
};

/**
 * 取歌曲的专辑名
 * @param album 专辑（对象或名称字符串）
 * @returns 专辑名
 */
export const getAlbumName = (album: PlatformAlbum | MetaData | string | undefined): string => {
  if (!album) return "";
  return typeof album === "string" ? album : (album.name ?? "");
};

/**
 * 应用音质档位 → 平台音质档位
 *
 * 应用侧音质档位沿用网易云口径（`exhigh` / `higher` / `lossless` …），
 * 平台侧各有一套自己的档位名，缺省时回落到 `hq`（QQ 320k / 酷狗 320k）。
 */
const PLATFORM_LEVEL_MAP: Record<ApiPlatform, Record<string, string>> = {
  netease: {},
  qqmusic: {
    jymaster: "hi-res",
    hires: "hi-res",
    lossless: "lossless",
    exhigh: "hq",
    higher: "sq",
    standard: "lq",
    dolby: "hq",
    sky: "hq",
    jyeffect: "hq",
  },
  kugou: {
    jymaster: "hi-res",
    hires: "hi-res",
    lossless: "lossless",
    exhigh: "hq",
    higher: "sq",
    standard: "sq",
    dolby: "hq",
    sky: "hq",
    jyeffect: "hq",
  },
};

/**
 * 取平台音质档位
 * @param platform 音源平台
 * @param appLevel 应用侧音质档位
 * @returns 平台音质档位
 */
export const getPlatformLevel = (platform: ApiPlatform, appLevel: string): string => {
  const map = PLATFORM_LEVEL_MAP[platform] ?? {};
  return map[appLevel] ?? map.exhigh ?? "hq";
};

/**
 * 平台音质档位 → 应用音质
 *
 * QQ 音乐：`hi-res` / `lossless` / `hq` / `sq` / `lq` / `trial`；
 * 酷狗：`high` / `flac` / `320` / `128`。
 * @param level 平台音质档位
 * @returns 应用音质，无法判定时返回 undefined
 */
export const mapPlatformQuality = (level?: string): QualityType | undefined => {
  switch (String(level ?? "").toLowerCase()) {
    case "hi-res":
    case "high":
      return QualityType.HiRes;
    case "lossless":
    case "flac":
      return QualityType.SQ;
    case "hq":
    case "320":
      return QualityType.HQ;
    case "sq":
    case "128":
      return QualityType.MQ;
    case "lq":
    case "trial":
      return QualityType.LQ;
    default:
      return undefined;
  }
};

/**
 * 按网易云口径生成封面各尺寸地址
 *
 * 网易云的封面地址以 `.jpg` 结尾时用 `?param=宽x高` 裁剪，
 * 第三方平台 CDN 同样支持该参数；其余地址原样返回。
 * @param url 封面地址
 * @returns 封面尺寸映射
 */
export const buildCoverSize = (url: string): CoverSize => {
  const withParam = (size: number): string =>
    url.endsWith(".jpg") ? `${url}?param=${size}y${size}` : url;
  return {
    s: withParam(100),
    m: withParam(300),
    l: withParam(1024),
    xl: withParam(1920),
  };
};

/**
 * 把归一化歌曲转换为应用内歌曲模型
 *
 * 字段口径与 `src/utils/format.ts` 的 `formatSongsList` 对齐，
 * 额外带上来源平台与平台字符串主键。
 *
 * 双 id 口径：应用内模型要求数字 `id`，而平台条目有时只给字符串主键
 * （QQ 音乐 mid / 酷狗 hash）。此时按主键派生一个稳定的数字 id，
 * 保证非 0 且同输入恒同值；`platformId` 始终是权威主键。
 * @param song 归一化歌曲
 * @returns 应用内歌曲模型
 */
export const toSongType = (song: PlatformSong): SongType => ({
  id: song.id,
  name: song.name,
  artists: song.artists.map((artist) => ({
    id: toNumericId(artist.id, artist.mid || artist.name),
    name: artist.name,
    cover: artist.picUrl,
    // 来源平台随歌手条目透出，歌手跳转据此选择数据源
    platform: song.platform,
    // QQ 音乐用 mid、酷狗用 author_id 作为歌手的平台主键
    platformId: resolveArtistPlatformId(song.platform, artist),
  })),
  album: {
    id: toNumericId(song.album.id, song.album.platformId || song.album.name),
    name: song.album.name,
    cover: song.album.picUrl,
    platformId: song.album.platformId,
  },
  cover: song.cover,
  coverSize: song.coverSize,
  duration: song.duration,
  free: song.fee,
  quality: song.quality,
  originCoverType: song.originCoverType,
  mv: song.mv,
  createTime: song.publishTime,
  size: song.size,
  type: "song",
  platform: song.platform,
  platformId: song.platformId,
});

/**
 * 把归一化歌手详情转换为应用内歌手模型
 *
 * 平台维度一并带上：详情页据此选择数据源，
 * `platformId` 是平台内主键（QQ 音乐 mid / 酷狗 author_id）。
 * @param artist 归一化歌手详情
 * @returns 应用内歌手模型
 */
export const toArtistType = (artist: PlatformArtistDetail): ArtistType => ({
  id: artist.id,
  name: artist.name,
  cover: artist.cover,
  coverSize: artist.coverSize,
  description: artist.description,
  albumSize: artist.albumSize,
  musicSize: artist.musicSize,
  mvSize: artist.mvSize,
  fansSize: artist.fansSize,
  platform: artist.platform,
  platformId: artist.platformId,
});

/**
 * 把归一化封面条目转换为应用内封面模型
 * @param entry 归一化封面条目
 * @returns 应用内封面模型
 */
export const toCoverEntry = (entry: PlatformCoverEntry): CoverType => ({
  id: entry.id,
  name: entry.name,
  cover: entry.cover,
  coverSize: buildCoverSize(entry.cover),
  description: entry.description,
  count: entry.count ?? 0,
  playCount: entry.playCount,
  creator: {
    id: 0,
    name: entry.creatorName ?? "",
    avatarUrl: "",
  },
  createTime: entry.publishTime,
  platform: entry.platform,
  platformId: entry.platformId,
});
