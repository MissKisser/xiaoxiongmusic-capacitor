/**
 * 酷狗音乐用户歌单（我的歌单）读取模块
 *
 * 走网关 cloudlist 路由：
 * - 歌单列表：POST /v7/get_all_list（自建与收藏歌单）
 * - 自建歌单详情：POST /v4/get_list_all_file（按官方 sort 位置下标排序）
 * - 收藏歌单源解析：从收藏记录反查 musiclib_id 并经由 readPublicPlaylist 读取源公开歌单
 * - 账号资料：POST /v3/get_my_info
 *
 * @author Hackerdallas
 */

import { kgGatewayRequest } from "../core/request";
import { fillCover, KG_CLOUDLIST_ROUTER } from "../core/config";
import { extractEntryTitle } from "../core/song_title";
import { rsaEncryptKugou } from "../core/crypto";
import { readPublicPlaylist } from "./playlist";
import { getSessionCookies } from "../../sessionStore";
import { coreLog } from "../core/logger";
import type { KGModule, KGParams } from "../core/types";

/** 单页最大曲目数 */
const MAX_PAGE_SIZE = 300;

/** 封面尺寸 */
const COVER_SIZE = 300;

interface KgPlaylistItem {
  listid?: number | string;
  name?: string;
  type?: number;
  count?: number;
  list_create_userid?: number | string;
  list_create_username?: string;
  pic?: string;
  intro?: string;
  create_time?: number;
  update_time?: number;
  is_def?: number;
  status?: number;
  list_create_listid?: number | string;
  list_create_gid?: string;
  global_collection_id?: string;
  musiclib_id?: number | string;
}

interface KgSongItem {
  hash?: string;
  fileid?: number | string;
  mixsongid?: number | string;
  audio_id?: number;
  name?: string;
  singername?: string;
  singerinfo?: Array<{ name?: string; id?: number }>;
  album_id?: number | string;
  albuminfo?: { id?: number | string; name?: string };
  album_name?: string;
  timelen?: number;
  sort?: number;
  cover?: string;
  media_pay_type?: number;
  language?: string;
  publish_date?: string;
  relate_goods?: Array<{
    hash?: string;
    size?: number;
    bitrate?: number;
    privilege?: number;
    level?: number;
  }>;
}

/**
 * 提取歌曲条目的专辑名称
 * @param song 歌曲条目
 * @returns 专辑名
 */
const pickAlbumName = (song: KgSongItem): string => {
  const info = song.albuminfo;
  if (info && typeof info === "object" && info.name) return String(info.name);
  return String(song.album_name ?? "");
};

/**
 * 将云端歌曲条目转换为对外结构
 * @param song 歌曲条目
 * @returns 规范化歌曲对象
 */
const mapCloudSong = (song: KgSongItem) => {
  const singerinfo = Array.isArray(song.singerinfo) ? song.singerinfo : [];
  const duration = Number(song.timelen || 0);

  return {
    id: String(song.hash ?? ""),
    hash: song.hash ?? "",
    fileid: String(song.fileid ?? ""),
    audioId: Number(song.audio_id || 0),
    mixSongId: String(song.mixsongid ?? ""),
    albumAudioId: Number(song.mixsongid || 0),
    name: extractEntryTitle(song, { nameFields: ["name"] }),
    artist:
      song.singername ||
      singerinfo
        .map((singer) => singer.name ?? "")
        .filter(Boolean)
        .join(" / "),
    artists: singerinfo.map((singer) => ({
      id: String(singer.id ?? ""),
      name: singer.name ?? "",
    })),
    album: pickAlbumName(song),
    albumId: String(song.album_id ?? ""),
    cover: fillCover(song.cover, COVER_SIZE) ?? "",
    coverOriginal: fillCover(song.cover, 480) ?? "",
    duration,
    interval: Math.round(duration / 1000),
    payType: song.media_pay_type ?? 0,
    language: song.language ?? "",
    publishDate: song.publish_date ?? "",
    qualities: (song.relate_goods ?? []).map((good) => ({
      bitrate: good.bitrate ?? 0,
      size: good.size ?? 0,
      hash: good.hash ?? "",
      privilege: good.privilege ?? 0,
      level: good.level ?? 0,
    })),
  };
};

/**
 * 映射歌单列表条目
 * @param item 歌单原始条目
 * @param subscribed 是否为收藏歌单
 * @returns 规范化歌单对象
 */
