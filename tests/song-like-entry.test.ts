/**
 * 喜欢（红心）统一入口的路由测试 (songLike.ts)
 *
 * 覆盖：
 * 1. 第三方平台歌曲未登录 -> 引导登录且不发起任何写入
 * 2. 第三方平台歌曲已登录 -> 调用平台写入，并按结果给出成功或失败提示
 * 3. 网易云歌曲 -> 走既有红心链路，不调用平台写入
 * 4. liked 缺省时按当前状态取反，显式传入时以传入值为准
 *
 * @author Hackerdallas
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { SongType } from "../src/types/main";
import type { ApiPlatform } from "../src/types/shared";
import {
  setSongLikeDependencies,
  toggleSongLike,
  type SongLikeDependencies,
} from "../src/utils/songLike";

/** 记录调用过程的桩集合 */
interface Recorder {
  deps: SongLikeDependencies;
  /** 平台写入调用记录 */
  likeSongCalls: Array<{ platform: ApiPlatform; song: SongType; liked: boolean }>;
  /** 网易云写入调用记录 */
  toLikeSongCalls: Array<{ song: SongType; liked: boolean }>;
  /** 登录引导记录 */
  loginPrompts: ApiPlatform[];
  /** 提示记录 */
  messages: Array<{ type: "success" | "error"; message: string }>;
}

/**
 * 构造带记录的依赖桩
 * @param options 桩行为配置
 */
const createRecorder = (options?: {
  loggedIn?: boolean;
  liked?: boolean;
  writeOk?: boolean;
  writeMessage?: string;
}): Recorder => {
  const recorder: Recorder = {
    likeSongCalls: [],
    toLikeSongCalls: [],
    loginPrompts: [],
    messages: [],
    deps: null as unknown as SongLikeDependencies,
  };
  recorder.deps = {
    isPlatformLoggedIn: () => options?.loggedIn ?? true,
    likeSong: async (platform, song, liked) => {
      recorder.likeSongCalls.push({ platform, song, liked });
      return { ok: options?.writeOk ?? true, message: options?.writeMessage };
    },
    toLikeSong: async (song, liked) => {
      recorder.toLikeSongCalls.push({ song, liked });
    },
    promptPlatformLogin: (platform) => {
      recorder.loginPrompts.push(platform);
    },
    isLiked: () => options?.liked ?? false,
    onSuccess: (message) => {
      recorder.messages.push({ type: "success", message });
    },
    onError: (message) => {
      recorder.messages.push({ type: "error", message });
    },
  };
  return recorder;
};

/** 构造一首指定平台的歌曲 */
const createSong = (platform: ApiPlatform, id = 1001): SongType => ({
  id,
  name: "测试歌曲",
  artists: "测试歌手",
  album: "测试专辑",
  cover: "",
  duration: 180000,
  free: 0,
  mv: null,
  type: "song",
  platform,
});

