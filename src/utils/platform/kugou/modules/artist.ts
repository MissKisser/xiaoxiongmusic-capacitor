/**
 * 酷狗音乐歌手详情模块
 *
 * 端点：
 * - 歌手详情：POST /kmr/v3/author（x-router openapi.kugou.com，kg-tid 36）
 * - 歌手单曲：POST /kmr/v1/audio_group/author（x-router openapi.kugou.com，kg-tid 220）
 * - 歌手专辑：POST /kmr/v1/author/albums（x-router openapi.kugou.com，kg-tid 36）
 * - 名称转 ID：GET /v1/search/author（x-router complexsearch.kugou.com）
 *
 * @author Hackerdallas
 */

import { kgErrorCode, kgGatewayRequest } from "../core/request";
import { signParamsKey } from "../core/crypto";
import { decodeName, fillCover } from "../core/config";
import { coreLog } from "../core/logger";
import type { KGModule, KGParams } from "../core/types";

/** 原始条目 */
type RawEntry = Record<string, any>;

/**
 * 把音质 hash 与体积整理成对外结构
 * @param raw 原始歌曲条目
 * @returns 音质信息
 */
const collectQualities = (raw: RawEntry) => {
  const hashes: Record<string, string> = {};
  const sizes: Record<string, number> = {};

  const put = (quality: string, hash: unknown, size: unknown) => {
    if (!hash || !size) return;
    hashes[quality] = String(hash);
    sizes[quality] = Number(size);
  };

  put("128k", raw.hash_128 ?? raw.hash, raw.filesize_128 ?? raw.filesize);
  put("320k", raw.hash_320, raw.filesize_320);
  put("flac", raw.hash_flac, raw.filesize_flac);
  put("flac24bit", raw.hash_high, raw.filesize_high);

  return { qualities: Object.keys(hashes), hashes, sizes };
};

/**
 * 归一化歌手单曲
 * @param raw 原始歌曲条目
 * @param artistId 当前歌手 ID
 * @param defaultCover 兜底封面模板
 * @returns 对外歌曲对象
 */
const normalizeArtistSong = (raw: RawEntry, artistId: string, defaultCover: string) => {
  const trans = raw.trans_param || {};
  const coverTemplate = trans.union_cover || defaultCover;
  const duration = Number(
    raw.timelength_320 ||
      raw.timelength_flac ||
      raw.timelength_128 ||
      raw.timelength_high ||
      raw.timelength ||
      raw.duration_320 ||
      raw.duration_128 ||
      raw.duration_flac ||
      raw.duration ||
      0,
  );
  const qualities = collectQualities(raw);
  const authors = Array.isArray(raw.authors) ? raw.authors : [];

  const artistName = decodeName(
    authors
      .map((author: RawEntry) => author.author_name)
      .filter(Boolean)
      .join(" / ") || raw.author_name,
  );

  return {
    id: String(raw.audio_id || raw.hash || ""),
    audioId: Number(raw.audio_id || 0),
    albumAudioId: Number(raw.album_audio_id || 0),
    hash: raw.hash_128 || raw.hash || "",
    name: decodeName(raw.audio_name),
    artist: artistName,
    artistId,
    artists: authors.length
      ? authors.map((author: RawEntry) => ({
          id: author.author_id === undefined ? artistId : String(author.author_id),
          name: decodeName(author.author_name),
        }))
      : [{ id: artistId, name: artistName }],
    album: decodeName(raw.album_name),
    albumId: String(raw.album_id || ""),
    cover: fillCover(coverTemplate, 300) ?? "",
    coverOriginal: fillCover(coverTemplate, 480) ?? "",
    duration,
    interval: Math.round(duration / 1000),
    qualities: qualities.qualities,
    hashes: qualities.hashes,
    sizes: qualities.sizes,
    pay: {
      payplay: Number(raw.pay_type || 0),
      privilege: Number(raw.privilege || 0),
      pkgPrice: Number(raw.pkg_price || 0),
      price: Number(raw.price || 0),
    },
  };
};

/**
 * 归一化歌手专辑
 * @param raw 原始专辑条目
 * @param artistId 当前歌手 ID
 * @param artistName 歌手名
 * @returns 对外专辑对象
 */
const normalizeArtistAlbum = (raw: RawEntry, artistId: string, artistName: string) => ({
  id: String(raw.album_id || ""),
  name: decodeName(raw.album_name),
  cover: fillCover(raw.sizable_cover, 300) ?? "",
  coverOriginal: fillCover(raw.sizable_cover, 480) ?? "",
  artist: decodeName(raw.author_name || artistName),
  artistId,
  trackCount: Number(raw.song_count || 0),
  publishTime: raw.publish_date || "",
  description: decodeName(raw.intro),
  type: raw.type || "",
  language: raw.language || "",
});

