/**
 * QQ 音乐歌词获取与解析
 *
 * 走 music.musichallSong.PlayLyricInfo / GetPlayLyricInfo：
 * 1. 带 qrc: 1 请求一次，服务端按 qrc_t 决定返回 QRC（逐字）还是 LRC；
 * 2. 若拿到的是 QRC，再带 qrc: 0 请求一次补齐普通 LRC；
 * 3. 翻译（trans）与罗马音（roma）随同返回。
 * 接口返回的是十六进制密文，解密与解析交给 core/qrc。
 *
 * @author Hackerdallas
 */

import { qmRequest } from "../core/request";
import { decryptQrc, parseLyric } from "../core/qrc";
import { coreLog } from "../core/logger";
import type { QMModule, QMParams } from "../core/types";

/** 歌词接口模块名 */
const LYRIC_MODULE = "music.musichallSong.PlayLyricInfo";

/** 歌词接口方法名 */
const LYRIC_METHOD = "GetPlayLyricInfo";

/**
 * 把文本编码为 Base64
 * @param text 原始文本
 * @returns Base64 字符串
 */
const encodeName = (text: unknown): string => {
  const bytes = new TextEncoder().encode(String(text ?? ""));
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return typeof btoa === "function" ? btoa(binary) : Buffer.from(bytes).toString("base64");
};

/**
 * 把歌曲 ID 转成可安全传输的数字
 * @param value 原始 ID
 * @returns 安全的数字或原始字符串
 */
const toSafeNumber = (value: unknown): number | string => {
  const num = Number(value);
  return Number.isSafeInteger(num) ? num : String(value ?? "");
};

/**
 * 尝试解密歌词密文
 * @param hex 十六进制密文
 * @returns 解密后的文本，失败时返回 undefined
 */
const tryDecrypt = (hex: unknown): string | undefined => {
  if (!hex) return undefined;
  try {
    return decryptQrc(String(hex));
  } catch {
    return undefined;
  }
};

/** 歌词接口响应数据段 */
interface LyricResponse {
  lyric?: string;
  qrc_t?: number;
  trans?: string;
  roma?: string;
}

/**
 * 请求一次歌词
 * @param param 歌词接口参数
 * @returns 接口返回的业务数据段
 */
const requestLyric = async (param: Record<string, unknown>): Promise<LyricResponse> =>
  qmRequest<LyricResponse>(LYRIC_MODULE, LYRIC_METHOD, param);

/**
 * 读取歌曲歌词
 * @param params.id 歌曲 ID（数字）
 * @param params.name 歌曲名称
 * @param params.artist 歌手名称
 * @param params.album 专辑名称
 * @param params.duration 歌曲时长（秒）
 */
export const lyric: QMModule = async (params: QMParams) => {
  const id = params.id ?? params.songId ?? params.songid;
  if (id === undefined || id === null || String(id).trim() === "") {
    return { code: 400, message: "id required" };
  }

  const name = String(params.name ?? "");
  const artist = String(params.artist ?? "");
  const album = String(params.album ?? "");
  const duration = Number(params.duration ?? 0);

  const baseParam: Record<string, unknown> = {
    albumName: encodeName(album),
    crypt: 1,
    ct: 19,
    cv: 2111,
    interval: duration,
    lrc_t: 0,
    qrc: 1,
    qrc_t: 0,
    roma: 1,
    roma_t: 0,
    singerName: encodeName(artist),
    songID: toSafeNumber(id),
    songName: encodeName(name),
    trans: 1,
    trans_t: 0,
    type: 0,
  };

  try {
    const resp = (await requestLyric(baseParam)) || {};
    const result = { lrc: "", qrc: "", trans: "", roma: "" };

    // 主歌词：按 qrc_t 判断服务端返回的是 QRC 还是 LRC
    const mainDecrypted = tryDecrypt(resp.lyric);
    if (mainDecrypted) {
      if (resp.qrc_t === 0) {
        result.lrc = mainDecrypted;
      } else {
        result.qrc = mainDecrypted;
      }
    }

    // 只拿到 QRC 时再单独请求一次 LRC
    if (result.qrc && !result.lrc) {
      try {
        const lrcResp = await requestLyric({ ...baseParam, qrc: 0, qrc_t: 0 });
        const lrcText = tryDecrypt(lrcResp && lrcResp.lyric);
        if (lrcText) result.lrc = lrcText;
      } catch {
        // 次级失败不影响主结果
      }
    }

    result.trans = tryDecrypt(resp.trans) || "";
    result.roma = tryDecrypt(resp.roma) || "";

    const mainParsed = result.qrc ? parseLyric(result.qrc) : parseLyric(result.lrc);

    return {
      code: 200,
      id: String(id),
      name,
      artist,
      album,
      duration,
      lrc: result.lrc,
      qrc: result.qrc,
      trans: result.trans,
      roma: result.roma,
      format: mainParsed.format,
      lines: mainParsed.lines,
      hasLyric: Boolean(result.lrc || result.qrc),
      hasTranslation: Boolean(result.trans),
      hasRoma: Boolean(result.roma),
      raw: { code: 200, ...result },
    };
  } catch (err) {
    coreLog.error("[qm-lyric] QQ 音乐歌词获取异常:", err);
    return {
      code: 502,
      message: `QQ 音乐歌词获取失败: ${(err as Error)?.message ?? String(err)}`,
    };
  }
};
