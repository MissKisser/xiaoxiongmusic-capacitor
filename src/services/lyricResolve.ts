/**
 * 在线歌词解析与格式偏好服务
 *
 * Based on SPlayer-Next
 * Copyright (C) 2024 SPlayer-Dev
 * Licensed under AGPL-3.0
 *
 * 基于从 SPlayer-Next 移植的多格式解析器，为在线歌词（网易云 / QQ 音乐等）提供
 * 「按来源返回的原始字段解析为渲染层 AMLL LyricLine[]」的统一封装，并支持 KRC/LyS/SRT/ASS
 * 等此前未覆盖的格式。不发起任何网络请求，仅负责解析与格式选优。
 */
import type { LyricFormat } from "@/types/lyrics";
import {
  parseLyricContent,
  parseLyricWithTranslation,
  type ParseContentOptions,
} from "@/utils/lyric/contentParser";
import type { LyricLine } from "@applemusic-like-lyrics/lyric";

/**
 * 单来源歌词载荷（来自某个平台的原始字段）
 */
export interface LyricPayload {
  /** 主歌词原始文本 */
  content?: string;
  /** 主歌词格式；缺省按内容自动检测 */
  format?: LyricFormat;
  /** 翻译歌词原始文本 */
  translation?: string;
  /** 翻译格式；缺省与主格式一致 */
  translationFormat?: LyricFormat;
  /** 音译歌词原始文本 */
  romaji?: string;
  /** 音译格式；缺省与主格式一致 */
  romajiFormat?: LyricFormat;
}

/**
 * 解析单个来源的歌词载荷为 AMLL LyricLine[]
 * @param payload 歌词原始字段
 * @param options 解析选项
 */
export const resolveLyricPayload = (
  payload: LyricPayload,
  options: ParseContentOptions = {},
): LyricLine[] => {
  if (!payload.content) return [];
  return parseLyricWithTranslation(
    {
      content: payload.content,
      translation: payload.translation,
      translationFormat: payload.translationFormat,
      romaji: payload.romaji,
      romajiFormat: payload.romajiFormat,
    },
    payload.format,
    options,
  );
};

/**
 * 从网易云 `songLyric` 返回的数据对象解析歌词。
 * 支持字段：
 *   - lrc.lyric / tlyric.lyric / romalrc.lyric（普通 + 翻译 + 音译）
 *   - yrc.lyric / ytlrc.lyric / yromalrc.lyric（逐字 + 翻译 + 音译）
 *   - klyric.lyric（KRC 逐字，若有）
 * @param data 网易云歌词接口返回对象
 * @returns { lrcData, yrcData } 渲染层歌词行
 */
export const resolveNeteaseLyric = (
  data: any,
): { lrcData: LyricLine[]; yrcData: LyricLine[] } => {
  const result: { lrcData: LyricLine[]; yrcData: LyricLine[] } = { lrcData: [], yrcData: [] };
  if (!data) return result;

  // 普通歌词（LRC 族，含 KRC 自动检测）
  if (data?.lrc?.lyric) {
    const lrcData = parseLyricWithTranslation(
      {
        content: data.lrc.lyric,
        translation: data?.tlyric?.lyric,
        romaji: data?.romalrc?.lyric,
      },
      "lrc",
    );
    if (lrcData.length) result.lrcData = lrcData;
  }

  // 逐字歌词：优先 KRC（klyric），其次 YRC（yrc）
  let yrcData: LyricLine[] = [];
  if (data?.klyric?.lyric) {
    yrcData = parseLyricContent(data.klyric.lyric, "krc");
    // KRC 解析为空（格式异常）时回退 YRC
    if (!yrcData.length && data?.yrc?.lyric) {
      yrcData = parseLyricContent(data.yrc.lyric, "yrc");
    }
  } else if (data?.yrc?.lyric) {
    yrcData = parseLyricContent(data.yrc.lyric, "yrc");
  }
  if (yrcData.length) result.yrcData = yrcData;

  return result;
};
