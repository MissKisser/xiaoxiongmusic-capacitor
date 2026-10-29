/**
 * 播放决策树与优先级测试 (playbackDecision.ts, unlockPriority.ts, unlockUrlCache.ts)
 *
 * 覆盖：
 * 1. 播放决策树四步骤排布（官方直链 → 试听裁定 → 换源解锁 → 本地缓存）
 * 2. 解锁换源优先于试听（解锁能拿完整曲目，试听仅有 60 秒）
 * 3. 各平台换源优先级分派与 A-05 铁律（第三方平台严禁包含网易云数字 ID 直查源）
 * 4. 换源直链内存缓存 TTL 与淘汰机制
 *
 * @author Hackerdallas
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPinia, setActivePinia } from "pinia";
import "./helpers/setup";
import { planPlayback, type PlaybackDecisionInput } from "../src/core/player/playbackDecision";
import { getUnlockPriority, getPlatformLabel } from "../src/utils/unlockPriority";
import { UnlockUrlCache, UNLOCKED_URL_TTL_MS } from "../src/utils/unlockUrlCache";
import { SongUnlockServer } from "../src/types/shared";
import { getUnlockSourceName, SONG_UNLOCK_PRIORITY } from "../src/core/player/SongManager";
import { useSettingStore } from "../src/stores/setting";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("播放决策树与换源优先级", () => {
  describe("播放决策树 planPlayback", () => {
    it("官方完整可用直链：命中 official，后接 unlock 与 cache", () => {
      const input: PlaybackDecisionInput = {
        hasOfficialUrl: true,
        isTrial: false,
        canUnlock: true,
        playSongDemo: false,
      };
      const steps = planPlayback(input);
      assert.deepEqual(steps, ["official", "unlock", "cache"]);
    });

    it("官方仅试听且开启换源与试听：解锁优先于试听 (SPEC P0-4 对齐)", () => {
      const input: PlaybackDecisionInput = {
        hasOfficialUrl: true,
        isTrial: true,
        canUnlock: true,
        playSongDemo: true,
      };
      const steps = planPlayback(input);
      // 解锁优先于试听，试听作为解锁失败后的兜底
      assert.deepEqual(steps, ["unlock", "trial", "cache"]);
    });

    it("官方仅试听但关闭试听开关：不包含 trial 步骤", () => {
      const input: PlaybackDecisionInput = {
        hasOfficialUrl: true,
        isTrial: true,
        canUnlock: true,
        playSongDemo: false,
      };
      const steps = planPlayback(input);
      assert.deepEqual(steps, ["unlock", "cache"]);
    });

    it("官方仅试听且关闭换源功能：若开启试听，回落 trial", () => {
      const input: PlaybackDecisionInput = {
        hasOfficialUrl: true,
        isTrial: true,
        canUnlock: false,
        playSongDemo: true,
      };
      const steps = planPlayback(input);
      assert.deepEqual(steps, ["trial", "cache"]);
    });

    it("官方无直链且开启换源：进入 unlock，兜底 cache", () => {
      const input: PlaybackDecisionInput = {
        hasOfficialUrl: false,
        isTrial: false,
        canUnlock: true,
        playSongDemo: true,
      };
      const steps = planPlayback(input);
      assert.deepEqual(steps, ["unlock", "cache"]);
    });

    it("官方无直链且关闭换源：仅有本地缓存 cache", () => {
      const input: PlaybackDecisionInput = {
        hasOfficialUrl: false,
        isTrial: false,
        canUnlock: false,
        playSongDemo: true,
      };
      const steps = planPlayback(input);
      assert.deepEqual(steps, ["cache"]);
    });
  });

  describe("平台换源优先级分派 unlockPriority (A-05 铁律)", () => {
    it("网易云歌曲以 XINGHAI 为第一首选", () => {
      const priority = getUnlockPriority("netease");
      assert.equal(priority[0], SongUnlockServer.XINGHAI);
      assert.equal(getPlatformLabel("netease"), "网易云");
    });

    it("QQ 歌曲以 FISH 为第一首选，酷狗歌曲以 JIEXIANG 为第一首选", () => {
      assert.equal(getUnlockPriority("qqmusic")[0], SongUnlockServer.FISH);
      assert.equal(getUnlockPriority("kugou")[0], SongUnlockServer.JIEXIANG);
      assert.equal(getPlatformLabel("qqmusic"), "QQ 音乐");
      assert.equal(getPlatformLabel("kugou"), "酷狗音乐");
    });

    it("三个平台按实测可用性锁定的链位全序（与 PC 端同构）", () => {
      const neteasePriority = getUnlockPriority("netease");
      const qqPriority = getUnlockPriority("qqmusic");
      const kgPriority = getUnlockPriority("kugou");

      // 第三方平台歌曲对 NETEASE 源走关键词寻址（useKeywordLookup），不拿平台数字 ID 直查，
      // 故 NETEASE 可入 QQ/酷狗链（A-05 禁的是数字 ID 直查，不是源入链）
      // 网易云链零触碰：星海仍在首位
      assert.deepEqual(neteasePriority, [
        SongUnlockServer.XINGHAI,
        SongUnlockServer.NETEASE,
        SongUnlockServer.MIGU,
        SongUnlockServer.CHANGQING,
        SongUnlockServer.KUWO,
        SongUnlockServer.BODIAN,
        SongUnlockServer.GEQUBAO,
      ]);
      // QQ 链首位插小鱼，其余顺序保持原样
      assert.deepEqual(qqPriority, [
        SongUnlockServer.FISH,
        SongUnlockServer.CHANGQING,
        SongUnlockServer.MIGU,
        SongUnlockServer.NETEASE,
        SongUnlockServer.LXMUSIC,
        SongUnlockServer.BODIAN,
        SongUnlockServer.KUWO,
        SongUnlockServer.GEQUBAO,
      ]);
      // 酷狗链首位插吉祥，其余顺序与 QQ 链同构
      assert.deepEqual(kgPriority, [
        SongUnlockServer.JIEXIANG,
        SongUnlockServer.CHANGQING,
        SongUnlockServer.MIGU,
        SongUnlockServer.NETEASE,
        SongUnlockServer.LXMUSIC,
        SongUnlockServer.BODIAN,
        SongUnlockServer.KUWO,
        SongUnlockServer.GEQUBAO,
      ]);
      // 歌曲宝是社区公益源，置于各平台链位末位，仅在其余源全部落空时兜底
      assert.equal(neteasePriority.at(-1), SongUnlockServer.GEQUBAO);
      assert.equal(qqPriority.at(-1), SongUnlockServer.GEQUBAO);
      assert.equal(kgPriority.at(-1), SongUnlockServer.GEQUBAO);
      // 网易云链不含新源，避免误用于网易云曲库
      assert.equal(neteasePriority.includes(SongUnlockServer.FISH), false);
      assert.equal(neteasePriority.includes(SongUnlockServer.JIEXIANG), false);
    });
  });

  describe("换源直链内存缓存 UnlockUrlCache", () => {
    it("存取有效直链条目", () => {
      const cache = new UnlockUrlCache();
      const now = 1000000;
      cache.set("qqmusic-97773", {
        url: "https://example.com/audio.mp3",
        quality: "320k",
        unlockSource: "bodian",
      }, now);

      const entry = cache.get("qqmusic-97773", now + 1000);
      assert.notEqual(entry, null);
      assert.equal(entry?.url, "https://example.com/audio.mp3");
      assert.equal(entry?.unlockSource, "bodian");
    });

    it("超出 TTL 自动失效并删除", () => {
      const cache = new UnlockUrlCache(60000); // 1分钟
      const now = 1000000;
      cache.set("kugou-12345", {
        url: "https://example.com/audio2.mp3",
        unlockSource: "kuwo",
      }, now);

      assert.notEqual(cache.get("kugou-12345", now + 30000), null);
      // 60秒后过期
      assert.equal(cache.get("kugou-12345", now + 60001), null);
    });

    it("超出最大条数上限时淘汰最早过期的条目", () => {
      const cache = new UnlockUrlCache(10000, 2); // 上限 2 条
      const now = 1000000;
      cache.set("key1", { url: "http://1.mp3", unlockSource: "s1" }, now);
      cache.set("key2", { url: "http://2.mp3", unlockSource: "s2" }, now + 1000);
      assert.equal(cache.size, 2);

      // 插入第 3 条，淘汰最早过期的 key1
      cache.set("key3", { url: "http://3.mp3", unlockSource: "s3" }, now + 2000);
      assert.equal(cache.size, 2);
      assert.equal(cache.get("key1", now + 2000), null);
      assert.notEqual(cache.get("key2", now + 2000), null);
      assert.notEqual(cache.get("key3", now + 2000), null);
    });
  });

  describe("星海音源统一定义断言", () => {
    it("星海音源源名映射与基线优先级", () => {
      assert.equal(getUnlockSourceName(SongUnlockServer.XINGHAI), "星海音源");
      assert.equal(SONG_UNLOCK_PRIORITY[0], SongUnlockServer.XINGHAI);
    });

    it("设置项默认包含星海音源且默认启用", () => {
      setActivePinia(createPinia());
      const settingStore = useSettingStore();
      const xinghai = settingStore.songUnlockServer.find(
        (s) => s.key === SongUnlockServer.XINGHAI,
      );
      assert.ok(xinghai, "默认换源清单应包含星海音源");
      assert.equal(xinghai.enabled, true, "星海音源应默认启用");
    });

    it("设置页组件包含星海音源标签定义", () => {
      const vueContent = readFileSync(
        path.join(repoRoot, "src/components/Modal/Setting/SongUnlockManager.vue"),
        "utf8",
      );
      assert.ok(
        vueContent.includes("星海音源（社区公益源，网易云曲库）"),
        "设置页组件应声明星海音源专属标签",
      );
      assert.ok(
        vueContent.includes("SongUnlockServer.XINGHAI"),
        "设置页组件应注册 XINGHAI 枚举项",
      );
    });
  });

  describe("小鱼音源与吉祥音源统一定义断言", () => {
    it("源名映射为小鱼音源与吉祥音源", () => {
      assert.equal(getUnlockSourceName(SongUnlockServer.FISH), "小鱼音源");
      assert.equal(getUnlockSourceName(SongUnlockServer.JIEXIANG), "吉祥音源");
    });

    it("设置项默认包含两源且默认启用", () => {
      setActivePinia(createPinia());
      const settingStore = useSettingStore();
      const fish = settingStore.songUnlockServer.find(
        (s) => s.key === SongUnlockServer.FISH,
      );
      const jiexiang = settingStore.songUnlockServer.find(
        (s) => s.key === SongUnlockServer.JIEXIANG,
      );
      assert.ok(fish, "默认换源清单应包含小鱼音源");
      assert.equal(fish.enabled, true, "小鱼音源应默认启用");
      assert.ok(jiexiang, "默认换源清单应包含吉祥音源");
      assert.equal(jiexiang.enabled, true, "吉祥音源应默认启用");
    });

    it("设置页组件包含两源标签定义", () => {
      const vueContent = readFileSync(
        path.join(repoRoot, "src/components/Modal/Setting/SongUnlockManager.vue"),
        "utf8",
      );
      assert.ok(
        vueContent.includes("小鱼音源（社区公益源，QQ 曲库）"),
        "设置页组件应声明小鱼音源专属标签",
      );
      assert.ok(
        vueContent.includes("吉祥音源（社区公益源，酷狗曲库）"),
        "设置页组件应声明吉祥音源专属标签",
      );
      assert.ok(
        vueContent.includes("SongUnlockServer.FISH"),
        "设置页组件应注册 FISH 枚举项",
      );
      assert.ok(
        vueContent.includes("SongUnlockServer.JIEXIANG"),
        "设置页组件应注册 JIEXIANG 枚举项",
      );
    });

    it("两源均不出现在网易云链内", () => {
      const neteasePriority = getUnlockPriority("netease");
      assert.equal(neteasePriority.includes(SongUnlockServer.FISH), false);
      assert.equal(neteasePriority.includes(SongUnlockServer.JIEXIANG), false);
      assert.equal(neteasePriority[0], SongUnlockServer.XINGHAI);
    });
  });
});
