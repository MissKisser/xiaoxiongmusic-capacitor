/**
 * QQ 音乐单曲播放地址解析模块
 *
 * @author Hackerdallas
 */

import { qmRequest, getQQMusicUin } from "../core/request";
import { requestSongUrl } from "../core/song_url";
import { coreLog } from "../core/logger";
import type { QMModule, QMParams } from "../core/types";

/** 失败原因映射 */
const REASON_RESPONSES: Record<string, { status: number; message: string }> = {
  need_pay: {
    status: 403,
    message: "该歌曲为付费歌曲，当前账号无播放权限",
  },
  no_authorization: {
    status: 403,
    message: "当前账号没有该歌曲的播放权限",
  },
  filename_rejected: {
    status: 502,
    message: "上游未接受播放文件名",
  },
  vkey_error: {
    status: 502,
    message: "上游播放凭证接口返回异常",
  },
};

/** 兜底失败响应 */
const DEFAULT_FAILURE = {
  status: 502,
  message: "上游播放凭证接口返回异常",
};

/** 从歌曲详情响应中提取歌曲主体 */
const pickTrack = (data: any): any => {
  if (!data) return null;
  if (data.track_info) return data.track_info;
  if (data.song_info) return data.song_info;
  if (Array.isArray(data.songs) && data.songs[0]) return data.songs[0];
  if (data.songid || data.mid) return data;
  return null;
};

/** 解析歌曲标识与付费标记 */
const resolveSong = async (
  value: string,
): Promise<{ mid: string; mediaMid: string; payPlay?: number }> => {
  const isNumeric = /^\d+$/.test(value) && value.length <= 15;

  const detail = await qmRequest(
    "music.pf_song_detail_svr",
    "get_song_detail_yqq",
    isNumeric ? { song_num: 1, song_id: Number(value) } : { song_type: 0, song_mid: value },
  );

  const track = pickTrack(detail);
  if (!track) return { mid: value, mediaMid: "", payPlay: undefined };

  const pay = track.pay || {};
  const payPlay =
    pay.pay_play !== undefined
      ? Number(pay.pay_play)
      : pay.payplay !== undefined
        ? Number(pay.payplay)
        : undefined;

  return {
    mid: track.mid || value,
    mediaMid: (track.file && track.file.media_mid) || "",
    payPlay,
  };
};

/**
 * 解析单曲播放地址
 * @param params.mid 歌曲 mid 或数字 ID
 * @param params.mediaMid 媒体 mid
 * @param params.level 首选音质档位（hq/sq/lossless/hi-res）
 */
export const song_url: QMModule = async (params: QMParams) => {
  const raw = String(params.mid ?? params.song_mid ?? params.id ?? "").trim();
  if (!raw) return { code: 400, message: "mid required" };

  const uin = getQQMusicUin();
  if (!uin || uin === "0") return { code: 301, message: "需要登录" };

  const level = String(params.level ?? params.quality ?? "hq");
  const givenMediaMid = String(params.mediaMid ?? params.media_mid ?? "").trim();

  try {
    const resolved = await resolveSong(raw);
    const songMid = resolved.mid || raw;
    const mediaMid = givenMediaMid || resolved.mediaMid;

    const result = await requestSongUrl({
      mid: songMid,
      mediaMid,
      level,
      payPlay: resolved.payPlay,
    });

    if (!result.ok) {
      const mapped = REASON_RESPONSES[result.reason!] || DEFAULT_FAILURE;
      return {
        code: mapped.status,
        message: mapped.message,
        mid: songMid,
        available: false,
        reason: result.reason,
        isTrial: false,
        payPlay: resolved.payPlay,
        triedLevels: result.triedLevels || [],
        vkeyResults: result.vkeyResults || [],
        raw: result.raw,
      };
    }

    return {
      code: 200,
      mid: songMid,
      available: true,
      url: result.url,
      level: result.level,
      label: result.label,
      format: result.format,
      isFallback: result.isFallback,
      isTrial: result.isTrial,
      payPlay: resolved.payPlay,
      triedLevels: result.triedLevels || [],
      raw: result.raw,
    };
  } catch (err) {
    coreLog.error("解析播放地址异常:", err);
    return {
      code: 502,
      message: `解析播放地址失败: ${(err as Error)?.message ?? String(err)}`,
    };
  }
};
