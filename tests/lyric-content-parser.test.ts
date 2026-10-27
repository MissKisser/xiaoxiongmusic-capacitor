/**
 * 歌词内容解析测试 (contentParser.ts)
 *
 * 覆盖：标准 LRC 文本解析、逐行 JSON 新版格式（{"t":ms,"c":[{"tx":"..."}]}）解析，
 * 以及 JSON 格式解析失败时回退常规 LRC 路径的行为。
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parseLyricContent, parseLyricWithTranslation } from "../src/utils/lyric/contentParser";

describe("标准 LRC 歌词解析", () => {
  const lrc = [
    "[00:01.000]第一句歌词",
    "[00:05.500]第二句歌词",
    "[00:10.250]第三句歌词",
  ].join("\n");

  it("解析出行数与行时间", () => {
    const lines = parseLyricContent(lrc);
    assert.equal(lines.length, 3);
    assert.equal(lines[0].startTime, 1000);
    assert.equal(lines[1].startTime, 5500);
    assert.equal(lines[2].startTime, 10250);
  });

  it("解析出行文本与行尾时间", () => {
    const lines = parseLyricContent(lrc);
    assert.equal(lines[0].words.map((w) => w.word).join(""), "第一句歌词");
    assert.equal(lines[0].endTime, 5500);
    assert.equal(lines[2].endTime, 60039999);
  });
});

describe("逐行 JSON 新版歌词解析", () => {
  const jsonLines = [
    '{"t":1000,"c":[{"tx":""},{"tx":"第一句歌词"}]}',
    '{"t":4000,"c":[{"tx":"第二句歌词"}]}',
    '{"t":9000,"c":[{"or":"link"},{"tx":"第三句歌词"}]}',
    '{"t":12000,"c":[{"li":"meta"},{"tx":"第四句歌词"}]}',
  ].join("\n");

  it("解析出行数、毫秒时间与文本拼接", () => {
    const lines = parseLyricContent(jsonLines);
    assert.equal(lines.length, 4);
    assert.equal(lines[0].startTime, 1000);
    assert.equal(lines[1].startTime, 4000);
    assert.equal(lines[2].startTime, 9000);
    assert.equal(lines[3].startTime, 12000);
    assert.equal(lines[0].words.map((w) => w.word).join(""), "第一句歌词");
    assert.equal(lines[1].words.map((w) => w.word).join(""), "第二句歌词");
    assert.equal(lines[2].words.map((w) => w.word).join(""), "第三句歌词");
    assert.equal(lines[3].words.map((w) => w.word).join(""), "第四句歌词");
  });

  it("显式指定 lrc 格式时同样命中 JSON 分支", () => {
    const lines = parseLyricContent(jsonLines, "lrc");
    assert.equal(lines.length, 4);
    assert.equal(lines[0].startTime, 1000);
  });

  it("行尾时间取下一行起始时间", () => {
    const lines = parseLyricContent(jsonLines);
    assert.equal(lines[0].endTime, 4000);
    assert.equal(lines[2].endTime, 12000);
  });

  it("翻译 / 音译按同一格式解析并对齐", () => {
    const translation = [
      '{"t":1000,"c":[{"tx":"first line"}]}',
      '{"t":4000,"c":[{"tx":"second line"}]}',
    ].join("\n");
    const lines = parseLyricWithTranslation({
      content: jsonLines,
      translation,
    });
    assert.equal(lines.length, 4);
    assert.equal(lines[0].translatedLyric, "first line");
    assert.equal(lines[1].translatedLyric, "second line");
  });

  it("JSON 整体解析失败时回退 LRC 路径", () => {
    const broken = '{"t":1000,"c":[';
    const lines = parseLyricContent(broken, "lrc");
    assert.equal(lines.length, 0);
  });
});
