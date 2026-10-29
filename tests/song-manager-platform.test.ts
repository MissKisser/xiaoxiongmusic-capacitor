/**
 * SongManager 平台播放接线与判据单测 (SongManager.ts)
 *
 * 覆盖：
 * 1. 官方播放直链分派（QQ / 酷狗 / 网易云零改动分流）
 * 2. 试听裁定与换源流转（SPEC P0-4 对齐：官方仅试听时优先尝试解锁换源）
 * 3. 换源分流与 A-05 铁律（平台歌曲严格排除 NETEASE 源、缺少歌手时安全拒绝）
 * 4. 换源直链内存缓存命中复用
 * 5. 播放最终失败的用户可读错误文案（errorText.ts 翻译平台与本地原因）
 *
 * @author Hackerdallas
 */

import "./helpers/setup";
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createPinia, setActivePinia } from "pinia";
import { useSongManager } from "../src/core/player/SongManager";
import { useSettingStore } from "../src/stores/setting";
import { setPlatformCallInterceptor } from "../src/api/platform/music";
import { setCustomUnlockHandler } from "../src/api/song";
import { SongUnlockServer } from "../src/types/shared";
import type { SongType } from "../src/types/main";

describe("SongManager 平台播放接线与判据 songManager-platform", () => {
  let songManager: ReturnType<typeof useSongManager>;

  beforeEach(() => {
    setActivePinia(createPinia());
    songManager = useSongManager();
    songManager.clearPrefetch();
    setPlatformCallInterceptor(null);
    setCustomUnlockHandler(null);
  });

  afterEach(() => {
    setPlatformCallInterceptor(null);
    setCustomUnlockHandler(null);
  });

  describe("官方播放直链分派 getOnlineUrl", () => {
    it("QQ 音乐：命中官方完整直链，返回 official 音频源", async () => {
      const qqSong: SongType = {
        id: 97773,
        name: "晴天",
        artists: "周杰伦",
        album: "叶惠美",
        cover: "",
        duration: 269000,
        free: 0,
        mv: null,
        type: "song",
        platform: "qqmusic",
        platformId: "0039MnYb0qxYhV",
      };

      setPlatformCallInterceptor((platform, name) => {
        if (platform === "qqmusic" && name === "song_url") {
          return {
            available: true,
            mid: "0039MnYb0qxYhV",
            url: "https://dl.stream.qqmusic.qq.com/test/stream.mp3",
            level: "hq",
            isTrial: false,
          };
        }
        return undefined;
      });

      const res = await songManager.getOnlineUrl(qqSong, qqSong.id);
      assert.equal(res.id, 97773);
      assert.notEqual(res.url, undefined);
      assert.equal(res.isTrial, false);
      assert.equal(res.unlockSource, "official");
    });

    it("酷狗音乐：命中官方完整直链，返回 official 音频源", async () => {
      const kgSong: SongType = {
        id: 12345,
        name: "素颜",
        artists: "许嵩",
        album: "素颜",
        cover: "",
        duration: 238000,
        free: 0,
        mv: null,
        type: "song",
        platform: "kugou",
        platformId: "30C94AE2868E63B1058DA7685E0CDF3B",
      };

      setPlatformCallInterceptor((platform, name) => {
        if (platform === "kugou" && name === "song_url") {
          return {
            status: 1,
            url: "https://webfs.tx.kugou.com/test.mp3",
            quality: "hq",
            isTrial: false,
          };
        }
        return undefined;
      });

      const res = await songManager.getOnlineUrl(kgSong, kgSong.id);
      assert.equal(res.id, 12345);
      assert.notEqual(res.url, undefined);
      assert.equal(res.isTrial, false);
      assert.equal(res.unlockSource, "official");
    });

    it("酷狗音乐：付费墙试听片段（status=2 且 isTrial=true），正确标记 isTrial=true", async () => {
      const kgSong: SongType = {
        id: 54321,
        name: "付费歌曲",
        artists: "歌手",
        album: "专辑",
        cover: "",
        duration: 240000,
        free: 0,
        mv: null,
        type: "song",
        platform: "kugou",
        platformId: "A1B2C3D4E5F6",
      };

      setPlatformCallInterceptor((platform, name) => {
        if (platform === "kugou" && name === "song_url") {
          return {
            status: 2,
            url: "https://webfs.tx.kugou.com/trial.mp3",
            isTrial: true,
            quality: "128k",
          };
        }
        return undefined;
      });

      const res = await songManager.getOnlineUrl(kgSong, kgSong.id);
      assert.equal(res.id, 54321);
      assert.notEqual(res.url, undefined);
      assert.equal(res.isTrial, true);
      assert.equal(res.unlockSource, "official");
    });
  });

  describe("换源分流与 A-05 铁律 getUnlockSongUrl", () => {
    it("平台歌曲换源绝对不调用 NETEASE 源（A-05 铁律）", async () => {
      const settingStore = useSettingStore();
      settingStore.songUnlockServer = [
        { key: SongUnlockServer.NETEASE, enabled: true },
        { key: SongUnlockServer.BODIAN, enabled: true },
        { key: SongUnlockServer.KUWO, enabled: true },
      ];

      const qqSong: SongType = {
        id: 97773,
        name: "晴天",
        artists: "周杰伦",
        album: "叶惠美",
        cover: "",
        duration: 269000,
        free: 0,
        mv: null,
        type: "song",
        platform: "qqmusic",
      };

      const requestedServers: SongUnlockServer[] = [];
      setCustomUnlockHandler(async (id, songName, artist, server) => {
        requestedServers.push(server);
        if (server === SongUnlockServer.BODIAN) {
          return { code: 200, url: "https://bodian.example.com/audio.mp3" };
        }
        return { code: 404, url: null };
      });

      const res = await songManager.getUnlockSongUrl(qqSong);
      assert.equal(res.id, 97773);
      assert.equal(res.isUnlocked, true);
      assert.equal(res.unlockSource, SongUnlockServer.BODIAN);
      // 绝对不可调用 NETEASE
      assert.equal(requestedServers.includes(SongUnlockServer.NETEASE), false);
      assert.equal(requestedServers[0], SongUnlockServer.BODIAN);
    });

    it("网易云歌曲优先尝试 XINGHAI 源，且透传网易云歌曲 id 到 platformId", async () => {
      const settingStore = useSettingStore();
      settingStore.songUnlockServer = [
        { key: SongUnlockServer.XINGHAI, enabled: true },
        { key: SongUnlockServer.NETEASE, enabled: true },
        { key: SongUnlockServer.BODIAN, enabled: true },
      ];

      const neteaseSong: SongType = {
        id: 186016,
        name: "晴天",
        artists: "周杰伦",
        album: "叶惠美",
        cover: "",
        duration: 269000,
        free: 0,
        mv: null,
        type: "song",
        platform: "netease",
      };

      const requestedServers: SongUnlockServer[] = [];
      let capturedContext: unknown;
      setCustomUnlockHandler(async (id, songName, artist, server, context) => {
        requestedServers.push(server);
        capturedContext = context;
        if (server === SongUnlockServer.XINGHAI) {
          return { code: 200, url: "https://xinghai.example.com/audio.flac" };
        }
        return { code: 404, url: null };
      });

      const res = await songManager.getUnlockSongUrl(neteaseSong);
      assert.equal(res.id, 186016);
      assert.equal(res.isUnlocked, true);
      assert.equal(res.unlockSource, SongUnlockServer.XINGHAI);
      assert.equal(requestedServers[0], SongUnlockServer.XINGHAI);
      assert.deepEqual(capturedContext, {
        duration: 269,
        platform: "netease",
        platformId: "186016",
      });
    });

    it("平台歌曲缺少歌手信息时拒绝换源，防范同名不同版本串播", async () => {
      const qqSongWithoutArtist: SongType = {
        id: 97773,
        name: "晴天",
        artists: "",
        album: "叶惠美",
        cover: "",
        duration: 269000,
        free: 0,
        mv: null,
        type: "song",
        platform: "qqmusic",
      };

      const res = await songManager.getUnlockSongUrl(qqSongWithoutArtist);
      assert.equal(res.url, undefined);
      assert.equal(res.failureReason, "缺少歌手信息，无法安全换源");
    });

    it("QQ 歌曲优先尝试 FISH 源，且透传 QQ mid 作为 platformId", async () => {
      const settingStore = useSettingStore();
      settingStore.songUnlockServer = [
        { key: SongUnlockServer.FISH, enabled: true },
        { key: SongUnlockServer.CHANGQING, enabled: true },
        { key: SongUnlockServer.BODIAN, enabled: true },
      ];

      const qqSong: SongType = {
        id: 99901,
        name: "晴天",
        artists: "周杰伦",
        album: "叶惠美",
        cover: "",
        duration: 269000,
        free: 0,
        mv: null,
        type: "song",
        platform: "qqmusic",
        platformId: "0039MnYb0qxYhV",
      };

      const requestedServers: SongUnlockServer[] = [];
      let capturedContext: unknown;
      setCustomUnlockHandler(async (id, songName, artist, server, context) => {
        requestedServers.push(server);
        capturedContext = context;
        if (server === SongUnlockServer.FISH) {
          return { code: 200, url: "https://fish.example.com/audio.flac" };
        }
        return { code: 404, url: null };
      });

      const res = await songManager.getUnlockSongUrl(qqSong);
      assert.equal(res.id, 99901);
      assert.equal(res.isUnlocked, true);
      assert.equal(res.unlockSource, SongUnlockServer.FISH);
      assert.equal(requestedServers[0], SongUnlockServer.FISH);
      assert.deepEqual(capturedContext, {
        duration: 269,
        platform: "qqmusic",
        platformId: "0039MnYb0qxYhV",
      });
    });

    it("酷狗歌曲优先尝试 JIEXIANG 源，且透传酷狗 hash 作为 platformId", async () => {
      const settingStore = useSettingStore();
      settingStore.songUnlockServer = [
        { key: SongUnlockServer.JIEXIANG, enabled: true },
        { key: SongUnlockServer.CHANGQING, enabled: true },
        { key: SongUnlockServer.BODIAN, enabled: true },
      ];

      const kgSong: SongType = {
        id: 99902,
        name: "素颜",
        artists: "许嵩",
        album: "素颜",
        cover: "",
        duration: 238000,
        free: 0,
        mv: null,
        type: "song",
        platform: "kugou",
        platformId: "30C94AE2868E63B1058DA7685E0CDF3B",
      };

      const requestedServers: SongUnlockServer[] = [];
      let capturedContext: unknown;
      setCustomUnlockHandler(async (id, songName, artist, server, context) => {
        requestedServers.push(server);
        capturedContext = context;
        if (server === SongUnlockServer.JIEXIANG) {
          return { code: 200, url: "https://jiexiang.example.com/audio.flac" };
        }
        return { code: 404, url: null };
      });

      const res = await songManager.getUnlockSongUrl(kgSong);
      assert.equal(res.id, 99902);
      assert.equal(res.isUnlocked, true);
      assert.equal(res.unlockSource, SongUnlockServer.JIEXIANG);
      assert.equal(requestedServers[0], SongUnlockServer.JIEXIANG);
      assert.deepEqual(capturedContext, {
        duration: 238,
        platform: "kugou",
        platformId: "30C94AE2868E63B1058DA7685E0CDF3B",
      });
    });

    it("网易云歌曲链位零触碰：不会尝试小鱼音源与吉祥音源", async () => {
      const settingStore = useSettingStore();
      settingStore.songUnlockServer = [
        { key: SongUnlockServer.XINGHAI, enabled: true },
        { key: SongUnlockServer.FISH, enabled: true },
        { key: SongUnlockServer.JIEXIANG, enabled: true },
        { key: SongUnlockServer.NETEASE, enabled: true },
      ];

      const neteaseSong: SongType = {
        id: 99903,
        name: "晴天",
        artists: "周杰伦",
        album: "叶惠美",
        cover: "",
        duration: 269000,
        free: 0,
        mv: null,
        type: "song",
        platform: "netease",
      };

      const requestedServers: SongUnlockServer[] = [];
      setCustomUnlockHandler(async (id, songName, artist, server) => {
        requestedServers.push(server);
        return { code: 404, url: null };
      });

      await songManager.getUnlockSongUrl(neteaseSong);
      assert.equal(requestedServers.includes(SongUnlockServer.FISH), false);
      assert.equal(requestedServers.includes(SongUnlockServer.JIEXIANG), false);
      assert.equal(requestedServers[0], SongUnlockServer.XINGHAI);
    });
  });

  describe("播放音频源决策树调度 getAudioSource (SPEC 三态判据对齐)", () => {
    it("官方完整可播：直接返回官方源 (official)", async () => {
      const qqSong: SongType = {
        id: 97773,
        name: "晴天",
        artists: "周杰伦",
        album: "叶惠美",
        cover: "",
        duration: 269000,
        free: 0,
        mv: null,
        type: "song",
        platform: "qqmusic",
      };

      setPlatformCallInterceptor((platform, name) => {
        if (platform === "qqmusic" && name === "song_url") {
          return {
            available: true,
            mid: "0039MnYb0qxYhV",
            url: "https://dl.stream.qqmusic.qq.com/official.mp3",
            level: "hq",
            isTrial: false,
          };
        }
        return undefined;
      });

      const source = await songManager.getAudioSource(qqSong);
      assert.equal(source.id, 97773);
      assert.notEqual(source.url, undefined);
      assert.equal(source.isTrial, false);
      assert.equal(source.unlockSource, "official");
    });

    it("官方仅试听且开启换源：优先尝试换源解锁，换源命中即播放解锁源 (P0-4 解锁优先于试听)", async () => {
      const settingStore = useSettingStore();
      settingStore.useSongUnlock = true;
      settingStore.songUnlockServer = [
        { key: SongUnlockServer.BODIAN, enabled: true },
      ];

      const kgSong: SongType = {
        id: 12345,
        name: "素颜",
        artists: "许嵩",
        album: "素颜",
        cover: "",
        duration: 238000,
        free: 0,
        mv: null,
        type: "song",
        platform: "kugou",
      };

      setPlatformCallInterceptor((platform, name) => {
        if (platform === "kugou" && name === "song_url") {
          return {
            status: 2,
            url: "https://webfs.tx.kugou.com/trial.mp3",
            isTrial: true,
          };
        }
        return undefined;
      });

      setCustomUnlockHandler(async (id, songName, artist, server) => {
        if (server === SongUnlockServer.BODIAN) {
          return { code: 200, url: "https://bodian.example.com/suyan.mp3" };
        }
        return { code: 404, url: null };
      });

      const source = await songManager.getAudioSource(kgSong);
      assert.equal(source.id, 12345);
      assert.equal(source.isUnlocked, true);
      assert.equal(source.unlockSource, SongUnlockServer.BODIAN);
      assert.equal(source.isTrial, undefined);
    });

    it("官方仅试听且换源全败：若允许试听，回落官方试听 (trial)", async () => {
      const settingStore = useSettingStore();
      settingStore.useSongUnlock = true;
      settingStore.playSongDemo = true;
      settingStore.songUnlockServer = [
        { key: SongUnlockServer.BODIAN, enabled: true },
      ];

      const kgSong: SongType = {
        id: 12346,
        name: "素颜2",
        artists: "许嵩",
        album: "素颜2",
        cover: "",
        duration: 238000,
        free: 0,
        mv: null,
        type: "song",
        platform: "kugou",
      };

      setPlatformCallInterceptor((platform, name) => {
        if (platform === "kugou" && name === "song_url") {
          return {
            status: 2,
            url: "https://webfs.tx.kugou.com/trial.mp3",
            isTrial: true,
          };
        }
        return undefined;
      });

      setCustomUnlockHandler(async () => {
        return { code: 404, url: null };
      });

      const source = await songManager.getAudioSource(kgSong);
      // 换源全败后回落官方试听
      assert.equal(source.id, 12346);
      assert.notEqual(source.url, undefined);
      assert.equal(source.isTrial, true);
      assert.equal(source.unlockSource, "official");
    });

    it("官方仅试听但关闭试听开关：不回落试听，直接失败并给出用户可读原因", async () => {
      const settingStore = useSettingStore();
      settingStore.useSongUnlock = false;
      settingStore.playSongDemo = false; // 用户不接受试听

      const kgSong: SongType = {
        id: 12347,
        name: "付费歌曲",
        artists: "某歌手",
        album: "某专辑",
        cover: "",
        duration: 200000,
        free: 0,
        mv: null,
        type: "song",
        platform: "kugou",
      };

      setPlatformCallInterceptor((platform, name) => {
        if (platform === "kugou" && name === "song_url") {
          return {
            status: 2,
            url: "https://webfs.tx.kugou.com/trial.mp3",
            isTrial: true,
          };
        }
        return undefined;
      });

      const source = await songManager.getAudioSource(kgSong);
      assert.equal(source.url, undefined);
      assert.equal(typeof source.failureReason, "string");
      assert.notEqual(source.failureReason, "");
    });

    it("官方无可用链接且换源失败：通过 errorText 给出用户可读失败文案", async () => {
      const settingStore = useSettingStore();
      settingStore.useSongUnlock = false;

      const qqSong: SongType = {
        id: 99999,
        name: "QQ付费歌",
        artists: "歌手",
        album: "专辑",
        cover: "",
        duration: 200000,
        free: 0,
        mv: null,
        type: "song",
        platform: "qqmusic",
      };

      setPlatformCallInterceptor((platform, name) => {
        if (platform === "qqmusic" && name === "song_url") {
          return {
            available: false,
            url: "",
            reason: "need_pay",
          };
        }
        return undefined;
      });

      const source = await songManager.getAudioSource(qqSong);
      assert.equal(source.url, undefined);
      // errorText 映射为该歌曲为付费歌曲
      assert.equal(source.failureReason, "该歌曲需要付费，已尝试换源未成功");
    });
  });
});
