/**
 * 酷狗音乐热门歌手列表
 *
 * 走 GET http://mobilecdn.kugou.com/api/v3/singer/list
 *
 * @author Hackerdallas
 */

import { kgRequest } from "../core/request";
import { decodeName, fillCover } from "../core/config";
import { coreLog } from "../core/logger";
import type { KGModule, KGParams } from "../core/types";

/** 歌手列表端点 */
const KG_SINGER_LIST_URL = "http://mobilecdn.kugou.com/api/v3/singer/list";

/** 默认分类（上游「全部」，key=0） */
const DEFAULT_TYPE_KEY = 0;

/** 默认页码 */
const DEFAULT_PAGE = 1;

/** 默认每页条数 */
const DEFAULT_LIMIT = 30;

/** 每页条数上限 */
const MAX_LIMIT = 100;

/** 上游原始条目 */
type RawEntry = Record<string, any>;

/**
 * 拼分类标识
 * @param key 上游分类键
 * @param musician 音乐人维度
 * @returns 分类标识
 */
const formatTypeId = (key: number, musician: number): string =>
  musician ? `${key}:${musician}` : String(key);

/**
 * 解析分类标识
 * @param raw 分类标识
 * @returns 上游分类键与音乐人维度
 */
const parseTypeId = (raw: unknown): { key: number; musician: number } => {
  const text = String(raw ?? "").trim();
  if (!text) return { key: DEFAULT_TYPE_KEY, musician: 0 };

  const [keyPart, musicianPart] = text.split(":");
  const key = Number(keyPart);
  const musician = musicianPart === undefined ? Number.NaN : Number(musicianPart);
  return {
    key: Number.isFinite(key) ? key : DEFAULT_TYPE_KEY,
    musician: Number.isFinite(musician) ? musician : 0,
  };
};

/**
 * 归一化分类项
 * @param item 上游分类项
 * @returns 归一化后的分类项
 */
const normalizeType = (item: RawEntry) => {
  const source = item || {};
  const key = Number(source.key ?? DEFAULT_TYPE_KEY);
  const musician = Number(source.musician ?? 0);
  return {
    id: formatTypeId(Number.isFinite(key) ? key : DEFAULT_TYPE_KEY, musician),
    name: decodeName(source.value ?? ""),
  };
};

/**
 * 归一化歌手条目
 * @param item 上游歌手条目
 * @returns 归一化后的歌手条目
 */
const normalizeArtist = (item: RawEntry) => {
  const source = item || {};
  const singerId = String(source.singerid ?? "");
  return {
    id: Number(source.singerid ?? 0),
    platformId: singerId,
    name: decodeName(source.singername ?? ""),
    cover: fillCover(source.imgurl, 300) ?? "",
    coverOriginal: fillCover(source.imgurl, 480) ?? "",
    fansCount: Number(source.fanscount ?? 0),
    heat: Number(source.heat ?? 0),
  };
};

/**
 * 拼上游请求地址
 * @param key 上游分类键
 * @param musician 音乐人维度（0 表示不传）
 * @param page 页码
 * @param limit 每页条数
 * @returns 请求地址
 */
const buildSingerListUrl = (key: number, musician: number, page: number, limit: number): string => {
  const params = [
    `type=${encodeURIComponent(key)}`,
    `page=${encodeURIComponent(page)}`,
    `pagesize=${encodeURIComponent(limit)}`,
  ];
  if (musician) params.push(`musician=${encodeURIComponent(musician)}`);
  return `${KG_SINGER_LIST_URL}?${params.join("&")}`;
};

/**
 * 读取酷狗音乐热门歌手列表
 * @param params.type 分类标识（<key> 或 <key>:<musician>），缺省取「全部」
 * @param params.page 页码，从 1 开始
 * @param params.limit 每页条数，默认 30，上限 100
 */
export const hot_artists: KGModule = async (params: KGParams) => {
  const page = Math.max(1, Number(params.page ?? DEFAULT_PAGE) || DEFAULT_PAGE);
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number(params.limit ?? params.pagesize ?? DEFAULT_LIMIT) || DEFAULT_LIMIT),
  );
  const { key, musician } = parseTypeId(params.type);

  try {
    const body = await kgRequest<{
      data?: { info?: RawEntry[]; total?: number; enu_list?: { types?: RawEntry[] } };
    }>(buildSingerListUrl(key, musician, page, limit));

    const data = body?.data || {};
    const info = Array.isArray(data.info) ? data.info : [];
    const types = Array.isArray(data.enu_list?.types) ? data.enu_list.types : [];

    return {
      code: 200,
      total: Number(data.total ?? info.length),
      page,
      limit,
      types: types.map(normalizeType),
      artists: info.map(normalizeArtist),
    };
  } catch (err) {
    coreLog.error("[kg-hot-artists] 酷狗热门歌手列表获取异常:", err);
    return {
      code: 502,
      message: `酷狗热门歌手列表获取失败: ${(err as Error)?.message ?? String(err)}`,
    };
  }
};