describe("喜欢统一入口 songLike", () => {
  it("第三方平台未登录时引导登录，且不发起任何写入", async () => {
    const recorder = createRecorder({ loggedIn: false });
    setSongLikeDependencies(recorder.deps);

    await toggleSongLike(createSong("kugou"));

    assert.deepEqual(recorder.loginPrompts, ["kugou"]);
    assert.equal(recorder.likeSongCalls.length, 0);
    assert.equal(recorder.toLikeSongCalls.length, 0);
    assert.equal(recorder.messages.length, 0);

    setSongLikeDependencies(null);
  });

  it("第三方平台已登录时写入平台红心，并给出成功提示", async () => {
    const recorder = createRecorder({ loggedIn: true, liked: false });
    setSongLikeDependencies(recorder.deps);

    const song = createSong("qqmusic");
    await toggleSongLike(song);

    assert.equal(recorder.likeSongCalls.length, 1);
    assert.equal(recorder.likeSongCalls[0].platform, "qqmusic");
    assert.equal(recorder.likeSongCalls[0].song, song);
    // 当前未红心 -> 取反后为「喜欢」
    assert.equal(recorder.likeSongCalls[0].liked, true);
    assert.equal(recorder.toLikeSongCalls.length, 0);
    assert.deepEqual(recorder.messages, [{ type: "success", message: "已添加到我喜欢的音乐" }]);

    setSongLikeDependencies(null);
  });

  it("当前已红心时默认取反为取消喜欢", async () => {
    const recorder = createRecorder({ loggedIn: true, liked: true });
    setSongLikeDependencies(recorder.deps);

    await toggleSongLike(createSong("kugou"));

    assert.equal(recorder.likeSongCalls.length, 1);
    assert.equal(recorder.likeSongCalls[0].liked, false);
    assert.deepEqual(recorder.messages, [{ type: "success", message: "已取消喜欢" }]);

    setSongLikeDependencies(null);
  });

  it("显式传入 liked 时以传入值为准，不做取反", async () => {
    const recorder = createRecorder({ loggedIn: true, liked: true });
    setSongLikeDependencies(recorder.deps);

    await toggleSongLike(createSong("kugou"), true);

    assert.equal(recorder.likeSongCalls.length, 1);
    assert.equal(recorder.likeSongCalls[0].liked, true);
    assert.deepEqual(recorder.messages, [{ type: "success", message: "已添加到我喜欢的音乐" }]);

    setSongLikeDependencies(null);
  });

  it("平台写入失败时给出失败提示且不报成功", async () => {
    const recorder = createRecorder({
      loggedIn: true,
      writeOk: false,
      writeMessage: "写入失败",
    });
    setSongLikeDependencies(recorder.deps);

    await toggleSongLike(createSong("qqmusic"));

    assert.equal(recorder.likeSongCalls.length, 1);
    assert.deepEqual(recorder.messages, [{ type: "error", message: "写入失败" }]);

    setSongLikeDependencies(null);
  });

  it("平台写入失败且无提示文案时给出兜底文案", async () => {
    const recorder = createRecorder({ loggedIn: true, writeOk: false });
    setSongLikeDependencies(recorder.deps);

    await toggleSongLike(createSong("qqmusic"));

    assert.deepEqual(recorder.messages, [{ type: "error", message: "操作失败，请重试" }]);

    setSongLikeDependencies(null);
  });

  it("网易云歌曲走既有红心链路，不调用平台写入", async () => {
    const recorder = createRecorder({ loggedIn: false, liked: false });
    setSongLikeDependencies(recorder.deps);

    const song = createSong("netease");
    await toggleSongLike(song);

    assert.equal(recorder.toLikeSongCalls.length, 1);
    assert.equal(recorder.toLikeSongCalls[0].song, song);
    assert.equal(recorder.toLikeSongCalls[0].liked, true);
    assert.equal(recorder.likeSongCalls.length, 0);
    // 网易云未登录的提示由既有链路给出，入口不干预
    assert.equal(recorder.loginPrompts.length, 0);
    assert.equal(recorder.messages.length, 0);

    setSongLikeDependencies(null);
  });

  it("网易云歌曲显式传入 liked 时透传给既有链路", async () => {
    const recorder = createRecorder({ loggedIn: true, liked: true });
    setSongLikeDependencies(recorder.deps);

    await toggleSongLike(createSong("netease"), false);

    assert.equal(recorder.toLikeSongCalls.length, 1);
    assert.equal(recorder.toLikeSongCalls[0].liked, false);
    assert.equal(recorder.likeSongCalls.length, 0);

    setSongLikeDependencies(null);
  });

  it("未装配依赖时拒绝执行，避免静默吞掉写入", async () => {
    setSongLikeDependencies(null);
    await assert.rejects(() => toggleSongLike(createSong("kugou")), /喜欢动作依赖未初始化/);
  });
});
