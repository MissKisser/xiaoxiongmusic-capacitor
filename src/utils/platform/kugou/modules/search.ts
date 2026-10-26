/**
 * 酷狗音乐多分类搜索模块
 *
 * 覆盖：
 * - 单曲（song / 0）：主走 mobilecdn，解析封面与多音质分级，失败自动回退 songsearch
 * - 专辑（album / 8）：网关 /v1/search/album
 * - 歌手（artist / 9）：网关 /v1/search/author
 * - 歌单（playlist / 2）：网关 /v1/search/special
 *
 * @author Hackerdallas
 */

import { kgErrorCode, kgGatewayRequest, kgRequest } from "../core/request";
import {
  decodeName,
  fillCover,
  formatSingerName,
  KG_MOBILECDN_URL,
  KG_SEARCH_URL,
} from "../core/config";
import type { KGModule, KGParams } from "../core/types";

/** 搜索网关路由头 */
const SEARCH_ROUTER = "complexsearch.kugou.com";

type RawEntry = Record<string, any>;

/**
 * 格式化 mobilecdn 返回的歌手名称串
 * @param name 原始歌手串
 * @returns 规范化的歌手名
 */
const formatMobileArtist = (name: unknown): string => {
  if (!name) return "";
  return decodeName(String(name))
    .split(/、|,|;|\//)
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" / ");
};

/**
 * 将搜索类型归一化为内部标识
 * @param type 分类入参
 * @returns 归一化分类名称
 */
const resolveType = (type: unknown): string | null => {
  const key = String(type === undefined || type === null ? 0 : type).toLowerCase();
  if (key === "0" || key === "song") return "song";
  if (key === "8" || key === "album") return "album";
  if (key === "9" || key === "artist" || key === "author") return "artist";
  if (key === "2" || key === "playlist" || key === "special") return "playlist";
  return null;
};

/**
 * 映射 mobilecdn 歌曲条目
 * @param raw 原始歌曲条目
 * @returns 规范化歌曲对象
 */
const normalizeFromMobile = (raw: RawEntry) => {
  const sizes: Record<string, number> = {};
  const hashes: Record<string, string> = {};

  if (raw.filesize && raw.hash) {
    sizes["128k"] = raw.filesize;
    hashes["128k"] = raw.hash;
  }
  if (raw["320filesize"] && raw["320hash"]) {
    sizes["320k"] = raw["320filesize"];
    hashes["320k"] = raw["320hash"];
  }
  if (raw.sqfilesize && raw.sqhash) {
    sizes.flac = raw.sqfilesize;
    hashes.flac = raw.sqhash;
  }
  const hrSize = raw.hires_filesize ?? raw.resfilesize;
  const hrHash = raw.hires_hash ?? raw.reshash;
  if (hrSize && hrHash) {
    sizes.flac24bit = hrSize;
    hashes.flac24bit = hrHash;
  }

  const interval = raw.duration ?? 0;
  const coverTpl = raw.trans_param && raw.trans_param.union_cover;
  const artistName = formatMobileArtist(raw.singername);
  const artists = artistName ? artistName.split(" / ").map((name) => ({ id: name, name })) : [];

  return {
    id: String(raw.audio_id || raw.hash || ""),
    audioId: raw.audio_id ?? 0,
    albumAudioId: raw.album_audio_id,
    hash: raw.hash ?? "",
    name: decodeName(raw.songname || raw.filename || ""),
    artist: artistName,
    artists,
    album: decodeName(raw.album_name ?? ""),
    albumId: String(raw.album_id ?? ""),
    cover: fillCover(coverTpl, 300) ?? "",
    coverOriginal: fillCover(coverTpl, 480) ?? "",
    interval,
    duration: interval * 1000,
    qualities: Object.keys(hashes),
    hashes,
    sizes,
    pay: {
      payplay: raw.pay_type ?? 0,
      privilege: raw.privilege ?? 0,
      feetype: raw.feetype ?? 0,
      pkgPrice: raw.pkg_price ?? 0,
      price: raw.price ?? 0,
    },
  };
};

/**
 * 映射旧版 songsearch 歌曲条目
 * @param raw 原始歌曲条目
 * @returns 规范化歌曲对象
 */
