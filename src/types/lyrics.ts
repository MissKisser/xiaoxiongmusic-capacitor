/**
 * 歌词共享类型
 *
 * Based on SPlayer-Next
 * Copyright (C) 2024 SPlayer-Dev
 * Licensed under AGPL-3.0
 *
 * 从 SPlayer-Next 的 `shared/types/lyrics.ts` 移植并适配到 capacitor 端：
 *   - 原文件依赖 `shared/types/player`（Track / Platform），本端为自包含版本，仅保留歌词相关类型
 *   - 补充 `DownloadLyricFormat`（原在 `shared/types/download`，此处内联）
 *
 * 注意：本文件的 `LyricLine` 与 `@applemusic-like-lyrics/lyric` 的 `LyricLine` 结构不同
 * （本文件行内含 `words: LyricWord[]`，带逐字时间），渲染层使用前请经 `utils/lyric/convert.ts` 转换。
 */

/** 歌词格式 */
export type LyricFormat = "ttml" | "lys" | "yrc" | "qrc" | "krc" | "lrc" | "srt" | "ass";

/** 默认格式优先级（高到低）；本地外挂选择、TTML 升级判定共用 */
export const DEFAULT_LYRIC_FORMAT_ORDER: readonly LyricFormat[] = [
  "ttml",
  "lys",
  "qrc",
  "krc",
  "yrc",
  "lrc",
  "ass",
  "srt",
];

/** 歌词来源 */
export type LyricSource = "external" | "embedded" | "online";

/** 歌词行语言；und-Latn 表示语言未知的拉丁文字 */
export type LyricLanguage = "ja" | "ko" | "zh-CN" | "und-Latn";

/** 歌词数据 */
export type LyricData = {
  source: LyricSource;
  format: LyricFormat;
  /** 在线歌词所属平台，仅 source=online 时有值 */
  platform?: string;
} | null;

/** 歌词时间片段 */
export interface LyricSpan {
  /** 起始时间（毫秒） */
  startTime: number;
  /** 结束时间（毫秒） */
  endTime: number;
  /** 内容 */
  word: string;
}

/** 歌词单词 */
export interface LyricWord extends LyricSpan {
  /** 音译内容 */
  romanWord?: string;
  /** 是否包含不雅用语 */
  obscene?: boolean;
  /** 注音（如日语假名标注） */
  ruby?: LyricSpan[];
}

/** 一行歌词 */
export interface LyricLine {
  /** 主歌词语言，用于字形选择与 HTML lang */
  language?: LyricLanguage;
  /**
   * 该行的所有单词
   * 如果是 LyRiC 等只能表达一行歌词的格式，这里就只会有一个单词且通常其始末时间和本结构的 `startTime` 和 `endTime` 相同
   */
  words: LyricWord[];
  /** 该行的翻译歌词，将会显示在主歌词行的下方 */
  translatedLyric: string;
  /** 该行的音译歌词，将会显示在翻译歌词行的下方 */
  romanLyric: string;
  /** 句子的起始时间，单位为毫秒 */
  startTime: number;
  /** 句子的结束时间，单位为毫秒 */
  endTime: number;
  /** 是否为背景歌词行 */
  isBG: boolean;
  /** 是否为对唱歌词行 */
  isDuet: boolean;
}

/**
 * 歌词原始内容载荷：主 + 可选翻译 / 音译
 */
export interface LyricInput {
  /** 主歌词原始文本 */
  content: string;
  /** 翻译原始文本 */
  translation?: string;
  translationFormat?: LyricFormat;
  /** 罗马音原始文本 */
  romaji?: string;
  romajiFormat?: LyricFormat;
}

/** 歌词匹配结果 */
export interface LyricMatchResult extends LyricInput {
  platform: string;
  /** 主歌词格式 */
  format: LyricFormat;
}

/** 下载歌词文件保存格式：逐行 LRC / 逐字增强 LRC（原在 shared/types/download，内联） */
export type DownloadLyricFormat = "lrc" | "enhanced-lrc";
