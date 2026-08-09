/**
 * 播放统计采集：累计每首歌的实际收听时长，结算后写入本地存储
 *
 * Based on SPlayer-Next
 * Copyright (C) 2024 SPlayer-Dev
 * Licensed under AGPL-3.0
 *
 * 从 SPlayer-Next 的 `src/core/player/stats.ts` 移植并适配到 capacitor 端：
 *   - 曲目身份由 `musicStore.playSong` 驱动
 *   - 播放态由 `statusStore.playStatus`（boolean）驱动
 *   - 落库原为 Electron 主进程 better-sqlite3，此处改为 localforage（IndexedDB）
 *
 * 并发安全：维护内存缓存 entries + 串行写入队列，避免快速切歌时读-改-写丢失更新。
 * 持久化时机：切换歌曲/自然播完/页面隐藏（beforeunload + Capacitor appStateChange）。
 *
 * 墙钟用 Date.now() 差值，不依赖定时器与 position 事件，窗口隐藏时也准确。
 */
import localforage from "localforage";
import { useMusicStore, useStatusStore } from "@/stores";

/** 低于此收听时长（毫秒）不记录 */
const MIN_RECORD_MS = 5000;

/** 单曲统计 */
export interface SongPlayStat {
  /** 歌曲 ID */
  songId: number;
  /** 歌曲名 */
  name: string;
  /** 歌手名 */
  artist: string;
  /** 累计收听次数 */
  playCount: number;
  /** 累计收听时长（毫秒） */
  totalListenMs: number;
  /** 最近一次播放 unix ms */
  lastPlayedAt: number;
}

/** 统计数据存储（本地） */
const statsDB = localforage.createInstance({
  name: "play-stats",
  description: "Play statistics data",
  storeName: "stats",
});

/** 会话状态 */
interface Session {
  songId: number;
  name: string;
  artist: string;
  /** 本次播放开始 unix ms */
  startedAt: number;
  /** 已累计的收听墙钟毫秒 */
  listenedMs: number;
  /** 进入 playing 的墙钟时刻 */
  playingSince: number | null;
}

let session: Session | null = null;
let installed = false;

/** 内存缓存 + 写入队列（保证读-改-写不丢更新） */
let entriesCache: Record<string, SongPlayStat> | null = null;
let writeChain: Promise<void> = Promise.resolve();

/** 曲目身份标识 */
const songKey = (songId: number): string => `song:${songId}`;

/** 读取全部统计（带内存缓存） */
export const loadPlayStats = async (): Promise<Record<string, SongPlayStat>> => {
  if (entriesCache) return entriesCache;
  try {
    entriesCache = (await statsDB.getItem<Record<string, SongPlayStat>>("entries")) || {};
  } catch {
    entriesCache = {};
  }
  return entriesCache;
};

/** 把进行中的 playing 区间结清进 listenedMs */
const settle = (): void => {
  if (!session || session.playingSince === null) return;
  session.listenedMs += Date.now() - session.playingSince;
  session.playingSince = null;
};

/** 为指定曲目开新会话 */
const begin = (songId: number, name: string, artist: string, playing: boolean): void => {
  const now = Date.now();
  session = { songId, name, artist, startedAt: now, listenedMs: 0, playingSince: playing ? now : null };
};

/**
 * 结算当前会话并落库
 * 通过写队列串行化「读缓存→改→写盘」，并发结算不丢更新
 */
const finalize = (): void => {
  if (!session) return;
  settle();
  const { songId, name, artist, listenedMs } = session;
  session = null;
  if (listenedMs < MIN_RECORD_MS) return;

  // 记录一次结算（异步入队写盘）
  const snapshot: SongPlayStat = {
    songId,
    name,
    artist,
    playCount: 1,
    totalListenMs: listenedMs,
    lastPlayedAt: Date.now(),
  };
  void enqueueWrite(snapshot);
};

/** 串行写入队列：合并增量到缓存并落盘 */
const enqueueWrite = (snapshot: SongPlayStat): Promise<void> => {
  writeChain = writeChain.then(async () => {
    const entries = await loadPlayStats();
    const key = songKey(snapshot.songId);
    const prev = entries[key];
    entries[key] = {
      songId: snapshot.songId,
      name: snapshot.name,
      artist: snapshot.artist,
      playCount: (prev?.playCount ?? 0) + 1,
      totalListenMs: (prev?.totalListenMs ?? 0) + snapshot.totalListenMs,
      lastPlayedAt: snapshot.lastPlayedAt,
    };
    try {
      await statsDB.setItem("entries", entries);
    } catch (error) {
      console.error("写入播放统计失败:", error);
    }
  });
  return writeChain;
};

/**
 * 歌曲自然播完时调用
 * @param restart 单曲循环：结算后立即为同一首开新会话，使每圈各成一行
 */
export const onTrackEnded = (restart: boolean): void => {
  finalize();
  if (!restart) return;
  const musicStore = useMusicStore();
  const song = musicStore.playSong;
  if (song && song.id) {
    const statusStore = useStatusStore();
    begin(song.id, song.name, formatArtist(song.artists), statusStore.playStatus);
  }
};

/** 歌手名归一化 */
const formatArtist = (artists: string | Array<{ name: string }> | undefined): string => {
  if (!artists) return "";
  if (typeof artists === "string") return artists;
  return artists.map((a) => a.name).join(" / ");
};

/** 安装播放统计累加器（幂等） */
export const installPlayStats = (): void => {
  if (installed) return;
  installed = true;
  const musicStore = useMusicStore();
  const statusStore = useStatusStore();

  // 曲目身份变化：结算旧会话，为新曲开会话
  let lastKey = "";
  const syncSong = () => {
    const song = musicStore.playSong;
    const id = song?.id ?? 0;
    const key = songKey(id);
    if (key === lastKey && id !== 0) {
      // 同一首不重复开会话
      return;
    }
    // 结算旧会话
    finalize();
    lastKey = key;
    if (song && id) {
      begin(id, song.name, formatArtist(song.artists), statusStore.playStatus);
    }
  };
  // 监听曲目变化
  watch(
    () => musicStore.playSong?.id,
    () => syncSong(),
  );

  // 播放态变化：同一会话内累计 / 暂停计时
  watch(
    () => statusStore.playStatus,
    (playing) => {
      if (!session) return;
      if (playing) {
        if (session.playingSince === null) session.playingSince = Date.now();
      } else {
        settle();
      }
    },
  );

  // 持久化：页面隐藏（桌面 beforeunload / Capacitor appStateChange）
  window.addEventListener("beforeunload", () => void finalize());
  void import("@capacitor/app")
    .then(({ App }) => {
      App.addListener("appStateChange", ({ isActive }) => {
        if (!isActive) void finalize();
      });
    })
    .catch(() => {
      // @capacitor/app 不可用（纯 Web 调试）时忽略
    });
};
