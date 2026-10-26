/**
 * 平台作用域的状态仓库
 *
 * 网易云 / QQ 音乐 / 酷狗三个平台的界面与播放状态必须完全独立：
 * 切到某平台后，不得残留其它平台的内容。
 *
 * 本仓库持有两类平台维度数据：
 *
 * 1. **播放队列与播放状态** —— 队列、正在播放的歌曲、歌词与播放进度都只属于
 *    一个平台。切换平台时整体作废；重载后按归属平台校验，不属于当前平台的
 *    持久化数据一律丢弃（持久化 store 不得把旧平台的队列带回来）。
 * 2. **播放历史** —— 最近播放按平台分桶，各平台的记录互不混排。
 *
 * 红心判据的平台维度化不在本仓库：判据真源在 `@/utils/songLiked`，
 * 各平台的红心集合在 `@/stores/platform`，此处不重复持有。
 *
 * @author Hackerdallas
 */

import { defineStore } from "pinia";
import localforage from "localforage";
import { cloneDeep } from "lodash-es";
import { toRaw } from "vue";
import type { SongType } from "@/types/main";
import type { ApiPlatform } from "@/types/shared";
import { useDataStore } from "@/stores/data";
import { useMusicStore } from "@/stores/music";
import { onPlatformChange, usePlatformStore } from "@/stores/platform";
import { useStatusStore } from "@/stores/status";
import { isSongOfPlatform, resolveSongPlatform } from "@/utils/songPlatform";

/** 平台作用域的持久化存储 */
const platformDB = localforage.createInstance({
  name: "platform-data",
  description: "Platform scoped runtime data",
  storeName: "platform",
});

/** 各平台播放历史的存储键 */
const HISTORY_KEY = "historyByPlatform";

/** 单平台播放历史的最大条数 */
const HISTORY_LIMIT = 500;

/**
 * 判断播放队列是否属于指定平台
 *
 * 队列内只要有一首属于其它平台的曲目，整个队列即视为他平台数据：
 * 平台之间完全独立，不允许混排。本地歌曲全局可用，不参与归属判定。
 * @param songs 播放队列
 * @param platform 音源平台
 * @returns 是否属于该平台
 */
const isQueueOfPlatform = (songs: SongType[], platform: ApiPlatform): boolean => {
  for (const song of songs) {
    if (song.path) continue;
    if (resolveSongPlatform(song) !== platform) return false;
  }
  return true;
};

interface PlatformScopeState {
  /** 各平台的播放历史（最近播放） */
  historyByPlatform: Record<string, SongType[]>;
  /** 播放历史是否已从本地存储载入 */
  historyLoaded: boolean;
}

/**
 * 平台作用域状态仓库
 */