const normalizeFromLegacy = (raw: RawEntry) => {
  const sizes: Record<string, number> = {};
  const hashes: Record<string, string> = {};

  if (raw.FileSize && raw.FileHash) {
    sizes["128k"] = raw.FileSize;
    hashes["128k"] = raw.FileHash;
  }
  if (raw.HQFileSize && raw.HQFileHash) {
    sizes["320k"] = raw.HQFileSize;
    hashes["320k"] = raw.HQFileHash;
  }
  if (raw.SQFileSize && raw.SQFileHash) {
    sizes.flac = raw.SQFileSize;
    hashes.flac = raw.SQFileHash;
  }
  if (raw.ResFileSize && raw.ResFileHash) {
    sizes.flac24bit = raw.ResFileSize;
    hashes.flac24bit = raw.ResFileHash;
  }

  const singers = Array.isArray(raw.Singers) ? raw.Singers : [];
  const artistName = formatSingerName(singers);
  const artists = singers.length
    ? singers.map((s: RawEntry) => ({
        id: s.id !== undefined ? String(s.id) : s.name || undefined,
        name: decodeName(s.name || ""),
      }))
    : artistName
      ? [{ id: artistName, name: artistName }]
      : [];

  return {
    id: String(raw.Audioid || raw.FileHash || ""),
    audioId: raw.Audioid,
    albumAudioId: raw.MixSongID ?? raw.AlbumAudioId,
    hash: raw.FileHash || "",
    name: decodeName(raw.SongName || ""),
    artist: artistName,
    artists,
    album: decodeName(raw.AlbumName ?? ""),
    albumId: String(raw.AlbumID ?? ""),
    cover: "",
    coverOriginal: "",
    interval: raw.Duration ?? 0,
    duration: (raw.Duration ?? 0) * 1000,
    qualities: Object.keys(hashes),
    hashes,
    sizes,
    pay: {
      payplay: raw.PayType ?? 0,
      privilege: raw.Privilege ?? 0,
      pkgPrice: raw.PkgPrice ?? 0,
      price: raw.Price ?? 0,
    },
  };
};

/**
 * 经由 mobilecdn 搜索单曲
 * @param keywords 关键词
 * @param page 页码
 * @param limit 每页数量
 * @returns 搜索结果与总数
 */
