/**
 * 酷狗音乐歌单广场模块
 *
 * 广场按「分类关键词 + 上游真实分页」轮换取材：
 * 每个分类连续占用若干页，页内取上游 /v1/search/special 的一页。
 *
 * @author Hackerdallas
 */

import { kgErrorCode, kgGatewayRequest } from "../core/request";
import { decodeName, fillCover } from "../core/config";
import { coreLog } from "../core/logger";
import type { KGModule, KGParams } from "../core/types";

/** 搜索网关的路由头 */
const SEARCH_ROUTER = "complexsearch.kugou.com";

/** 广场取材的分类关键词，按顺序轮换 */
const SQUARE_KEYWORDS = ["热歌", "轻音乐", "民谣", "DJ", "钢琴", "经典"];

/** 每个分类连续占用的页数 */
const PAGES_PER_KEYWORD = 3;

/** 广场可翻页的总页数 */
const TOTAL_PAGES = SQUARE_KEYWORDS.length * PAGES_PER_KEYWORD;

/** 上游原始条目 */
type RawEntry = Record<string, any>;

/**
 * 从网关搜索响应里取出条目列表
 * @param res 网关响应体
 * @returns 条目列表
 */
const pickList = (res: any): RawEntry[] => {
  const data = res?.data || {};
  if (Array.isArray(data.lists)) return data.lists;
  if (Array.isArray(data.info)) return data.info;
  return [];
};

/**
 * 把上游歌单条目映射为对外结构
 * @param raw 上游歌单条目
 * @returns 对外歌单对象
 */
const normalizePlaylist = (raw: RawEntry) => ({
  id: String(raw.specialid || raw.gid || ""),
  name: decodeName(raw.specialname),
  cover: fillCover(raw.img, 300) ?? "",
  creator: decodeName(raw.nickname),
  trackCount: raw.song_count ?? 0,
  playCount: Number(raw.play_count || raw.total_play_count || 0),
});

/** 分片定位：分类序号与该分类内的上游页码 */
interface SquareShard {
  /** 分类序号 */
  keywordIndex: number;
  /** 分类关键词 */
  keyword: string;
  /** 该分类内的上游页码 */
  upstreamPage: number;
}

/**
 * 由分片序号算出分类与上游页码
 * @param shardIndex 分片序号，从 0 开始
 * @returns 分片定位
 */
const shardOf = (shardIndex: number): SquareShard => {
  const keywordIndex = Math.floor(shardIndex / PAGES_PER_KEYWORD);
  return {
    keywordIndex,
    keyword: SQUARE_KEYWORDS[keywordIndex] ?? "",
    upstreamPage: (shardIndex % PAGES_PER_KEYWORD) + 1,
  };
};

/**
 * 取一个分片的上游数据
 * @param shard 分片定位
 * @param limit 每页条数
 * @returns 网关响应体与条目列表
 */
const fetchShard = async (shard: SquareShard, limit: number) => {
  const res = await kgGatewayRequest<{
    data?: { total?: number; lists?: RawEntry[]; info?: RawEntry[] };
  }>("/v1/search/special", {
    method: "GET",
    params: {
      keyword: shard.keyword,
      page: shard.upstreamPage,
      pagesize: limit,
      platform: "AndroidFilter",
      iscorrection: 1,
    },
    headers: { "x-router": SEARCH_ROUTER },
    allowBusinessError: true,
  });
  return { res, list: pickList(res) };
};

/**
 * 读取酷狗歌单广场
 * @param params.page 页码，从 1 开始
 * @param params.limit 每页条数
 * @param params.keyword 固定关键词，缺省时按分类关键词轮换取材
 */
export const playlist_square: KGModule = async (params: KGParams) => {
  const page = Math.max(1, Number(params.page ?? 1) || 1);
  const limit = Math.max(1, Number(params.limit ?? 30) || 30);
  const fixedKeyword = String(params.keyword ?? "").trim();
  const total = TOTAL_PAGES * limit;

  const empty = {
    code: 200,
    page,
    limit,
    keyword: fixedKeyword,
    keywordIndex: -1,
    total,
    hasMore: false,
    playlists: [] as Record<string, unknown>[],
    items: [] as Record<string, unknown>[],
    raw: null,
  };

  if (!fixedKeyword && page > TOTAL_PAGES) return empty;

  try {
    if (fixedKeyword) {
      const { res, list } = await fetchShard(
        { keywordIndex: -1, keyword: fixedKeyword, upstreamPage: page },
        limit,
      );

      const errCode = kgErrorCode(res);
      if (errCode !== 0) {
        return {
          code: 502,
          message: `酷狗歌单广场取材失败：error_code=${errCode}`,
          page,
          limit,
          raw: res,
        };
      }

      const playlists = list.slice(0, limit).map(normalizePlaylist);
      const keywordTotal = Number(res?.data?.total ?? playlists.length);
      return {
        code: 200,
        page,
        limit,
        keyword: fixedKeyword,
        keywordIndex: -1,
        total: keywordTotal,
        hasMore: page * limit < keywordTotal,
        playlists,
        items: playlists,
        raw: res,
      };
    }

    let shardIndex = page - 1;

    for (let guard = 0; guard <= PAGES_PER_KEYWORD; guard += 1) {
      const shard = shardOf(shardIndex);
      const { res, list } = await fetchShard(shard, limit);

      const errCode = kgErrorCode(res);
      if (errCode !== 0) {
        return {
          code: 502,
          message: `酷狗歌单广场取材失败：error_code=${errCode}`,
          page,
          limit,
          raw: res,
        };
      }

      if (list.length > 0) {
        const playlists = list.slice(0, limit).map(normalizePlaylist);
        return {
          code: 200,
          page,
          limit,
          keyword: shard.keyword,
          keywordIndex: shard.keywordIndex,
          total,
          hasMore: shardIndex + 1 < TOTAL_PAGES,
          playlists,
          items: playlists,
          raw: res,
        };
      }

      shardIndex += 1;
      if (shardIndex >= TOTAL_PAGES) break;
    }

    return empty;
  } catch (err) {
    coreLog.error("[kg-playlist-square] 读取酷狗歌单广场失败:", err);
    return {
      code: 502,
      message: `读取酷狗歌单广场失败: ${(err as Error)?.message ?? String(err)}`,
    };
  }
};
