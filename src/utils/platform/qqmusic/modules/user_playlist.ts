/**
 * QQ 音乐「我的歌单」与歌单读取模块
 *
 * 涵盖：自建歌单列表、收藏歌单列表、我喜欢的音乐（系统目录 dirId=201）、
 * 歌单详情解析（兼容自建 dirinfo 与公开 cdlist 结构）、歌单编辑信息查询及单曲详情。
 *
 * @author Hackerdallas
 */

import { qmRequest, getQQMusicUin, getQQMusicCookies } from "../core/request";
import { coreLog } from "../core/logger";
import type { QMModule, QMParams } from "../core/types";

/** 我喜欢目录的系统 dirId（红心写入也走此目录） */
export const LIKED_DIR_ID = 201;

interface OwnedPlaylistEntry {
  tid?: number | string;
  dirId?: number | string;
  dirName?: string;
  dirType?: number;
  uin?: string | number;
  songnum?: number;
  songNum?: number;
  listenNum?: number;
  logo?: string;
  logoUrl?: string;
  picUrl?: string;
  bigpicUrl?: string;
  nick?: string;
  desc?: string;
  createTime?: number;
  updateTime?: number;
}

interface OwnedPlaylistResponse {
  total?: number;
  v_playlist?: OwnedPlaylistEntry[];
  v_delTid?: number[];
  bFinish?: boolean;
}

const positiveInt = (value: unknown): number | undefined => {
  const num = typeof value === "string" && /^\d{1,15}$/.test(value) ? Number(value) : value;
  return typeof num === "number" && Number.isSafeInteger(num) && num > 0 ? num : undefined;
};

const firstNonEmpty = (...values: Array<string | undefined>): string =>
  values.find((value) => typeof value === "string" && value.trim() !== "") ?? "";

/**
 * 读取当前账号的自建与收藏歌单列表
 */
export const user_playlist_list: QMModule = async () => {
  const uin = getQQMusicUin();
  if (!uin || uin === "0") {
    return { code: 401, message: "未登录" };
  }

  const data = await qmRequest<OwnedPlaylistResponse>(
    "music.musicasset.PlaylistBaseRead",
    "GetPlaylistByUin",
    { uin },
    { session: false },
  );

  const list = data?.v_playlist ?? [];
  const owned = list.filter((item) => item.dirType === 0 || item.dirType === undefined);
  const favorites = list.filter((item) => item.dirType === 3);

  const toPlaylistEntry = (item: OwnedPlaylistEntry, dirType: number) => ({
    tid: positiveInt(item.tid) ?? 0,
    dirId: positiveInt(item.dirId) ?? 0,
    dirName: item.dirName ?? "",
    dirType,
    songNum: item.songnum ?? item.songNum ?? 0,
    listenNum: item.listenNum ?? 0,
    cover: item.picUrl ?? item.bigpicUrl ?? item.logo ?? item.logoUrl ?? "",
    creator: item.nick ?? "",
    description: item.desc ?? "",
    createTime: item.createTime ?? 0,
    updateTime: item.updateTime ?? 0,
  });

  return {
    code: 200,
    total: data?.total ?? list.length,
    bFinish: data?.bFinish ?? true,
    owned: owned.map((item) => toPlaylistEntry(item, item.dirType ?? 0)),
    favorites: favorites.map((item) => toPlaylistEntry(item, 3)),
  };
};

/**
 * 读取「我喜欢的音乐」中的歌曲
 *
 * 我喜欢为系统目录 dirId=201，需从自建歌单中定位其 tid 作为 disstid 发起查询。
 */