const searchSongsMobile = async (keywords: string, page: number, limit: number) => {
  const url =
    `${KG_MOBILECDN_URL}?keyword=${encodeURIComponent(keywords)}` +
    `&page=${page}&pagesize=${limit}&format=json&showtype=1`;

  const body = await kgRequest<{ data?: { info?: RawEntry[]; total?: number } }>(url, {
    allowBusinessError: true,
  });
  const raw = body?.data?.info || [];

  const songs: ReturnType<typeof normalizeFromMobile>[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(raw) ? raw : []) {
    const key = `${item.audio_id ?? ""}_${item.hash ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    songs.push(normalizeFromMobile(item));
  }

  return { total: Number(body?.data?.total || songs.length), songs, raw: body };
};

/**
 * 经由旧版 songsearch 搜索单曲兜底
 * @param keywords 关键词
 * @param page 页码
 * @param limit 每页数量
 * @returns 搜索结果与总数
 */
const searchSongsLegacy = async (keywords: string, page: number, limit: number) => {
  const url =
    `${KG_SEARCH_URL}?keyword=${encodeURIComponent(keywords)}` +
    `&page=${page}&pagesize=${limit}` +
    `&userid=0&clientver=&platform=WebFilter&filter=2&iscorrection=1&privilege_filter=0&area_code=1`;

  const body = await kgRequest<{ data?: { lists?: RawEntry[]; total?: number } }>(url, {
    allowBusinessError: true,
  });
  const raw = body?.data?.lists || [];

  const songs: ReturnType<typeof normalizeFromLegacy>[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(raw) ? raw : []) {
    const key = `${item.Audioid}_${item.FileHash}`;
    if (seen.has(key)) continue;
    seen.add(key);
    songs.push(normalizeFromLegacy(item));
  }

  return { total: Number(body?.data?.total || songs.length), songs, raw: body };
};

interface SongSearchAttempt {
  total: number;
  songs: Array<Record<string, unknown>>;
  raw: unknown;
}

/**
 * 搜索单曲，主通道失败时自动回退兜底通道
 * @param keywords 关键词
 * @param page 页码
 * @param limit 每页数量
 * @returns 歌曲列表及元数据
 */
const searchSongs = async (keywords: string, page: number, limit: number) => {
  const attempt = async (): Promise<SongSearchAttempt> => {
    let mobile: SongSearchAttempt | null = null;
    try {
      mobile = await searchSongsMobile(keywords, page, limit);
    } catch {
      mobile = null;
    }
    if (mobile && mobile.songs.length > 0) return mobile;

    let legacy: SongSearchAttempt | null = null;
    try {
      legacy = await searchSongsLegacy(keywords, page, limit);
    } catch {
      legacy = null;
    }
    if (legacy && legacy.songs.length > 0) return legacy;

    return mobile ?? legacy ?? { total: 0, songs: [], raw: null };
  };

  const first = await attempt();
  if (first.songs.length > 0) return first;

  if (first.total > 0) {
    try {
      const retry = await searchSongsMobile(keywords, page, limit);
      if (retry.songs.length > 0) return retry;
    } catch {
      // 保持空结果
    }
  }

  return first;
};

/**
 * 从响应提取列表数组
 * @param res 网关响应
 * @returns 原始列表条目
 */
const pickList = (res: any): RawEntry[] => {
  const data = res?.data || {};
  if (Array.isArray(data.lists)) return data.lists;
  if (Array.isArray(data.info)) return data.info;
  return [];
};

/**
 * 网关搜索调用封装
 * @param path 网关相对路径
 * @param keywords 关键词
 * @param page 页码
 * @param limit 每页数量
 * @param extraParams 附加参数
 * @returns 响应与列表
 */
const searchGatewayList = async (
  path: string,
  keywords: string,
  page: number,
  limit: number,
  extraParams: Record<string, unknown> = {},
): Promise<{ res: any; list: RawEntry[] }> => {
  const request = () =>
    kgGatewayRequest<{ data?: { total?: number; lists?: RawEntry[]; info?: RawEntry[] } }>(path, {
      method: "GET",
      params: {
        keyword: keywords,
        page,
        pagesize: limit,
        platform: "AndroidFilter",
        iscorrection: 1,
        ...extraParams,
      },
      headers: { "x-router": SEARCH_ROUTER },
      allowBusinessError: true,
    });

  let res = await request();
  let list = pickList(res);
  const total = Number(res?.data?.total ?? 0);
  if (list.length === 0 && total > 0) {
    res = await request();
    list = pickList(res);
  }
  return { res, list: list.slice(0, limit) };
};

/**
 * 酷狗搜索主入口
 * @param params.keywords 搜索关键词
 * @param params.type 搜索分类（0/song, 8/album, 9/artist, 2/playlist）
 * @param params.page 页码
 * @param params.limit 每页数量
 */
export const search: KGModule = async (params: KGParams) => {
  const keywords = String(params.keywords || params.keyword || "").trim();
  if (!keywords) return { code: 400, message: "keywords required" };

  const type = resolveType(params.type);
  if (!type) {
    return { code: 400, message: `不支持的酷狗搜索分类：${String(params.type)}` };
  }

  const page = Math.max(1, Number(params.page ?? 1) || 1);
  const limit = Math.max(1, Number(params.limit ?? 30) || 30);

  try {
    if (type === "song") {
      const result = await searchSongs(keywords, page, limit);
      const songs = result.songs.slice(0, limit);
      return {
        code: 200,
        type,
        page,
        limit,
        total: result.total,
        songs,
        items: songs,
        raw: result.raw,
      };
    }

    const path =
      type === "album"
        ? "/v1/search/album"
        : type === "artist"
          ? "/v1/search/author"
          : "/v1/search/special";

    const { res, list } = await searchGatewayList(
      path,
      keywords,
      page,
      limit,
      type === "album" ? { albumhide: 0, nocollect: 0 } : {},
    );

    const errCode = kgErrorCode(res);
    if (errCode !== 0) {
      return {
        code: 502,
        message: `酷狗${type === "album" ? "专辑" : type === "artist" ? "歌手" : "歌单"}搜索失败：error_code=${errCode}`,
        type,
        page,
        limit,
        raw: res,
      };
    }

    if (type === "album") {
      const albums = list.map((raw) => {
        const singerStr =
          raw.singer ||
          (raw.singers
            ? raw.singers
                .map((s: RawEntry) => s.name)
                .filter(Boolean)
                .join(" / ")
            : "");
        const artistId = raw.singerid || (raw.singerids && raw.singerids[0]);
        return {
          id: String(raw.albumid ?? ""),
          name: decodeName(raw.albumname),
          cover: fillCover(raw.img, 300) ?? "",
          artist: decodeName(singerStr),
          artistId: artistId !== undefined ? String(artistId) : undefined,
          trackCount: raw.songcount ?? 0,
          publishTime: raw.publish_time || undefined,
          intro: raw.intro || undefined,
        };
      });
      return {
        code: 200,
        type,
        page,
        limit,
        total: Number(res?.data?.total ?? albums.length),
        albums,
        items: albums,
        raw: res,
      };
    }

    if (type === "artist") {
      const artists = list.map((raw) => ({
        id: String(raw.AuthorId ?? ""),
        name: decodeName(raw.AuthorName),
        cover: fillCover(raw.Avatar || raw.FirstFrameImage, 300) ?? "",
        albumCount: raw.AlbumCount ?? 0,
        songCount: raw.AudioCount ?? 0,
        fansCount: raw.FansNum ?? 0,
      }));
      return {
        code: 200,
        type,
        page,
        limit,
        total: Number(res?.data?.total ?? artists.length),
        artists,
        items: artists,
        raw: res,
      };
    }

    const playlists = list.map((raw) => ({
      id: String(raw.specialid ?? ""),
      name: decodeName(raw.specialname),
      cover: fillCover(raw.img, 300) ?? "",
      creator: decodeName(raw.nickname),
      trackCount: raw.songcount ?? 0,
      playCount: raw.playcount ?? 0,
      collectCount: raw.collectcount ?? 0,
      intro: raw.intro || undefined,
      publishTime: raw.publishtime || undefined,
    }));

    return {
      code: 200,
      type,
      page,
      limit,
      total: Number(res?.data?.total ?? playlists.length),
      playlists,
      items: playlists,
      raw: res,
    };
  } catch (err) {
    return {
      code: 502,
      message: `酷狗搜索异常: ${(err as Error)?.message ?? String(err)}`,
      type,
      page,
      limit,
    };
  }
};
