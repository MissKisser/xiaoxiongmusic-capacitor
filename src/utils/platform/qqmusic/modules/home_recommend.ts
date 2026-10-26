/**
 * QQ 音乐首页推荐区块（为你推荐 / 精选歌单 / 歌手推荐 / 新碟上架）
 *
 * @author Hackerdallas
 */

import { qmRequest } from "../core/request";
import { coreLog } from "../core/logger";
import type { QMModule, QMParams } from "../core/types";

/** 为你推荐默认条数 */
const DEFAULT_RECOMMEND_LIMIT = 12;

/** 精选歌单默认条数 */
const DEFAULT_SQUARE_LIMIT = 24;

/** 歌手推荐默认条数 */
const DEFAULT_SINGER_LIMIT = 12;

/** 新碟上架默认条数 */
const DEFAULT_ALBUM_LIMIT = 12;

/** 精选歌单默认分类（官方歌单） */
const DEFAULT_SQUARE_CATEGORY = 3317;

/** 歌手列表上游固定返回的条数，按需裁剪 */
const SINGER_POOL_SIZE = 80;

/**
 * 限制条数参数的取值范围
 * @param value 原始参数
 * @param fallback 缺省值
 * @param max 上限
 * @returns 合法条数
 */
const clampLimit = (value: unknown, fallback: number, max: number): number => {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.min(max, Math.floor(num));
};

/**
 * 去除搜索结果的命中高亮标签
 * @param text 原始文本
 * @returns 处理后的文本
 */
const stripHighlight = (text: unknown): string =>
  typeof text === "string" ? text.replace(/<\/?em>/g, "") : "";

/**
 * 拼接歌手名
 * @param singers 歌手数组
 * @returns 形如 A / B 的歌手名
 */
const formatSingerName = (singers: unknown): string => {
  if (!Array.isArray(singers)) return "";
  return singers
    .map((item: any) => stripHighlight(item?.name))
    .filter(Boolean)
    .join(" / ");
};

/**
 * 回查专辑的曲目数
 * @param mid 专辑主键
 * @returns 曲目数，取不到时为 0
 */
const fetchAlbumTrackCount = async (mid: string): Promise<number> => {
  if (!mid) return 0;
  try {
    const data = await qmRequest<any>("music.musichallAlbum.AlbumSongList", "GetAlbumSongList", {
      albumMid: mid,
      albumID: 0,
      begin: 0,
      num: 1,
      order: 2,
    });
    return Number(data?.totalNum ?? 0);
  } catch (err) {
    coreLog.warn("[qm-home] 专辑曲目数回查失败:", mid, (err as Error)?.message ?? String(err));
    return 0;
  }
};

/**
 * 读取「为你推荐」编辑推荐歌单
 * @param params.limit 取回的条数
 */
export const homeRecommend: QMModule = async (params: QMParams) => {
  const limit = clampLimit(params.limit, DEFAULT_RECOMMEND_LIMIT, 30);

  try {
    const data = await qmRequest<any>("playlist.HotRecommendServer", "get_hot_recommend", {
      async: 1,
      cmd: 2,
    });

    const source = Array.isArray(data?.v_hot) ? data.v_hot : [];
    const list = source
      .slice(0, limit)
      .map((item: any) => ({
        id: String(item?.content_id ?? ""),
        name: stripHighlight(item?.title ?? ""),
        cover: item?.cover ?? "",
        playCount: Number(item?.listen_num ?? 0),
        creatorName: stripHighlight(item?.username ?? ""),
      }))
      .filter((item: { id: string }) => !!item.id);

    return {
      code: 200,
      total: source.length,
      list,
    };
  } catch (err) {
    coreLog.error("[qm-home] QQ 音乐为你推荐获取异常:", err);
    return {
      code: 502,
      message: `QQ 音乐为你推荐获取失败: ${(err as Error)?.message ?? String(err)}`,
    };
  }
};

/**
 * 读取歌单广场的分类歌单
 * @param params.category 分类号
 * @param params.page 页码（从 1 开始）
 * @param params.limit 取回的条数
 */
