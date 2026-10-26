/**
 * 酷狗音乐播放地址模块
 *
 * 整合官方取链与 VIP 变体 hash 两段式解析，
 * 支持 status=2 试听片段边界与试听直链兜底语义。
 *
 * @author Hackerdallas
 */

import { getSessionCookies } from "../../sessionStore";
import { ensureKugouDfid } from "../core/device";
import {
  resolveSongUrl,
  type KgHashOffset,
  type SongUrlResult,
} from "../core/song_url";
import { coreLog } from "../core/logger";
import type { KGModule, KGParams } from "../core/types";

/** 剔除的敏感播放票据字段 */
const RAW_EXCLUDED_FIELDS = [
  "url",
  "backupUrl",
  "backup_url",
  "hash_token",
  "hash_token_query",
  "q",
];

/**
 * 收敛上游原始响应字段
 * @param response 原始响应
 * @returns 过滤后的响应
 */
const sanitizeRaw = (response: unknown): Record<string, unknown> => {
  if (!response || typeof response !== "object") return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(response as Record<string, unknown>)) {
    if (RAW_EXCLUDED_FIELDS.includes(key)) continue;
    out[key] = value;
  }
  return out;
};

/** 试听请求收敛结果 */
interface TrialOutcome {
  requested: boolean;
  status: number;
  hash_offset: KgHashOffset | null;
  privilege: number | null;
  playable: boolean;
  url: string;
  urls: string[];
  duration: number;
  size: number;
  bitrate: number;
  extName: string;
}

/**
 * 组装基础播放信息
 * @param result 解析结果
 * @returns 播放信息
 */
const toPlaybackInfo = (result: SongUrlResult) => {
  const raw = result.response as Record<string, unknown>;
  return {
    url: result.url,
    urls: result.urls,
    quality: result.quality,
    size: Number(raw.fileSize ?? raw.size ?? 0),
    bitrate: Number(raw.bitRate ?? raw.bitrate ?? 0),
    duration: Number(raw.timeLength ?? raw.timelength ?? 0),
    extName: String(raw.extName ?? ""),
  };
};

/**
 * 获取歌曲播放地址
 * @param params.hash 歌曲 hash 或 id
 * @param params.albumId 专辑 ID
 * @param params.albumAudioId 专辑音频 ID
 * @param params.level 首选音质，默认 hq
 * @param params.freePart 是否只请求试听片段
 * @param params.privilege 资源授权位兜底
 */
export const song_url: KGModule = async (params: KGParams) => {
  const hash = String(params.hash ?? params.id ?? "")
    .trim()
    .toLowerCase();
  if (!hash) return { code: 400, message: "hash required" };

  const session = getSessionCookies("kugou");
  if (!session.token || !session.userid) {
    return { code: 301, message: "需要登录" };
  }

  const albumId = Number(params.albumId ?? params.album_id ?? 0) || 0;
  const audioId =
    Number(
      params.albumAudioId ?? params.album_audio_id ?? params.audioId ?? params.audio_id ?? 0,
    ) || 0;
  const level = String(params.level ?? params.quality ?? "hq");
  const wantTrial = Boolean(params.freePart ?? params.free_part);
  const givenPrivilege =
    params.privilege === undefined || params.privilege === null
      ? null
      : Number(params.privilege) || 0;

  const userid = session.userid;
  if (!session.dfid) {
    try {
      await ensureKugouDfid();
    } catch (err) {
      coreLog.warn("注册酷狗设备指纹失败，按匿名设备继续", err);
    }
  }

  const request = {
    hash,
    albumId,
    audioId,
    level,
    userid,
  };

  try {
    const primary = await resolveSongUrl({ ...request, freePart: wantTrial });

    let probe: SongUrlResult | null = null;
    if (!wantTrial && !primary.ok) {
      probe = await resolveSongUrl({ ...request, freePart: true });
    }

    const trialSource = wantTrial ? primary : probe;
    const trialPlayable = wantTrial ? primary.ok : Boolean(probe?.ok);

    const privilege = primary.privilege ?? givenPrivilege;
    const playback = toPlaybackInfo(primary);
    const trialPlayback = trialSource ? toPlaybackInfo(trialSource) : null;

    const trialOutcome: TrialOutcome = {
      requested: Boolean(trialSource),
      status: trialSource?.status ?? 0,
      hash_offset: trialSource?.hashOffset ?? null,
      privilege: trialSource ? (trialSource.privilege ?? privilege) : privilege,
      playable: trialPlayable,
      url: trialSource?.url ?? "",
      urls: trialSource?.urls ?? [],
      duration: Number(trialSource?.hashOffset?.end_ms ?? 0),
      size: trialPlayback?.size ?? 0,
      bitrate: trialPlayback?.bitrate ?? 0,
      extName: trialPlayback?.extName ?? "",
    };

    const playable = primary.ok || trialPlayable;
    const isTrial = wantTrial || (!primary.ok && trialPlayable);

    if (!playable) {
      const reason =
        primary.status === 3
          ? "该账号对该资源完全无授权"
          : "无可用播放地址（可能需要会员或该歌曲不可播放）";
      return {
        code: 403,
        message: reason,
        hash,
        requestMode: wantTrial ? "trial" : "normal",
        status: primary.status,
        hash_offset: primary.hashOffset,
        privilege,
        playable: false,
        isTrial: false,
        freePart: wantTrial,
        url: "",
        urls: [],
        quality: primary.quality,
        requestedQuality: primary.requestedQuality,
        downgraded: primary.quality !== primary.requestedQuality,
        size: playback.size,
        bitrate: playback.bitrate,
        duration: playback.duration,
        extName: playback.extName,
        usedPrivilege: primary.usedPrivilege,
        trial: trialOutcome,
        raw: sanitizeRaw(primary.response),
      };
    }

    return {
      code: 200,
      message: "",
      hash,
      requestMode: wantTrial ? "trial" : "normal",
      status: primary.status,
      hash_offset: primary.hashOffset,
      privilege,
      playable: true,
      isTrial,
      freePart: isTrial,
      url: primary.ok ? primary.url : (trialSource?.url ?? ""),
      urls: primary.ok ? primary.urls : (trialSource?.urls ?? []),
      quality: primary.ok ? primary.quality : (trialSource?.quality ?? primary.quality),
      requestedQuality: primary.requestedQuality,
      downgraded: primary.quality !== primary.requestedQuality,
      size: primary.ok ? playback.size : (trialPlayback?.size ?? 0),
      bitrate: primary.ok ? playback.bitrate : (trialPlayback?.bitrate ?? 0),
      duration: primary.ok ? playback.duration : (trialPlayback?.duration ?? 0),
      extName: primary.ok ? playback.extName : (trialPlayback?.extName ?? ""),
      usedPrivilege: primary.usedPrivilege,
      trial: trialOutcome,
      raw: sanitizeRaw(primary.response),
    };
  } catch (err) {
    coreLog.error("解析酷狗播放地址异常", err);
    return {
      code: 502,
      message: `解析酷狗播放地址失败: ${(err as Error)?.message ?? String(err)}`,
      hash,
    };
  }
};
