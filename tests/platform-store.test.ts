/**
 * 音源平台 Store 状态机测试 (usePlatformStore)
 *
 * 覆盖：
 * 1. 平台切换状态机与广播 (switchPlatform, onPlatformChange)
 * 2. 账号标识追踪与变更广播 (setAccountKey, onAccountChange, invalidateAccountData)
 * 3. 红心歌曲集合装载与增删缓存 (ensureLikedSongs, setLikedSongs, patchLikedSong, isLikedSong)
 * 4. 账号资料刷新与鉴权失效处理 (refreshProfile, handleAuthExpired, A-01 规则：鉴权失效不回填旧快照)
 * 5. 平台登出与数据彻底作废 (logout)
 *
 * @author Hackerdallas
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createPinia, setActivePinia } from "pinia";
import {
  usePlatformStore,
  onPlatformChange,
  onAccountChange,
  SUPPORTED_PLATFORMS,
  THIRD_PARTY_PLATFORMS,
  type PlatformChangePayload,
  type AccountChangePayload,
} from "../src/stores/platform";
import { PlatformAuthExpiredError, setPlatformCallInterceptor } from "../src/api/platform/music";
import type { PlatformProfile } from "../src/types/shared";
import type { SongType } from "../src/types/main";

describe("音源平台 Store 状态机 platform.ts", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    setPlatformCallInterceptor(null);
  });

  describe("平台切换与事件广播 switchPlatform", () => {
    it("缺省平台为网易云 netease", () => {
      const store = usePlatformStore();
      assert.equal(store.currentPlatform, "netease");
    });

    it("切换到支持的平台成功并广播事件", () => {
      const store = usePlatformStore();
      const events: PlatformChangePayload[] = [];
      const unsub = onPlatformChange((payload) => {
        events.push(payload);
      });

      const changed1 = store.switchPlatform("qqmusic");
      assert.equal(changed1, true);
      assert.equal(store.currentPlatform, "qqmusic");
      assert.equal(events.length, 1);
      assert.deepEqual(events[0], { platform: "qqmusic", previous: "netease" });

      const changed2 = store.switchPlatform("kugou");
      assert.equal(changed2, true);
      assert.equal(store.currentPlatform, "kugou");
      assert.equal(events.length, 2);
      assert.deepEqual(events[1], { platform: "kugou", previous: "qqmusic" });

      unsub();

      // 取消订阅后不再接收事件
      store.switchPlatform("netease");
      assert.equal(events.length, 2);
    });

    it("切换到相同平台返回 false 且不重复广播", () => {
      const store = usePlatformStore();
      const events: PlatformChangePayload[] = [];
      const unsub = onPlatformChange((payload) => events.push(payload));

      const res = store.switchPlatform("netease");
      assert.equal(res, false);
      assert.equal(events.length, 0);

      unsub();
    });

    it("切换到未知平台被拒绝并返回 false", () => {
      const store = usePlatformStore();
      // @ts-expect-error 测试未知平台非法入参
      const res = store.switchPlatform("unknown_platform");
      assert.equal(res, false);
      assert.equal(store.currentPlatform, "netease");
    });
  });

  describe("账号标识与数据作废 setAccountKey / invalidateAccountData", () => {
    it("设置相同账号标识不触发作废与广播", () => {
      const store = usePlatformStore();
      store.accountKeys.qqmusic = "uin_12345";
      const events: AccountChangePayload[] = [];
      const unsub = onAccountChange((e) => events.push(e));

      store.setAccountKey("qqmusic", "uin_12345");
      assert.equal(events.length, 0);

      unsub();
    });

    it("账号标识变更时广播事件并作废旧账号红心与歌单数据", () => {
      const store = usePlatformStore();
      store.currentPlatform = "qqmusic";
      store.accountKeys.qqmusic = "uin_12345";
      store.likedSongIds.qqmusic = new Set([101, 102]);
      store.playlists = {
        owned: [{ id: 1, name: "旧歌单", count: 10 }],
        favorites: [],
      };

      const events: AccountChangePayload[] = [];
      const unsub = onAccountChange((e) => events.push(e));

      store.setAccountKey("qqmusic", "uin_67890");

      assert.equal(store.accountKeys.qqmusic, "uin_67890");
      assert.equal(store.likedSongIds.qqmusic, undefined);
      assert.deepEqual(store.playlists, { owned: [], favorites: [] });
      assert.equal(events.length, 1);
      assert.deepEqual(events[0], {
        platform: "qqmusic",
        accountKey: "uin_67890",
        previousAccountKey: "uin_12345",
        loggedIn: true,
      });

      unsub();
    });
  });

  describe("红心歌曲集合与判据 setLikedSongs / patchLikedSong / isLikedSong", () => {
    it("网易云歌曲红心判据恒返回 false（由网易云自身体系维护）", () => {
      const store = usePlatformStore();
      assert.equal(store.isLikedSong("netease", 999), false);
    });

    it("第三方平台正确装载、查询与增删红心歌曲", () => {
      const store = usePlatformStore();
      assert.equal(store.isLikedSong("qqmusic", 97773), false);

      const fakeTracks: SongType[] = [
        { id: 97773, name: "晴天", artists: "周杰伦", album: "叶惠美", cover: "", duration: 269000, free: 0, mv: null, type: "song" },
        { id: 88888, name: "七里香", artists: "周杰伦", album: "七里香", cover: "", duration: 300000, free: 0, mv: null, type: "song" },
      ];

      store.setLikedSongs("qqmusic", fakeTracks);
      assert.equal(store.isLikedSong("qqmusic", 97773), true);
      assert.equal(store.isLikedSong("qqmusic", 88888), true);
      assert.equal(store.isLikedSong("qqmusic", 12345), false);
      // 跨平台隔离：酷狗同号歌曲不受 QQ 影响
      assert.equal(store.isLikedSong("kugou", 97773), false);

      // 增量打补丁：移除 97773，新增 12345
      store.patchLikedSong("qqmusic", 97773, false);
      assert.equal(store.isLikedSong("qqmusic", 97773), false);

      store.patchLikedSong("qqmusic", 12345, true);
      assert.equal(store.isLikedSong("qqmusic", 12345), true);

      // 作废缓存
      store.invalidateLikedSongs("qqmusic");
      assert.equal(store.likedSongIds.qqmusic, undefined);
      assert.equal(store.isLikedSong("qqmusic", 12345), false);
    });
  });

  describe("鉴权失效处理与登出 handleAuthExpired / logout (A-01规则)", () => {
    it("handleAuthExpired：清空资料、标记 authExpired、作废账号数据并广播未登录（不回填旧快照）", () => {
      const store = usePlatformStore();
      store.platformProfiles.qqmusic = {
        userId: "3049793667",
        nickname: "测试用户",
        avatar: "https://example.com/avatar.jpg",
      };
      store.accountKeys.qqmusic = "3049793667";
      store.likedSongIds.qqmusic = new Set([101, 102]);

      const events: AccountChangePayload[] = [];
      const unsub = onAccountChange((e) => events.push(e));

      store.handleAuthExpired("qqmusic");

      // A-01 核心校验：资料清空，标记失效，绝对不回填旧快照
      assert.equal(store.authExpired.qqmusic, true);
      assert.equal(store.platformProfiles.qqmusic, null);
      assert.equal(store.accountKeys.qqmusic, undefined);
      assert.equal(store.likedSongIds.qqmusic, undefined);

      assert.equal(events.length, 1);
      assert.deepEqual(events[0], {
        platform: "qqmusic",
        accountKey: "",
        previousAccountKey: "3049793667",
        loggedIn: false,
      });

      unsub();
    });

    it("logout：登出第三方平台清空会话与资料并广播", async () => {
      const store = usePlatformStore();
      store.platformProfiles.kugou = {
        userId: "1123056595",
        nickname: "酷狗测试",
        avatar: "https://example.com/kg.jpg",
      };
      store.accountKeys.kugou = "1123056595";
      store.likedSongIds.kugou = new Set([201, 202]);

      const events: AccountChangePayload[] = [];
      const unsub = onAccountChange((e) => events.push(e));

      await store.logout("kugou");

      assert.equal(store.platformProfiles.kugou, null);
      assert.equal(store.accountKeys.kugou, undefined);
      assert.equal(store.likedSongIds.kugou, undefined);

      assert.equal(events.length, 1);
      assert.deepEqual(events[0], {
        platform: "kugou",
        accountKey: "",
        previousAccountKey: "1123056595",
        loggedIn: false,
      });

      unsub();
    });

    it("网易云 logout 走网易云自身链路，此处直接静默返回", async () => {
      const store = usePlatformStore();
      const events: AccountChangePayload[] = [];
      const unsub = onAccountChange((e) => events.push(e));

      await store.logout("netease");
      assert.equal(events.length, 0);

      unsub();
    });
  });

  describe("桩件驱动数据装载 refreshProfile / ensureLikedSongs / refreshPlaylists", () => {
    it("refreshProfile：装载 QQ 音乐资料并更新 accountKey 与广播变更", async () => {
      const store = usePlatformStore();
      const events: AccountChangePayload[] = [];
      const unsub = onAccountChange((e) => events.push(e));

      setPlatformCallInterceptor((platform, name) => {
        if (platform === "qqmusic" && name === "user_detail") {
          return {
            code: 0,
            loggedIn: true,
            profile: {
              userId: "3049793667",
              nickname: "QQ测试号",
              avatar: "https://example.com/avatar.png",
            },
          };
        }
        if (platform === "qqmusic" && name === "user_liked_songs") {
          return {
            songs: [
              { id: 97773, name: "晴天" },
              { id: 88888, name: "七里香" },
            ],
          };
        }
        return undefined;
      });

      const profile = await store.refreshProfile("qqmusic");
      assert.notEqual(profile, null);
      assert.equal(profile?.userId, "3049793667");
      assert.equal(profile?.nickname, "QQ测试号");
      assert.equal(store.accountKeys.qqmusic, "3049793667");
      assert.equal(store.authExpired.qqmusic, false);

      assert.equal(events.length, 1);
      assert.deepEqual(events[0], {
        platform: "qqmusic",
        accountKey: "3049793667",
        previousAccountKey: "",
        loggedIn: true,
      });

      unsub();
    });

    it("refreshProfile：接口抛出 PlatformAuthExpiredError 时触发 handleAuthExpired（A-01规则不回填旧快照）", async () => {
      const store = usePlatformStore();
      store.platformProfiles.qqmusic = {
        userId: "3049793667",
        nickname: "旧快照",
        avatar: "",
      };
      store.accountKeys.qqmusic = "3049793667";

      setPlatformCallInterceptor((platform, name) => {
        if (name === "user_detail") {
          throw new PlatformAuthExpiredError(platform, "登录失效", 1000, 1000);
        }
        return undefined;
      });

      const profile = await store.refreshProfile("qqmusic");
      assert.equal(profile, null);
      // 必须清空资料并置失效标记，绝不回填旧快照
      assert.equal(store.platformProfiles.qqmusic, null);
      assert.equal(store.accountKeys.qqmusic, undefined);
      assert.equal(store.authExpired.qqmusic, true);
    });

    it("refreshProfile：接口返回 code 401 时按鉴权失效处理", async () => {
      const store = usePlatformStore();
      store.platformProfiles.kugou = {
        userId: "1123056595",
        nickname: "酷狗旧快照",
        avatar: "",
      };
      store.accountKeys.kugou = "1123056595";

      setPlatformCallInterceptor((platform, name) => {
        if (name === "user_detail") {
          return { code: 401, loggedIn: false };
        }
        return undefined;
      });

      const profile = await store.refreshProfile("kugou");
      assert.equal(profile, null);
      assert.equal(store.platformProfiles.kugou, null);
      assert.equal(store.authExpired.kugou, true);
    });

    it("ensureLikedSongs：并发调用共享同一次请求并写入 likedSongIds", async () => {
      const store = usePlatformStore();
      let callCount = 0;

      setPlatformCallInterceptor((platform, name) => {
        if (name === "user_playlist_list") {
          callCount++;
          return {
            owned: [{ tid: 1001, dirId: 201, dirName: "我喜欢", songNum: 2 }],
            favorites: [],
          };
        }
        if (name === "playlist_detail") {
          return {
            tid: 1001,
            name: "我喜欢",
            cover: "https://example.com/cover.jpg",
            creator: { name: "本人" },
            total: 2,
            songs: [
              { id: 101, name: "曲目1" },
              { id: 102, name: "曲目2" },
            ],
          };
        }
        return undefined;
      });

      // 并发两次请求
      const [ids1, ids2] = await Promise.all([
        store.ensureLikedSongs("qqmusic"),
        store.ensureLikedSongs("qqmusic"),
      ]);

      assert.equal(callCount, 1);
      assert.equal(ids1.has(101), true);
      assert.equal(ids2.has(102), true);
      assert.equal(store.isLikedSong("qqmusic", 101), true);
      assert.equal(store.isLikedSong("qqmusic", 999), false);
    });

    it("refreshPlaylists：正确装载自建与收藏歌单列表", async () => {
      const store = usePlatformStore();

      setPlatformCallInterceptor((platform, name) => {
        if (name === "user_playlist_list") {
          return {
            owned: [{ tid: 1001, dirId: 1, dirName: "我创建的歌单", songNum: 5 }],
            favorites: [{ tid: 2002, dirId: 2, dirName: "我收藏的歌单", songNum: 10 }],
          };
        }
        return undefined;
      });

      const lists = await store.refreshPlaylists("qqmusic");
      assert.equal(lists.owned.length, 1);
      assert.equal(lists.owned[0].name, "我创建的歌单");
      assert.equal(lists.favorites.length, 1);
      assert.equal(lists.favorites[0].name, "我收藏的歌单");
    });
  });
});
