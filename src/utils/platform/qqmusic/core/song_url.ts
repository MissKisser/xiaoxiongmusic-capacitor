/**
 * QQ 音乐播放地址解析核心实现（vkey 协议直连）
 *
 * 播放地址走 vkey 协议，请求体为 { comm, req_0: { module, method, param } }。
 * 一次请求并排上报所有候选音质档位的文件名，上游仅对具备权限的档位返回有效直链。
 *
 * 文件名规则：
 * - 格式为 {档位前缀}{base}{扩展名}
 * - 首选 base 为媒体 mid 单个（file.media_mid）
 * - 兜底 base 为歌曲 mid×2
 * - 正式直链获取失败时自动下发 RS02 前缀的试听直链兜底
 *
 * @author Hackerdallas
 */

import { QM_API_URL, QM_HEADERS } from "./config";
import { sessionToCookieHeader } from "./credential";
import { getQQMusicCookies, getQQMusicUin } from "./request";
import { platformRequest } from "../../http";
import { coreLog } from "./logger";

/** vkey 接口的 Referer */
const VKEY_REFERER = "https://y.qq.com/";

/** vkey 请求超时（毫秒） */
const VKEY_TIMEOUT_MS = 8000;

/** 试听直链的文件名前缀 */
const TRIAL_PREFIX = "RS02";

/** 试听直链的文件扩展名 */
const TRIAL_EXT = ".mp3";

/** 试听音质档位标识 */
const TRIAL_LEVEL = "trial";

/** 试听音质说明 */
const TRIAL_LABEL = "试听片段";

/**
 * 音质档位候选表，按音质从高到低排列
 */
const QUALITY_CANDIDATES = [
  { prefix: "AI00", ext: ".flac", level: "hi-res", label: "Hi-Res FLAC" },
  { prefix: "F000", ext: ".flac", level: "lossless", label: "无损 FLAC" },
  { prefix: "M800", ext: ".mp3", level: "hq", label: "320k MP3" },
  { prefix: "M500", ext: ".mp3", level: "sq", label: "128k MP3" },
  { prefix: "C400", ext: ".m4a", level: "lq", label: "标准 AAC" },
];

/**
 * 允许原样回传的 vkey 结果字段（剥离敏感播放凭据）
 */
const RAW_ITEM_FIELDS = [
  "filename",
  "songmid",
  "mid",
  "result",
  "subcode",
  "isbuy",
  "onecan",
  "isonly",
  "pneed",
  "pneedbuy",
  "hisbuy",
  "hisdown",
  "errtype",
  "premain",
  "pdl",
];

/** 音质候选档位 */
export interface QualityCandidate {
  /** 文件名前缀 */
  prefix: string;
  /** 文件扩展名 */
  ext: string;
  /** 音质档位标识 */
  level: string;
  /** 音质中文说明 */
  label: string;
}

/** 单个候选文件的上游结果 */
export interface VkeyResult {
  /** 音质档位 */
  level: string;
  /** 上报的文件名 */
  filename: string;
  /** 上游结果码，无返回时为 null */
  result: number | null;
  /** 上游子错误码，无返回时为 null */
  subcode: number | null;
}

/** 收敛后的 vkey 业务响应 */
export interface SanitizedVkeyRaw {
  /** 外层业务码 */
  code: number;
  /** 内层业务段 */
  req_0: {
    /** 内层业务码 */
    code: number;
    /** 内层数据段 */
    data: {
      /** 各候选文件的上游结果 */
      midurlinfo: Array<Record<string, unknown>>;
    };
  };
}

/** 播放地址解析结果 */
export interface SongUrlResult {
  /** 是否拿到可用直链 */
  ok: boolean;
  /** 播放地址 */
  url?: string;
  /** 命中的音质档位，试听直链为 trial */
  level?: string;
  /** 命中音质的中文说明 */
  label?: string;
  /** 音频格式 */
  format?: string;
  /** 是否降级到低于首选档位的音质 */
  isFallback?: boolean;
  /** 是否为官方下发的试听片段直链 */
  isTrial?: boolean;
  /** 歌曲付费标记，1 表示该歌曲需付费 */
  payPlay?: number;
  /** 本次尝试的音质档位 */
  triedLevels?: string[];
  /** 失败原因 */
  reason?: string;
  /** 收敛后的 vkey 业务响应 */
  raw?: SanitizedVkeyRaw;
  /** 每个候选文件的上游结果码 */
  vkeyResults?: VkeyResult[];
}

/** 单个上报给 vkey 的候选文件 */
interface VkeyEntry {
  /** 上报的文件名 */
  filename: string;
  /** 对应的音质档位 */
  level: string;
}

