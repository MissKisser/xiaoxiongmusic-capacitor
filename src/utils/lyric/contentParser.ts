/**
 * 歌词内容统一解析入口
 *
 * Based on SPlayer-Next
 * Copyright (C) 2024 SPlayer-Dev
 * Licensed under AGPL-3.0
 *
 * 基于从 SPlayer-Next 移植的多格式解析器（parse.ts / parseKRC / parseLyS / parseSRT / parseASS 等），
 * 对外提供「按内容检测格式 → 解析为渲染层可用的 AMLL LyricLine[]」的统一能力。
 *
 * 覆盖格式：LRC / TTML / YRC / QRC / KRC / LyS / SRT / ASS
 * 内部先转成 upstream LyricLine[]（含逐字时间），再经 convert.ts 转成 AMLL LyricLine[]，
 * 使调用方无需关心两套类型差异。
 */
import type { LyricFormat, LyricInput } from "@/types/lyrics";
import { detectFormat, parseLyric } from "./parse";
import { toAmllLines } from "./convert";
import type { LyricLine } from "@applemusic-like-lyrics/lyric";

export interface ParseContentOptions {
  /** 是否解析背景行（KRC/QRC/YRC 等格式的 and 声部） */
  detectBackground?: boolean;
}

/**
 * 解析歌词内容（自动检测格式）
 * @param content 歌词原始文本
 * @param format 已知格式；缺省时按内容特征自动检测
 * @param options 解析选项
 * @returns 渲染层可直接使用的 AMLL LyricLine[]
 */
export const parseLyricContent = (
  content: string,
  format?: LyricFormat,
  options: ParseContentOptions = {},
): LyricLine[] => {
  if (!content) return [];
  const fmt = format ?? detectFormat(content);
  const input: LyricInput = { content };
  const upstreamLines = parseLyric(input, fmt, "", {
    detectBackground: options.detectBackground !== false,
  });
  return toAmllLines(upstreamLines);
};

/**
 * 解析歌词 + 翻译 / 音译（三份原始文本，分别按各自格式解析后按时间对齐）
 * @param input 主 + 可选翻译 / 音译
 * @param mainFormat 主歌词格式（缺省自动检测）
 * @param options 解析选项
 * @returns 渲染层可直接使用的 AMLL LyricLine[]
 */
export const parseLyricWithTranslation = (
  input: LyricInput,
  mainFormat?: LyricFormat,
  options: ParseContentOptions = {},
): LyricLine[] => {
  const fmt = mainFormat ?? detectFormat(input.content);
  const upstreamLines = parseLyric(
    {
      ...input,
      translationFormat: input.translationFormat ?? fmt,
      romajiFormat: input.romajiFormat ?? fmt,
    },
    fmt,
    "",
    { detectBackground: options.detectBackground !== false },
  );
  return toAmllLines(upstreamLines);
};
