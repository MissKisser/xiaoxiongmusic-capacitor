/**
 * QQ 音乐搜索模块
 *
 * 走移动端搜索接口 music.search.SearchCgiService / DoSearchForQQMusicMobile，
 * 支持按 type 切换搜索对象：0 歌曲 / 8 专辑 / 9 歌手 / 2 歌单。
 * 单页 limit 严格限制不超过 40 条。
 *
 * @author Hackerdallas
 */

import { qmRequest } from "../core/request";
import { coreLog } from "../core/logger";
import type { QMModule, QMParams } from "../core/types";

/** 搜索目标到接口内部 search_type 映射 */
const SEARCH_TYPE_BY_TARGET: Record<string, number> = {
  song: 0,
  album: 2,
  artist: 1,
  playlist: 3,
};

/** 对外数字类型码到内部搜索目标映射 */
const TARGET_BY_TYPE: Record<string, string> = {
  "0": "song",
  "8": "album",
  "9": "artist",
  "2": "playlist",
};

/** 安全转换协议至 HTTPS */
const secureUrl = (url: unknown): string =>
  typeof url === "string" ? url.replace(/^http:/, "https:") : "";

/** 剔除搜索结果中的高亮 em 标签 */
const stripHighlight = (text: unknown): string =>
  typeof text === "string" ? text.replace(/<\/?em>/g, "") : "";

/** 格式化拼接歌手名称 */
const formatSingerName = (singers: unknown): string => {
  if (!Array.isArray(singers)) return "";
  return singers
    .map((item) => stripHighlight((item as { name?: string })?.name))
    .filter(Boolean)
    .join(" / ");
};

/** 生成移动端搜索会话 ID */
const createSearchId = (): string => {
  const group = BigInt(Math.floor(Math.random() * 20) + 1);
  const random = BigInt(Math.floor(Math.random() * 4194305));
  const todayMs = BigInt(Date.now() % 86400000);
  return (group * 18014398509481984n + random * 4294967296n + todayMs).toString();
};

/** 归一化歌手对象 */
const normalizeArtist = (singer: any): Record<string, unknown> => ({
  id: String(singer?.id ?? ""),
  mid: singer?.mid ?? "",
  name: stripHighlight(singer?.name ?? ""),
});

/** 归一化歌曲对象 */
const normalizeSong = (song: any): Record<string, unknown> => {
  const source = song || {};
  const album = source.album || {};
  const file = source.file || {};
  const pay = source.pay || {};
  const pictureMid = album.mid || album.pmid || "";

  return {
    id: String(source.id ?? ""),
    mid: source.mid ?? "",
    name: stripHighlight(source.title ?? source.name ?? ""),
    artist: formatSingerName(source.singer),
    artists: (Array.isArray(source.singer) ? source.singer : []).map(normalizeArtist),
    album: stripHighlight(album.name || album.title || ""),
    albumMid: album.mid ?? "",
    albumId: String(album.id ?? ""),
    duration: (source.interval ?? 0) * 1000,
    mediaMid: file.media_mid ?? "",
    cover: pictureMid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${pictureMid}.jpg` : "",
    coverOriginal: pictureMid
      ? `https://y.gtimg.cn/music/photo_new/T002R800x800M000${pictureMid}.jpg`
      : "",
    pay: {
      payalbum: pay.pay_month === 0 && (pay.price_album ?? 0) > 0 ? 1 : 0,
      payplay: pay.pay_play ?? 0,
    },
    size128: file.size_128mp3 ?? 0,
    size320: file.size_320mp3 ?? 0,
    sizeApe: file.size_ape ?? 0,
    sizeFlac: file.size_flac ?? 0,
    sizeOgg: file.size_192ogg ?? 0,
    sizeHiRes: Array.isArray(file.size_new) ? (file.size_new[0] ?? 0) : 0,
    hiResSampleRate: file.hires_sample ?? 0,
    hiResBitDepth: file.hires_bitdepth ?? 0,
  };
};