/** 一次 vkey 请求的收敛结果 */
interface VkeyOutcome {
  /** 上游返回的候选结果列表 */
  infos: any[];
  /** 直链拼接前缀 */
  sip: string;
  /** 收敛后的业务响应 */
  raw: SanitizedVkeyRaw;
  /** 按文件名索引的上游结果 */
  byFilename: Map<string, any>;
  /** 逐候选的上游结果码 */
  vkeyResults: VkeyResult[];
}

/**
 * 生成 32 位随机 GUID 字符串
 * @returns 十六进制 GUID
 */
const generateGuid = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().replace(/-/g, "");
  }
  return "xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

/**
 * 计算 QQ 系 CSRF token（g_tk）
 * @param str 参与计算的字符串
 * @param seed 初始种子，默认 0
 * @returns 32 位无符号整数
 */
export const hash33 = (str: string, seed = 0): number => {
  let h = seed;
  for (const ch of str) {
    h = (((h << 5) + h + ch.codePointAt(0)!) & 0xffffffff) >>> 0;
  }
  return h & 2147483647;
};

/**
 * 收敛 vkey 响应，剥离敏感信息
 * @param json vkey 接口原始响应
 * @param infos 原始 midurlinfo 列表
 * @returns 收敛后的响应
 */
const sanitizeRaw = (json: any, infos: any[]): SanitizedVkeyRaw => {
  const inner = (json && json.req_0) || {};
  return {
    code: json && json.code !== undefined ? json.code : 0,
    req_0: {
      code: inner.code !== undefined ? inner.code : 0,
      data: {
        midurlinfo: (infos || []).map((info) => {
          const item: Record<string, unknown> = {};
          for (const field of RAW_ITEM_FIELDS) {
            if (info && info[field] !== undefined) item[field] = info[field];
          }
          return item;
        }),
      },
    },
  };
};

/**
 * 发起一次 vkey 请求并解析返回
 * @param mid 歌曲 mid
 * @param entries 上报的文件列表
 * @returns 收敛后的结果
 */
const postVkey = async (mid: string, entries: VkeyEntry[]): Promise<VkeyOutcome> => {
  const filenames = entries.map((item) => item.filename);

  const cookies = getQQMusicCookies();
  const musickey = cookies.qm_keyst || cookies.qqmusic_key || "";
  const gtk = hash33(musickey, 5381);
  const guid = generateGuid();
  const account = getQQMusicUin();
  const cookieHeader = sessionToCookieHeader(cookies);

  const body = {
    comm: {
      ct: 11,
      cv: 14090008,
      v: 14090008,
      chid: "10003505",
      os_ver: "15",
      phonetype: "24122RKC7C",
      tmeAppID: "qqmusic",
      nettype: "NETWORK_WIFI",
      udid: "0",
      OpenUDID: "0",
      QIMEI36: "0",
      uin: account && account !== "0" ? account : "",
      format: "json",
      inCharset: "utf-8",
      outCharset: "utf-8",
      notice: 0,
      needNewCode: 1,
      g_tk: gtk,
      g_tk_new_20200303: gtk,
      guid,
    },
    req_0: {
      module: "music.vkey.GetVkey",
      method: "UrlGetVkey",
      param: {
        guid,
        songmid: filenames.map(() => mid),
        filename: filenames,
        songtype: filenames.map(() => 0),
        uin: account && account !== "0" ? account : "",
        ctx: 0,
        loginflag: 1,
        platform: "20",
      },
    },
  };

  const response = await platformRequest<any>({
    url: QM_API_URL,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      Referer: VKEY_REFERER,
      Origin: "https://y.qq.com",
      "User-Agent": QM_HEADERS["User-Agent"],
    },
    data: body,
    timeout: VKEY_TIMEOUT_MS,
  });

  const json = response.data;
  const inner = json && json.req_0;
  const data = json && json.code === 0 && inner && inner.code === 0 ? inner.data : null;
  const infos = (data && data.midurlinfo) || [];
  const sip =
    ((data && data.sip) || []).find((item: unknown) => String(item).startsWith("http")) ||
    "https://isure.stream.qqmusic.qq.com/";

  const byFilename = new Map<string, any>();
  for (const info of infos) {
    if (info && info.filename && !byFilename.has(info.filename)) {
      byFilename.set(info.filename, info);
    }
  }

  const vkeyResults: VkeyResult[] = entries.map((item) => {
    const info = byFilename.get(item.filename);
    return {
      level: item.level,
      filename: item.filename,
      result: info && info.result !== undefined ? Number(info.result) : null,
      subcode: info && info.subcode !== undefined ? Number(info.subcode) : null,
    };
  });

  return { infos, sip, raw: sanitizeRaw(json, infos), byFilename, vkeyResults };
};

/**
 * 按首选音质生成顺位候选列表
 * @param preferredLevel 首选音质档位
 * @returns 候选档位列表
 */