export const usePlatformScopeStore = defineStore("platformScope", {
  state: (): PlatformScopeState => ({
    // 各平台的播放历史
    historyByPlatform: {},
    // 播放历史载入标记
    historyLoaded: false,
  }),

  getters: {
    /**
     * 当前平台的播放历史
     */
    currentHistory(state): SongType[] {
      const platform = usePlatformStore().currentPlatform;
      return state.historyByPlatform[platform] ?? [];
    },
  },

  actions: {
    /**
     * 载入各平台的播放历史
     *
     * 旧版的全局播放历史（不带平台维度）在首次载入时按歌曲平台分桶迁移一次，
     * 迁移后各平台的记录互不混排。
     */
    async loadHistory(): Promise<void> {
      if (this.historyLoaded) return;
      const stored = (await platformDB.getItem(HISTORY_KEY)) as
        Record<string, SongType[]> | null | undefined;
      if (stored && typeof stored === "object") {
        this.historyByPlatform = stored;
        this.historyLoaded = true;
        return;
      }
      // 旧版全局历史按平台分桶迁移
      const legacy = useDataStore().historyList ?? [];
      const migrated: Record<string, SongType[]> = {};
      for (const song of legacy) {
        const platform = resolveSongPlatform(song);
        const bucket = migrated[platform] ?? [];
        if (!bucket.some((item) => item.id === song.id)) bucket.push(song);
        migrated[platform] = bucket;
      }
      this.historyByPlatform = migrated;
      this.historyLoaded = true;
      await this.saveHistory();
    },

    /**
     * 写入播放历史
     *
     * 记录只落在歌曲所属平台的桶里，跨平台同号歌曲互不顶替。
     * @param song 播放过的歌曲
     */
    async recordHistory(song: SongType): Promise<void> {
      if (!this.historyLoaded) await this.loadHistory();
      const platform = resolveSongPlatform(song);
      const bucket = this.historyByPlatform[platform] ?? [];
      // 同平台同号歌曲只保留最新一条
      const rest = bucket.filter((item) => item.id !== song.id);
      const next = [song, ...rest];
      if (next.length > HISTORY_LIMIT) next.splice(HISTORY_LIMIT);
      this.historyByPlatform[platform] = next;
      await this.saveHistory();
    },

    /**
     * 清空某平台的播放历史
     * @param platform 音源平台，缺省清空当前平台
     */
    async clearHistory(platform?: ApiPlatform): Promise<void> {
      if (!this.historyLoaded) await this.loadHistory();
      const target = platform ?? usePlatformStore().currentPlatform;
      delete this.historyByPlatform[target];
      await this.saveHistory();
    },

    /**
     * 把播放历史写入本地存储
     */
    async saveHistory(): Promise<void> {
      await platformDB.setItem(HISTORY_KEY, cloneDeep(toRaw(this.historyByPlatform)));
    },

    /**
     * 作废只属于旧平台的运行时状态
     *
     * 播放队列、正在播放的歌曲、歌词与播放进度都只属于一个平台，
     * 切换平台时整体作废，避免旧平台的内容残留在新平台的界面上。
     */
    resetPlatformScopedState(): void {
      const dataStore = useDataStore();
      const musicStore = useMusicStore();
      const statusStore = useStatusStore();
      // 心动模式为网易云专属能力，切平台时退出，避免状态残留到无此能力的平台
      if (statusStore.shuffleMode === "heartbeat") {
        statusStore.shuffleMode = "off";
      }
      // 停止当前播放（音频环境可用时）
      try {
        if (typeof window !== "undefined") {
          import("@/core/player/AudioManager")
            .then(({ useAudioManager }) => {
              useAudioManager().stop();
            })
            .catch(() => {});
        }
      } catch {
        // 单测或无音频驱动环境下静默忽略
      }
      // 播放进度、歌词位置与播放面板状态
      statusStore.resetPlatformPlayStatus();
      // 正在播放的歌曲与平台专属列表
      musicStore.resetPlatformMusicData();
      // 播放队列：只属于旧平台，整体清空
      void dataStore.setPlayList([]);
      void dataStore.clearOriginalPlayList();
    },

    /**
     * 丢弃不属于当前平台的持久化状态
     *
     * 平台切换伴随页面重载时，持久化的播放队列与正在播放的歌曲仍留在本地
     * 存储里，重载后会被读回来。此处按归属平台校验，不属于当前平台的一律丢弃。
     */
    async discardForeignPersistedState(): Promise<void> {
      const dataStore = useDataStore();
      const musicStore = useMusicStore();
      const statusStore = useStatusStore();
      const platform = usePlatformStore().currentPlatform;
      // 播放队列
      if (!isQueueOfPlatform(dataStore.playList, platform)) {
        void dataStore.setPlayList([]);
        void dataStore.clearOriginalPlayList();
      }
      // 正在播放的歌曲
      const playSong = musicStore.playSong;
      if (playSong?.id && !isSongOfPlatform(playSong, platform)) {
        musicStore.resetPlatformMusicData();
        statusStore.resetPlatformPlayStatus();
      }
    },
  },
});

/**
 * 初始化平台作用域
 *
 * 载入各平台的播放历史，并校验持久化状态是否属于当前平台。
 * @returns 初始化完成
 */
export const initPlatformScope = async (): Promise<void> => {
  const scopeStore = usePlatformScopeStore();
  await scopeStore.loadHistory();
  await scopeStore.discardForeignPersistedState();
};

// 平台切换：旧平台的运行时状态整体作废
onPlatformChange(() => {
  usePlatformScopeStore().resetPlatformScopedState();
});