export const user_liked_songs: QMModule = async (params: QMParams) => {
  const uin = getQQMusicUin();
  if (!uin || uin === "0") {
    return { code: 401, message: "未登录" };
  }
  const cookies = getQQMusicCookies();

  const listData = await qmRequest<{ v_playlist?: OwnedPlaylistEntry[] }>(
    "music.musicasset.PlaylistBaseRead",
    "GetPlaylistByUin",
    { uin },
    { session: false },
  );

  const likedEntry = (listData?.v_playlist ?? []).find(
    (item) => positiveInt(item.dirId) === LIKED_DIR_ID,
  );
  if (!likedEntry) {
    return { code: 404, message: "未找到「我喜欢」歌单" };
  }
  const likedTid = positiveInt(likedEntry.tid);
  if (!likedTid) {
    return { code: 404, message: "「我喜欢」缺少 tid" };
  }

  const data = await qmRequest<{
    songlist?: Array<{
      id?: number;
      mid?: string;
      name?: string;
      singer?: Array<{ name?: string }>;
      album?: string;
      interval?: number;
      pay?: Record<string, unknown>;
    }>;
    total_song_num?: number;
    hasmore?: number;
  }>(
    "music.srfDissInfo.DissInfo",
    "CgiGetDiss",
    {
      disstid: likedTid,
      dirid: LIKED_DIR_ID,
      tag: true,
      song_begin: Number(params.song_begin ?? 0),
      song_num: Number(params.song_num ?? 100),
      userinfo: true,
      orderlist: true,
      enc_host_uin: cookies.euin ?? "",
    },
    { session: false, webComm: true },
  );

  return {
    code: 200,
    tid: likedTid,
    dirId: LIKED_DIR_ID,
    total: data?.total_song_num ?? data?.songlist?.length ?? 0,
    hasmore: data?.hasmore ?? 0,
    songs: (data?.songlist ?? []).map((song) => ({
      id: song.id ?? 0,
      mid: song.mid ?? "",
      name: song.name ?? "",
      artist: (song.singer ?? [])
        .map((s) => s.name ?? "")
        .filter(Boolean)
        .join(" / "),
      album: song.album ?? "",
      duration: (song.interval ?? 0) * 1000,
      pay: song.pay ?? {},
    })),
  };
};

/**
 * 查询收藏状态
 * @param params.type playlist | album | song
 * @param params.ids 逗号分隔的目标 ID
 */
