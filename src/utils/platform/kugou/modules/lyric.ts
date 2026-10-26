/**
 * 酷狗音乐歌词模块
 *
 * 两步流程：
 * 1. GET lyrics.kugou.com/search?keyword=&hash=&timelength= 取第一候选
 * 2. GET lyrics.kugou.com/download?id=&accesskey=&fmt= 取 base64 内容
 *    - fmt=krc：XOR + pako inflate 解密
 *    - fmt=lrc：base64 直接 UTF-8 解码
 *
 * @author Hackerdallas
 */

import { kgRequest } from "../core/request";
import { decodeKrc, base64ToUtf8 } from "../core/krc";
import {
  intervalToSeconds,
  KG_LYRIC_DOWNLOAD_URL,
  KG_LYRIC_HEADERS,
  KG_LYRIC_SEARCH_URL,
} from "../core/config";
import { coreLog } from "../core/logger";
import type { KGModule, KGParams } from "../core/types";

/** 歌词候选条目 */
interface LyricCandidate {
  id?: string | number;
  accesskey?: string;
  fmt?: string;
  krctype?: number;
  contenttype?: number;
}

/**
 * 查候选歌词
 * @param hash 歌曲 hash
 * @param name 歌名
 * @param seconds 时长（秒）
 * @returns 酷狗歌词搜索响应体
 */
const searchCandidates = async (
  hash: string,
  name: string,
  seconds: number,
): Promise<{ candidates?: LyricCandidate[] }> => {
  const url =
    `${KG_LYRIC_SEARCH_URL}?ver=1&man=yes&client=pc&lrctxt=1` +
    `&keyword=${encodeURIComponent(name)}` +
    `&hash=${encodeURIComponent(hash)}` +
    `&timelength=${seconds}`;
  return kgRequest<{ candidates?: LyricCandidate[] }>(url, {
    headers: KG_LYRIC_HEADERS,
    allowBusinessError: true,
  });
};

/**
 * 下载候选歌词的 base64 内容
 * @param id 候选歌词 ID
 * @param accesskey 候选歌词访问键
 * @param fmt 歌词格式
 * @returns 酷狗歌词下载响应体
 */
const downloadLyric = async (
  id: string,
  accesskey: string,
  fmt: string,
): Promise<{ content?: string; fmt?: string }> => {
  const url =
    `${KG_LYRIC_DOWNLOAD_URL}?ver=1&client=pc&charset=utf8` +
    `&id=${encodeURIComponent(id)}` +
    `&accesskey=${encodeURIComponent(accesskey)}` +
    `&fmt=${fmt}`;
  return kgRequest<{ content?: string; fmt?: string }>(url, {
    headers: KG_LYRIC_HEADERS,
    allowBusinessError: true,
  });
};

/**
 * 读取歌曲歌词
 * @param params.hash 歌曲 hash
 * @param params.name 歌名
 * @param params.duration 时长（秒，或 MM:SS 形式的时长串）
 */
export const lyric: KGModule = async (params: KGParams) => {
  const hash = String(params.hash ?? "").trim();
  if (!hash) return { code: 400, message: "hash required" };

  const name = String(params.name ?? "").trim();
  const seconds = intervalToSeconds(params.duration as string | number | undefined);

  let searchResp: { candidates?: LyricCandidate[] };
  try {
    searchResp = await searchCandidates(hash, name, seconds);
  } catch (err) {
    coreLog.error("[kg-lyric] 查询酷狗歌词候选失败:", err);
    return {
      code: 502,
      message: `查询酷狗歌词候选失败: ${(err as Error)?.message ?? String(err)}`,
    };
  }

  const candidates = Array.isArray(searchResp?.candidates) ? searchResp.candidates : [];
  const candidate = candidates[0];
  if (!candidate) {
    return {
      code: 404,
      message: "未找到匹配的歌词",
      hash,
      name,
      duration: seconds,
      raw: { search: searchResp },
    };
  }

  const fmt = candidate.krctype === 1 && candidate.contenttype !== 1 ? "krc" : "lrc";

  let downloadResp: { content?: string; fmt?: string };
  try {
    downloadResp = await downloadLyric(
      String(candidate.id ?? ""),
      String(candidate.accesskey ?? ""),
      fmt,
    );
  } catch (err) {
    coreLog.error("[kg-lyric] 下载酷狗歌词失败:", err);
    return {
      code: 502,
      message: `下载酷狗歌词失败: ${(err as Error)?.message ?? String(err)}`,
    };
  }

  const content = downloadResp?.content;
  if (!content) {
    return {
      code: 404,
      message: "歌词内容为空",
      hash,
      name,
      duration: seconds,
      raw: { search: searchResp, download: downloadResp },
    };
  }

  const raw = { search: searchResp, download: downloadResp };
  const responseFmt = String(downloadResp.fmt || fmt);

  if (responseFmt === "krc") {
    try {
      const parsed = await decodeKrc(content);
      return {
        code: 200,
        hash,
        name,
        duration: seconds,
        fmt: "krc",
        lrc: parsed.lrc,
        krc: parsed.krc,
        trans: parsed.trans || undefined,
        roma: parsed.roma || undefined,
        hasLyric: Boolean(parsed.lrc || parsed.krc),
        raw,
      };
    } catch (err) {
      coreLog.error("[kg-lyric] 解密酷狗 KRC 歌词失败:", err);
      return {
        code: 502,
        message: `解密酷狗 KRC 歌词失败: ${(err as Error)?.message ?? String(err)}`,
        hash,
        name,
        duration: seconds,
        raw,
      };
    }
  }

  if (responseFmt === "lrc") {
    const lrc = base64ToUtf8(content);
    return {
      code: 200,
      hash,
      name,
      duration: seconds,
      fmt: "lrc",
      lrc,
      hasLyric: Boolean(lrc),
      raw,
    };
  }

  return {
    code: 502,
    message: `未知的酷狗歌词格式：${responseFmt}`,
    hash,
    name,
    duration: seconds,
    raw,
  };
};
