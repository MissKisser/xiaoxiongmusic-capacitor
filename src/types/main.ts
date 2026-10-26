import { songLevelData } from "@/utils/meta";
import type { ApiPlatform } from "@/types/shared";

export type MetaData = {
  id: number;
  name: string;
  cover?: string;
  alias?: string[];
  /**
   * 平台内字符串主键
   *
   * QQ 音乐为 mid，酷狗为平台数字 id 的字符串形式；
   * `id` 仍是平台数字 ID，两者并存构成平台条目的双 id 口径。
   */
  platformId?: string;
  /**
   * 来源平台
   *
   * 缺省为网易云；第三方平台的歌手条目会带上该字段，
   * 歌手详情页据此选择对应的数据源。
   */
  platform?: ApiPlatform;
};

export type DjData = {
  id: number;
  name: string;
  creator?: string;
};

export type CoverSize = {
  s: string;
  m: string;
  l: string;
  xl: string;
};

/** 音质 */
export enum QualityType {
  /** 超清母带 */
  Master = "Master", // jymaster
  /** 杜比全景声 */
  Dolby = "Dolby", // db
  /** 沉浸环绕声 */
  Spatial = "Spatial", // sky
  /** 高清环绕声 */
  Surround = "Surround", // jyeffect
  /** Hi-Res */
  HiRes = "Hi-Res", // hr
  /** 无损 */
  SQ = "SQ", // sq / flac
  /** 高质量 */
  HQ = "HQ", // h: 320kbps
  /** 中质量 */
  MQ = "MQ", // m: 192kbps
  /** 低质量 */
  LQ = "LQ", // l: 128kbps
}

export type UserType = {
  id: number;
  name: string;
  avatarUrl: string | undefined;
  vipType?: number;
  vipLevel?: number;
  vipIconUrl?: string;
  isAnnualCount?: boolean;
};

/** 歌曲信息 */
export type SongType = {
  /** 歌曲id */
  id: number;
  /** 歌曲名称 */
  name: string;
  /** 歌手 */
  artists: MetaData[] | string;
  /** 专辑 */
  album: MetaData | string;
  /** 电台 */
  dj?: DjData;
  /** 封面 */
  cover: string;
  /** 封面大小 */
  coverSize?: CoverSize;
  /** 时长 */
  duration: number;
  /**
   * 原曲类型
   * 0: 未知 | 1: 原曲 | 2: 翻唱
   */
  originCoverType?: number;
  /** 别名 */
  alia?: string;
  /** 免费或无版权
   * 1: VIP 歌曲 | 4: 购买专辑 | 8: 非会员可免费播放低音质，会员可播放高音质及下载 */
  free: 0 | 1 | 4 | 8;
  /** MV */
  mv: number | null;
  /** 本地路径 */
  path?: string;
  /** 是否为云盘歌曲 */
  pc?: boolean;
  /** 大小 */
  size?: number;
  /** 音质 */
  quality?: QualityType;
  /** 创建时间 */
  createTime?: number;
  /** 更新时间 */
  updateTime?: number;
  /** 播放量 */
  playCount?: number;
  /**
   * 歌曲类型
   * song: 歌曲 | radio: 电台 | streaming: 流媒体
   */
  type: "song" | "radio" | "streaming";
  /**
   * 内容形态标记
   *
   * 酷狗听书章节标记为 `audiobook`：它按酷狗普通歌曲形态参与播放，
   * 界面据此把副标题显示为「听书」，并在取链时带上专辑号与章节号。
   * 网易云播客走的是另一套 `type: "radio"` 语义，两者互不影响。
   */
  mediaKind?: "audiobook";
  /** 流媒体播放 URL */
  streamUrl?: string;
  /** 原始 ID（流媒体服务器的 ID） */
  originalId?: string;
  /** 流媒体服务器类型 */
  serverType?: "navidrome" | "jellyfin" | "opensubsonic";
  /** 流媒体服务器 ID */
  serverId?: string;
  /** 来源标记 */
  source?: "streaming";
  /**
   * 来源平台
   *
   * 缺省为网易云，向后兼容既有数据。
   */
  platform?: ApiPlatform;
  /**
   * 平台内字符串主键
   *
   * QQ 音乐为 mid，酷狗为 hash；`id` 仍是平台数字 ID。
   */
  platformId?: string;
};

// Cover
export type CoverType = {
  id: number | string;
  name: string;
  cover: string;
  coverSize?: CoverSize;
  description?: string;
  creator?: UserType;
  artists?: MetaData[] | string;
  count?: number;
  tags?: string[];
  userId?: number | null;
  privacy?: number;
  playCount?: number;
  liked?: boolean;
  likedCount?: number;
  commentCount?: number;
  shareCount?: number;
  subCount?: number;
  createTime?: number;
  updateTime?: number;
  loading?: boolean;
  updateTip?: string;
  tracks?: {
    first: string;
    second: string;
  }[];
  /**
   * 来源平台
   *
   * 缺省为网易云；第三方平台的歌单 / 专辑条目会带上该字段，
   * 详情页据此选择对应的数据源。
   */
  platform?: ApiPlatform;
  /**
   * 平台内字符串主键
   *
   * QQ 音乐为 mid，酷狗为歌单号 / 专辑号；`id` 仍是平台数字 ID。
   */
  platformId?: string;
  /**
   * 收藏歌单的源歌单是否可读
   *
   * 酷狗收藏歌单的曲目在源歌单里；源歌单已删除或未公开时曲目为空，
   * 该字段为 false，详情页据此给出明确说明而不是当成空歌单。
   */
  sourceReadable?: boolean;
};

