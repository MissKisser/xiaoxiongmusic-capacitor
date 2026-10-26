/**
 * QQ 音乐单曲详情
 *
 * 走 music.pf_song_detail_svr / get_song_detail_yqq 接口。
 *
 * @author Hackerdallas
 */

import { qmRequest } from "../core/request";
import { coreLog } from "../core/logger";
import type { QMModule, QMParams } from "../core/types";

/**
 * 去掉搜索结果的命中高亮标签
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
    .map((item) => stripHighlight((item as { name?: string })?.name))
    .filter(Boolean)
    .join(" / ");
};

/**
 * 归一化单曲
 * @param track 接口返回的曲目信息
 * @returns 归一化后的单曲
 */
const normalizeTrack = (track: any): Record<string, unknown> => {
  const source = track || {};
  const album = source.album || {};
  const file = source.file || {};
  return {
    id: String(source.id ?? ""),
    mid: source.mid ?? "",
    name: stripHighlight(source.title || source.name || ""),
    artist: formatSingerName(source.singer),
    artists: (Array.isArray(source.singer) ? source.singer : []).map((item: any) => ({
      id: String(item?.id ?? ""),
      mid: item?.mid ?? "",
      name: stripHighlight(item?.name ?? ""),
    })),
    album: stripHighlight(album.name ?? ""),
    albumMid: album.mid ?? "",
    albumId: String(album.id ?? ""),
    duration: (source.interval ?? 0) * 1000,
    publishTime: album.time_public ?? source.time_public ?? "",
    mediaMid: file.media_mid ?? "",
    cover: album.mid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${album.mid}.jpg` : "",
    file,
    pay: source.pay ?? {},
  };
};

/**
 * 读取单曲详情
 * @param params.mid 歌曲 mid
 */
export const song_info: QMModule = async (params: QMParams) => {
  const mid = String(params.mid ?? params.songmid ?? "").trim();
  if (!mid) return { code: 400, message: "mid required" };

  try {
    const data =
      (await qmRequest<any>("music.pf_song_detail_svr", "get_song_detail_yqq", {
        song_type: 0,
        song_mid: mid,
      })) || {};

    const track = data.track_info;
    if (!track) {
      return { code: 404, message: "song not found" };
    }

    return {
      code: 200,
      song: normalizeTrack(track),
      raw: data,
    };
  } catch (err) {
    coreLog.error("[qm-song-info] QQ 音乐单曲详情获取异常:", err);
    return {
      code: 502,
      message: `QQ 音乐单曲详情获取失败: ${(err as Error)?.message ?? String(err)}`,
    };
  }
};
