/**
 * 酷狗音乐每日推荐模块
 *
 * 走每日推荐独立服务域：
 * POST http://everydayrec.service.kugou.com/everyday/api/v1/more
 * body { platform: 'Android', alldays: 1 }，协议 A 签名。
 *
 * @author Hackerdallas
 */

import { getSessionCookies } from "../../sessionStore";
import { kgGatewayRequest } from "../core/request";
import { coreLog } from "../core/logger";
import { normalizePoolSong } from "./songfm";
import type { KGModule, KGParams } from "../core/types";

/** 每日推荐端点路径 */
const KG_DAILY_PATH = "/everyday/api/v1/more";

/** 每日推荐端点所属域名 */
const KG_DAILY_BASE_URL = "http://everydayrec.service.kugou.com";

/** 单次返回的曲目数默认值 */
const DEFAULT_LIMIT = 30;

/** 单次返回的曲目数上限 */
const MAX_LIMIT = 100;

/** 上游原始条目 */
type RawEntry = Record<string, any>;

/**
 * 取当天的日期串
 * @returns YYYYMMDD 形式的日期串
 */
const today = (): string => {
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
};

/**
 * 读取每日推荐曲目
 * @returns 上游曲目列表
 */
const fetchDailySongs = async (): Promise<RawEntry[]> => {
  const body = await kgGatewayRequest<RawEntry>(KG_DAILY_PATH, {
    method: "POST",
    baseURL: KG_DAILY_BASE_URL,
    data: { platform: "Android", alldays: 1 },
  });
  const list = (body?.data && body.data.song_list) || [];
  return Array.isArray(list) ? list : [];
};

/**
 * 读取酷狗音乐每日推荐
 * @param params 业务参数
 * @param params.limit 取回的曲目数，默认 30，上限 100
 */
export const dailyRecommend: KGModule = async (params: KGParams) => {
  const session = getSessionCookies("kugou");
  if (!session.token || !session.userid) {
    return { code: 301, message: "需要登录" };
  }

  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(params.limit) || DEFAULT_LIMIT));

  let rawSongs: RawEntry[];
  try {
    rawSongs = await fetchDailySongs();
  } catch (err) {
    coreLog.warn("[kg-daily] 酷狗每日推荐获取失败：", (err as Error)?.message ?? String(err));
    return {
      code: 502,
      message: `酷狗每日推荐获取失败：${(err as Error)?.message ?? String(err)}`,
    };
  }

  const songs = rawSongs
    .map((item) => normalizePoolSong(item, "daily"))
    .filter(Boolean)
    .slice(0, limit) as RawEntry[];

  if (!songs.length) {
    return { code: 502, message: "酷狗每日推荐返回空曲目" };
  }

  return {
    code: 200,
    id: `daily-${today()}`,
    name: "每日歌曲推荐",
    cover: songs[0].cover || "",
    coverSource: songs[0].cover ? "song" : "none",
    count: songs.length,
    date: today(),
    source: "everydayrec",
    songs,
  };
};
