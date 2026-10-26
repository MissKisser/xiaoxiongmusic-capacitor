/**
 * 酷狗音乐播放地址解析核心
 *
 * 拆解「音质档位 → 授权探测 → 取播放直链」链路：
 * - 免费单段：使用原始 hash 发起 GET /v5/url 取直链；
 * - VIP 两段式：POST /v2/get_res_privilege/lite 获取音质变体 hash 后取直链；
 * - status 判据：1 可播，2 付费墙（提供 hash_offset 试听片段），3 无授权。
 *
 * @author Hackerdallas
 */

import { kgGatewayRequest } from "./request";
import type { KGRawBody } from "./types";
import { getDeviceMid, signKey } from "./crypto";
import { getKgAppid, getKgClientver, isKugouConceptMode } from "./config";

/** 音质档位，由低到高 */
export const QUALITY_LEVELS = ["128", "320", "flac", "high"];

/** 外部音质名映射至酷狗音质档位 */
export const QUALITY_MAP: Record<string, string> = {
  "hi-res": "high",
  lossless: "flac",
  hq: "320",
  sq: "128",
  lq: "128",
};

/** 播放地址接口协议版本号 */
const TRACK_URL_VERSION = 11430;

/** 试听片段边界 */
export interface KgHashOffset {
  start_ms?: number;
  end_ms?: number;
  end_byte?: number;
  start_byte?: number;
  file_type?: number;
  offset_hash?: string;
  clip_hash?: string;
  [key: string]: unknown;
}

/** 官方授权接口返回的音质变体 */
export interface KgQualityVariant {
  quality: string;
  hash: string;
  privilege: number;
}

/** 官方授权接口解析结果 */
export interface KgPrivilegeResult {
  options: Map<string, string>;
  privilege: number | null;
  qualityPrivileges: Map<string, number>;
  response: KGRawBody;
}

/** 播放地址解析选项 */
export interface SongUrlOptions {
  hash: string;
  albumId?: number;
  audioId?: number;
  level?: string;
  freePart?: boolean;
  userid?: string | number;
}

/** 播放地址解析结果 */
export interface SongUrlResult {
  ok: boolean;
  url: string;
  urls: string[];
  quality: string;
  requestedQuality: string;
  usedPrivilege: boolean;
  status: number;
  hashOffset: KgHashOffset | null;
  privilege: number | null;
  response: KGRawBody;
}

/**
 * 提取响应里的可用直链
 * @param response 播放地址响应
 * @returns 直链数组
 */
export const extractUrls = (response: unknown): string[] => {
  if (!response || typeof response !== "object") return [];
  const record = response as Record<string, unknown>;
  return [record.url, record.backup_url, record.backupUrl]
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .filter((value): value is string => typeof value === "string" && value.length > 0);
};

/**
 * 提取可播放的音频直链（排除视频 mp4 格式）
 * @param response 播放地址响应
 * @returns 可播放音频直链列表
 */
export const playableUrls = (response: unknown): string[] => {
  const urls = extractUrls(response);
  if (urls.length === 0) return [];
  const extName = (response as { extName?: unknown })?.extName;
  if (extName === "mp4") return [];
  return urls;
};

/**
 * 提取试听片段边界
 * @param response 播放地址响应
 * @returns 试听边界对象，不存在返回 null
 */
export const pickHashOffset = (response: unknown): KgHashOffset | null => {
  if (!response || typeof response !== "object") return null;
  const record = response as Record<string, unknown>;
  if (record.hash_offset && typeof record.hash_offset === "object") {
    return record.hash_offset as KgHashOffset;
  }
  const transParam = record.trans_param as { hash_offset?: unknown } | undefined;
  if (transParam && transParam.hash_offset && typeof transParam.hash_offset === "object") {
    return transParam.hash_offset as KgHashOffset;
  }
  return null;
};

/**
 * 提取响应中的 status 标识
 * @param response 播放地址响应
 * @returns status 数值
 */
export const pickStatus = (response: unknown): number => {
  if (!response || typeof response !== "object") return 0;
  const status = (response as { status?: unknown }).status;
  return Number(status) || 0;
};

/**
 * 读取当前账号在各音质档位的授权位与变体 hash
 * @param options 请求选项
 * @returns 解析后的授权与变体信息
 */
