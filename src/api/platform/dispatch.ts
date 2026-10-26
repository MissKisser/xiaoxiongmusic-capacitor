/**
 * 数据源分派层
 *
 * 页面层只认「当前平台」这一个维度：歌单列表、歌单详情、喜欢歌曲列表、
 * 搜索结果、歌曲评论五组数据都从这里取，分派层内部按平台走各自的数据源：
 *
 * - 网易云：直调既有网易云封装（`src/api/user.ts` / `src/api/playlist.ts` /
 *   `src/api/song.ts` / `src/api/search.ts` / `src/api/comment.ts`），
 *   返回结构与原链路完全一致，页面行为零变化；
 * - QQ 音乐 / 酷狗：走 `src/api/platform/{qqmusic,kugou}.ts` 的平台数据层，
 *   平台原生字段已在该层归一成网易云字段形状。
 *
 * @author Hackerdallas
 */

import { getSessionCookies } from "@/utils/platform/sessionStore";
import type { ApiPlatform } from "@/types/shared";
import type { ArtistType, CommentType, CoverSize, CoverType, SongType } from "@/types/main";

/**
 * 延迟加载网易云相关 API 与格式化工具
 *
 * 保证本模块在无浏览器环境（如 node:test）被导入时，不会因为网易云链路对
 * SvgIcon.vue 与 window 的静态依赖而中断执行。
 */
const loadNeteaseModules = async () => {
  const [userApi, playlistApi, songApi, searchApi, commentApi, formatUtils] = await Promise.all([
    import("@/api/user"),
    import("@/api/playlist"),
    import("@/api/song"),
    import("@/api/search"),
    import("@/api/comment"),
    import("@/utils/format"),
  ]);
  return {
    userPlaylist: userApi.userPlaylist,
    playlistDetail: playlistApi.playlistDetail,
    playlistAllSongs: playlistApi.playlistAllSongs,
    songDetail: songApi.songDetail,
    searchResult: searchApi.searchResult,
    searchHot: searchApi.searchHot,
    getComment: commentApi.getComment,
    getHotComment: commentApi.getHotComment,
    formatCoverList: formatUtils.formatCoverList,
    formatSongsList: formatUtils.formatSongsList,
    formatArtistsList: formatUtils.formatArtistsList,
    formatCommentList: formatUtils.formatCommentList,
  };
};
import {
  kgAlbumDetail,
  kgArtistDetail,
  kgComment,
  kgFindLikedPlaylist,
  kgHomeAlbums,
  kgHomeThemes,
  kgHotArtists,
  kgLeaderboardDetail,
  kgLeaderboardList,
  kgPlaylistDetail,
  kgPlaylistSquare,
  kgPublicPlaylist,
  kgSearch,
  kgSearchAlbums,
  kgSearchArtists,
  kgSearchPlaylists,
  kgUserPlaylistList,
  KG_DEFAULT_RANK_ID,
  toKgAlbumEntry,
  toKgArtistEntry,
  toKgPlaylistEntry,
} from "./kugou";
import {
  QQ_HOME_SQUARE_CATEGORIES,
  QQ_SEARCH_PAGE_LIMIT,
  qqAlbumDetail,
  qqArtistDetail,
  qqComment,
  qqHomeAlbums,
  qqHomeRecommend,
  qqHomeSingers,
  qqHomeSquare,
  qqHotSearch,
  qqLeaderboard,
  qqLeaderboardDetail,
  qqLeaderboardList,
  qqPlaylistDetailPage,
  qqPlaylistSquare,
  qqPublicPlaylistDetail,
  qqSearch,
  qqSearchAlbums,
  qqSearchArtists,
  qqSearchPlaylists,
  qqUserPlaylistList,
  toQqAlbumEntry,
  toQqArtistEntry,
  toQqPlaylistEntry,
} from "./qqmusic";
import {
  toArtistType,
  toCoverEntry,
  toSongType,
  type PlatformComment,
  type PlatformCommentPage,
  type PlatformLeaderboardGroup,
  type PlatformPlaylist,
  type PlatformPlaylistDetail,
  type PlatformThemeCard,
} from "./types";

/** 网易云歌单详情单页曲目数 */
const NETEASE_PAGE_SIZE = 500;

/** 第三方平台歌单详情默认每页曲目数 */
const DEFAULT_PAGE_SIZE = 300;

/** 分派层统一歌单条目（网易云字段形状 + 平台维度） */
export interface DispatchPlaylist {
  /** 歌单标识：网易云为数字 id，第三方平台为平台内主键 */
  id: number | string;
  /** 歌单名 */
  name: string;
  /** 封面直链 */
  cover: string;
  /** 封面尺寸 */
  coverSize?: CoverSize;
  /** 曲目数 */
  count: number;
  /** 播放量 */
  playCount?: number;
  /** 歌单描述 */
  description?: string;
  /** 创建者昵称 */
  creatorName?: string;
  /** 创建时间（毫秒） */
  createTime?: number;
  /** 更新时间（毫秒） */
  updateTime?: number;
  /** 来源平台 */
  platform: ApiPlatform;
  /** 平台内字符串主键 */
  platformId?: string;
  /** 歌单目录号（QQ 自建歌单读详情时需要） */
  dirId?: number;
  /** 是否为收藏（订阅）歌单 */
  subscribed: boolean;
  /** 是否为「我喜欢的音乐」歌单 */
  isLiked?: boolean;
  /** 源歌单号（酷狗收藏歌单：源歌单在源账号下的歌单号） */
  originListid?: string;
  /** 源歌单的精选号（酷狗收藏歌单：公开歌单通道按此取曲目） */
  originSpecialid?: string;
  /** 收藏歌单的源歌单是否可读（酷狗收藏歌单） */
  sourceReadable?: boolean;
}

/** 分派层歌单详情结果 */
export interface DispatchPlaylistDetail {
  /** 歌单头部（网易云形状） */
  detail: CoverType;
  /** 曲目列表（网易云形状） */
  tracks: SongType[];
  /** 曲目总数 */
  count: number;
  /** 是否还有更多曲目 */
  hasMore: boolean;
  /** 当前页码（从 1 开始） */
  page: number;
  /** 每页数量 */
  pageSize: number;
  /** 网易云返回的曲目 id 列表（网易云链路用于批量取歌曲详情） */
  privileges?: number[];
}

/** 分派层用户歌单列表结果 */
export interface DispatchUserPlaylists {
  /** 自建歌单 */
  owned: DispatchPlaylist[];
  /** 收藏（订阅）歌单 */
  favorites: DispatchPlaylist[];
}

/** 歌单详情读取参数 */
export interface DispatchDetailOptions {
  /** 歌单标识：网易云为数字 id，第三方平台为平台内主键 */
  id: string | number;
  /** 是否取回曲目，缺省取回 */
  withTracks?: boolean;
  /** QQ 自建歌单的目录号 */
  dirId?: number;
  /** 页码（从 1 开始） */
  page?: number;
  /** 每页数量 */
  pageSize?: number;
  /**
   * 歌单范围
   *
   * 酷狗的账号云歌单与公开精选歌单是两套数据源，
   * `public` 表示读公开歌单，其余按云歌单处理。
   */
  scope?: "cloud" | "public";
}

/** 喜欢歌曲列表读取参数 */
export interface DispatchLikedOptions {
  /** 网易云「我喜欢的音乐」歌单 id（网易云链路必填，第三方平台由平台侧自行定位） */
  playlistId?: number;
  /** 页码（从 1 开始） */
  page?: number;
  /** 每页数量 */
  pageSize?: number;
}

/** 用户歌单列表读取参数 */
export interface DispatchUserPlaylistOptions {
  /** 网易云用户 id（网易云链路必填，第三方平台由平台侧自行定位） */
  uid?: number;
  /** 取回条数 */
  limit?: number;
}