export const getQualityCandidates = (preferredLevel: string): QualityCandidate[] => {
  const target = String(preferredLevel || "hq").toLowerCase();
  const index = QUALITY_CANDIDATES.findIndex((item) => item.level === target);
  if (index >= 0) return QUALITY_CANDIDATES.slice(index);
  return QUALITY_CANDIDATES;
};

/**
 * 生成 filename 的 base 候选列表
 *
 * 首选为媒体 mid 单个，兜底为歌曲 mid×2
 * @param mid 歌曲 mid
 * @param mediaMid 媒体 mid
 * @returns base 候选列表
 */
export const getBaseCandidates = (mid: string, mediaMid: string): string[] => {
  const bases: string[] = [];
  const push = (value: string) => {
    if (!value) return;
    if (bases.includes(value)) return;
    bases.push(value);
  };
  push(mediaMid);
  push(`${mid}${mid}`);
  if (mediaMid && mediaMid !== mid) push(`${mediaMid}${mediaMid}`);
  return bases;
};

/**
 * 判定未返回直链的失败原因
 * @param infos 原始 midurlinfo 列表
 * @param payPlay 歌曲付费标记
 * @returns 失败原因分类标识
 */
const pickReason = (infos: any[], payPlay?: number): string => {
  const codes = (infos || []).map((info) => Number(info && info.result));
  if (codes.some((code) => code === 101404)) return "filename_rejected";
  if (codes.some((code) => code === 104003 || code === 10400)) {
    return payPlay === 1 ? "need_pay" : "no_authorization";
  }
  return "vkey_error";
};

/**
 * 请求并解析单曲播放直链
 * @param options 请求配置项
 * @returns 播放地址解析结果
 */
export const requestSongUrl = async (options: {
  mid: string;
  mediaMid?: string;
  level?: string;
  payPlay?: number;
}): Promise<SongUrlResult> => {
  const { mid, mediaMid = "", level = "hq", payPlay } = options;

  const bases = getBaseCandidates(mid, mediaMid);
  const targetLevel = String(level || "hq");
  const candidates = getQualityCandidates(targetLevel);
  const triedLevels = candidates.map((item) => item.level);

  const requests: VkeyEntry[] = [];
  for (const candidate of candidates) {
    for (const base of bases) {
      requests.push({
        filename: `${candidate.prefix}${base}${candidate.ext}`,
        level: candidate.level,
      });
    }
  }

  const outcome = await postVkey(mid, requests);

  for (const request of requests) {
    const found = outcome.byFilename.get(request.filename);
    if (!found || !found.purl) continue;

    const candidate = candidates.find((item) => item.level === request.level);
    if (!candidate) continue;

    const purl = String(found.purl);
    coreLog.info(`[qm-song-url] 播放地址命中: ${mid} -> ${candidate.label} (${candidate.level})`);
    return {
      ok: true,
      url: purl.startsWith("http") ? purl : `${outcome.sip}${purl}`,
      level: candidate.level,
      label: candidate.label,
      format: candidate.ext.replace(".", ""),
      isFallback: candidate.level !== targetLevel,
      isTrial: false,
      payPlay,
      triedLevels,
      raw: outcome.raw,
      vkeyResults: outcome.vkeyResults,
    };
  }

  // 正式直链拿不到时探测官方试听直链
  const trialBase = mediaMid || mid;
  const trialOutcome = await postVkey(mid, [
    { filename: `${TRIAL_PREFIX}${trialBase}${TRIAL_EXT}`, level: TRIAL_LEVEL },
  ]);
  const trialInfo = trialOutcome.byFilename.get(`${TRIAL_PREFIX}${trialBase}${TRIAL_EXT}`);
  if (trialInfo && trialInfo.purl) {
    const purl = String(trialInfo.purl);
    coreLog.info(`[qm-song-url] 命中试听直链: ${mid}`);
    return {
      ok: true,
      url: purl.startsWith("http") ? purl : `${trialOutcome.sip}${purl}`,
      level: TRIAL_LEVEL,
      label: TRIAL_LABEL,
      format: TRIAL_EXT.replace(".", ""),
      isFallback: true,
      isTrial: true,
      payPlay,
      triedLevels,
      raw: trialOutcome.raw,
      vkeyResults: trialOutcome.vkeyResults,
    };
  }

  const reason = pickReason(outcome.infos, payPlay);
  coreLog.warn(`[qm-song-url] vkey 未返回可用播放地址: ${mid} 首选=${targetLevel} 原因=${reason}`);
  return {
    ok: false,
    reason,
    isTrial: false,
    payPlay,
    triedLevels,
    raw: outcome.raw,
    vkeyResults: outcome.vkeyResults,
  };
};