export const subscription_status: QMModule = async (params: QMParams) => {
  const uin = getQQMusicUin();
  if (!uin || uin === "0") {
    return { code: 401, message: "未登录" };
  }
  const type = String(params.type ?? "playlist");
  const ids = String(params.ids ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  if (ids.length === 0) return { code: 400, message: "ids required" };

  if (type === "playlist") {
    const data = await qmRequest<{ m_fan?: Record<string, boolean> }>(
      "music.musicasset.PlaylistFavRead",
      "IsPlaylistFan",
      { v_tid: ids.map(Number) },
      { session: false },
    );
    return {
      code: 200,
      type,
      items: ids.map((id) => ({ id, status: data?.m_fan?.[id] ? "subscribed" : "not-subscribed" })),
    };
  }

  if (type === "album") {
    const data = await qmRequest<{ m_fan?: Record<string, boolean> }>(
      "music.musicasset.AlbumFavRead",
      "IsAlbumFan",
      { uin, v_albumMid: ids },
      { session: false },
    );
    return {
      code: 200,
      type,
      items: ids.map((id) => ({ id, status: data?.m_fan?.[id] ? "subscribed" : "not-subscribed" })),
    };
  }

  if (type === "song") {
    const data = await qmRequest<{ m_fan?: Record<string, boolean> }>(
      "music.musicasset.SongFavRead",
      "IsSongFanByMid",
      { v_songMid: ids },
      { session: false },
    );
    return {
      code: 200,
      type,
      items: ids.map((id) => ({ id, status: data?.m_fan?.[id] ? "subscribed" : "not-subscribed" })),
    };
  }

  return { code: 400, message: `unsupported type: ${type}` };
};

/**
 * 读取一张歌单的详情与歌曲列表
 * @param params.id 歌单 tid
 * @param params.dirId 歌单目录号
 */
export const playlist_detail: QMModule = async (params: QMParams) => {
  const id = String(params.id ?? "");
  if (!id) return { code: 400, message: "id required" };
  const cookies = getQQMusicCookies();

  const data = await qmRequest<{
    code?: number;
    songlist?: Array<{
      id?: number;
      mid?: string;
      name?: string;
      singer?: Array<{ name?: string }>;
      album?: string;
      interval?: number;
      pay?: Record<string, unknown>;
    }>;
    total_song_num?: number;
    hasmore?: number;
    cdlist?: Array<{ dissname?: string; logo?: string; nickname?: string; desc?: string }>;
    dirinfo?: {
      title?: string;
      picurl?: string;
      picurl2?: string;
      headurl?: string;
      desc?: string;
      host_nick?: string;
    };
  }>(
    "music.srfDissInfo.DissInfo",
    "CgiGetDiss",
    {
      disstid: Number(id),
      dirid: Number(params.dirId ?? 0),
      tag: true,
      song_begin: Number(params.song_begin ?? 0),
      song_num: Number(params.song_num ?? 100),
      userinfo: true,
      orderlist: true,
      enc_host_uin: cookies.euin ?? "",
    },
    { session: false, webComm: true },
  );

  const cd = data?.cdlist?.[0];
  const dirInfo = data?.dirinfo;

  return {
    code: 200,
    id,
    name: firstNonEmpty(cd?.dissname, dirInfo?.title),
    creator: firstNonEmpty(cd?.nickname, dirInfo?.host_nick),
    cover: firstNonEmpty(cd?.logo, dirInfo?.picurl, dirInfo?.picurl2, dirInfo?.headurl),
    description: firstNonEmpty(cd?.desc, dirInfo?.desc),
    total: data?.total_song_num ?? data?.songlist?.length ?? 0,
    hasmore: data?.hasmore ?? 0,
    songs: (data?.songlist ?? []).map((song) => ({
      id: song.id ?? 0,
      mid: song.mid ?? "",
      name: song.name ?? "",
      artist: (song.singer ?? [])
        .map((s) => s.name ?? "")
        .filter(Boolean)
        .join(" / "),
      album: song.album ?? "",
      duration: (song.interval ?? 0) * 1000,
      pay: song.pay ?? {},
    })),
  };
};

/**
 * 读取歌单编辑元信息
 * @param params.dirId 歌单目录号
 */
export const playlist_edit_info: QMModule = async (params: QMParams) => {
  const dirId = Number(params.dirId ?? 0);
  if (!dirId) return { code: 400, message: "dirId required" };

  const data = await qmRequest<{
    dirinfo?: {
      dirid?: number;
      title?: string;
      desc?: string;
      picurl?: string;
      picurl2?: string;
      dir_show?: number;
      tag?: Array<{ id: number; name: string }>;
    };
  }>(
    "music.srfDissInfo.aiDissInfo",
    "uniform_get_Dissinfo",
    { dirid: dirId, optype: 3, tag: 1, userinfo: 0, pic_dpi: 300 },
    { session: false, webComm: true },
  );

  const info = data?.dirinfo;
  if (!info) {
    coreLog.warn("读取歌单编辑信息失败:", dirId);
    return { code: 404, message: "歌单编辑信息不可读" };
  }

  return {
    code: 200,
    dirId,
    title: info.title ?? "",
    desc: info.desc ?? "",
    picurl: info.picurl ?? "",
    picurl2: info.picurl2 ?? "",
    dirShow: info.dir_show === 2 ? 2 : 1,
    tag: info.tag ?? [],
  };
};

/**
 * 查询单曲元信息（获取数字歌曲 ID）
 * @param params.mid 歌曲 mid
 */
export const song_detail: QMModule = async (params: QMParams) => {
  const mid = String(params.mid ?? "");
  if (!mid) return { code: 400, message: "mid required" };

  const data = await qmRequest<{
    track_info?: {
      id?: number;
      mid?: string;
      name?: string;
      title?: string;
      singer?: Array<{ name?: string }>;
      album?: { name?: string };
      interval?: number;
    };
  }>(
    "music.pf_song_detail_svr",
    "get_song_detail_yqq",
    { song_type: 0, song_mid: mid },
    { session: false },
  );

  const track = data?.track_info;
  if (!track?.id) {
    return { code: 404, message: "歌曲不存在" };
  }

  return {
    code: 200,
    id: track.id,
    mid: track.mid ?? mid,
    name: track.name ?? track.title ?? "",
    artist: (track.singer ?? [])
      .map((s) => s.name ?? "")
      .filter(Boolean)
      .join(" / "),
    album: track.album?.name ?? "",
    duration: (track.interval ?? 0) * 1000,
  };
};
