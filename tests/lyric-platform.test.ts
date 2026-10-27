/**
 * 平台歌词链单测 (LyricManager.ts)
 *
 * 覆盖：
 * 1. QQ 音乐 QRC 逐字歌词解析（含翻译 LRC 对齐、音译 QRC 对齐）
 * 2. 酷狗 KRC 逐字歌词解析（含翻译 / 音译 LRC 对齐）
 * 3. 平台歌词路由（QQ 歌曲走 qqLyric、酷狗歌曲走 kgLyric，含 duration 秒换算与 hash 大写）
 * 4. 过期请求丢弃（请求序号变化 / 当前播放歌曲变化时不产生歌词数据）
 *
 * node 环境无法加载 @applemusic-like-lyrics/lyric（wasm ESM 入口），
 * 在加载被测模块前先注册解析钩子指向测试桩，因此被测模块均为动态导入。
 */

import "./helpers/setup";
import { register } from "node:module";
import type { PlatformCallInterceptor } from "../src/api/platform/music";
import type { SongType } from "../src/types/main";

register(new URL("./helpers/amll-resolve-hook.mjs", import.meta.url));

const { describe, it, beforeEach, afterEach } = await import("node:test");
const assert: typeof import("node:assert/strict") = (
  await import("node:assert/strict")
).default;
const { createPinia, setActivePinia } = await import("pinia");
const { useLyricManager } = await import("../src/core/player/LyricManager");
const { useMusicStore } = await import("../src/stores");
const { setPlatformCallInterceptor } = await import("../src/api/platform/music");

/** 构造一首平台在线歌曲 */
const buildPlatformSong = (overrides: Partial<SongType>): SongType => ({
  id: 97773,
  name: "晴天",
  artists: "周杰伦",
  album: "叶惠美",
  cover: "",
  duration: 269000,
  free: 0,
  mv: null,
  type: "song",
  ...overrides,
});

/** QRC 主歌词样本：行 [100,3000]，逐字「喂 你 好」 */
const QRC_MAIN = "[100,3000]喂(100,500) 你(600,500)好(1100,1900)";
/** QRC 翻译（LRC 格式，起始时间与主行一致） */
const QRC_TRANS = "[00:00.100]Hello there";
/** QRC 音译（QRC 格式，起始时间与主行一致） */
const QRC_ROMA = "[100,3000]wei(100,500) ni(600,500)hao(1100,1900)";
/** KRC 主歌词样本：行起始 1 分 1.5 秒，逐字「素 颜」 */
const KRC_MAIN = "[00:01.500]<0,300>素<300,300>颜<600,400>";
/** KRC 翻译 / 音译（LRC 格式，起始时间与主行一致） */
const KRC_TRANS = "[00:01.500]Plain Face";
const KRC_ROMA = "[00:01.500]Su Yan";

