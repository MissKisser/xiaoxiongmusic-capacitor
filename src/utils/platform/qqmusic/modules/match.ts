/**
 * QQ 音乐听歌识曲取词
 *
 * 组合 search 与 lyric：先按关键词搜歌，取第一条命中再取它的歌词。
 *
 * @author Hackerdallas
 */

import { search } from "./search";
import { lyric } from "./lyric";
import { coreLog } from "../core/logger";
import type { QMModule, QMParams } from "../core/types";

/** 搜索命中的歌曲条目 */
interface MatchedSong {
  id: string;
  mid: string;
  name: string;
  artist: string;
  album: string;
  duration: number;
  [key: string]: unknown;
}

/** 歌词模块返回体中本模块关心的字段 */
interface MatchedLyric {
  code: number;
  lrc?: string;
  qrc?: string;
  trans?: string;
  roma?: string;
  format?: string;
  lines?: unknown[];
  hasLyric?: boolean;
  raw?: unknown;
  message?: string;
}

/**
 * 按关键词模糊匹配歌曲并取回歌词
 * @param params.keywords 搜索关键词（建议格式：歌曲名-歌手名）
 */
export const match: QMModule = async (params: QMParams) => {
  const keywords = String(params.keywords ?? params.keyword ?? "").trim();
  if (!keywords) return { code: 400, message: "keywords required" };

  try {
    const searched = (await search({
      ...params,
      keywords,
      type: 0,
      page: 1,
      limit: 1,
    })) as { code: number; songs?: MatchedSong[]; message?: string };

    if (searched.code !== 200) {
      return { code: searched.code, message: searched.message ?? "搜索失败" };
    }

    const song = searched.songs?.[0];
    if (!song) {
      return { code: 404, message: "未找到匹配的歌曲" };
    }

    const lyricData = (await lyric({
      ...params,
      id: song.id,
      name: song.name,
      artist: song.artist,
      album: song.album,
      duration: Math.floor((song.duration || 0) / 1000),
    })) as MatchedLyric;

    if (lyricData.code !== 200) {
      return { code: lyricData.code, message: lyricData.message ?? "歌词获取失败" };
    }

    return {
      code: 200,
      keywords,
      song,
      lrc: lyricData.lrc ?? "",
      qrc: lyricData.qrc ?? "",
      trans: lyricData.trans ?? "",
      roma: lyricData.roma ?? "",
      format: lyricData.format ?? "lrc",
      lines: lyricData.lines ?? [],
      hasLyric: Boolean(lyricData.hasLyric),
      raw: { song, lyric: lyricData.raw },
    };
  } catch (err) {
    coreLog.error("[qm-match] QQ 音乐听歌识曲取词异常:", err);
    return {
      code: 502,
      message: `QQ 音乐听歌识曲取词失败: ${(err as Error)?.message ?? String(err)}`,
    };
  }
};
