/**
 * 酷狗音乐公开歌单详情模块
 *
 * 负责公开精选歌单（special）的元信息与歌曲列表读取，
 * 支持按 album_id 批量反查专辑名与封面。
 *
 * @author Hackerdallas
 */

import { kgErrorCode, kgGatewayRequest, kgRequest } from "../core/request";
import { extractSongTitle } from "../core/song_title";
import { decodeName, fillCover } from "../core/config";
import { coreLog } from "../core/logger";
import type { KGModule, KGParams } from "../core/types";

/** 单页最大歌曲数 */
const MAX_PAGE_SIZE = 300;

/** 网关单次批量解析专辑上限 */
const ALBUM_BATCH_SIZE = 50;

/** 专辑信息并发数 */
const ALBUM_CONCURRENCY = 4;

type RawEntry = Record<string, any>;

interface AlbumInfo {
  name: string;
  cover: string;
}

/**
 * 汇总歌曲音质与体积
 * @param raw 原始歌曲条目
 * @returns 音质配置对象
 */
const collectQualities = (raw: RawEntry) => {
  const hashes: Record<string, string> = {};
  const sizes: Record<string, number> = {};

  const put = (quality: string, hash: unknown, size: unknown) => {
    if (!hash || !size) return;
    hashes[quality] = String(hash);
    sizes[quality] = Number(size);
  };

  put("128k", raw.hash, raw.filesize);
  put("320k", raw["320hash"], raw["320filesize"]);
  put("flac", raw.sqhash, raw.sqfilesize);
  put("flac24bit", raw.hires_hash ?? raw.reshash, raw.hires_filesize ?? raw.resfilesize);

  return { qualities: Object.keys(hashes), hashes, sizes };
};

/**
 * 拆分歌手名称
 * @param singername 歌手名字段
 * @param filename 文件名字段
 * @returns 归一化后的歌手名
 */
const formatArtist = (singername: unknown, filename: unknown): string => {
  if (singername) {
    return decodeName(String(singername))
      .split(/、|,|;|\//)
      .map((name) => name.trim())
      .filter(Boolean)
      .join(" / ");
  }
  const parts = String(filename || "").split(" - ");
  return parts.length > 1 ? decodeName(parts[0].trim()) : "";
};

/**
 * 提取歌曲专辑名
 * @param raw 歌曲条目
 * @returns 专辑名
 */
const pickAlbumName = (raw: RawEntry): string => {
  const info = raw.albuminfo || raw.album_info || {};
  const candidate = raw.album_name || raw.albumname || info.name || info.album_name || "";
  return decodeName(candidate);
};

/**
 * 将数组切分为定长分片
 * @param items 原数组
 * @param size 分片长度
 * @returns 分片二维数组
 */
const chunk = <T>(items: T[], size: number): T[][] => {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
};

/**
 * 受限并发执行器
 * @param items 任务数据
 * @param limit 并发限制数
 * @param worker 任务工作函数
 * @returns 结果数组
 */
const mapWithLimit = async <T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> => {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const runner = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  };

  const workers: Promise<void>[] = [];
  const count = Math.min(limit, items.length);
  for (let i = 0; i < count; i += 1) workers.push(runner());
  await Promise.all(workers);
  return results;
};

/**
 * 批量反查专辑信息
 * @param albumIds 待反查专辑 ID 列表
 * @returns 专辑信息字典
 */
const resolveAlbums = async (albumIds: string[]): Promise<Map<string, AlbumInfo>> => {
  const albums = new Map<string, AlbumInfo>();
  if (albumIds.length === 0) return albums;

  const pending = [...albumIds];

  await mapWithLimit(chunk(pending, ALBUM_BATCH_SIZE), ALBUM_CONCURRENCY, async (batch) => {
    try {
      const response = await kgGatewayRequest<{ data?: RawEntry[] }>("/kmr/v2/albums", {
        method: "POST",
        data: {
          data: batch.map((id) => ({ album_id: id })),
          fields: "album_id,album_name,sizable_cover",
        },
        headers: { "x-router": "openapi.kugou.com", "kg-tid": "255" },
        allowBusinessError: true,
      });
      if (kgErrorCode(response) !== 0) return;

      const list = Array.isArray(response.data) ? response.data : [];
      list.forEach((item) => {
        const id = String(item.album_id || "");
        if (!id || !item.album_name) return;
        albums.set(id, {
          name: decodeName(item.album_name),
          cover: fillCover(item.sizable_cover, 300) ?? "",
        });
      });
    } catch (err) {
      coreLog.warn("批量解析专辑信息失败", err);
    }
  });

  const rest = pending.filter((id) => !albums.has(id));
  if (rest.length === 0) return albums;

  await mapWithLimit(rest, ALBUM_CONCURRENCY, async (id) => {
    try {
      const response = await kgRequest<{ data?: RawEntry }>(
        `http://mobilecdn.kugou.com/api/v3/album/info?albumid=${encodeURIComponent(id)}&format=json`,
        { allowBusinessError: true },
      );
      const detail = response?.data || {};
      if (!detail.albumname) return;
      albums.set(id, {
        name: decodeName(detail.albumname),
        cover: fillCover(detail.imgurl, 300) ?? "",
      });
    } catch (err) {
      coreLog.warn("解析单专辑信息失败", err);
    }
  });

  return albums;
};