/**
 * 由歌手名反查歌手 ID
 * @param idOrName 歌手 ID 或歌手名
 * @returns 歌手 ID
 */
const resolveAuthorId = async (idOrName: string): Promise<string> => {
  if (/^\d+$/.test(idOrName)) return idOrName;

  try {
    const response = await kgGatewayRequest<{
      data?: { lists?: RawEntry[]; info?: RawEntry[] };
    }>("/v1/search/author", {
      method: "GET",
      params: {
        keyword: idOrName,
        page: 1,
        pagesize: 1,
        platform: "AndroidFilter",
        iscorrection: 1,
      },
      headers: { "x-router": "complexsearch.kugou.com" },
      allowBusinessError: true,
    });

    const list = response?.data?.lists || response?.data?.info || [];
    if (list[0] && list[0].AuthorId) return String(list[0].AuthorId);
  } catch (err) {
    coreLog.warn("[kg-artist] 歌手名转 ID 失败:", err);
  }
  return idOrName;
};

/**
 * 读取酷狗歌手详情
 * @param params.id 歌手 ID 或歌手名
 */
export const artist: KGModule = async (params: KGParams) => {
  const rawId = String(params.id ?? params.author_id ?? params.artist_id ?? "").trim();
  if (!rawId) return { code: 400, message: "id required" };

  try {
    const artistId = await resolveAuthorId(rawId);
    const clienttime = Math.floor(Date.now() / 1000);

    const detailResponse = await kgGatewayRequest<{ data?: RawEntry }>("/kmr/v3/author", {
      method: "POST",
      data: { author_id: artistId },
      headers: { "x-router": "openapi.kugou.com", "kg-tid": "36" },
      allowBusinessError: true,
    });
    const detailCode = kgErrorCode(detailResponse);
    if (detailCode !== 0) throw new Error(`error_code=${detailCode}`);
    const detail = detailResponse.data || {};

    const songsResponse = await kgGatewayRequest<{
      data?: RawEntry[];
      total?: number;
    }>("/kmr/v1/audio_group/author", {
      method: "POST",
      baseURL: "https://openapi.kugou.com",
      data: {
        author_id: artistId,
        pagesize: 50,
        page: 1,
        sort: 1,
        area_code: "all",
        clienttime,
        key: signParamsKey(clienttime),
      },
      headers: { "x-router": "openapi.kugou.com", "kg-tid": "220" },
      allowBusinessError: true,
    });
    const songsCode = kgErrorCode(songsResponse);
    if (songsCode !== 0) throw new Error(`error_code=${songsCode}`);
    const rawSongs = songsResponse.data || [];
    const songTotal = Number(songsResponse.total || rawSongs.length);

    const albumsResponse = await kgGatewayRequest<{
      data?: RawEntry[];
      total?: number;
    }>("/kmr/v1/author/albums", {
      method: "POST",
      data: {
        author_id: artistId,
        pagesize: 50,
        page: 1,
        sort: 3,
        category: 1,
        area_code: "all",
      },
      headers: { "x-router": "openapi.kugou.com", "kg-tid": "36" },
      allowBusinessError: true,
    });
    const albumsCode = kgErrorCode(albumsResponse);
    if (albumsCode !== 0) throw new Error(`error_code=${albumsCode}`);
    const rawAlbums = albumsResponse.data || [];
    const albumTotal = Number(albumsResponse.total || rawAlbums.length);

    const name = decodeName(detail.author_name || rawId);
    const intro = decodeName(
      detail.intro ||
        (Array.isArray(detail.long_intro)
          ? detail.long_intro
              .map((item: RawEntry) => item.content)
              .filter(Boolean)
              .join("\n\n")
          : ""),
    );

    return {
      code: 200,
      artist: {
        id: String(detail.author_id || artistId),
        name,
        cover: fillCover(detail.sizable_avatar, 300) ?? "",
        avatar: fillCover(detail.sizable_avatar, 480) ?? "",
        songCount: songTotal,
        albumCount: Number(detail.album_count || albumTotal),
        mvCount: Number(detail.mv_count || 0),
        fansCount: Number(detail.fansnums || 0),
        birthday: detail.birthday || "",
        intro,
      },
      songs: rawSongs.map((song: RawEntry) => normalizeArtistSong(song, artistId, "")),
      albums: rawAlbums.map((album: RawEntry) => normalizeArtistAlbum(album, artistId, name)),
      raw: { detail, songs: rawSongs, albums: rawAlbums },
    };
  } catch (err) {
    coreLog.error("[kg-artist] 读取歌手失败:", err);
    return {
      code: 502,
      message: `读取歌手失败: ${(err as Error)?.message ?? String(err)}`,
    };
  }
};
