/**
 * 平台作用域状态仓库测试 (platformScope.ts)
 *
 * 覆盖：
 * 1. 播放历史按平台分桶隔离 (recordHistory, currentHistory, clearHistory)
 * 2. 跨平台同数字 ID 曲目在播放历史中互不顶替
 * 3. 切换平台时运行时状态作废 (resetPlatformScopedState)
 * 4. 跨平台持久化状态丢弃校验 (discardForeignPersistedState)
 *
 * @author Hackerdallas
 */

import "./helpers/setup";
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createPinia, setActivePinia } from "pinia";
import { usePlatformScopeStore } from "../src/stores/platformScope";
import { usePlatformStore } from "../src/stores/platform";
import { useDataStore } from "../src/stores/data";
import { useMusicStore } from "../src/stores/music";
import { useStatusStore } from "../src/stores/status";
import type { SongType } from "../src/types/main";

describe("平台作用域状态仓库 platformScope.ts", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  describe("播放历史按平台分桶 recordHistory / currentHistory / clearHistory", () => {
    it("播放历史按歌曲所属平台分别落入对应桶", async () => {
      const scopeStore = usePlatformScopeStore();
      const platformStore = usePlatformStore();
      scopeStore.historyLoaded = true; // 避免打桩环境触发 localforage 读盘

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
        // netease 无 platform 标记
      };

      await scopeStore.recordHistory(qqSong);
      await scopeStore.recordHistory(kgSong);
      await scopeStore.recordHistory(neteaseSong);

      // 当前平台为 netease
      platformStore.currentPlatform = "netease";
      assert.equal(scopeStore.currentHistory.length, 1);
      assert.equal(scopeStore.currentHistory[0].id, 186016);

      // 切到 qqmusic
      platformStore.currentPlatform = "qqmusic";
      assert.equal(scopeStore.currentHistory.length, 1);
      assert.equal(scopeStore.currentHistory[0].id, 97773);

      // 切到 kugou
      platformStore.currentPlatform = "kugou";
      assert.equal(scopeStore.currentHistory.length, 1);
      assert.equal(scopeStore.currentHistory[0].id, 12345);
    });

    it("跨平台同数字 ID 曲目在播放历史中独立分桶，互不顶替", async () => {
      const scopeStore = usePlatformScopeStore();
      scopeStore.historyLoaded = true;

      const qqSong: SongType = {
        id: 10001,
        name: "QQ音乐同号歌",
        artists: "歌手A",
        album: "专辑A",
        cover: "",
        duration: 200000,
        free: 0,
        mv: null,
        type: "song",
        platform: "qqmusic",
      };

      const kgSong: SongType = {
        id: 10001,
        name: "酷狗同号歌",
        artists: "歌手B",
        album: "专辑B",
        cover: "",
        duration: 180000,
        free: 0,
        mv: null,
        type: "song",
        platform: "kugou",
      };

      await scopeStore.recordHistory(qqSong);
      await scopeStore.recordHistory(kgSong);

      assert.equal(scopeStore.historyByPlatform.qqmusic.length, 1);
      assert.equal(scopeStore.historyByPlatform.qqmusic[0].name, "QQ音乐同号歌");

      assert.equal(scopeStore.historyByPlatform.kugou.length, 1);
      assert.equal(scopeStore.historyByPlatform.kugou[0].name, "酷狗同号歌");
    });

    it("清空历史只清空指定平台，其余平台历史不受影响", async () => {
      const scopeStore = usePlatformScopeStore();
      const platformStore = usePlatformStore();
      scopeStore.historyLoaded = true;

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

      await scopeStore.recordHistory(qqSong);
      await scopeStore.recordHistory(kgSong);

      platformStore.currentPlatform = "qqmusic";
      await scopeStore.clearHistory(); // 缺省清空当前平台

      assert.equal(scopeStore.historyByPlatform.qqmusic, undefined);
      assert.equal(scopeStore.historyByPlatform.kugou.length, 1);
    });
  });

  describe("平台切换时状态重置 resetPlatformScopedState", () => {
    it("重置状态时清空播放队列、播放中歌曲、重置播放进度", async () => {
      const scopeStore = usePlatformScopeStore();
      const dataStore = useDataStore();
      const musicStore = useMusicStore();
      const statusStore = useStatusStore();

      dataStore.playList = [
        { id: 97773, name: "晴天", artists: "周杰伦", album: "叶惠美", cover: "", duration: 269000, free: 0, mv: null, type: "song" },
      ];
      musicStore.playSong = {
        id: 97773,
        name: "晴天",
        artists: "周杰伦",
        album: "叶惠美",
        cover: "",
        duration: 269000,
        free: 0,
        mv: null,
        type: "song",
      };
      statusStore.playStatus = true;
      statusStore.currentTime = 120;
      statusStore.duration = 269;
      statusStore.shuffleMode = "heartbeat";

      scopeStore.resetPlatformScopedState();

      assert.deepEqual(dataStore.playList, []);
      assert.equal(musicStore.playSong.id, 0);
      assert.equal(statusStore.currentTime, 0);
      assert.equal(statusStore.duration, 0);
      assert.equal(statusStore.playStatus, false);
      // 网易云专属心动模式退出
      assert.equal(statusStore.shuffleMode, "off");
    });
  });

  describe("异平台持久化数据校验与丢弃 discardForeignPersistedState", () => {
    it("当前平台为 kugou 时，队列中的 qqmusic 歌曲被整体清空", async () => {
      const scopeStore = usePlatformScopeStore();
      const platformStore = usePlatformStore();
      const dataStore = useDataStore();

      platformStore.currentPlatform = "kugou";
      dataStore.playList = [
        { id: 97773, name: "晴天", artists: "周杰伦", album: "叶惠美", cover: "", duration: 269000, free: 0, mv: null, type: "song", platform: "qqmusic" },
      ];

      await scopeStore.discardForeignPersistedState();
      assert.deepEqual(dataStore.playList, []);
    });

    it("当前平台为 qqmusic 时，播放中的 kugou 歌曲被重置", async () => {
      const scopeStore = usePlatformScopeStore();
      const platformStore = usePlatformStore();
      const musicStore = useMusicStore();
      const statusStore = useStatusStore();

      platformStore.currentPlatform = "qqmusic";
      musicStore.playSong = {
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
      statusStore.playStatus = true;

      await scopeStore.discardForeignPersistedState();
      assert.equal(musicStore.playSong.id, 0);
      assert.equal(statusStore.currentTime, 0);
    });

    it("本地歌曲（含 path）全局放行，不触发队列丢弃", async () => {
      const scopeStore = usePlatformScopeStore();
      const platformStore = usePlatformStore();
      const dataStore = useDataStore();

      platformStore.currentPlatform = "qqmusic";
      dataStore.playList = [
        { id: 100, name: "本地歌曲", artists: "本地歌手", album: "本地", cover: "", duration: 180000, free: 0, mv: null, type: "song", path: "/sdcard/Music/test.mp3" },
      ];

      await scopeStore.discardForeignPersistedState();
      assert.equal(dataStore.playList.length, 1);
    });
  });
});