/**
 * 规范化精选歌单歌曲
 * @param raw 原始歌曲对象
 * @param fallbackCover 歌单兜底封面
 * @param albums 专辑信息映射
 * @returns 规范化后的歌曲对象
 */
const normalizeSpecialSong = (
  raw: RawEntry,
  fallbackCover: string,
  albums: Map<string, AlbumInfo>,
) => {
  const trans = raw.trans_param || {};
  const albumId = String(raw.album_id || "");
  const album = albums.get(albumId);
  const coverTemplate = trans.union_cover || album?.cover || fallbackCover;
  const interval = Number(raw.duration || 0);
  const qualities = collectQualities(raw);

  const artistName = formatArtist(raw.singername, raw.filename);
  const songName =
    decodeName(extractSongTitle(raw.filename, { artistPrefix: true })) ||
    decodeName(raw.songname || "");

  return {
    id: String(raw.audio_id || raw.hash || ""),
    audioId: Number(raw.audio_id || 0),
    albumAudioId: Number(raw.album_audio_id || 0),
    mixSongId: String(raw.album_audio_id || ""),
    hash: raw.hash || "",
    name: songName,
    artist: artistName,
    artists: artistName ? artistName.split(" / ").map((name) => ({ id: "", name })) : [],
    album: pickAlbumName(raw) || album?.name || "",
    albumId,
    cover: fillCover(coverTemplate, 300) ?? "",
    coverOriginal: fillCover(coverTemplate, 480) ?? "",
    duration: interval * 1000,
    interval,
    qualities: qualities.qualities,
    hashes: qualities.hashes,
    sizes: qualities.sizes,
    pay: {
      payplay: Number(raw.pay_type || 0),
      privilege: Number(raw.privilege || 0),
      feetype: Number(raw.feetype || 0),
      pkgPrice: Number(raw.pkg_price || 0),
      price: Number(raw.price || 0),
    },
  };
};

/**
 * 读取酷狗公开歌单详情与歌曲
 * @param specialId 公开精选歌单 ID
 * @param page 页码
 * @param pageSize 每页条数
 * @returns 歌单详情及歌曲列表
 */
export const readPublicPlaylist = async (specialId: string, page: number, pageSize: number) => {
  const infoResponse = await kgRequest<{ data?: RawEntry }>(
    `http://mobilecdn.kugou.com/api/v3/special/info?specialid=${encodeURIComponent(specialId)}&format=json`,
    { allowBusinessError: true },
  );
  const info = infoResponse.data || {};

  const songsResponse = await kgRequest<{
    data?: { info?: RawEntry[]; total?: number };
  }>(
    `http://mobilecdn.kugou.com/api/v3/special/song?specialid=${encodeURIComponent(specialId)}&page=${page}&pagesize=${pageSize}&format=json`,
    { allowBusinessError: true },
  );
  const songs = songsResponse?.data?.info || [];
  const total = Number(songsResponse?.data?.total || songs.length);

  const coverTemplate = info.imgurl || "";

  const albumIds = [...new Set(songs.map((song) => String(song.album_id || "")).filter(Boolean))];
  let albums = new Map<string, AlbumInfo>();
  try {
    albums = await resolveAlbums(albumIds);
  } catch (err) {
    coreLog.warn("解析歌单专辑信息失败", err);
  }

  return {
    id: String(info.specialid || specialId),
    name: decodeName(info.specialname),
    description: decodeName(info.intro),
    creator: decodeName(info.nickname),
    creatorId: info.suid === undefined ? "" : String(info.suid),
    cover: fillCover(coverTemplate, 300) ?? "",
    coverOriginal: fillCover(coverTemplate, 480) ?? "",
    playCount: Number(info.playcount || 0),
    collectCount: Number(info.collectcount || 0),
    commentCount: Number(info.commentcount || 0),
    publishTime: info.publishtime || "",
    tags: (Array.isArray(info.tags) ? info.tags : []).map((tag: RawEntry) => ({
      id: String(tag.tagid || ""),
      name: tag.tagname || "",
    })),
    total: Number(info.songcount || total || songs.length),
    albums: [...albums.entries()].map(([albumId, album]) => ({
      id: albumId,
      name: album.name,
      cover: album.cover,
    })),
    songs: songs.map((song) => normalizeSpecialSong(song, coverTemplate, albums)),
    raw: { info, songs },
  };
};

/**
 * 酷狗公开歌单接口
 * @param params.id 歌单 ID
 * @param params.page 页码
 * @param params.pageSize 每页数量
 */
export const playlist: KGModule = async (params: KGParams) => {
  const specialId = String(params.id ?? params.specialid ?? params.special_id ?? "").trim();
  if (!specialId) return { code: 400, message: "id required" };

  const page = Math.max(1, Number(params.page ?? 1) || 1);
  const pageSize = Math.max(
    1,
    Math.min(
      MAX_PAGE_SIZE,
      Number(params.pageSize ?? params.pagesize ?? MAX_PAGE_SIZE) || MAX_PAGE_SIZE,
    ),
  );

  try {
    const detail = await readPublicPlaylist(specialId, page, pageSize);
    return {
      code: 200,
      ...detail,
      page,
      pageSize,
    };
  } catch (err) {
    coreLog.error("读取公开歌单失败", err);
    return {
      code: 502,
      message: `读取公开歌单失败: ${(err as Error)?.message ?? String(err)}`,
    };
  }
};
