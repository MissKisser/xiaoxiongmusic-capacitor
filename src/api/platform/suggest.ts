/**
 * 搜索建议分派
 *
 * 网易云沿用既有 `/search/suggest` 封装，返回结构原样透出，页面行为零变化；
 * QQ 音乐 / 酷狗 没有站内建议接口，按各平台自己的搜索接口取分类前几条，
 * 归一成与网易云建议一致的分组结构（单曲 / 歌手 / 专辑 / 歌单），
 * 页面层的下拉建议因此在三平台上是同一套交互。
 *
 * 条目 id 口径：网易云是平台数字 id，第三方平台是平台内主键
 * （QQ 音乐 mid / 酷狗 hash 类主键），跳转时随 `platform` 一起传路由。
 */

import type { ApiPlatform } from "@/types/shared";
import type { CoverType, MetaData, SongType } from "@/types/main";
import { searchSuggest } from "@/api/search";
import { dispatchSearch } from "./dispatch";

/** 建议条目（第三方平台形状） */
export interface PlatformSuggestItem {
  /** 条目 id（第三方平台为平台内主键） */
  id: number | string;
  /** 名称 */
  name: string;
  /** 歌手（单曲条目用） */
  artists?: { id: number | string; name: string }[];
  /** 歌手（专辑 / 歌单条目用） */
  artist?: { id: number | string; name: string };
  /** 来源平台 */
  platform: ApiPlatform;
  /** 单曲条目自带的歌曲数据，点击后直接入队播放 */
  song?: SongType;
}

/** 建议分组（第三方平台形状） */
export interface PlatformSuggestResult {
  /** 分类顺序 */
  order: string[];
  /** 单曲 */
  songs: PlatformSuggestItem[];
  /** 歌手 */
  artists: PlatformSuggestItem[];
  /** 专辑 */
  albums: PlatformSuggestItem[];
  /** 歌单 */
  playlists: PlatformSuggestItem[];
}

/** 每个分类的建议条数 */
const SUGGEST_LIMIT = 5;

/**
 * 取条目在平台内定位用的主键
 * @param entry 条目
 * @returns 平台内主键，缺失时退到条目自身 id
 */
const pickPlatformKey = (entry: { id: number | string; platformId?: string }): number | string =>
  entry.platformId ?? entry.id;

/**
 * 取歌手条目里的歌手名列表
 * @param artists 歌手条目
 * @returns 歌手名列表
 */
const pickArtistNames = (
  artists: MetaData[] | string | undefined,
): { id: number | string; name: string }[] => {
  if (!Array.isArray(artists)) return [];
  return artists.map((artist) => ({ id: artist.id, name: artist.name }));
};

/**
 * 读取一个分类的建议条目
 *
 * 单个分类取数失败不影响其它分类，故失败时返回空列表。
 * @param platform 音源平台
 * @param keyword 搜索关键词
 * @param category 分类
 * @returns 分类下的建议条目
 */
const fetchSuggestCategory = async (
  platform: ApiPlatform,
  keyword: string,
  category: "song" | "artist" | "album" | "playlist",
): Promise<CoverType[] | SongType[]> => {
  try {
    const result = await dispatchSearch(platform, {
      keyword,
      category,
      page: 1,
      limit: SUGGEST_LIMIT,
    });
    if (category === "song") return result.songs;
    if (category === "artist") return result.artists;
    if (category === "album") return result.albums;
    return result.playlists;
  } catch (error) {
    console.error(`读取${platform}搜索建议失败：`, error);
    return [];
  }
};

/**
 * 读取当前平台的搜索建议
 *
 * 网易云：原样返回 `/search/suggest` 的结果；
 * QQ 音乐 / 酷狗：按平台搜索接口取四类前几条，归一成同构分组。
 * @param platform 音源平台
 * @param keyword 搜索关键词
 * @returns 建议分组
 */
export const dispatchSearchSuggest = async (
  platform: ApiPlatform,
  keyword: string,
): Promise<any> => {
  // 网易云：既有建议接口，返回结构原样透出
  if (platform === "netease") {
    const result = await searchSuggest(keyword);
    return result.result;
  }
  const [songs, artists, albums, playlists] = await Promise.all([
    fetchSuggestCategory(platform, keyword, "song"),
    fetchSuggestCategory(platform, keyword, "artist"),
    fetchSuggestCategory(platform, keyword, "album"),
    fetchSuggestCategory(platform, keyword, "playlist"),
  ]);
  return {
    order: ["songs", "artists", "albums", "playlists"],
    songs: (songs as SongType[]).map((song) => ({
      id: pickPlatformKey(song),
      name: song.name,
      artists: pickArtistNames(song.artists),
      platform,
      song,
    })),
    artists: (artists as CoverType[]).map((artist) => ({
      id: pickPlatformKey(artist),
      name: artist.name,
      platform,
    })),
    albums: (albums as CoverType[]).map((album) => ({
      id: pickPlatformKey(album),
      name: album.name,
      platform,
    })),
    playlists: (playlists as CoverType[]).map((playlist) => ({
      id: pickPlatformKey(playlist),
      name: playlist.name,
      platform,
    })),
  } satisfies PlatformSuggestResult;
};
