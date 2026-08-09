/**
 * 歌词类型转换适配层
 *
 * Based on SPlayer-Next
 * Copyright (C) 2024 SPlayer-Dev
 * Licensed under AGPL-3.0
 *
 * 本端存在两套 `LyricLine`：
 *  - `@/types/lyrics`（upstream 移植，词级含 obscene/ruby，行级含 language）
 *  - `@applemusic-like-lyrics/lyric`（AMLL，现有渲染/存储层使用）
 *
 * 两套结构高度一致（words/translatedLyric/romanLyric/isBG/isDuet/startTime/endTime），
 * 仅 upstream 多出若干可选字段。本模块负责双向无损转换，供解析器与渲染层桥接。
 */
import type { LyricLine as UpLyricLine, LyricWord as UpLyricWord } from "@/types/lyrics";
import type { LyricLine as AmllLyricLine, LyricWord as AmllLyricWord } from "@applemusic-like-lyrics/lyric";

/** upstream 单词 → AMLL 单词 */
export const toAmllWord = (word: UpLyricWord): AmllLyricWord => ({
  startTime: word.startTime,
  endTime: word.endTime,
  word: word.word,
  romanWord: word.romanWord,
});

/** AMLL 单词 → upstream 单词 */
export const toUpstreamWord = (word: AmllLyricWord): UpLyricWord => ({
  startTime: word.startTime,
  endTime: word.endTime,
  word: word.word,
  romanWord: word.romanWord,
});

/** upstream 行 → AMLL 行 */
export const toAmllLine = (line: UpLyricLine): AmllLyricLine => ({
  words: line.words.map(toAmllWord),
  translatedLyric: line.translatedLyric,
  romanLyric: line.romanLyric,
  isBG: line.isBG,
  isDuet: line.isDuet,
  startTime: line.startTime,
  endTime: line.endTime,
});

/** AMLL 行 → upstream 行 */
export const toUpstreamLine = (line: AmllLyricLine): UpLyricLine => ({
  words: line.words.map(toUpstreamWord),
  translatedLyric: line.translatedLyric,
  romanLyric: line.romanLyric,
  isBG: line.isBG,
  isDuet: line.isDuet,
  startTime: line.startTime,
  endTime: line.endTime,
});

/** upstream 行数组 → AMLL 行数组 */
export const toAmllLines = (lines: UpLyricLine[]): AmllLyricLine[] => lines.map(toAmllLine);

/** AMLL 行数组 → upstream 行数组 */
export const toUpstreamLines = (lines: AmllLyricLine[]): UpLyricLine[] => lines.map(toUpstreamLine);