const mapPlaylistItem = (item: KgPlaylistItem, subscribed: boolean) => ({
  listid: String(item.listid ?? ""),
  name: item.name ?? "",
  type: item.type ?? (subscribed ? 1 : 0),
  count: item.count ?? 0,
  creator: item.list_create_username ?? "",
  cover: fillCover(item.pic, COVER_SIZE) ?? "",
  intro: item.intro ?? "",
  createTime: item.create_time ?? 0,
  updateTime: item.update_time ?? 0,
  isDef: Number(item.is_def ?? 0),
  isDefault: item.is_def === 1,
  subscribed,
  originListid: String(item.list_create_listid ?? ""),
  originUserid: String(item.list_create_userid ?? ""),
  originGid: String(item.list_create_gid ?? ""),
  globalCollectionId: String(item.global_collection_id ?? ""),
  originSpecialid: String(item.musiclib_id ?? ""),
});

/**
 * 读取当前账号的全部云歌单条目
 * @param session 会话凭据
 * @returns 歌单列表及统计数据
 */
const readPlaylistItems = async (session: {
  userid: string;
  token: string;
}): Promise<{
  items: KgPlaylistItem[];
  listCount: number;
  collectCount: number;
  albumCount: number;
}> => {
  const response = await kgGatewayRequest<{
    data?: {
      info?: KgPlaylistItem[];
      list_count?: number;
      collect_count?: number;
      album_count?: number;
    };
  }>("/v7/get_all_list", {
    method: "POST",
    headers: { "x-router": KG_CLOUDLIST_ROUTER },
    params: { plat: 1 },
    data: {
      userid: session.userid,
      token: session.token,
      total_ver: 979,
      type: 2,
      page: 1,
      pagesize: 100,
    },
  });

  const data = response?.data ?? {};
  const items = data.info ?? [];
  const owned = items.filter((item) => Number(item.type ?? 0) !== 1);
  const favorites = items.filter((item) => Number(item.type ?? 0) === 1);

  return {
    items,
    listCount: data.list_count ?? owned.length,
    collectCount: data.collect_count ?? favorites.length,
    albumCount: data.album_count ?? 0,
  };
};

/**
 * 查找指定 listid 的收藏记录
 * @param items 歌单条目
 * @param listid 目标 listid
 * @returns 匹配的收藏记录
 */
const findCollectedEntry = (items: KgPlaylistItem[], listid: string): KgPlaylistItem | null =>
  items.find((item) => Number(item.type ?? 0) === 1 && String(item.listid ?? "") === listid) ??
  null;

/**
 * 按官方客户端 sort 下标进行排序
 * @param items 原始歌曲条目
 * @returns 排序后的歌曲条目
 */
const sortByOfficialOrder = (items: KgSongItem[]): KgSongItem[] => {
  const positions = items.map((item) => {
    const value: unknown = item?.sort;
    if (value === undefined || value === null || value === "") return Number.NaN;
    return Number(value);
  });
  if (positions.some((value) => !Number.isFinite(value))) return items;
  const order = items.map((_, index) => index);
  order.sort((a, b) => positions[a] - positions[b] || a - b);
  return order.map((index) => items[index]);
};

/**
 * 读取自建云歌单全部歌曲并按官方顺序排布
 * @param session 会话凭据
 * @param listid 歌单标识
 * @returns 歌曲列表与总数
 */
const readListSongsInOfficialOrder = async (
  session: { userid: string; token: string },
  listid: string,
): Promise<{ items: KgSongItem[]; count: number }> => {
  const collected: KgSongItem[] = [];
  const seen = new Set<string>();
  let count = 0;
  let totalPages = 1;

  for (let page = 1; page <= totalPages; page += 1) {
    const response = await kgGatewayRequest<{
      data?: {
        info?: KgSongItem[];
        count?: number;
      };
    }>("/v4/get_list_all_file", {
      method: "POST",
      headers: { "x-router": KG_CLOUDLIST_ROUTER },
      params: { plat: 1 },
      data: {
        listid,
        userid: session.userid,
        area_code: 1,
        show_relate_goods: 1,
        pagesize: MAX_PAGE_SIZE,
        allplatform: 1,
        show_cover: 1,
        type: 0,
        token: session.token,
        page,
      },
    });

    const data = response?.data ?? {};
    const items = data.info ?? [];
    count = data.count ?? count;
    totalPages = Math.max(1, Math.ceil(count / MAX_PAGE_SIZE));
    for (const item of items) {
      const key = String(item?.hash ?? "");
      if (key) {
        if (seen.has(key)) continue;
        seen.add(key);
      }
      collected.push(item);
    }
    if (items.length === 0) break;
  }

  return {
    items: sortByOfficialOrder(collected),
    count: count || collected.length,
  };
};