/** 归一化专辑对象 */
const normalizeAlbum = (album: any): Record<string, unknown> => {
  const source = album || {};
  const singerList = Array.isArray(source.singer_list) ? source.singer_list : [];
  const artist =
    typeof source.singer === "string"
      ? stripHighlight(source.singer)
      : formatSingerName(singerList);

  return {
    id: source.albummid ?? String(source.id ?? ""),
    albumId: String(source.id ?? ""),
    name: stripHighlight(source.name ?? ""),
    cover: secureUrl(source.pic),
    artist,
    artistMid: singerList[0]?.mid ?? "",
    trackCount: source.song_num ?? 0,
  };
};

/** 归一化歌手对象 */
const normalizeSinger = (artist: any): Record<string, unknown> => {
  const source = artist || {};
  return {
    id: source.singerMID ?? String(source.singerID ?? ""),
    name: stripHighlight(source.singerName ?? ""),
    cover: secureUrl(source.singerPic || source.iconurl),
    albumCount: source.albumNum ?? 0,
    songCount: source.songNum ?? 0,
  };
};

/** 归一化歌单对象 */
const normalizePlaylist = (playlist: any): Record<string, unknown> => {
  const source = playlist || {};
  return {
    id: source.dissid ?? "",
    name: stripHighlight(source.dissname),
    cover: secureUrl(source.logo || source.layer_url),
    creator: stripHighlight(source.nickname ?? ""),
    trackCount: source.songnum ?? 0,
    playCount: source.listennum ?? 0,
  };
};

interface SearchResponse {
  body?: {
    item_song?: any[];
    item_album?: any[];
    singer?: any[];
    item_songlist?: any[];
  };
  meta?: { sum?: number };
}

export const search: QMModule = async (params: QMParams) => {
  const keywords = String(params.keywords ?? params.s ?? "").trim();
  if (!keywords) return { code: 400, message: "keywords required" };

  const rawType = params.type ?? 0;
  let target: string | undefined = TARGET_BY_TYPE[String(rawType)];
  if (!target && typeof rawType === "string") {
    target = SEARCH_TYPE_BY_TARGET[rawType] === undefined ? undefined : rawType;
  }
  if (!target) {
    return {
      code: 400,
      message: `unsupported search type: ${String(rawType)}（可用：0 歌曲 / 8 专辑 / 9 歌手 / 2 歌单）`,
    };
  }

  const page = Math.max(1, Number(params.page) || 1);
  // 硬性口径：单页 limit 强制钳制在 40 以内
  const limit = Math.min(40, Math.max(1, Number(params.limit) || 30));

  try {
    const data = await qmRequest<SearchResponse>(
      "music.search.SearchCgiService",
      "DoSearchForQQMusicMobile",
      {
        searchid: createSearchId(),
        query: keywords,
        page_num: page,
        num_per_page: limit,
        search_type: SEARCH_TYPE_BY_TARGET[target],
        highlight: true,
        grp: 1,
        selectors: {},
        vec_selectors: [],
      },
    );

    const body = data?.body || {};
    const total = data?.meta?.sum ?? 0;

    const songs: Record<string, unknown>[] = [];
    const albums: Record<string, unknown>[] = [];
    const artists: Record<string, unknown>[] = [];
    const playlists: Record<string, unknown>[] = [];

    if (target === "song") {
      for (const item of body.item_song || []) songs.push(normalizeSong(item));
    } else if (target === "album") {
      for (const item of body.item_album || []) albums.push(normalizeAlbum(item));
    } else if (target === "artist") {
      for (const item of body.singer || []) artists.push(normalizeSinger(item));
    } else {
      for (const item of body.item_songlist || []) playlists.push(normalizePlaylist(item));
    }

    const count = songs.length || albums.length || artists.length || playlists.length || 0;

    return {
      code: 200,
      keywords,
      type: target,
      page,
      limit,
      total: total || count,
      songs,
      albums,
      artists,
      playlists,
      raw: data,
    };
  } catch (err) {
    coreLog.error("QQ 音乐搜索异常:", err);
    return {
      code: 502,
      message: `QQ 音乐搜索失败: ${(err as Error)?.message ?? String(err)}`,
    };
  }
};