/** 平台歌单列表缓存（详情页补齐歌单头时复用，避免重复拉取） */
const playlistListCache = new Map<ApiPlatform, { at: number; lists: DispatchUserPlaylists }>();

/** 歌单列表缓存有效期（毫秒） */
const PLAYLIST_LIST_TTL = 30_000;

/**
 * 读取平台歌单列表（带短时缓存）
 * @param platform 音源平台
 * @returns 自建歌单与收藏歌单
 */
const readUserPlaylists = async (platform: ApiPlatform): Promise<DispatchUserPlaylists> => {
  const cached = playlistListCache.get(platform);
  if (cached && Date.now() - cached.at < PLAYLIST_LIST_TTL) return cached.lists;
  const lists = await dispatchUserPlaylists(platform);
  playlistListCache.set(platform, { at: Date.now(), lists });
  return lists;
};

/**
 * 作废平台歌单列表缓存
 *
 * 缓存按平台存放，里面是**某个账号**的歌单号；账号切换后同一个歌单号
 * 在新账号下指向完全不同的歌单，因此账号变更时必须显式作废。
 * @param platform 音源平台，缺省作废全部平台
 */
export const invalidatePlaylistListCache = (platform?: ApiPlatform): void => {
  if (!platform) {
    playlistListCache.clear();
    return;
  }
  playlistListCache.delete(platform);
};

/**
 * 用歌单列表补齐歌单头
 *
 * QQ 音乐与酷狗的歌单详情接口不返回歌单名 / 封面 / 创建者，
 * 这些字段只在「我的歌单列表」里给出，详情页据此补齐。
 * @param platform 音源平台
 * @param id 歌单标识
 * @returns 命中的歌单条目，未命中时为 null
 */
const findPlaylistEntry = async (
  platform: ApiPlatform,
  id: string | number,
): Promise<DispatchPlaylist | null> => {
  try {
    const lists = await readUserPlaylists(platform);
    const all = [...lists.owned, ...lists.favorites];
    return (
      all.find((playlist) => String(playlist.platformId ?? playlist.id) === String(id)) ?? null
    );
  } catch (error) {
    console.error("获取平台歌单列表失败：", error);
    return null;
  }
};

/** 自建歌单缺创建者时的本人标注 */
const SELF_CREATOR_NAME = "我";

let customAccountNameGetter: ((platform: ApiPlatform) => string) | null = null;

/**
 * 设置自定义账号昵称读取器（单测与隔离环境使用）
 * @param getter 昵称读取器，传 null 恢复默认机制
 */
export const setAccountNameGetter = (getter: ((platform: ApiPlatform) => string) | null): void => {
  customAccountNameGetter = getter;
};

/**
 * 读取当前登录账号的昵称
 *
 * 第三方平台取平台账号资料里的昵称，网易云取本地用户资料；
 * 只有空白字符的昵称视为没有昵称。
 * @param platform 音源平台
 * @returns 账号昵称，没有昵称时为空字符串
 */
const currentAccountName = (platform: ApiPlatform): string => {
  if (customAccountNameGetter) return customAccountNameGetter(platform);
  if (platform === "netease") {
    try {
      const glob = globalThis as unknown as { __piniaDataStore__?: { userData?: { name?: string } } };
      return (glob.__piniaDataStore__?.userData?.name ?? "").trim();
    } catch {
      return "";
    }
  }
  const cookies = getSessionCookies(platform);
  return (cookies.nickname || cookies.nick || "").trim();
};

/**
 * 组装歌单创建者名称
 *
 * 上游给了创建者就用上游的；
 * 自建歌单的上游常不回创建者（创建者就是当前账号本人），此时回填当前账号昵称，
 * 账号没有昵称时标注为本人；
 * 第三方公开歌单与收藏歌单的上游作者缺失时留空，由界面给出中性兜底文案。
 * @param platform 音源平台
 * @param upstream 上游给出的创建者名称
 * @param owned 是否为当前账号自建歌单
 * @returns 创建者名称，上游与账号昵称都缺失时为空字符串
 */
const resolveCreatorName = (
  platform: ApiPlatform,
  upstream: string | undefined,
  owned: boolean,
): string => {
  const name = (upstream ?? "").trim();
  if (name) return name;
  if (!owned) return "";
  return currentAccountName(platform) || SELF_CREATOR_NAME;
};

/**
 * 把平台歌单条目转为分派层统一条目
 * @param playlist 平台归一化歌单
 * @returns 分派层统一歌单条目
 */
