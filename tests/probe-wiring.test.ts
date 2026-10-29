/**
 * 换源探活上报接线单测 (SongManager.ts)
 *
 * 覆盖四块接线判据：
 * 1. 换源成功：上报「源 / 成败 / 耗时 / 失败类别」四字段，且不含歌名
 * 2. 换源失败：上报失败样本，失败类别取失败原因
 * 3. 取链异常：超时归入 timeout 类别
 * 4. 设置开关：关闭「匿名上报音源可用性」后完全不上报
 *
 * 上报请求用桩件替换全局 fetch：只验证请求形状，不发起真实网络请求。
 */

import "./helpers/setup";
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createPinia, setActivePinia } from "pinia";
import { useSongManager } from "../src/core/player/SongManager";
import { useSettingStore } from "../src/stores/setting";
import { setCustomUnlockHandler } from "../src/api/song";
import { SongUnlockServer } from "../src/types/shared";
import type { SongType } from "@/types/main";

/** 记录到的上报请求 */
type CapturedRequest = { url: string; body?: string };

/** fetch 桩件状态 */
const captured: CapturedRequest[] = [];

/** 原始 fetch 引用 */
const originalFetch = globalThis.fetch;

/** 替换全局 fetch 为记录型桩件 */
const installFetchStub = (): void => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    captured.push({
      url: String(input),
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    return { ok: true, status: 200 } as Response;
  }) as typeof globalThis.fetch;
};

/** 等待上报请求写出（上报为异步发出） */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

/** 构造一首 QQ 音乐歌曲（平台歌曲不参与网易云数字 ID 直查） */
const makeSong = (id: number): SongType => ({
  id,
  name: "晴天",
  artists: "周杰伦",
  album: "叶惠美",
  cover: "",
  duration: 269000,
  free: 0,
  mv: null,
  type: "song",
  platform: "qqmusic",
});

describe("换源探活上报接线 probeWiring", () => {
  let songManager: ReturnType<typeof useSongManager>;

  beforeEach(() => {
    setActivePinia(createPinia());
    captured.length = 0;
    installFetchStub();
    songManager = useSongManager();
    songManager.clearPrefetch();
    setCustomUnlockHandler(null);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    setCustomUnlockHandler(null);
  });

  it("换源成功：上报四字段载荷，不含歌名与身份信息", async () => {
    const settingStore = useSettingStore();
    settingStore.songUnlockServer = [{ key: SongUnlockServer.BODIAN, enabled: true }];
    setCustomUnlockHandler(async () => ({
      code: 200,
      url: "https://bodian.example.com/audio.mp3",
    }));

    await songManager.getUnlockSongUrl(makeSong(90001));
    await flush();

    assert.equal(captured.length, 1);
    const payload = JSON.parse(captured[0].body ?? "{}");
    assert.deepEqual(Object.keys(payload).sort(), [
      "durationMs",
      "failCategory",
      "source",
      "success",
    ]);
    assert.equal(payload.source, "bodian");
    assert.equal(payload.success, true);
    assert.equal(payload.failCategory, "none");
    assert.equal(typeof payload.durationMs, "number");
    // 载荷里不得出现歌名与歌手
    assert.equal(captured[0].body?.includes("晴天"), false);
    assert.equal(captured[0].body?.includes("周杰伦"), false);
  });

  it("换源失败：上报失败样本与失败类别", async () => {
    const settingStore = useSettingStore();
    settingStore.songUnlockServer = [{ key: SongUnlockServer.KUWO, enabled: true }];
    setCustomUnlockHandler(async () => ({ code: 404, url: null }));

    await songManager.getUnlockSongUrl(makeSong(90002));
    await flush();

    assert.equal(captured.length, 1);
    const payload = JSON.parse(captured[0].body ?? "{}");
    assert.equal(payload.source, "kuwo");
    assert.equal(payload.success, false);
    assert.equal(payload.failCategory, "other");
  });

  it("取链超时：失败类别归入 timeout", async () => {
    const settingStore = useSettingStore();
    settingStore.songUnlockServer = [{ key: SongUnlockServer.CHANGQING, enabled: true }];
    setCustomUnlockHandler(async () => {
      throw Object.assign(new Error("timeout of 15000ms exceeded"), {
        code: "ECONNABORTED",
      });
    });

    await songManager.getUnlockSongUrl(makeSong(90003));
    await flush();

    assert.equal(captured.length, 1);
    const payload = JSON.parse(captured[0].body ?? "{}");
    assert.equal(payload.source, "changqing");
    assert.equal(payload.success, false);
    assert.equal(payload.failCategory, "timeout");
  });

  it("关闭匿名上报开关：完全不上报", async () => {
    const settingStore = useSettingStore();
    settingStore.anonymousProbeReport = false;
    settingStore.songUnlockServer = [{ key: SongUnlockServer.MIGU, enabled: true }];
    setCustomUnlockHandler(async () => ({
      code: 200,
      url: "https://migu.example.com/audio.mp3",
    }));

    await songManager.getUnlockSongUrl(makeSong(90004));
    await flush();

    assert.equal(captured.length, 0);
  });

  it("未登记到上报接口的源：不上报", async () => {
    const settingStore = useSettingStore();
    settingStore.songUnlockServer = [{ key: SongUnlockServer.GEQUBAO, enabled: true }];
    setCustomUnlockHandler(async () => ({
      code: 200,
      url: "https://gequbao.example.com/audio.mp3",
    }));

    await songManager.getUnlockSongUrl(makeSong(90005));
    await flush();

    assert.equal(captured.length, 0);
  });

  it("星海音源换源成功：上报 source 为 xinghai，且网易云歌曲缺 platformId 时透传 String(song.id)", async () => {
    const settingStore = useSettingStore();
    settingStore.songUnlockServer = [{ key: SongUnlockServer.XINGHAI, enabled: true }];

    let capturedContext: unknown;
    setCustomUnlockHandler(async (id, songName, artist, server, context) => {
      capturedContext = context;
      return {
        code: 200,
        url: "https://xinghai.example.com/audio.mp3",
      };
    });

    const neteaseSong: SongType = {
      id: 654321,
      name: "海阔天空",
      artists: "Beyond",
      album: "乐与怒",
      cover: "",
      duration: 326000,
      free: 0,
      mv: null,
      type: "song",
      platform: "netease",
    };

    const res = await songManager.getUnlockSongUrl(neteaseSong);
    await flush();

    assert.equal(res.id, 654321);
    assert.equal(res.isUnlocked, true);
    assert.equal(res.unlockSource, SongUnlockServer.XINGHAI);

    assert.deepEqual(capturedContext, {
      duration: 326,
      platform: "netease",
      platformId: "654321",
    });

    assert.equal(captured.length, 1);
    const payload = JSON.parse(captured[0].body ?? "{}");
    assert.equal(payload.source, "xinghai");
    assert.equal(payload.success, true);
    assert.equal(payload.failCategory, "none");
  });
});
