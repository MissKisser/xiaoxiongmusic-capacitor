/**
 * 酷狗音乐首页「新碟上架」
 *
 * 端点：GET http://mobilecdn.kugou.com/api/v3/album/list
 *
 * @author Hackerdallas
 */

import { kgRequest } from "../core/request";
import { decodeName, fillCover } from "../core/config";
import { coreLog } from "../core/logger";
import type { KGModule, KGParams } from "../core/types";

/** 新碟列表端点 */
const KG_ALBUM_LIST_URL = "http://mobilecdn.kugou.com/api/v3/album/list";

/** 专辑曲目数回查端点 */
const KG_ALBUM_SONG_URL = "http://mobilecdn.kugou.com/api/v3/album/song";

/** 新碟默认条数 */
const DEFAULT_LIMIT = 12;

/** 新碟条数上限 */
const MAX_LIMIT = 50;

/** 上游原始条目 */
type RawEntry = Record<string, any>;

/**
 * 归一化新碟条目
 * @param item 上游新碟条目
 * @returns 归一化后的新碟条目
 */
const normalizeAlbum = (item: RawEntry) => {
  const source = item || {};
  const albumId = String(source.albumid ?? source.album_id ?? "");
  return {
    id: albumId,
    name: decodeName(source.albumname ?? source.album_name ?? ""),
    artist: decodeName(source.singername ?? ""),
    publishTime: String(source.publishtime ?? source.publish_date ?? ""),
    cover: fillCover(source.imgurl, 300) ?? "",
  };
};

/**
 * 回查专辑的曲目数
 * @param albumId 专辑号
 * @returns 曲目数，取不到时为 0
 */
const fetchAlbumTrackCount = async (albumId: string): Promise<number> => {
  if (!albumId) return 0;
  try {
    const body = await kgRequest<{ data?: { total?: number } }>(
      `${KG_ALBUM_SONG_URL}?albumid=${encodeURIComponent(albumId)}&page=1&pagesize=1&format=json`,
    );
    return Number(body?.data?.total ?? 0);
  } catch (err) {
    coreLog.warn("[kg-home-album] 专辑曲目数回查失败:", albumId, (err as Error)?.message ?? String(err));
    return 0;
  }
};

/**
 * 读取酷狗音乐新碟上架列表
 * @param params.page 页码，从 1 开始
 * @param params.limit 取回的条数
 */
export const homeAlbum: KGModule = async (params: KGParams) => {
  const page = Math.max(1, Number(params.page ?? 1) || 1);
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number(params.limit ?? DEFAULT_LIMIT) || DEFAULT_LIMIT),
  );

  try {
    const body = await kgRequest<{ data?: { info?: RawEntry[]; total?: number } }>(
      `${KG_ALBUM_LIST_URL}?page=${page}&pagesize=${limit}&format=json`,
    );

    const data = body?.data || {};
    const info = Array.isArray(data.info) ? data.info : [];
    const picked = info.slice(0, limit);
    const counts = await Promise.all(
      picked.map((item: RawEntry) =>
        fetchAlbumTrackCount(String(item?.albumid ?? item?.album_id ?? "")),
      ),
    );
    const list = picked
      .map((item: RawEntry, index: number) => ({
        ...normalizeAlbum(item),
        trackCount: counts[index],
      }))
      .filter((item: { id: string }) => !!item.id);

    return {
      code: 200,
      total: Number(data.total ?? info.length),
      page,
      list,
    };
  } catch (err) {
    coreLog.error("[kg-home-album] 酷狗新碟上架获取异常:", err);
    return {
      code: 502,
      message: `酷狗新碟上架获取失败: ${(err as Error)?.message ?? String(err)}`,
    };
  }
};
