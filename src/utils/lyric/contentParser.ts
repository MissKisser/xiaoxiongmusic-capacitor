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
import type { LyricFormat, LyricInput, LyricLine as UpLyricLine } from "@/types/lyrics";
import { detectFormat, parseLyric, pairTranslation } from "./parse";
import { toAmllLines } from "./convert";
import { MAX_TIME } from "./timestamp";
import type { LyricLine } from "@applemusic-like-lyrics/lyric";

export interface ParseContentOptions {
  /** 是否解析背景行（KRC/QRC/YRC 等格式的 and 声部） */
  detectBackground?: boolean;
}

/** 逐行 JSON 歌词的单行结构（t 为毫秒时间，c 为行内容片段数组） */
interface JsonLyricLine {
  /** 行起始时间（毫秒） */
  t?: unknown;
  /** 行内容片段数组，各片段经 tx 承载文本 */
  c?: unknown;
}

/**
 * 判断歌词内容是否为逐行 JSON 的新版格式
 * @param content 歌词原始文本
 * @returns 内容以 "{" 开头且首行可解析出含 t/c 字段的对象时为 true
 */
const isJsonLineFormat = (content: string): boolean => {
  const trimmed = content.trim();
  if (!trimmed.startsWith("{")) return false;
  const firstLine = trimmed.split("\n", 1)[0].trim();
  if (!firstLine) return false;
  try {
    const obj = JSON.parse(firstLine) as JsonLyricLine | null;
    return (
      typeof obj === "object" && obj !== null && "t" in obj && Array.isArray(obj.c)
    );
  } catch {
    return false;
  }
};

/**
 * 解析逐行 JSON 的新版歌词格式
 * 每行形如 {"t":1000,"c":[{"tx":"歌词文本"}]}，t 为行时间（毫秒），
 * c 数组内各元素的 tx 拼接为行文本（li / or 等链接元数据忽略）。
 * @param content 逐行 JSON 歌词文本
 * @returns 解析后的歌词行数组（按时间排序并填充行尾时间），无有效行时返回 null
 */
const parseJsonLineLyric = (content: string): UpLyricLine[] | null => {
  const lines: UpLyricLine[] = [];
  for (const raw of content.split("\n")) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    let obj: JsonLyricLine;
    try {
      obj = JSON.parse(trimmed) as JsonLyricLine;
    } catch {
      continue;
    }
    const t = Number(obj.t);
    if (!Number.isFinite(t) || !Array.isArray(obj.c)) continue;
    const text = obj.c
      .map(
        (item) =>
          typeof item === "object" && item !== null && typeof (item as { tx?: unknown }).tx === "string"
            ? ((item as { tx: string }).tx as string)
            : "",
      )
      .join("")
      .trim();
    lines.push({
      words: text ? [{ startTime: t, endTime: 0, word: text }] : [],
      translatedLyric: "",
      romanLyric: "",
      startTime: t,
      endTime: 0,
      isBG: false,
      isDuet: false,
    });
  }
  if (lines.length === 0) return null;
  lines.sort((a, b) => a.startTime - b.startTime);
  // 行级 endTime = 下一行的 startTime，末行为 MAX_TIME（与 LRC 解析保持一致）
  for (let i = lines.length - 1; i >= 0; i--) {
    lines[i].endTime = i < lines.length - 1 ? lines[i + 1].startTime : MAX_TIME;
    const lastWord = lines[i].words[lines[i].words.length - 1];
    if (lastWord && lastWord.endTime <= lastWord.startTime) lastWord.endTime = lines[i].endTime;
  }
  return lines;
};

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
  // 逐行 JSON 新版格式优先：解析失败时回退常规格式解析
  if (isJsonLineFormat(content)) {
    const jsonLines = parseJsonLineLyric(content);
    if (jsonLines) return toAmllLines(jsonLines);
  }
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
  // 逐行 JSON 新版格式优先：主歌词命中时翻译 / 音译按同一格式解析并对齐，整体失败回退常规路径
  if (isJsonLineFormat(input.content)) {
    const jsonLines = parseJsonLineLyric(input.content);
    if (jsonLines) {
      if (input.translation) {
        pairTranslation(
          jsonLines,
          (isJsonLineFormat(input.translation) && parseJsonLineLyric(input.translation)) || [],
          "translatedLyric",
        );
      }
      if (input.romaji) {
        pairTranslation(
          jsonLines,
          (isJsonLineFormat(input.romaji) && parseJsonLineLyric(input.romaji)) || [],
          "romanLyric",
        );
      }
      return toAmllLines(jsonLines);
    }
  }
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
