/**
 * 歌曲平台维度与红心不串台判据测试 (songPlatform.ts & songLiked.ts)
 *
 * 覆盖：
 * 1. 平台判定与 platform:id 唯一复合键生成
 * 2. 跨平台同号歌曲非同一首（isSameSong 平台维度隔离）
 * 3. 本地歌曲全局可用判据
 * 4. 红心判据按平台分流与跨平台严格不串台保证
 *
 * @author Hackerdallas
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { SongType } from "../src/types/main";
import {
  AUDIOBOOK_TEXT,
  isAudiobookSong,
  isSameSong,
  isSongOfPlatform,
  resolveSongPlatform,
  toPlatformSongKey,
} from "../src/utils/songPlatform";
import {
  evaluateSongLiked,
  isSongLikedInScope,
  setLikedStoreReader,
} from "../src/utils/songLiked";

describe("平台维度基础判据 songPlatform", () => {
  const neteaseSong: SongType = {
    id: 1001,
    name: "七里香",
    artists: "周杰伦",
    album: "七里香",
    cover: "https://example.com/cover.jpg",
    duration: 299000,
    free: 0,
    mv: null,
    type: "song",
    platform: "netease",
  };

  const qqSong: SongType = {
    id: 1001, // 相同数字 ID
    name: "夜曲",
    artists: "周杰伦",
    album: "十一月的萧邦",
    cover: "https://example.com/qq.jpg",
    duration: 226000,
    free: 1,
    mv: null,
    type: "song",
    platform: "qqmusic",
    platformId: "0039MnYb0qxYAc",
  };

  const kgSong: SongType = {
    id: 1001, // 相同数字 ID
    name: "童话",
    artists: "光良",
    album: "童话",
    cover: "https://example.com/kg.jpg",
    duration: 245000,
    free: 0,
    mv: null,
    type: "song",
    platform: "kugou",
    platformId: "HASH1234567890",
  };

  it("resolveSongPlatform 正确提取平台，缺省回退为 netease", () => {
    assert.equal(resolveSongPlatform(neteaseSong), "netease");
    assert.equal(resolveSongPlatform(qqSong), "qqmusic");
    assert.equal(resolveSongPlatform(kgSong), "kugou");
    assert.equal(resolveSongPlatform({ ...neteaseSong, platform: undefined }), "netease");
    assert.equal(resolveSongPlatform(null), "netease");
  });

  it("toPlatformSongKey 生成 platform:id 唯一复合键", () => {
    assert.equal(toPlatformSongKey(neteaseSong), "netease:1001");
    assert.equal(toPlatformSongKey(qqSong), "qqmusic:1001");
    assert.equal(toPlatformSongKey(kgSong), "kugou:1001");
    assert.equal(toPlatformSongKey(null), "");
  });

  it("isSameSong 严格防止跨平台同 ID 误判为同一首", () => {
    // 跨平台同 ID 歌曲绝非同一首
    assert.equal(isSameSong(neteaseSong, qqSong), false);
    assert.equal(isSameSong(qqSong, kgSong), false);
    assert.equal(isSameSong(neteaseSong, kgSong), false);

    // 同平台且同 ID
    assert.equal(isSameSong(qqSong, { ...qqSong }), true);
    assert.equal(isSameSong(neteaseSong, { ...neteaseSong }), true);

    // ID 不同
    assert.equal(isSameSong(neteaseSong, { ...neteaseSong, id: 9999 }), false);
    assert.equal(isSameSong(null, qqSong), false);
  });

  it("isSongOfPlatform 平台归属与本地歌曲全局放行", () => {
    assert.equal(isSongOfPlatform(qqSong, "qqmusic"), true);
    assert.equal(isSongOfPlatform(qqSong, "kugou"), false);
    assert.equal(isSongOfPlatform(qqSong, "netease"), false);

    // 本地歌曲（带 path）全局可用，任何平台均放行
    const localSong: SongType = { ...neteaseSong, path: "/storage/emulated/0/Music/song.mp3" };
    assert.equal(isSongOfPlatform(localSong, "qqmusic"), true);
    assert.equal(isSongOfPlatform(localSong, "kugou"), true);
    assert.equal(isSongOfPlatform(localSong, "netease"), true);

    assert.equal(isSongOfPlatform(null, "qqmusic"), false);
  });

  it("isAudiobookSong 正确识别酷狗听书章节", () => {
    assert.equal(isAudiobookSong(kgSong), false);
    assert.equal(isAudiobookSong({ ...kgSong, mediaKind: "audiobook" }), true);
    assert.equal(isAudiobookSong(null), false);
    assert.equal(AUDIOBOOK_TEXT, "听书");
  });
});

describe("红心跨平台不串台判据 songLiked", () => {
  const qqLikedIds = new Set<number>([1001, 2002]);
  const kgLikedIds = new Set<number>([3003]);
  const neteaseLikedIds = new Set<number>([1001, 4004]); // 注意 1001 与 QQ 同号

  const mockIsPlatformLiked = (platform: string, id: number): boolean => {
    if (platform === "qqmusic") return qqLikedIds.has(id);
    if (platform === "kugou") return kgLikedIds.has(id);
    return false;
  };

  const mockIsNeteaseLiked = (id: number): boolean => neteaseLikedIds.has(id);

  it("第三方平台歌曲按该平台红心集合判定，不受其他平台同 ID 影响", () => {
    const qqSong: SongType = {
      id: 1001,
      name: "QQ歌曲",
      artists: "歌手",
      album: "专辑",
      cover: "",
      duration: 180000,
      free: 0,
      mv: null,
      type: "song",
      platform: "qqmusic",
    };

    // QQ 1001 已红心
    assert.equal(
      evaluateSongLiked(qqSong, "qqmusic", mockIsPlatformLiked, mockIsNeteaseLiked),
      true,
    );

    // QQ 3003 在酷狗里红心，但在 QQ 里未红心 -> 必须判定为未红心
    const qqSongUnliked: SongType = { ...qqSong, id: 3003 };
    assert.equal(
      evaluateSongLiked(qqSongUnliked, "qqmusic", mockIsPlatformLiked, mockIsNeteaseLiked),
      false,
    );
  });

  it("网易云歌曲仅在当前处于网易云平台时参与判据，在第三方平台界面绝不串显", () => {
    const neteaseSong: SongType = {
      id: 1001, // 网易云 1001 是红心
      name: "网易歌曲",
      artists: "歌手",
      album: "专辑",
      cover: "",
      duration: 180000,
      free: 0,
      mv: null,
      type: "song",
      platform: "netease",
    };

    // 当前在网易云平台：正常读取红心
    assert.equal(
      evaluateSongLiked(neteaseSong, "netease", mockIsPlatformLiked, mockIsNeteaseLiked),
      true,
    );

    // 核心断言：当前在 QQ 音乐或酷狗平台，网易云歌曲绝对不得判定为红心（防串显）
    assert.equal(
      evaluateSongLiked(neteaseSong, "qqmusic", mockIsPlatformLiked, mockIsNeteaseLiked),
      false,
    );
    assert.equal(
      evaluateSongLiked(neteaseSong, "kugou", mockIsPlatformLiked, mockIsNeteaseLiked),
      false,
    );
  });

  it("isSongLikedInScope 通过注入的 reader 完整验证链路", () => {
    setLikedStoreReader({
      currentPlatform: "qqmusic",
      isLikedSong: mockIsPlatformLiked,
      isNeteaseLiked: mockIsNeteaseLiked,
    });

    const qqSong: SongType = {
      id: 1001,
      name: "QQ歌",
      artists: "A",
      album: "B",
      cover: "",
      duration: 100,
      free: 0,
      mv: null,
      type: "song",
      platform: "qqmusic",
    };

    const neteaseSong: SongType = {
      id: 1001,
      name: "网易歌",
      artists: "A",
      album: "B",
      cover: "",
      duration: 100,
      free: 0,
      mv: null,
      type: "song",
      platform: "netease",
    };

    // QQ 歌曲在 QQ 视角下红心
    assert.equal(isSongLikedInScope(qqSong), true);
    // 网易歌曲在 QQ 视角下绝不红心
    assert.equal(isSongLikedInScope(neteaseSong), false);

    // 切换到网易云视角
    setLikedStoreReader({
      currentPlatform: "netease",
      isLikedSong: mockIsPlatformLiked,
      isNeteaseLiked: mockIsNeteaseLiked,
    });
    // 网易歌曲在网易视角下红心
    assert.equal(isSongLikedInScope(neteaseSong), true);

    // 清理 reader
    setLikedStoreReader(null);
  });
});