describe("平台歌词链 lyric-platform", () => {
  let lyricManager: ReturnType<typeof useLyricManager>;

  beforeEach(async () => {
    setActivePinia(createPinia());
    lyricManager = useLyricManager();
    setPlatformCallInterceptor(null);
  });

  afterEach(() => {
    setPlatformCallInterceptor(null);
  });

  describe("QRC 逐字歌词解析 parseQRCLyric", () => {
    it("解析出行与逐字时间", () => {
      const lines = lyricManager["parseQRCLyric"](QRC_MAIN);
      assert.equal(lines.length, 1);
      assert.equal(lines[0].startTime, 100);
      assert.equal(lines[0].endTime, 3100);
      assert.equal(
        lines[0].words.map((w) => w.word).join(""),
        "喂 你好",
      );
      assert.equal(lines[0].words[0].startTime, 100);
      assert.equal(lines[0].words[0].endTime, 600);
      assert.equal(lines[0].words[2].endTime, 3000);
    });

    it("翻译行对齐到主行 translatedLyric", () => {
      const lines = lyricManager["parseQRCLyric"](QRC_MAIN, QRC_TRANS);
      assert.equal(lines[0].translatedLyric, "Hello there");
    });

    it("音译 QRC 行合并为整行并对齐到主行 romanLyric", () => {
      const lines = lyricManager["parseQRCLyric"](QRC_MAIN, undefined, QRC_ROMA);
      assert.equal(lines[0].romanLyric, "wei nihao");
    });

    it("元数据标签行被跳过", () => {
      const content = ["[ti:晴天]", "[ar:周杰伦]", QRC_MAIN].join("\n");
      const lines = lyricManager["parseQRCLyric"](content);
      assert.equal(lines.length, 1);
      assert.equal(lines[0].startTime, 100);
    });
  });

  describe("KRC 逐字歌词解析 parseKRCLyric", () => {
    it("解析出行与逐字时间（行首时间为基准加相对偏移）", () => {
      const lines = lyricManager["parseKRCLyric"](KRC_MAIN);
      assert.equal(lines.length, 1);
      assert.equal(lines[0].startTime, 1500);
      assert.equal(
        lines[0].words.map((w) => w.word).join(""),
        "素颜",
      );
      assert.equal(lines[0].words[0].startTime, 1500);
      assert.equal(lines[0].words[0].endTime, 1800);
      assert.equal(lines[0].words[1].startTime, 1800);
      assert.equal(lines[0].endTime, 2100);
    });

    it("翻译行对齐到主行 translatedLyric", () => {
      const lines = lyricManager["parseKRCLyric"](KRC_MAIN, KRC_TRANS);
      assert.equal(lines[0].translatedLyric, "Plain Face");
    });

    it("音译行对齐到主行 romanLyric", () => {
      const lines = lyricManager["parseKRCLyric"](KRC_MAIN, undefined, KRC_ROMA);
      assert.equal(lines[0].romanLyric, "Su Yan");
    });

    it("版权占位翻译行被过滤不对齐", () => {
      const trans = "[00:01.500]//\n[00:01.500]此歌词未经过作品的著作权方授权";
      const lines = lyricManager["parseKRCLyric"](KRC_MAIN, trans);
      assert.equal(lines[0].translatedLyric, "");
    });
  });

  describe("平台歌词路由 handlePlatformLyric", () => {
    const calls: Array<{ platform: string; name: string; params: Record<string, unknown> }> = [];

    /** 拦截平台调用并记录入参，按平台返回原生歌词形状 */
    const intercept: PlatformCallInterceptor = (platform, name, params) => {
      calls.push({ platform, name, params: params ?? {} });
      if (platform === "qqmusic") {
        return { code: 200, lrc: "[00:00.100]qrc lrc", qrc: QRC_MAIN, trans: QRC_TRANS, roma: "" };
      }
      return { code: 200, lrc: "[00:01.500]krc lrc", krc: KRC_MAIN, trans: KRC_TRANS, roma: "" };
    };

    beforeEach(() => {
      calls.length = 0;
    });

    it("QQ 音乐歌曲走 qqLyric（qqmusic/lyric），duration 换算为秒", async () => {
      const song = buildPlatformSong({ platform: "qqmusic", platformId: "0039MnYb0qxYhV" });
      useMusicStore().playSong = song;
      lyricManager["activeLyricReq"] = 1;
      setPlatformCallInterceptor(intercept);

      const result = await lyricManager["handlePlatformLyric"](song);

      assert.equal(calls.length, 1);
      assert.equal(calls[0].platform, "qqmusic");
      assert.equal(calls[0].name, "lyric");
      assert.equal(calls[0].params.duration, 269);
      // QRC 逐字歌词优先
      assert.equal(result.yrcData.length, 1);
      assert.equal(result.yrcData[0].words.map((w) => w.word).join(""), "喂 你好");
      assert.equal(result.yrcData[0].translatedLyric, "Hello there");
      assert.equal(result.lrcData.length, 0);
    });

    it("酷狗音乐歌曲走 kgLyric（kugou/lyric），hash 取 platformId 并大写", async () => {
      const song = buildPlatformSong({
        name: "素颜",
        duration: 238000,
        platform: "kugou",
        platformId: "30c94ae2868e63b1058da7685e0cdf3b",
      });
      useMusicStore().playSong = song;
      lyricManager["activeLyricReq"] = 1;
      setPlatformCallInterceptor(intercept);

      const result = await lyricManager["handlePlatformLyric"](song);

      assert.equal(calls.length, 1);
      assert.equal(calls[0].platform, "kugou");
      assert.equal(calls[0].name, "lyric");
      assert.equal(calls[0].params.hash, "30C94AE2868E63B1058DA7685E0CDF3B");
      assert.equal(calls[0].params.duration, 238);
      // KRC 逐字歌词优先
      assert.equal(result.yrcData.length, 1);
      assert.equal(result.yrcData[0].words.map((w) => w.word).join(""), "素颜");
      assert.equal(result.yrcData[0].translatedLyric, "Plain Face");
      assert.equal(result.lrcData.length, 0);
    });

    it("无逐字歌词时回落行级歌词并对齐翻译", async () => {
      const song = buildPlatformSong({ platform: "qqmusic", platformId: "0039MnYb0qxYhV" });
      useMusicStore().playSong = song;
      lyricManager["activeLyricReq"] = 1;
      setPlatformCallInterceptor(() => ({
        code: 200,
        lrc: "[00:00.100]plain line",
        qrc: "",
        trans: QRC_TRANS,
        roma: "",
      }));

      const result = await lyricManager["handlePlatformLyric"](song);

      assert.equal(result.yrcData.length, 0);
      assert.equal(result.lrcData.length, 1);
      assert.equal(result.lrcData[0].words.map((w) => w.word).join(""), "plain line");
      assert.equal(result.lrcData[0].translatedLyric, "Hello there");
    });
  });

  describe("过期请求丢弃", () => {
    it("当前播放歌曲变化时丢弃返回结果", async () => {
      const song = buildPlatformSong({ platform: "qqmusic", platformId: "0039MnYb0qxYhV" });
      const otherSong = buildPlatformSong({ id: 99999 });
      useMusicStore().playSong = otherSong;
      lyricManager["activeLyricReq"] = 1;
      setPlatformCallInterceptor(() => ({ code: 200, qrc: QRC_MAIN }));

      const result = await lyricManager["handlePlatformLyric"](song);

      assert.equal(result.yrcData.length, 0);
      assert.equal(result.lrcData.length, 0);
    });

    it("请求序号变化时丢弃返回结果", async () => {
      const song = buildPlatformSong({ platform: "qqmusic", platformId: "0039MnYb0qxYhV" });
      useMusicStore().playSong = song;
      lyricManager["activeLyricReq"] = 1;
      setPlatformCallInterceptor(() => {
        // 接口返回前切歌导致序号递增，模拟过期
        lyricManager["activeLyricReq"] = 2;
        return { code: 200, qrc: QRC_MAIN };
      });

      const result = await lyricManager["handlePlatformLyric"](song);

      assert.equal(result.yrcData.length, 0);
      assert.equal(result.lrcData.length, 0);
    });

    it("平台接口异常时不抛出并返回空歌词", async () => {
      const song = buildPlatformSong({ platform: "qqmusic", platformId: "0039MnYb0qxYhV" });
      useMusicStore().playSong = song;
      lyricManager["activeLyricReq"] = 1;
      setPlatformCallInterceptor(() => {
        throw new Error("network down");
      });

      const result = await lyricManager["handlePlatformLyric"](song);

      assert.equal(result.yrcData.length, 0);
      assert.equal(result.lrcData.length, 0);
    });
  });
});