export const homeSquare: QMModule = async (params: QMParams) => {
  const category = Number(params.category ?? DEFAULT_SQUARE_CATEGORY) || DEFAULT_SQUARE_CATEGORY;
  const page = Math.max(1, Number(params.page ?? 1) || 1);
  const limit = clampLimit(params.limit, DEFAULT_SQUARE_LIMIT, 60);

  try {
    const data = await qmRequest<any>("playlist.PlayListPlazaServer", "get_playlist_by_category", {
      id: category,
      curPage: page,
      size: limit,
      order: 5,
      titleid: category,
    });

    const source = Array.isArray(data?.v_playlist) ? data.v_playlist : [];
    const list = source
      .slice(0, limit)
      .map((item: any) => ({
        id: String(item?.tid ?? ""),
        name: stripHighlight(item?.title ?? ""),
        cover: item?.cover_url_big ?? "",
        playCount: Number(item?.access_num ?? 0),
        creatorName: stripHighlight(item?.creator_info?.nick ?? ""),
        createTime: Number(item?.create_time ?? 0),
      }))
      .filter((item: { id: string }) => !!item.id);

    return {
      code: 200,
      total: Number(data?.total ?? source.length),
      category,
      page,
      list,
    };
  } catch (err) {
    coreLog.error("[qm-home] QQ 音乐歌单广场获取异常:", err);
    return {
      code: 502,
      message: `QQ 音乐歌单广场获取失败: ${(err as Error)?.message ?? String(err)}`,
    };
  }
};

/**
 * 读取歌手推荐列表
 * @param params.limit 取回的条数
 */
export const homeSinger: QMModule = async (params: QMParams) => {
  const limit = clampLimit(params.limit, DEFAULT_SINGER_LIMIT, SINGER_POOL_SIZE);

  try {
    const data = await qmRequest<any>("Music.SingerListServer", "get_singer_list", {
      area: -100,
      sex: -100,
      genre: -100,
      index: -100,
      sin: 0,
      num: SINGER_POOL_SIZE,
    });

    const source = Array.isArray(data?.singerlist) ? data.singerlist : [];
    const list = source
      .slice(0, limit)
      .map((item: any) => ({
        id: String(item?.singer_id ?? ""),
        mid: String(item?.singer_mid ?? ""),
        name: stripHighlight(item?.singer_name ?? ""),
        cover: item?.singer_pic ?? "",
      }))
      .filter((item: { mid: string }) => !!item.mid);

    return {
      code: 200,
      total: Number(data?.total ?? source.length),
      list,
    };
  } catch (err) {
    coreLog.error("[qm-home] QQ 音乐歌手推荐获取异常:", err);
    return {
      code: 502,
      message: `QQ 音乐歌手推荐获取失败: ${(err as Error)?.message ?? String(err)}`,
    };
  }
};

/**
 * 读取新碟上架列表
 * @param params.limit 取回的条数
 * @param params.area 地区维度
 */
export const homeAlbum: QMModule = async (params: QMParams) => {
  const limit = clampLimit(params.limit, DEFAULT_ALBUM_LIMIT, 30);
  const area = Number(params.area ?? 1) || 1;

  try {
    const data = await qmRequest<any>("newalbum.NewAlbumServer", "get_new_album_info", {
      area,
      sin: 0,
      num: limit,
    });

    const source = Array.isArray(data?.albums) ? data.albums : [];
    const picked = source.slice(0, limit);
    const counts = await Promise.all(
      picked.map((item: any) => fetchAlbumTrackCount(String(item?.mid ?? ""))),
    );
    const list = picked
      .map((item: any, index: number) => ({
        id: String(item?.id ?? ""),
        mid: String(item?.mid ?? ""),
        name: stripHighlight(item?.name ?? ""),
        artist: formatSingerName(item?.singers),
        releaseTime: stripHighlight(item?.release_time ?? ""),
        trackCount: counts[index],
      }))
      .filter((item: { mid: string }) => !!item.mid);

    return {
      code: 200,
      total: Number(data?.total ?? source.length),
      list,
    };
  } catch (err) {
    coreLog.error("[qm-home] QQ 音乐新碟上架获取异常:", err);
    return {
      code: 502,
      message: `QQ 音乐新碟上架获取失败: ${(err as Error)?.message ?? String(err)}`,
    };
  }
};