/**
 * 读取当前用户的歌单列表（自建 + 收藏）
 */
export const user_playlist_list: KGModule = async () => {
  const session = getSessionCookies("kugou");
  if (!session.token || !session.userid) {
    return { code: 401, message: "未登录" };
  }

  const snapshot = await readPlaylistItems({
    userid: session.userid,
    token: session.token,
  });
  const owned = snapshot.items.filter((item) => Number(item.type ?? 0) !== 1);
  const favorites = snapshot.items.filter((item) => Number(item.type ?? 0) === 1);

  return {
    code: 200,
    total: snapshot.items.length,
    listCount: snapshot.listCount,
    collectCount: snapshot.collectCount,
    albumCount: snapshot.albumCount,
    owned: owned.map((item) => mapPlaylistItem(item, false)),
    favorites: favorites.map((item) => mapPlaylistItem(item, true)),
  };
};

/**
 * 读取歌单歌曲详情（支持自建歌单与收藏歌单源反查）
 * @param params.id 歌单 listid
 * @param params.page 页码
 * @param params.pageSize 每页数量
 */
export const playlist_detail: KGModule = async (params: KGParams) => {
  const session = getSessionCookies("kugou");
  if (!session.token || !session.userid) {
    return { code: 401, message: "未登录" };
  }
  const listid = String(params.id ?? "");
  if (!listid) return { code: 400, message: "id required" };

  const page = Math.max(1, Number(params.page ?? 1) || 1);
  const pageSize = Math.max(1, Number(params.pageSize ?? MAX_PAGE_SIZE) || MAX_PAGE_SIZE);

  const result = await readListSongsInOfficialOrder(
    { userid: session.userid, token: session.token },
    listid,
  );

  const offset = (page - 1) * pageSize;
  const songs = result.items.slice(offset, offset + pageSize);

  if (result.items.length === 0) {
    const snapshot = await readPlaylistItems({
      userid: session.userid,
      token: session.token,
    });
    const collected = findCollectedEntry(snapshot.items, listid);
    if (collected) {
      const sourceId = String(collected.musiclib_id ?? "");
      const sourceUserId = String(collected.list_create_userid ?? "");
      const sourceListid = String(collected.list_create_listid ?? "");
      if (sourceId) {
        try {
          const source = await readPublicPlaylist(sourceId, page, pageSize);
          if (source.songs.length > 0) {
            return {
              code: 200,
              id: listid,
              page,
              pageSize,
              total: source.total,
              songs: source.songs,
              subscribed: true,
              sourceId,
              sourceUserId,
              sourceListid,
              sourceName: source.name,
              sourceCreator: source.creator,
              sourceCount: collected.count ?? 0,
              sourceReadable: true,
            };
          }
        } catch (err) {
          coreLog.warn("读取收藏歌单源歌单失败", err);
        }
      }

      return {
        code: 200,
        id: listid,
        page,
        pageSize,
        total: 0,
        songs: [],
        subscribed: true,
        sourceId,
        sourceUserId,
        sourceListid,
        sourceName: collected.name ?? "",
        sourceCreator: collected.list_create_username ?? "",
        sourceCount: collected.count ?? 0,
        sourceReadable: false,
        message: "源歌单当前不可读",
      };
    }
  }

  return {
    code: 200,
    id: listid,
    page,
    pageSize,
    total: result.count || result.items.length,
    songs: songs.map(mapCloudSong),
  };
};

/**
 * 读取账号基础资料
 */
export const user_profile: KGModule = async () => {
  const session = getSessionCookies("kugou");
  if (!session.token || !session.userid) {
    return { code: 401, message: "未登录" };
  }

  try {
    const clienttime = Math.floor(Date.now() / 1000);
    const response = await kgGatewayRequest<{ data?: Record<string, unknown> }>("/v3/get_my_info", {
      method: "POST",
      headers: { "x-router": "usercenter.kugou.com" },
      params: { plat: 1 },
      data: {
        visit_time: clienttime,
        usertype: 1,
        p: rsaEncryptKugou({ token: session.token, clienttime }).toUpperCase(),
        userid: Number(session.userid),
      },
    });
    const info = response?.data ?? {};
    coreLog.info("读取账号资料成功");
    return {
      code: 200,
      userId: String(session.userid),
      nickname: String(info.nickname ?? info.username ?? session.nickname ?? ""),
      avatar: String(info.pic ?? info.userpic ?? session.avatar ?? ""),
      vipType: Number(info.vip_type ?? session.vip_type ?? 0),
    };
  } catch (err) {
    coreLog.error("读取账号资料失败", err);
    throw err;
  }
};