const fromPlatformPlaylist = (playlist: PlatformPlaylist): DispatchPlaylist => ({
  id: playlist.id,
  name: playlist.name,
  cover: playlist.coverImgUrl,
  coverSize: playlist.coverSize,
  count: playlist.trackCount,
  playCount: playlist.playCount,
  description: playlist.description,
  // 自建歌单的创建者是本人，收藏歌单的创建者是源歌单作者
  creatorName: resolveCreatorName(
    playlist.platform,
    playlist.creator?.name,
    playlist.subscribed !== true,
  ),
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
 * 把分派层统一条目转为网易云形状的歌单头部
 * @param playlist 分派层统一歌单条目
 * @returns 网易云形状的歌单头部
 */
export const toCoverType = (playlist: DispatchPlaylist): CoverType => ({
  id: playlist.id,
  name: playlist.name,
  cover: playlist.cover,
  coverSize: playlist.coverSize,
  count: playlist.count,
  playCount: playlist.playCount,
  description: playlist.description,
  creator: {
    id: 0,
    name: playlist.creatorName ?? "",
    avatarUrl: "",
  },
  createTime: playlist.createTime,
  updateTime: playlist.updateTime,
  sourceReadable: playlist.sourceReadable,
});

/**
 * 读取网易云歌单详情
 *
 * 直调既有网易云封装：头部走 `playlistDetail`，曲目按网易云原链路的两种口径取
 * （`privileges` 齐平时批量取详情，否则按 500 一页翻页）。
 * @param id 歌单 id
 * @param withTracks 是否取回曲目
 * @returns 网易云形状的歌单详情
 */
const fetchNeteasePlaylistDetail = async (
  id: number,
  withTracks: boolean,
): Promise<DispatchPlaylistDetail> => {
  const { playlistDetail, formatCoverList, songDetail, formatSongsList, playlistAllSongs } =
    await loadNeteaseModules();
  const res = await playlistDetail(id);
  const detail = formatCoverList(res.playlist)[0];
  const count = detail?.count ?? 0;
  const privileges: number[] = (res.privileges ?? [])
    .map((item: { id?: number }) => Number(item?.id))
    .filter((value: number) => !Number.isNaN(value));

  if (!withTracks || count === 0) {
    return { detail, tracks: [], count, hasMore: false, page: 1, pageSize: 0, privileges };
  }

  // 曲目数与权限列表一致且不多时，按网易云原链路批量取详情
  if (privileges.length === count && count < 800) {
    const songRes = await songDetail(privileges);
    return {
      detail,
      tracks: formatSongsList(songRes.songs),
      count,
      hasMore: false,
      page: 1,
      pageSize: count,
      privileges,
    };
  }

  // 其余情况按页翻取
  const tracks: SongType[] = [];
  let offset = 0;
  do {
    const pageRes = await playlistAllSongs(id, NETEASE_PAGE_SIZE, offset);
    tracks.push(...formatSongsList(pageRes.songs));
    offset += NETEASE_PAGE_SIZE;
  } while (offset < count);

  return {
    detail,
    tracks,
    count,
    hasMore: false,
    page: 1,
    pageSize: NETEASE_PAGE_SIZE,
    privileges,
  };
};

/**
 * 解析当前账号的「我喜欢的音乐」歌单
 *
 * 系统红心歌单的**歌单号按账号分配**（酷狗 listid、QQ 音乐歌单号都是账号内主键），
 * 换账号后同一个歌单号指向完全不同的歌单，因此一律从**当前账号自己的歌单列表**
 * 里按平台语义解析，绝不沿用其它账号解析出的歌单号。
 *
 * 平台语义：
 * - QQ 音乐：系统目录 `dirId === 201`（「我喜欢」）；
 * - 酷狗：上游标记 `is_def === 2`（「我喜欢的歌」）。
 *
 * 网易云不走这里：它的「我喜欢的音乐」是用户歌单列表首项，由用户歌单接口给出。
 * @param platform 音源平台
 * @returns 命中的歌单条目，未命中时为 null
 */
export const resolveLikedPlaylist = async (
  platform: ApiPlatform,
): Promise<DispatchPlaylist | null> => {
  if (platform === "qqmusic") {
    const { owned } = await qqUserPlaylistList();
    const hit = owned.find((playlist) => playlist.isLiked === true);
    return hit ? { ...fromPlatformPlaylist(hit), isLiked: true } : null;
  }
  if (platform === "kugou") {
    const { owned } = await kgUserPlaylistList();
    const hit = kgFindLikedPlaylist(owned);
    return hit ? { ...fromPlatformPlaylist(hit), isLiked: true } : null;
  }
  return null;
};

/**
 * 读取当前平台的用户歌单列表
 *
 * 网易云走既有 `userPlaylist` 封装并按「创建者是否为本人」拆成自建 / 收藏两组；
 * 第三方平台走平台数据层，平台侧本身即分两组返回。
 * @param platform 音源平台
 * @param options 读取参数
 * @returns 自建歌单与收藏歌单
 */
export const dispatchUserPlaylists = async (
  platform: ApiPlatform,
  options: DispatchUserPlaylistOptions = {},
): Promise<DispatchUserPlaylists> => {
  if (platform === "netease") {
    const uid = options.uid ?? 0;
    if (!uid) return { owned: [], favorites: [] };
    const limit = options.limit ?? 50;
    const { userPlaylist, formatCoverList } = await loadNeteaseModules();
    const res = await userPlaylist(limit, 0, uid);
    const list = formatCoverList(res.playlist);
    const owned: DispatchPlaylist[] = [];
    const favorites: DispatchPlaylist[] = [];
    for (const item of list) {
      // 网易云把「我喜欢的音乐」混在用户歌单列表首位，按创建者是否为本人拆分两组
      const isOwned = item.userId === uid || item.creator?.id === uid;
      const entry: DispatchPlaylist = {
        id: item.id,
        name: item.name,
        cover: item.cover,
        coverSize: item.coverSize,
        count: item.count ?? 0,
        playCount: item.playCount,
        description: item.description,
        // 自建歌单的创建者是本人，收藏歌单的创建者是源歌单作者
        creatorName: resolveCreatorName("netease", item.creator?.name, isOwned),
        createTime: item.createTime,
        updateTime: item.updateTime,
        platform: "netease",
        subscribed: false,
      };
      if (isOwned) owned.push(entry);
      else favorites.push({ ...entry, subscribed: true });
    }
    // 网易云用户歌单列表首项固定是「我喜欢的音乐」
    if (owned.length > 0) owned[0].isLiked = true;
    return { owned, favorites };
  }

  if (platform === "qqmusic") {
    const { owned, favorites } = await qqUserPlaylistList();
    return {
      owned: owned.map(fromPlatformPlaylist),
      favorites: favorites.map(fromPlatformPlaylist),
    };
  }

  const { owned, favorites } = await kgUserPlaylistList();
  const ownedList = owned.map(fromPlatformPlaylist);
  // 酷狗的「我喜欢的歌」是自建歌单里的一种，按平台语义定位后打标
  const liked = kgFindLikedPlaylist(owned);
  if (liked) {
    const target = ownedList.find(
      (item) => String(item.platformId ?? item.id) === String(liked.platformId ?? liked.id),
    );
    if (target) target.isLiked = true;
  }
  return {
    owned: ownedList,
    favorites: favorites.map(fromPlatformPlaylist),
  };
};

/**
 * 读取当前平台的一张歌单详情（含曲目）
 *
 * 网易云直调既有网易云封装；第三方平台走平台数据层，曲目按平台自身分页口径取。
 * @param platform 音源平台
 * @param options 读取参数
 * @returns 歌单头部与曲目
 */
export const dispatchPlaylistDetail = async (
  platform: ApiPlatform,
  options: DispatchDetailOptions,
): Promise<DispatchPlaylistDetail> => {
  const withTracks = options.withTracks !== false;

  if (platform === "netease") {
    return fetchNeteasePlaylistDetail(Number(options.id), withTracks);
  }

  if (platform === "qqmusic") {
    const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
    const page = options.page ?? 1;
    const res = await qqPlaylistDetailPage(options.id, {
      dirId: options.dirId,
      songBegin: (page - 1) * pageSize,
      songNum: pageSize,
    });
    // 歌单名 / 封面 / 创建者在歌单列表里，详情接口不回，用列表补齐
    // （系统「我喜欢」目录只回名字不回封面；创建者缺失时同样要回列表查）
    const needEntry = !res.name || !res.coverImgUrl || !res.creator?.name;
    const entry = needEntry ? await findPlaylistEntry(platform, options.id) : null;
    // 自建歌单：列表命中且非收藏，创建者就是当前账号本人
    const owned = !!entry && !entry.subscribed;
    // 公开歌单端点：歌单头与创建者只在这里给（登录态端点不回创建者）
    let publicRes: PlatformPlaylistDetail | null = null;
    if (!res.name || (!res.creator?.name && !owned)) {
      try {
        publicRes = await qqPublicPlaylistDetail(options.id);
      } catch (error) {
        console.error("读取 QQ 公开歌单头部失败：", error);
      }
    }
    // 歌单头缺失时回落到公开歌单端点：广场歌单只有该端点带歌单名与封面
    if (!res.name && publicRes?.name) {
      const publicPlaylist: DispatchPlaylist = {
        id: publicRes.id,
        name: publicRes.name,
        cover: publicRes.coverImgUrl,
        coverSize: publicRes.coverSize,
        count: publicRes.trackCount,
        playCount: publicRes.playCount,
        description: publicRes.description,
        creatorName: resolveCreatorName(platform, publicRes.creator?.name, false),
        createTime: publicRes.createTime,
        platform: res.platform,
        platformId: publicRes.platformId,
        subscribed: false,
      };
      return {
        detail: toCoverType(publicPlaylist),
        // 曲目以登录态端点为准（公开端点不回曲目）
        tracks: withTracks ? res.tracks.map(toSongType) : [],
        count: publicPlaylist.count ?? 0,
        hasMore: res.hasMore,
        page,
        pageSize,
      };
    }
    const playlist: DispatchPlaylist = {
      id: res.id,
      name: res.name || entry?.name || "",
      cover: res.coverImgUrl || entry?.cover || "",
      coverSize: res.coverSize ?? entry?.coverSize,
      count: res.trackCount || entry?.count || 0,
      playCount: res.playCount || entry?.playCount,
      description: res.description || entry?.description,
      // 自建歌单回填当前账号昵称，公开歌单与收藏歌单取上游作者
      creatorName: resolveCreatorName(
        platform,
        res.creator?.name || entry?.creatorName || publicRes?.creator?.name,
        owned,
      ),
      // 创建 / 更新时间：账号歌单取自歌单列表，公开歌单取自公开歌单端点
      createTime: entry?.createTime ?? publicRes?.createTime,
      updateTime: entry?.updateTime,
      platform: res.platform,
      platformId: res.platformId,
      dirId: options.dirId,
      subscribed: entry?.subscribed === true,
    };
    return {
      detail: toCoverType(playlist),
      tracks: withTracks ? res.tracks.map(toSongType) : [],
      count: playlist.count,
      hasMore: res.hasMore,
      page,
      pageSize,
    };
  }

  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const page = options.page ?? 1;
  // 酷狗公开精选歌单与账号云歌单是两套数据源，按范围分流
  if (options.scope === "public") {
    return dispatchPublicPlaylistDetail(options.id, page, pageSize);
  }
  let res: PlatformPlaylistDetail;
  try {
    res = await kgPlaylistDetail(options.id, page, pageSize);
  } catch (error) {
    // 云歌单读不到时，回落到公开精选歌单
    console.error("读取酷狗云歌单失败，尝试公开歌单：", error);
    return dispatchPublicPlaylistDetail(options.id, page, pageSize);
  }
  const entry = await findPlaylistEntry(platform, options.id);
  // 云歌单读不到曲目时，同样回落到公开精选歌单：
  // 收藏歌单的本地 listid 只是收藏记录号，源歌单的精选号才是公开歌单号
  if (res.tracks.length === 0 && options.withTracks !== false) {
    const publicId = entry?.originSpecialid ?? String(options.id);
    try {
      const publicRes = await dispatchPublicPlaylistDetail(publicId, page, pageSize);
      if (publicRes.tracks.length > 0) return publicRes;
    } catch (error) {
      console.error("读取酷狗公开歌单失败：", error);
    }
  }
  const playlist: DispatchPlaylist = {
    id: res.id,
    name: res.name || entry?.name || "",
    cover: res.coverImgUrl || entry?.cover || "",
    coverSize: res.coverSize ?? entry?.coverSize,
    count: res.trackCount || entry?.count || 0,
    playCount: res.playCount || entry?.playCount,
    description: res.description || entry?.description,
    // 自建歌单回填当前账号昵称，收藏歌单取源歌单作者
    creatorName: resolveCreatorName(
      platform,
      res.creator?.name || entry?.creatorName,
      !!entry && !(res.subscribed === true || entry.subscribed === true),
    ),
    createTime: entry?.createTime,
    updateTime: entry?.updateTime,
    platform: res.platform,
    platformId: res.platformId,
    // 收藏歌单：源歌单号随条目带出，详情读不到时据此回落公开歌单通道
    subscribed: res.subscribed === true || entry?.subscribed === true,
    originListid: res.originListid ?? entry?.originListid,
    originSpecialid: entry?.originSpecialid,
    // 源歌单不可读时曲目为空，界面据此如实说明而不是当成空歌单
    sourceReadable: res.sourceReadable,
  };
  return {
    detail: toCoverType(playlist),
    tracks: withTracks ? res.tracks.map(toSongType) : [],
    count: playlist.count,
    hasMore: res.hasMore,
    page,
    pageSize,
  };
};

/**
 * 读取当前平台的「我喜欢的音乐」曲目
 *
 * 网易云以传入的歌单 id 读取（该 id 来自网易云用户歌单列表首项）；
 * QQ 音乐与酷狗的「我喜欢的音乐」都是**账号内分配**的系统歌单，
 * 一律从当前账号自己的歌单列表里按平台语义解析出歌单号，
 * 再走与侧边栏歌单条目相同的取数路径读取曲目。
 * @param platform 音源平台
 * @param options 读取参数
 * @returns 歌单头部与曲目
 */
export const dispatchLikedSongs = async (
  platform: ApiPlatform,
  options: DispatchLikedOptions = {},
): Promise<DispatchPlaylistDetail> => {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;

  if (platform === "netease") {
    const playlistId = options.playlistId ?? 0;
    if (!playlistId) {
      return {
        detail: toCoverType({
          id: 0,
          name: "我喜欢的音乐",
          cover: "",
          count: 0,
          platform: "netease",
          // 「我喜欢的音乐」是当前账号自建歌单，创建者即本人
          creatorName: resolveCreatorName("netease", undefined, true),
          subscribed: false,
        }),
        tracks: [],
        count: 0,
        hasMore: false,
        page: 1,
        pageSize,
      };
    }
    return fetchNeteasePlaylistDetail(playlistId, true);
  }

  const page = options.page ?? 1;
  // 「我喜欢的音乐」的歌单号按账号分配，必须从当前账号自己的歌单列表里解析
  const liked = await resolveLikedPlaylist(platform);
  if (!liked) {
    return {
      detail: toCoverType({
        id: 0,
        name: "我喜欢的音乐",
        cover: "",
        count: 0,
        platform,
        // 「我喜欢的音乐」是当前账号自建歌单，创建者即本人
        creatorName: resolveCreatorName(platform, undefined, true),
        subscribed: false,
      }),
      tracks: [],
      count: 0,
      hasMore: false,
      page: 1,
      pageSize,
    };
  }
  // 曲目走与侧边栏歌单条目完全相同的取数路径，
  // 保证「我喜欢的音乐」页与列表里的那条「我喜欢」指向同一张歌单
  const res = await dispatchPlaylistDetail(platform, {
    id: liked.platformId ?? liked.id,
    dirId: liked.dirId,
    page,
    pageSize,
  });
  return { ...res, page, pageSize };
};

/**
 * 分页取回平台「我喜欢的音乐」的全部曲目
 * @param platform 音源平台
 * @returns 曲目列表
 */
const fetchAllLikedTracks = async (platform: ApiPlatform): Promise<SongType[]> => {
  const pageSize = DEFAULT_PAGE_SIZE;
  const tracks: SongType[] = [];
  let count = 0;
  let page = 1;
  do {
    const res = await dispatchLikedSongs(platform, { page, pageSize });
    count = res.count;
    tracks.push(...res.tracks);
    page += 1;
    if (res.tracks.length === 0 || tracks.length >= count) break;
  } while (page <= 50);
  return tracks;
};

/**
 * 读取当前平台「我喜欢的音乐」的曲目 id 集合（红心判据）
 *
 * 判据来源：平台「我喜欢的音乐」歌单的曲目集合——
 * 歌单内的曲目判定为已红心，歌单外的曲目判定为未红心。
 * 网易云的红心集合由本地缓存维护，此处返回空集。
 * @param platform 音源平台
 * @param tracks 已取回的曲目，缺省时按平台自身分页取回
 * @returns 歌曲 id 集合
 */
export const dispatchLikedSongIds = async (
  platform: ApiPlatform,
  tracks?: SongType[],
): Promise<Set<number>> => {
  if (platform === "netease") return new Set<number>();
  const ids = new Set<number>();
  const collected = tracks?.length ? tracks : await fetchAllLikedTracks(platform);
  for (const track of collected) {
    const id = Number(track.id);
    if (Number.isFinite(id) && id > 0) ids.add(id);
  }
  return ids;
};

/** 搜索结果分类 */
export type DispatchSearchCategory = "song" | "playlist" | "album" | "artist";

/** 分派层搜索结果（网易云形状） */
export interface DispatchSearchResult {
  /** 结果总数 */
  total: number;
  /** 是否还有更多 */
  hasMore: boolean;
  /** 歌曲结果 */
  songs: SongType[];
  /** 歌单结果 */
  playlists: CoverType[];
  /** 专辑结果 */
  albums: CoverType[];
  /** 歌手结果 */
  artists: ArtistType[];
}

/** 搜索读取参数 */
export interface DispatchSearchOptions {
  /** 搜索关键词 */
  keyword: string;
  /** 结果分类 */
  category: DispatchSearchCategory;
  /** 页码（从 1 开始） */
  page?: number;
  /** 每页数量 */
  limit?: number;
}

/** 网易云搜索分类 → `/cloudsearch` 的 type 口径 (1 单曲 / 10 专辑 / 100 歌手 / 1000 歌单) */
const NETEASE_SEARCH_TYPE: Record<DispatchSearchCategory, number> = {
  song: 1,
  playlist: 1000,
  album: 10,
  artist: 100,
};

/** 第三方平台搜索默认每页数量 */
const DEFAULT_SEARCH_LIMIT = 50;

/**
 * 读取网易云搜索结果
 *
 * 直调既有 `/cloudsearch` 封装：偏移量按 `(页码 - 1) × 每页数量` 计算，
 * 与原页面逐页累加偏移量的口径完全一致。
 * @param options 搜索参数
 * @returns 归一化后的搜索结果
 */
const fetchNeteaseSearchResult = async (
  options: DispatchSearchOptions,
): Promise<DispatchSearchResult> => {
  const page = options.page ?? 1;
  const limit = options.limit ?? DEFAULT_SEARCH_LIMIT;
  const offset = (page - 1) * limit;
  const { searchResult, formatSongsList, formatCoverList, formatArtistsList } =
    await loadNeteaseModules();
  const res = await searchResult(
    options.keyword,
    limit,
    offset,
    NETEASE_SEARCH_TYPE[options.category] as any,
  );
  const result = res.result;
  const empty: DispatchSearchResult = {
    total: 0,
    hasMore: false,
    songs: [],
    playlists: [],
    albums: [],
    artists: [],
  };

  if (options.category === "song") {
    const songs = formatSongsList(result?.songs);
    const total = Number(result?.songCount ?? 0);
    return {
      ...empty,
      total,
      hasMore: result?.hasMore === true || total > offset + limit,
      songs,
    };
  }
  if (options.category === "playlist") {
    const playlists = formatCoverList(result?.playlists);
    const total = Number(result?.playlistCount ?? 0);
    return {
      ...empty,
      total,
      hasMore: result?.hasMore === true || total > offset + limit,
      playlists,
    };
  }
  if (options.category === "album") {
    const albums = formatCoverList(result?.albums);
    const total = Number(result?.albumCount ?? 0);
    return {
      ...empty,
      total,
      hasMore: result?.hasMore === true || total > offset + limit,
      albums,
    };
  }
  const artists = formatArtistsList(result?.artists);
  const total = Number(result?.artistCount ?? 0);
  return {
    ...empty,
    total,
    hasMore: result?.hasMore === true || total > offset + limit,
    artists,
  };
};

/**
 * 读取当前平台的搜索结果
 *
 * 网易云一次 `/cloudsearch` 返回多类型结果；第三方平台的搜索模块按分类逐次请求，
 * 每次只返回该分类的结果。
 * @param platform 音源平台
 * @param options 搜索参数
 * @returns 归一化后的搜索结果
 */
export const dispatchSearch = async (
  platform: ApiPlatform,
  options: DispatchSearchOptions,
): Promise<DispatchSearchResult> => {
  const page = options.page ?? 1;
  const requestedLimit = options.limit ?? DEFAULT_SEARCH_LIMIT;
  // QQ 音乐搜索上游单页上限为 40，超过后返回空结果，分页口径按上限收敛
  const limit =
    platform === "qqmusic" ? Math.min(requestedLimit, QQ_SEARCH_PAGE_LIMIT) : requestedLimit;
  const empty: DispatchSearchResult = {
    total: 0,
    hasMore: false,
    songs: [],
    playlists: [],
    albums: [],
    artists: [],
  };

  if (platform === "netease") {
    return fetchNeteaseSearchResult({ ...options, page, limit });
  }

  const hasMore = (total: number): boolean => page * limit < total;

  if (platform === "qqmusic") {
    if (options.category === "song") {
      const res = await qqSearch(options.keyword, page, limit);
      return {
        ...empty,
        total: res.total,
        hasMore: hasMore(res.total),
        songs: res.songs.map(toSongType),
      };
    }
    if (options.category === "playlist") {
      const res = await qqSearchPlaylists(options.keyword, page, limit);
      return {
        ...empty,
        total: res.total,
        hasMore: hasMore(res.total),
        playlists: res.playlists.map(toQqPlaylistEntry).map(toCoverEntry),
      };
    }
    if (options.category === "album") {
      const res = await qqSearchAlbums(options.keyword, page, limit);
      return {
        ...empty,
        total: res.total,
        hasMore: hasMore(res.total),
        albums: res.albums.map(toQqAlbumEntry).map(toCoverEntry),
      };
    }
    const res = await qqSearchArtists(options.keyword, page, limit);
    return {
      ...empty,
      total: res.total,
      hasMore: hasMore(res.total),
      artists: res.artists.map(toQqArtistEntry).map(toArtistType),
    };
  }

  if (options.category === "song") {
    const res = await kgSearch(options.keyword, page, limit);
    return {
      ...empty,
      total: res.total,
      hasMore: hasMore(res.total),
      songs: res.songs.map(toSongType),
    };
  }
  if (options.category === "playlist") {
    const res = await kgSearchPlaylists(options.keyword, page, limit);
    return {
      ...empty,
      total: res.total,
      hasMore: hasMore(res.total),
      playlists: res.playlists.map(toKgPlaylistEntry).map(toCoverEntry),
    };
  }
  if (options.category === "album") {
    const res = await kgSearchAlbums(options.keyword, page, limit);
    return {
      ...empty,
      total: res.total,
      hasMore: hasMore(res.total),
      albums: res.albums.map(toKgAlbumEntry).map(toCoverEntry),
    };
  }
  const res = await kgSearchArtists(options.keyword, page, limit);
  return {
    ...empty,
    total: res.total,
    hasMore: hasMore(res.total),
    artists: res.artists.map(toKgArtistEntry).map(toArtistType),
  };
};

/** 热搜条目（网易云形状） */
export interface DispatchHotSearchItem {
  /** 热搜词 */
  searchWord: string;
  /** 热度分 */
  score: number;
  /** 热搜描述 */
  content: string;
  /** 图标地址 */
  iconUrl?: string;
  /** 图标类型：1 HOT / 其他 UP */
  iconType?: number;
}

/**
 * 读取当前平台的热搜榜
 *
 * 网易云走 `/search/hot/detail`；QQ 音乐走平台热搜模块；
 * 酷狗没有热搜模块，返回空列表（页面退化为只显示最近搜索）。
 * @param platform 音源平台
 * @returns 归一化后的热搜条目
 */
export const dispatchHotSearch = async (
  platform: ApiPlatform,
): Promise<DispatchHotSearchItem[]> => {
  if (platform === "netease") {
    const { searchHot } = await loadNeteaseModules();
    const res = await searchHot();
    return (res.data ?? []).map((item: Record<string, any>) => ({
      searchWord: item?.searchWord ?? "",
      score: Number(item?.score ?? 0),
      content: item?.content ?? "",
      iconUrl: item?.iconUrl,
      iconType: item?.iconType,
    }));
  }

  if (platform === "qqmusic") {
    const res = await qqHotSearch();
    return res.list.map((item) => ({
      searchWord: item.keyword,
      score: item.score,
      content: item.description,
    }));
  }

  return [];
};

/** 分派层评论分页 */
export interface DispatchCommentPage {
  /** 评论列表 */
  comments: CommentType[];
  /** 评论总数 */
  total: number;
  /** 是否还有更多 */
  hasMore: boolean;
  /** 下一页游标（网易云为时间戳，平台为平台游标） */
  cursor?: number | string;
}

/** 评论读取参数 */
export interface DispatchCommentOptions {
  /** 资源 id（网易云为数字 id，平台为平台数字 id） */
  id: number | string;
  /** 平台内字符串主键（QQ 音乐 mid；酷狗评论用数字 id，不取该字段） */
  platformId?: string;
  /** 资源类型（网易云口径）：0 歌曲 / 1 mv / 2 歌单 / 3 专辑 / 4 电台节目 / 5 视频 / 6 动态 / 7 电台 */
  type?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
  /** 页码（从 1 开始） */
  page?: number;
  /** 每页数量 */
  pageSize?: number;
  /** 排序方式：1 推荐 / 2 热度 / 3 时间 */
  sortType?: 1 | 2 | 3;
  /** 游标（翻页用） */
  cursor?: number | string;
}

/**
 * 把平台标识映射为稳定的数字 id
 *
 * 平台评论 / 用户 id 可能是非数字字符串（如 QQ 音乐的 `1!xxx`），
 * 而应用内评论模型的 id 是数字：能直接转数字时按原值取，
 * 转不了时用 FNV-1a 散列成 32 位正整数，
 * 保证「同一条评论恒得同一个 id、不同评论不撞 id」。
 * @param value 平台原始 id
 * @returns 数字 id
 */
const toNumericId = (value: number | string | undefined): number => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const text = String(value ?? "");
  if (!text) return 0;
  if (/^\d+$/.test(text)) return Number(text);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash || 1;
};

/**
 * 把平台评论条目转为应用内评论模型
 * @param comment 平台归一化评论
 * @returns 应用内评论模型
 */
const toCommentType = (comment: PlatformComment): CommentType => ({
  id: toNumericId(comment.id),
  content: comment.content,
  time: comment.time,
  liked: comment.liked,
  likedCount: comment.likedCount,
  user: {
    id: toNumericId(comment.user?.id),
    name: comment.user?.name ?? "",
    avatarUrl: comment.user?.avatarUrl ?? "",
  },
  beReplied: comment.beReplied
    ? {
        content: comment.beReplied.content,
        user: {
          id: toNumericId(comment.beReplied.user?.id),
          name: comment.beReplied.user?.name ?? "",
          avatarUrl: comment.beReplied.user?.avatarUrl ?? "",
        },
      }
    : undefined,
});

/**
 * 把平台评论分页转为分派层评论分页
 * @param page 平台归一化评论分页
 * @returns 分派层评论分页
 */
const fromPlatformCommentPage = (page: PlatformCommentPage): DispatchCommentPage => ({
  comments: page.comments.map(toCommentType),
  total: page.total,
  hasMore: page.more,
  cursor: page.cursor,
});

/**
 * 读取网易云评论列表
 *
 * 直调既有 `/comment/new` 封装，游标口径与原页面一致（上一页最后一条的时间戳）。
 * @param options 评论参数
 * @returns 评论分页
 */
const fetchNeteaseComments = async (
  options: DispatchCommentOptions,
): Promise<DispatchCommentPage> => {
  const page = options.page ?? 1;
  const pageSize = options.pageSize ?? 20;
  const sortType = options.sortType ?? 3;
  const cursor = typeof options.cursor === "number" ? options.cursor : undefined;
  const { getComment, formatCommentList } = await loadNeteaseModules();
  const res = await getComment(
    Number(options.id),
    options.type ?? 0,
    page,
    pageSize,
    sortType,
    cursor,
  );
  const comments = formatCommentList(res.data?.comments);
  const last = comments[comments.length - 1];
  return {
    comments,
    total: Number(res.data?.total ?? comments.length),
    hasMore: res.data?.hasMore === true,
    cursor: last?.time,
  };
};

/**
 * 读取网易云热门评论
 * @param options 评论参数
 * @returns 评论分页
 */
const fetchNeteaseHotComments = async (
  options: DispatchCommentOptions,
): Promise<DispatchCommentPage> => {
  const { getHotComment, formatCommentList } = await loadNeteaseModules();
  const res = await getHotComment(Number(options.id), options.type ?? 0, options.pageSize ?? 20, 0);
  const comments = formatCommentList(res.hotComments);
  return {
    comments,
    total: Number(res.total ?? comments.length),
    hasMore: res.hasMore === true,
  };
};

/**
 * 读取当前平台的评论列表
 *
 * 网易云走 `/comment/new`；QQ 音乐按「时间 / 热门」两套通道取；
 * 酷狗只有一套评论端点，热门与最新共用第一页。
 * @param platform 音源平台
 * @param options 评论参数
 * @returns 评论分页
 */
export const dispatchComments = async (
  platform: ApiPlatform,
  options: DispatchCommentOptions,
): Promise<DispatchCommentPage> => {
  if (platform === "netease") {
    return fetchNeteaseComments(options);
  }

  const page = options.page ?? 1;
  const pageSize = options.pageSize ?? 20;
  // 网易云的「全部评论」按时间排序（sortType=3），平台侧对应「最新」通道
  const commentType = (options.sortType ?? 3) === 3 ? "new" : "hot";

  if (platform === "qqmusic") {
    // QQ 音乐评论的业务主键是歌曲 mid（主进程可由 mid 换算出数字歌曲 id）
    const key = options.platformId || String(options.id);
    const cursor = typeof options.cursor === "string" ? options.cursor : "";
    const res = await qqComment(key, commentType, page, pageSize, cursor);
    return fromPlatformCommentPage(res);
  }

  // 酷狗评论的业务主键是 album_audio_id 口径的歌曲主键（即数字 id）
  const res = await kgComment(String(options.id), page, pageSize);
  return fromPlatformCommentPage(res);
};

/**
 * 读取当前平台的热门评论
 *
 * 网易云走 `/comment/hot`；QQ 音乐走热门评论通道；
 * 酷狗没有独立热门通道，复用评论列表第一页。
 * @param platform 音源平台
 * @param options 评论参数
 * @returns 评论分页
 */
export const dispatchHotComments = async (
  platform: ApiPlatform,
  options: DispatchCommentOptions,
): Promise<DispatchCommentPage> => {
  if (platform === "netease") {
    return fetchNeteaseHotComments(options);
  }

  if (platform === "qqmusic") {
    const key = options.platformId || String(options.id);
    const res = await qqComment(key, "hot", 1, options.pageSize ?? 20, "");
    return fromPlatformCommentPage(res);
  }

  const res = await kgComment(String(options.id), 1, options.pageSize ?? 20);
  return fromPlatformCommentPage(res);
};

/** 分派层歌手详情结果 */
export interface DispatchArtistDetail {
  /** 歌手详情（网易云形状 + 平台维度） */
  detail: ArtistType;
  /** 歌手单曲 */
  songs: SongType[];
  /** 歌手专辑 */
  albums: CoverType[];
}

/** 分派层歌手详情读取参数 */
export interface DispatchArtistOptions {
  /** 歌手平台主键（QQ 音乐 mid / 酷狗 author_id） */
  id: string | number;
  /** 取回的单曲数 */
  limit?: number;
  /** 单曲偏移 */
  offset?: number;
}

/**
 * 读取当前平台的歌手详情
 *
 * QQ 音乐以歌手 mid 定位，酷狗以 author_id 定位；
 * 两条链路都返回「详情头 + 单曲 + 专辑」三段数据。
 * @param platform 音源平台
 * @param options 读取参数
 * @returns 歌手详情、单曲与专辑
 */
export const dispatchArtistDetail = async (
  platform: ApiPlatform,
  options: DispatchArtistOptions,
): Promise<DispatchArtistDetail> => {
  if (platform === "qqmusic") {
    const res = await qqArtistDetail(String(options.id), options.limit ?? 50, options.offset ?? 0);
    return {
      detail: toArtistType(res.artist),
      songs: res.songs.map(toSongType),
      albums: res.albums.map(toCoverEntry),
    };
  }
  const res = await kgArtistDetail(options.id);
  return {
    detail: toArtistType(res.artist),
    songs: res.songs.map(toSongType),
    albums: res.albums.map(toCoverEntry),
  };
};

/** 分派层专辑详情结果 */
export interface DispatchAlbumDetail {
  /** 专辑头部（网易云形状 + 平台维度） */
  detail: CoverType;
  /** 专辑曲目 */
  tracks: SongType[];
}

/**
 * 取专辑的歌手列表
 *
 * 平台侧的专辑详情接口只给歌手名，歌手的数字 id 与平台主键
 * 统一从曲目条目里取，保证专辑页的歌手可跳转。
 * @param songs 专辑曲目
 * @returns 歌手列表
 */
const pickAlbumArtists = (songs: SongType[]): CoverType["artists"] => {
  const artists = songs[0]?.artists;
  if (!Array.isArray(artists)) return undefined;
  return artists.map((artist) => ({
    id: Number(artist.id) || 0,
    name: artist.name,
    cover: artist.cover,
    platform: artist.platform,
    platformId: artist.platformId,
  }));
};

/**
 * 读取当前平台的专辑详情
 *
 * 专辑以平台主键定位（QQ 音乐 album mid / 酷狗 album_id）。
 * @param platform 音源平台
 * @param id 专辑平台主键
 * @returns 专辑详情与曲目
 */
export const dispatchAlbumDetail = async (
  platform: ApiPlatform,
  id: string | number,
): Promise<DispatchAlbumDetail> => {
  if (platform === "qqmusic") {
    const res = await qqAlbumDetail(String(id));
    const songs = res.songs.map(toSongType);
    return {
      detail: {
        id: res.album.id,
        name: res.album.name,
        cover: res.album.cover,
        coverSize: res.album.coverSize,
        count: res.album.count,
        description: res.album.description,
        // 专辑歌手取自曲目条目，条目自带歌手数字 id 与平台主键
        artists: pickAlbumArtists(songs),
        createTime: res.album.publishTime,
        platform: "qqmusic",
        platformId: res.album.platformId,
      },
      tracks: songs,
    };
  }
  const res = await kgAlbumDetail(id);
  const songs = res.songs.map(toSongType);
  return {
    detail: {
      id: res.album.id,
      name: res.album.name,
      cover: res.album.cover,
      coverSize: res.album.coverSize,
      count: res.album.count,
      description: res.album.description,
      artists: pickAlbumArtists(songs),
      createTime: res.album.publishTime,
      platform: "kugou",
      platformId: res.album.platformId,
    },
    tracks: songs,
  };
};

/** 分派层榜单结果 */
export interface DispatchLeaderboardResult {
  /** 榜单名 */
  title: string;
  /** 榜单副标题 */
  subTitle: string;
  /** 榜单封面 */
  cover: string;
  /** 榜单曲目总数 */
  total: number;
  /** 榜单曲目 */
  songs: SongType[];
  /**
   * 是否还有下一页
   *
   * 平台一次给全量榜单曲目（无翻页概念）时为 undefined，
   * 页面据此不显示「没有更多」页脚。
   */
  hasMore?: boolean;
}

/**
 * 读取当前平台的榜单
 *
 * QQ 音乐有榜单模块（缺省热歌榜）；酷狗的榜单按页取回，缺省 TOP500。
 * @param platform 音源平台
 * @param options 读取参数
 * @returns 榜单信息与曲目
 */
export const dispatchLeaderboard = async (
  platform: ApiPlatform,
  options: {
    topid?: number;
    rankid?: number;
    limit?: number;
    offset?: number;
    page?: number;
  } = {},
): Promise<DispatchLeaderboardResult> => {
  if (platform === "qqmusic") {
    const res = await qqLeaderboard(options.topid ?? 26, options.limit ?? 50, options.offset ?? 0);
    return {
      title: res.title,
      subTitle: res.subTitle,
      cover: res.cover,
      total: res.total,
      songs: res.songs.map(toSongType),
    };
  }
  if (platform === "kugou") {
    const res = await kgLeaderboardDetail(
      options.rankid ?? KG_DEFAULT_RANK_ID,
      options.page ?? 1,
      options.limit ?? 50,
    );
    return {
      title: res.title,
      subTitle: res.subTitle,
      cover: res.cover,
      total: res.total,
      songs: res.songs.map(toSongType),
      hasMore: res.hasMore,
    };
  }
  return { title: "", subTitle: "", cover: "", total: 0, songs: [] };
};

/**
 * 读取当前平台的分组榜单清单
 *
 * QQ 音乐与酷狗的榜单体系都按分组下发（巅峰榜 / 地区榜 / 特色榜 / …），
 * 页面按分组渲染榜单卡片，点选后再取该榜单的曲目。
 * @param platform 音源平台
 * @param options 读取参数
 * @returns 按分组组织的榜单清单
 */
export const dispatchLeaderboardGroups = async (
  platform: ApiPlatform,
  options: { groupId?: number } = {},
): Promise<PlatformLeaderboardGroup[]> => {
  if (platform === "qqmusic") return qqLeaderboardList();
  if (platform === "kugou") return kgLeaderboardList(options.groupId);
  return [];
};

/**
 * 读取当前平台单个榜单的详情
 *
 * QQ 音乐一次给全量榜单曲目（无翻页概念），
 * 酷狗榜单动辄数百首，按页取回。
 * @param platform 音源平台
 * @param options 读取参数
 * @returns 榜单信息与曲目
 */
export const dispatchLeaderboardDetail = async (
  platform: ApiPlatform,
  options: { boardId: number; page?: number; limit?: number },
): Promise<DispatchLeaderboardResult> => {
  if (platform === "qqmusic") {
    const res = await qqLeaderboardDetail(options.boardId, options.limit ?? 100);
    return {
      title: res.title,
      subTitle: res.subTitle,
      cover: res.cover,
      total: res.total,
      songs: res.songs.map(toSongType),
    };
  }
  if (platform === "kugou") {
    return dispatchLeaderboard(platform, {
      rankid: options.boardId,
      page: options.page ?? 1,
      limit: options.limit ?? 100,
    });
  }
  return { title: "", subTitle: "", cover: "", total: 0, songs: [] };
};

/** 分派层歌单广场结果 */
export interface DispatchSquareResult {
  /** 广场歌单 */
  playlists: CoverType[];
  /** 广场歌单总数 */
  total: number;
  /** 是否还有更多 */
  hasMore: boolean;
}

/** 分派层歌手分类项 */
export interface DispatchArtistType {
  /** 分类标识（平台内分类主键） */
  id: string;
  /** 分类名 */
  name: string;
}

/** 分派层热门歌手结果 */
export interface DispatchHotArtistsResult {
  /** 歌手列表 */
  artists: ArtistType[];
  /** 分类清单（平台没有分类维度时为空） */
  types: DispatchArtistType[];
  /** 歌手总数（平台不提供总数时按已取条数） */
  total: number;
  /** 是否还有下一页（平台一次性给全量歌手时为 false） */
  hasMore: boolean;
}

/**
 * 读取当前平台的热门歌手
 *
 * 各平台数据源不同：
 * - QQ 音乐没有「歌手列表」接口，改由榜单歌曲里出现的歌手聚合而成
 *   （条目自带 mid 与数字 id），上游一次性给全量，没有翻页概念；
 * - 酷狗直接取原生歌手列表接口，自带分页与分类维度，
 *   并透出上游分类清单供页面切换筛选。
 * @param platform 音源平台
 * @param options 读取参数（分类标识、页码、条数）
 * @returns 歌手列表与分类清单
 */
export const dispatchHotArtists = async (
  platform: ApiPlatform,
  options: { type?: string; page?: number; limit?: number } = {},
): Promise<DispatchHotArtistsResult> => {
  const limit = options.limit ?? 100;
  const page = options.page ?? 1;
  // 酷狗：原生歌手列表接口，自带分类维度
  if (platform === "kugou") {
    const res = await kgHotArtists(options.type, page, limit);
    return {
      artists: res.artists.map(toArtistType),
      types: res.types,
      total: res.total,
      hasMore: page * limit < res.total,
    };
  }
  if (platform !== "qqmusic") return { artists: [], types: [], total: 0, hasMore: false };
  const board = await dispatchLeaderboard(platform, { limit });
  const seen = new Set<string>();
  const artists: ArtistType[] = [];
  for (const song of board.songs) {
    if (!Array.isArray(song.artists)) continue;
    for (const artist of song.artists) {
      const key = artist.platformId ?? String(artist.id);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      artists.push({
        id: Number(artist.id) || 0,
        name: artist.name,
        cover: artist.cover ?? "",
        platform: "qqmusic",
        platformId: artist.platformId,
      });
    }
  }
  // QQ 音乐由榜单歌曲聚合而来，一次给全量，没有翻页概念
  return { artists, types: [], total: artists.length, hasMore: false };
};

/**
 * 读取当前平台的歌单广场
 *
 * QQ 音乐走广场模块（可翻页）；酷狗按分类关键词轮换取材，
 * 每页对应上游歌单搜索的一页，翻页真实推进。
 * 酷狗传 `keyword` 时按该关键词固定翻页（不参与分类轮换），
 * 用于「按场景关键词查看歌单」的入口。
 * @param platform 音源平台
 * @param options 读取参数
 * @returns 广场歌单与总数
 */
export const dispatchSquarePlaylists = async (
  platform: ApiPlatform,
  options: { page?: number; limit?: number; keyword?: string } = {},
): Promise<DispatchSquareResult> => {
  if (platform === "qqmusic") {
    const page = options.page ?? 1;
    const limit = options.limit ?? 30;
    const res = await qqPlaylistSquare(page, limit);
    return {
      playlists: res.list.map(toCoverEntry),
      total: res.total,
      hasMore: page * limit < res.total,
    };
  }
  const page = options.page ?? 1;
  const limit = options.limit ?? 30;
  const res = await kgPlaylistSquare(page, limit, options.keyword);
  return {
    playlists: res.list.map(toCoverEntry),
    total: res.total,
    hasMore: res.hasMore && page * limit < res.total,
  };
};

/** 分派层首页区块条目结果 */
export interface DispatchHomeResult {
  /** 区块条目 */
  items: CoverType[];
  /** 条目总数 */
  total: number;
}

/** 分派层首页区块歌手结果 */
export interface DispatchHomeArtistsResult {
  /** 歌手条目 */
  artists: ArtistType[];
  /** 歌手总数 */
  total: number;
}

/** 分派层首页场景电台结果 */
export interface DispatchHomeThemesResult {
  /** 主题卡条目 */
  themes: PlatformThemeCard[];
  /** 主题总数 */
  total: number;
}

/**
 * 读取当前平台首页「为你推荐」歌单
 *
 * 目前只有 QQ 音乐有该数据源（上游编辑推荐歌单），
 * 其它平台没有对应端点时返回空列表，由页面层按能力表决定是否渲染该区块。
 * @param platform 音源平台
 * @param options 读取参数
 * @returns 歌单条目与总数
 */
export const dispatchHomeRecommend = async (
  platform: ApiPlatform,
  options: { limit?: number } = {},
): Promise<DispatchHomeResult> => {
  if (platform !== "qqmusic") return { items: [], total: 0 };
  const list = await qqHomeRecommend(options.limit);
  return { items: list.map(toCoverEntry), total: list.length };
};

/**
 * 读取当前平台首页「精选歌单」的分类歌单
 *
 * 目前只有 QQ 音乐有分类歌单数据源（上游歌单广场），
 * 其它平台没有对应端点时返回空列表。
 * @param platform 音源平台
 * @param options 读取参数
 * @returns 歌单条目与总数
 */
export const dispatchHomeSquare = async (
  platform: ApiPlatform,
  options: { category?: number; limit?: number } = {},
): Promise<DispatchHomeResult> => {
  if (platform !== "qqmusic") return { items: [], total: 0 };
  const res = await qqHomeSquare(options.category ?? QQ_HOME_SQUARE_CATEGORIES[0].id, options.limit);
  return { items: res.list.map(toCoverEntry), total: res.total };
};

/**
 * 读取当前平台首页「歌手推荐」
 *
 * QQ 音乐走上游歌手列表，酷狗走热门歌手列表，
 * 两边的歌手条目都带平台主键，可直接定位歌手详情。
 * @param platform 音源平台
 * @param options 读取参数
 * @returns 歌手条目与总数
 */
export const dispatchHomeSingers = async (
  platform: ApiPlatform,
  options: { limit?: number } = {},
): Promise<DispatchHomeArtistsResult> => {
  const limit = options.limit ?? 12;
  if (platform === "qqmusic") {
    const list = await qqHomeSingers(limit);
    return { artists: list.map(toArtistType), total: list.length };
  }
  if (platform === "kugou") {
    const res = await kgHotArtists(undefined, 1, limit);
    return { artists: res.artists.map(toArtistType), total: res.total };
  }
  return { artists: [], total: 0 };
};

/**
 * 读取当前平台首页「新碟上架」
 *
 * QQ 音乐走上游新碟列表，酷狗走 mobilecdn 新碟列表，
 * 两边的专辑条目都带专辑主键，可直接定位专辑详情。
 * @param platform 音源平台
 * @param options 读取参数
 * @returns 专辑条目与总数
 */
export const dispatchHomeAlbums = async (
  platform: ApiPlatform,
  options: { limit?: number } = {},
): Promise<DispatchHomeResult> => {
  const limit = options.limit ?? 12;
  if (platform === "qqmusic") {
    const list = await qqHomeAlbums(limit);
    return { items: list.map(toCoverEntry), total: list.length };
  }
  if (platform === "kugou") {
    const list = await kgHomeAlbums(limit);
    return { items: list.map(toCoverEntry), total: list.length };
  }
  return { items: [], total: 0 };
};

/**
 * 读取当前平台首页「场景电台」主题卡
 *
 * 场景电台是酷狗独有能力：主题目录只在该平台有数据源，
 * 其它平台返回空列表，由页面层按能力表决定是否渲染该区块。
 * @param platform 音源平台
 * @param options 读取参数
 * @returns 主题卡条目与总数
 */
export const dispatchHomeThemes = async (
  platform: ApiPlatform,
  options: { limit?: number } = {},
): Promise<DispatchHomeThemesResult> => {
  if (platform !== "kugou") return { themes: [], total: 0 };
  const list = await kgHomeThemes(options.limit ?? 6);
  return { themes: list, total: list.length };
};

/**
 * 读取酷狗公开歌单详情
 *
 * 公开歌单与账号云歌单是两套数据源，详情页按 `scope` 参数分流。
 * @param id 公开歌单 id
 * @param page 页码（从 1 开始）
 * @param pageSize 每页条数
 * @returns 歌单头部与曲目
 */
export const dispatchPublicPlaylistDetail = async (
  id: string | number,
  page = 1,
  pageSize = 300,
): Promise<DispatchPlaylistDetail> => {
  const res = await kgPublicPlaylist(id, page, pageSize);
  return {
    detail: toCoverEntry({
      id: res.playlist.id,
      platformId: res.playlist.platformId,
      name: res.playlist.name,
      cover: res.playlist.cover,
      count: res.playlist.count,
      playCount: res.playlist.playCount,
      creatorName: resolveCreatorName("kugou", res.playlist.creatorName, false),
      description: res.playlist.description,
      platform: "kugou",
    }),
    tracks: res.songs.map(toSongType),
    count: res.playlist.count ?? 0,
    hasMore: res.hasMore,
    page,
    pageSize,
  };
};