export const fetchLiteQualityOptions = async (options: {
  hash: string;
  albumId?: number;
  userid?: string | number;
}): Promise<KgPrivilegeResult> => {
  const response = await kgGatewayRequest("/v2/get_res_privilege/lite", {
    method: "POST",
    data: {
      appid: getKgAppid(),
      clientver: getKgClientver(),
      area_code: 1,
      behavior: "play",
      need_hash_offset: 1,
      relate: 1,
      support_verify: 1,
      resource: [
        {
          type: "audio",
          page_id: 0,
          hash: options.hash,
          album_id: options.albumId ?? 0,
        },
      ],
      qualities: QUALITY_LEVELS,
    },
    headers: { "x-router": "media.store.kugou.com" },
    allowBusinessError: true,
  });

  const optionsMap = new Map<string, string>();
  const qualityPrivileges = new Map<string, number>();
  const data = Array.isArray(response?.data) ? (response.data as KGRawBody[]) : [];

  for (const item of data) {
    const variants = [
      item,
      ...(Array.isArray(item.relate_goods) ? (item.relate_goods as KGRawBody[]) : []),
    ];
    for (const variant of variants) {
      const quality = String(variant.quality ?? "");
      if (!quality) continue;
      const privilege = Number(variant.privilege ?? 0) || 0;
      if (!qualityPrivileges.has(quality)) qualityPrivileges.set(quality, privilege);
      if (!variant.hash || Number(variant.level) === 0) continue;
      if (!QUALITY_LEVELS.includes(quality) || optionsMap.has(quality)) continue;
      optionsMap.set(quality, String(variant.hash));
    }
  }

  const privilege = data.length > 0 ? Number(data[0].privilege ?? 0) || 0 : null;

  return {
    options: optionsMap,
    privilege,
    qualityPrivileges,
    response,
  };
};

/**
 * 请求单档音质播放直链
 * @param options 请求选项
 * @returns 网关响应数据
 */
export const requestTrackUrl = async (options: {
  hash: string;
  quality: string;
  albumId?: number;
  audioId?: number;
  freePart?: boolean;
  userid?: string | number;
}): Promise<KGRawBody> => {
  const { hash, quality, albumId = 0, audioId = 0, freePart = false } = options;
  const concept = isKugouConceptMode();

  const params: Record<string, unknown> = {
    area_code: 1,
    hash,
    ssa_flag: "is_fromtrack",
    version: TRACK_URL_VERSION,
    page_id: concept ? 967177915 : 151369488,
    quality,
    behavior: "play",
    pid: concept ? 411 : 2,
    cmd: 26,
    pidversion: 3001,
    IsFreePart: freePart ? 1 : 0,
    ppage_id: concept ? "356753938,823673182,967485191" : "463467626,350369493,788954147",
    cdnBackup: 1,
    module: "",
    clientver: TRACK_URL_VERSION,
    key: signKey(hash, getDeviceMid(), Number(options.userid || 0)),
  };

  if (Number(albumId) > 0) params.album_id = Number(albumId);
  if (Number(audioId) > 0) params.album_audio_id = Number(audioId);

  return kgGatewayRequest("/v5/url", {
    method: "GET",
    params,
    headers: { "x-router": "trackercdn.kugou.com" },
    allowBusinessError: true,
  });
};

/**
 * 解析歌曲播放地址（偏好降级 + VIP 变体 hash 支持）
 * @param options 解析入参
 * @returns 播放地址解析结果
 */
export const resolveSongUrl = async (options: SongUrlOptions): Promise<SongUrlResult> => {
  const { hash, albumId = 0, audioId = 0, level = "hq", freePart = false, userid = 0 } = options;

  const requestedQuality = QUALITY_MAP[String(level).toLowerCase()] || "320";
  const chain = QUALITY_LEVELS.slice(0, QUALITY_LEVELS.indexOf(requestedQuality) + 1).reverse();

  let candidates = chain.map((quality) => ({ quality, hash }));
  let usedPrivilege = false;
  let privilege: number | null = null;

  if (isKugouConceptMode() && userid) {
    try {
      const lite = await fetchLiteQualityOptions({ hash, albumId, userid });
      privilege = lite.privilege;
      const privileged = chain
        .map((quality) => ({ quality, variantHash: lite.options.get(quality) }))
        .filter((item) => Boolean(item.variantHash))
        .map((item) => ({ quality: item.quality, hash: item.variantHash as string }));
      if (privileged.length > 0) {
        candidates = privileged;
        usedPrivilege = true;
      }
    } catch {
      // 授权探测失败时回落到原始 hash
    }
  }

  let lastResponse: KGRawBody = {};
  for (const candidate of candidates) {
    const request = {
      hash: candidate.hash,
      quality: candidate.quality,
      albumId,
      audioId,
      freePart,
      userid,
    };

    let response = await requestTrackUrl(request);
    let urls = playableUrls(response);

    if (urls.length === 0 && Number(audioId) > 0) {
      // album_audio_id 不匹配时重试
      const retry = await requestTrackUrl({ ...request, audioId: 0 });
      const retryUrls = playableUrls(retry);
      if (retryUrls.length > 0) {
        response = retry;
        urls = retryUrls;
      }
    }

    lastResponse = response;
    if (urls.length > 0) {
      return {
        ok: true,
        url: urls[0],
        urls,
        quality: candidate.quality,
        requestedQuality,
        usedPrivilege,
        status: pickStatus(response),
        hashOffset: pickHashOffset(response),
        privilege,
        response,
      };
    }
  }

  return {
    ok: false,
    url: "",
    urls: [],
    quality: requestedQuality,
    requestedQuality,
    usedPrivilege,
    status: pickStatus(lastResponse),
    hashOffset: pickHashOffset(lastResponse),
    privilege,
    response: lastResponse,
  };
};
