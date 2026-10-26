/**
 * QQ 音乐每日推荐（官方今日推荐歌曲 / 每日30首）
 *
 * 走 music.ai_track_daily_svr / get_daily_track 协议。
 *
 * @author Hackerdallas
 */

import { getQQMusicUin, qmRequest } from "../core/request";
import { coreLog } from "../core/logger";
import type { QMModule } from "../core/types";

/** 每日推荐协议档位（上游约定值，0 / 1 / 99 实测等价） */
const DAILY_TRACK_ID = 99;

/** 每日推荐封面尺寸模板 */
const COVER_TEMPLATE = "https://y.gtimg.cn/music/photo_new/T002R300x300M000";

/** 去除搜索结果的命中高亮标签 */
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
 * 归一化每日推荐曲目
 * @param track 上游曲目
 * @returns 归一化后的曲目，缺少可播放标识时为 null
 */
const normalizeTrack = (track: any): Record<string, unknown> | null => {
  const source = track || {};
  const songId = Number(source.id ?? 0);
  const mid = source.mid ?? "";
  if (!songId && !mid) return null;

  const album = source.album || {};
  const albumMid = album.mid || album.pmid || "";

  return {
    id: String(songId),
    mid: String(mid),
    name: stripHighlight(source.title || source.name || ""),
    artist: formatSingerName(source.singer),
    artists: (Array.isArray(source.singer) ? source.singer : []).map((item: any) => ({
      id: String(item?.id ?? ""),
      mid: String(item?.mid ?? ""),
      name: stripHighlight(item?.name ?? ""),
    })),
    album: stripHighlight(album.name || album.title || ""),
    albumMid: String(albumMid),
    duration: (Number(source.interval) || 0) * 1000,
    cover: albumMid ? `${COVER_TEMPLATE}${albumMid}.jpg` : "",
    file: source.file ?? {},
    pay: source.pay ?? {},
  };
};

/**
 * 把上游日期串整理成 YYYYMMDD
 * @param date 上游日期字段
 * @returns 日期串，取不到时返回空串
 */
const normalizeDate = (date: unknown): string => {
  const text = String(date ?? "").trim();
  return /^\d{8}$/.test(text) ? text : "";
};

/**
 * 读取 QQ 音乐每日推荐
 */
export const dailyRecommend: QMModule = async () => {
  const uin = getQQMusicUin();
  if (!uin || uin === "0") {
    return { code: 301, message: "需要登录" };
  }

  try {
    const data = await qmRequest<any>("music.ai_track_daily_svr", "get_daily_track", {
      id: DAILY_TRACK_ID,
      cmd: 0,
      page: 1,
    });

    const source = data || {};
    const tracks = Array.isArray(source.tracks) ? source.tracks : [];
    const songs = tracks.map(normalizeTrack).filter(Boolean);
    const date = normalizeDate(source.date);

    if (!songs.length) {
      return { code: 502, message: "QQ 音乐每日推荐返回空曲目" };
    }

    return {
      code: 200,
      id: date ? `daily-${date}` : "daily",
      name: stripHighlight(source.title || "今日推荐歌曲"),
      cover: stripHighlight(source.picurl || ""),
      count: songs.length,
      date,
      isNew: Number(source.isnew) === 1,
      source: "ai_track_daily_svr",
      songs,
    };
  } catch (err) {
    coreLog.error("[qm-daily] QQ 音乐每日推荐获取异常:", (err as Error)?.message ?? String(err));
    return {
      code: 502,
      message: `QQ 音乐每日推荐获取失败: ${(err as Error)?.message ?? String(err)}`,
    };
  }
};