/** 本地歌单类型 */
export interface LocalPlaylistType {
  /** 歌单ID（16位数字） */
  id: number;
  /** 歌单名称 */
  name: string;
  /** 歌单描述 */
  description?: string;
  /** 歌单封面 */
  cover?: string;
  /** 歌曲ID数组 */
  songs: string[];
  /** 创建时间 */
  createTime: number;
  /** 更新时间 */
  updateTime: number;
}

// Artist
export type ArtistType = {
  id: number;
  name: string;
  cover: string;
  coverSize?: CoverSize;
  alia?: string;
  identify?: string;
  description?: string;
  albumSize?: number;
  musicSize?: number;
  mvSize?: number;
  fansSize?: number;
  /**
   * 来源平台
   *
   * 缺省为网易云；第三方平台的歌手条目会带上该字段，
   * 详情页据此选择对应的数据源。
   */
  platform?: ApiPlatform;
  /**
   * 平台内字符串主键
   *
   * QQ 音乐为歌手 mid，酷狗为 author_id；`id` 仍是平台数字 ID。
   */
  platformId?: string;
};

// Comment
export type CommentType = {
  id: number;
  content: string;
  beReplied?: {
    content: string;
    user: UserType;
  };
  time: number;
  user: UserType;
  ip?: {
    ip: string;
    location: string;
  };
  liked?: boolean;
  likedCount?: number;
};

/**
 * 歌词内容类型
 */
export type LyricContentType = {
  /** 歌词开始时间 */
  time: number;
  /** 歌词结束时间 */
  endTime: number;
  /** 歌词持续时间 */
  duration: number;
  /** 歌词内容 */
  content: string;
  /** 是否以空格结尾 */
  endsWithSpace: boolean;
};

/** 歌词类型 */
export type LyricType = {
  /** 歌词开始时间 */
  time: number;
  /** 歌词结束时间 */
  endTime: number;
  /** 翻译歌词 */
  tran?: string;
  /** 音译歌词 */
  roma?: string;
  /** 是否为背景歌词 */
  isBG?: boolean;
  /** 是否为对唱歌词 */
  isDuet?: boolean;
  /** 歌词内容 */
  content: string;
  /** 歌词内容数组 */
  contents: LyricContentType[];
};

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface ColorScheme {
  [key: string]: RGB;
}

export interface CoverColors {
  main?: RGB;
  light?: ColorScheme;
  dark?: ColorScheme;
}

export interface CatType {
  name: string;
  category: number;
  hot?: boolean;
  count?: number;
}

// userData
export interface UserDataType {
  userId: number;
  userType: number;
  vipType: number;
  name: string;
  level?: number;
  avatarUrl?: string;
  backgroundUrl?: string;
  createTime?: number;
  createDays?: number;
  artistCount?: number;
  djRadioCount?: number;
  mvCount?: number;
  subPlaylistCount?: number;
  createdPlaylistCount?: number;
}

export interface UserLikeDataType {
  songs: number[];
  playlists: CoverType[];
  artists: ArtistType[];
  albums: CoverType[];
  mvs: CoverType[];
  djs: CoverType[];
}

// sort
export type SortField =
  | "default"
  | "title"
  | "artist"
  | "album"
  | "duration"
  | "size"
  | "createTime"
  | "updateTime";

export type SortOrder = "default" | "asc" | "desc";

/** 歌曲元素音质类型 */
export type SongLevelType = keyof typeof songLevelData;

/** 歌曲元素音质数据 */
export type SongLevelDataType = {
  name: string;
  level: string;
  value: SongLevelType;
  size?: number;
  br?: number;
};

// setting
export type SettingType =
  | "general"
  | "play"
  | "lyrics"
  | "keyboard"
  | "local"
  | "third"
  | "streaming"
  | "other"
  | "about";

// UpdateLog
export type UpdateLogType = {
  version: string;
  changelog: string;
  time: number;
  url: string;
  prerelease: boolean;
  force?: boolean;
};

// 文件信息
export interface FileInfoType {
  url: string;
  sha512: string;
  size: number;
}

// 更新信息
export interface UpdateInfoType {
  tag: string;
  version: string;
  files: FileInfoType[];
  path: string;
  sha512: string;
  releaseDate: string;
  releaseName: string;
  releaseNotes: string;
  prerelease: boolean;
}

// 登录方式
export type LoginType = "qr" | "phone" | "cookie" | "uid";
