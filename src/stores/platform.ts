/**
 * 音源平台状态管理仓库
 *
 * 负责平台切换、各平台账号资料、歌单及红心状态同步。
 *
 * @author Hackerdallas
 */

import { defineStore } from "pinia";
import type { ApiPlatform, PlatformProfile } from "@/types/shared";
import type { SongType } from "@/types/main";
import { clearPlatformSession, PlatformAuthExpiredError, platformCall } from "@/api/platform/music";
import {
  dispatchLikedSongIds,
  dispatchUserPlaylists,
  invalidatePlaylistListCache,
  type DispatchPlaylist,
} from "@/api/platform/dispatch";

/** 支持的音源平台（网易云走既有 ncm-api 链路，不经平台 IPC 通道） */
export const SUPPORTED_PLATFORMS: ApiPlatform[] = ["netease", "qqmusic", "kugou"];

/** 第三方平台（走平台 IPC 通道的平台） */
export const THIRD_PARTY_PLATFORMS: ApiPlatform[] = ["qqmusic", "kugou"];

/** 平台展示信息 */
export const PLATFORM_META: Record<ApiPlatform, { name: string; short: string }> = {
  netease: { name: "网易云音乐", short: "云" },
  qqmusic: { name: "QQ 音乐", short: "Q" },
  kugou: { name: "酷狗音乐", short: "K" },
};

/** 各平台账号资料 */
export type PlatformProfileMap = Record<ApiPlatform, PlatformProfile | null>;

/** 平台切换事件载荷 */
export interface PlatformChangePayload {
  /** 切换到的平台 */
  platform: ApiPlatform;
  /** 切换前的平台 */
  previous: ApiPlatform;
}

/** 平台切换事件订阅者 */
export type PlatformChangeListener = (payload: PlatformChangePayload) => void;

/** 平台切换事件订阅集合 */
const changeListeners = new Set<PlatformChangeListener>();

/**
 * 账号变更事件载荷
 */
export interface AccountChangePayload {
  /** 变更的平台 */
  platform: ApiPlatform;
  /** 变更后的账号标识（登出时为空串） */
  accountKey: string;
  /** 变更前的账号标识 */
  previousAccountKey: string;
  /** 变更后是否处于登录态 */
  loggedIn: boolean;
}

/**
 * 账号变更事件订阅者
 */
export type AccountChangeListener = (payload: AccountChangePayload) => void;

/**
 * 账号变更事件订阅集合
 */
const accountListeners = new Set<AccountChangeListener>();

/**
 * 订阅账号变更事件
 *
 * 账号变更（登录 / 登出 / 换号）后，页面层据此作废并重新拉取
 * 该平台的歌单列表、红心集合与用户数据。
 * @param listener 事件订阅者
 * @returns 取消订阅函数
 */
export const onAccountChange = (listener: AccountChangeListener): (() => void) => {
  accountListeners.add(listener);
  return () => {
    accountListeners.delete(listener);
  };
};

/**
 * 广播账号变更事件
 * @param payload 事件载荷
 */
const emitAccountChange = (payload: AccountChangePayload): void => {
  for (const listener of accountListeners) {
    try {
      listener(payload);
    } catch (error) {
      console.error("账号变更事件处理失败：", error);
    }
  }
};

/**
 * 进行中的喜欢歌曲装载请求（按平台去重）
 *
 * 同一平台的并发调用共享同一个 Promise，避免重复请求。
 */
interface LikedSongLoad {
  /** 本次装载的令牌，用于丢弃已失效（登出等）的结果 */
  token: object;
  /** 装载请求 */
  promise: Promise<Set<number>>;
}

const likedSongLoads = new Map<ApiPlatform, LikedSongLoad>();

/**
 * 订阅平台切换事件
 *
 * 页面层在「当前平台」变化后据此重新拉取歌单 / 歌曲 / 评论等数据。
 * @param listener 事件订阅者
 * @returns 取消订阅函数
 */
export const onPlatformChange = (listener: PlatformChangeListener): (() => void) => {
  changeListeners.add(listener);
  return () => {
    changeListeners.delete(listener);
  };
};

/**
 * 广播平台切换事件
 * @param payload 事件载荷
 */
const emitPlatformChange = (payload: PlatformChangePayload): void => {
  for (const listener of changeListeners) {
    try {
      listener(payload);
    } catch (error) {
      console.error("平台切换事件处理失败：", error);
    }
  }
};

/** 主进程 `user_detail` 模块的返回 */
interface PlatformUserDetail {
  code?: number;
  loggedIn?: boolean;
  profile?: PlatformProfile;
  message?: string;
}

/** 主进程回报「凭据已失效」的业务码 */
const AUTH_EXPIRED_CODE = 401;

interface PlatformState {
  /** 当前平台 */
  currentPlatform: ApiPlatform;
  /** 各平台账号资料 */
  platformProfiles: PlatformProfileMap;
  /**
   * 各平台账号数据的归属标识
   *
   * 记录当前持有的账号维度数据（歌单列表 / 红心集合 / 用户喜欢数据）属于哪个账号：
   * - 第三方平台：平台账号资料里的 userId（QQ 的 uin、酷狗的 userid）；
   * - 网易云：网易云 uid。
   *
   * 标识变化即意味着账号已切换：系统红心歌单的歌单号按账号分配，
   * 同一个歌单号在新账号下指向完全不同的歌单，旧数据必须整体作废重拉。
   */
  accountKeys: Record<string, string>;
  /** 当前平台的歌单列表（第三方平台维护，网易云沿用既有本地缓存） */
  playlists: {
    /** 自建歌单 */
    owned: DispatchPlaylist[];
    /** 收藏（订阅）歌单 */
    favorites: DispatchPlaylist[];
  };
  /**
   * 各第三方平台的「我喜欢的音乐」曲目 id 集合
   *
   * 红心判据来源：平台「我喜欢的音乐」歌单的曲目集合——
   * 歌单内的曲目判定为已红心，歌单外的曲目判定为未红心。
   * 平台可用时即装载，任意页面都能判定红心状态。
   */
  likedSongIds: Record<string, Set<number>>;
  /**
   * 各平台最近一次账号资料读取是否因凭据失效而失败
   *
   * 凭据失效与网络抖动必须分开：前者要提示重新登录且不得回填旧快照，
   * 后者只保留旧资料，避免界面误显示「未登录」。
   */
  authExpired: Record<string, boolean>;
}

/**
 * 音源平台 Store
 *
 * 负责：当前平台的选择与切换、各平台账号资料的读取与缓存、平台登出。
 * 账号凭据始终留在主进程，本 store 只持有非凭据的展示字段。
 */
export const usePlatformStore = defineStore("platform", {
  state: (): PlatformState => ({
    // 当前平台（缺省网易云）
    currentPlatform: "netease",
    // 各平台账号资料
    platformProfiles: {
      netease: null,
      qqmusic: null,
      kugou: null,
    },
    // 各平台账号数据的归属标识
    accountKeys: {},
    // 当前平台的歌单列表
    playlists: {
      owned: [],
      favorites: [],
    },
    // 各第三方平台的「我喜欢的音乐」曲目 id 集合
    likedSongIds: {},
    // 各平台的凭据失效标记
    authExpired: {},
  }),

  getters: {
    /**
     * 当前平台的账号资料
     */
    currentProfile: (state): PlatformProfile | null =>
      state.platformProfiles[state.currentPlatform],
    /**
     * 已登录的平台列表
     */
    loggedInPlatforms: (state): ApiPlatform[] =>
      THIRD_PARTY_PLATFORMS.filter((platform) => !!state.platformProfiles[platform]),
    /**
     * 判断某首歌在指定第三方平台是否已喜欢
     * @param platform 音源平台
     * @param songId 歌曲 id
     * @returns 是否已喜欢
     */
    isLikedSong:
      (state) =>
      (platform: ApiPlatform, songId: number): boolean => {
        if (platform === "netease") return false;
        const ids = state.likedSongIds[platform];
        return ids ? ids.has(Number(songId)) : false;
      },
  },

  actions: {
    /**
     * 读取某平台账号数据的归属标识
     * @param platform 音源平台
     * @returns 账号标识，未登录时为空串
     */
    accountKeyOf(platform: ApiPlatform): string {
      return this.accountKeys[platform] ?? "";
    },

    /**
     * 标记某平台账号数据的归属标识
     *
     * 标识变化意味着账号已切换：作废该平台的账号维度数据并广播事件，
     * 由页面层重新拉取。
     * @param platform 音源平台
     * @param accountKey 账号标识，登出时为空串
     */
    setAccountKey(platform: ApiPlatform, accountKey: string): void {
      const previousAccountKey = this.accountKeys[platform] ?? "";
      if (previousAccountKey === accountKey) return;
      this.invalidateAccountData(platform, accountKey);
      emitAccountChange({
        platform,
        accountKey,
        previousAccountKey,
        loggedIn: !!accountKey,
      });
    },

    /**
     * 作废某平台的账号维度数据
     *
     * 账号切换后，上一个账号的歌单号与红心集合在新账号下指向完全不同的内容，
     * 必须整体作废：红心集合、分派层的歌单列表缓存、当前平台的歌单列表槽。
     * @param platform 音源平台
     * @param accountKey 变更后的账号标识（登出时为空串）
     */
    invalidateAccountData(platform: ApiPlatform, accountKey: string): void {
      if (accountKey) this.accountKeys[platform] = accountKey;
      else delete this.accountKeys[platform];
      // 红心集合按平台存放，账号切换后整体作废
      this.invalidateLikedSongs(platform);
      // 分派层的歌单列表缓存按平台存放，内含上一个账号的歌单号
      invalidatePlaylistListCache(platform);
      // 当前平台的歌单列表槽存放的是上一个账号的歌单
      if (this.currentPlatform === platform) {
        this.playlists = { owned: [], favorites: [] };
      }
    },

    /**
     * 切换当前平台
     *
     * 切换后广播事件，供页面层重新拉取平台数据。
     * @param platform 目标平台
     * @returns 是否发生了实际切换
     */
    switchPlatform(platform: ApiPlatform): boolean {
      if (!SUPPORTED_PLATFORMS.includes(platform)) return false;
      const previous = this.currentPlatform;
      if (previous === platform) return false;
      this.currentPlatform = platform;
      emitPlatformChange({ platform, previous });
      // 目标平台已登录时装载其「我喜欢的音乐」集合，使任意页面的红心状态可判定
      if (this.platformProfiles[platform]) void this.ensureLikedSongs(platform);
      return true;
    },

    /**
     * 确保某平台的「我喜欢的音乐」曲目 id 集合已装载
     *
     * 装载结果写入 store，界面可直接按平台判定红心；
     * 同一平台的并发调用共享同一次请求，不会产生重复请求风暴；
     * 装载失败静默降级（红心显示为未选中），不打断页面渲染。
     * @param platform 音源平台，缺省为当前平台
     * @returns 该平台的喜欢歌曲 id 集合
     */
    async ensureLikedSongs(platform?: ApiPlatform): Promise<Set<number>> {
      const target = platform ?? this.currentPlatform;
      if (target === "netease") return new Set<number>();
      const cached = this.likedSongIds[target];
      if (cached) return cached;
      const inflight = likedSongLoads.get(target);
      if (inflight) return inflight.promise;
      const token = {};
      const promise = dispatchLikedSongIds(target)
        .then((ids) => {
          // 装载期间集合被失效（登出等）时不再写回，避免复活已作废的集合
          if (likedSongLoads.get(target)?.token === token) this.likedSongIds[target] = ids;
          return ids;
        })
        .catch((error) => {
          console.error(`加载${PLATFORM_META[target].name}喜欢歌曲失败：`, error);
          return new Set<number>();
        })
        .finally(() => {
          if (likedSongLoads.get(target)?.token === token) likedSongLoads.delete(target);
        });
      likedSongLoads.set(target, { token, promise });
      return promise;
    },

    /**
     * 用已取回的曲目覆盖某平台的喜欢歌曲缓存
     *
     * 「我喜欢的音乐」页取回曲目后调用，保证缓存与页面数据同源。
     * @param platform 音源平台
     * @param tracks 平台「我喜欢的音乐」的曲目
     */
    setLikedSongs(platform: ApiPlatform, tracks: SongType[]): void {
      if (platform === "netease") return;
      const ids = new Set<number>();
      for (const track of tracks) {
        const id = Number(track.id);
        if (Number.isFinite(id) && id > 0) ids.add(id);
      }
      this.likedSongIds[platform] = ids;
    },

    /**
     * 在缓存里增删一首喜欢歌曲（写操作成功后调用）
     * @param platform 音源平台
     * @param songId 歌曲 id
     * @param liked 是否喜欢
     */
    patchLikedSong(platform: ApiPlatform, songId: number, liked: boolean): void {
      if (platform === "netease") return;
      const ids = this.likedSongIds[platform] ?? new Set<number>();
      if (liked) ids.add(Number(songId));
      else ids.delete(Number(songId));
      this.likedSongIds[platform] = ids;
    },

    /**
     * 失效某平台的喜欢歌曲缓存
     * @param platform 音源平台
     */
    invalidateLikedSongs(platform: ApiPlatform): void {
      if (platform === "netease") return;
      delete this.likedSongIds[platform];
      likedSongLoads.delete(platform);
    },

    /**
     * 刷新指定平台的歌单列表
     *
     * 走歌单数据源分派层；网易云的歌单列表由既有本地缓存维护，此处直接清空。
     * @param platform 音源平台
     * @returns 该平台的自建歌单与收藏歌单
     */
    async refreshPlaylists(
      platform?: ApiPlatform,
    ): Promise<{ owned: DispatchPlaylist[]; favorites: DispatchPlaylist[] }> {
      const target = platform ?? this.currentPlatform;
      if (target === "netease") {
        this.playlists = { owned: [], favorites: [] };
        return this.playlists;
      }
      // 记录发起时的账号标识：请求期间账号被切换时，本次结果整体丢弃，
      // 避免把上一个账号的歌单写进新账号的界面
      const accountKey = this.accountKeys[target] ?? "";
      try {
        const lists = await dispatchUserPlaylists(target);
        if ((this.accountKeys[target] ?? "") !== accountKey) return this.playlists;
        this.playlists = lists;
      } catch (error) {
        console.error(`获取 ${PLATFORM_META[target].name}歌单列表失败：`, error);
        if ((this.accountKeys[target] ?? "") === accountKey) {
          this.playlists = { owned: [], favorites: [] };
        }
      }
      return this.playlists;
    },

    /**
     * 刷新指定平台的账号资料
     *
     * 走主进程平台模块 `user_detail`；未登录时把本地资料清空。
     * 账号标识与已记录的不一致即意味着账号已切换（换号登录），
     * 此时作废该平台的账号维度数据并广播账号变更事件。
     *
     * 凭据失效（主进程回报 401 或抛出鉴权失效异常）时按登出处理：
     * 清空资料与持久化快照、作废账号维度数据并广播账号变更事件，
     * 由界面提示重新登录——此时不得回填旧快照。
     * @param platform 音源平台
     * @returns 平台账号资料，未登录时为 null
     */
    async refreshProfile(platform: ApiPlatform): Promise<PlatformProfile | null> {
      // 网易云的登录态由既有 `/login/status` 链路维护，不经平台 IPC 通道
      if (platform === "netease") return null;
      this.authExpired[platform] = false;
      try {
        const res = await platformCall<PlatformUserDetail>(platform, "user_detail");
        // 主进程明确回报凭据失效：与「未登录」区分开，按登出处理
        if (res?.code === AUTH_EXPIRED_CODE) {
          this.handleAuthExpired(platform);
          return null;
        }
        const profile = res?.loggedIn && res.profile ? res.profile : null;
        this.platformProfiles[platform] = profile;
        // 账号标识变化 = 账号已切换：作废上一个账号的数据并广播事件
        const accountKey = profile?.userId ? String(profile.userId) : "";
        const previousAccountKey = this.accountKeys[platform] ?? "";
        if (accountKey !== previousAccountKey) {
          this.invalidateAccountData(platform, accountKey);
          emitAccountChange({
            platform,
            accountKey,
            previousAccountKey,
            loggedIn: !!profile,
          });
        }
        // 登录态就绪时装载其「我喜欢的音乐」集合，使任意页面的红心状态可判定
        if (profile) void this.ensureLikedSongs(platform);
        return profile;
      } catch (error) {
        // 鉴权失效：凭据已死，与网络抖动分开处理
        if (error instanceof PlatformAuthExpiredError) {
          this.handleAuthExpired(platform);
          return null;
        }
        console.error(`获取 ${PLATFORM_META[platform].name}账号资料失败：`, error);
        this.platformProfiles[platform] = null;
        return null;
      }
    },

    /**
     * 处理某平台的凭据失效
     *
     * 清空账号资料（持久化快照随之清空）、作废账号维度数据并广播账号变更事件。
     * @param platform 音源平台
     */
    handleAuthExpired(platform: ApiPlatform): void {
      this.authExpired[platform] = true;
      this.platformProfiles[platform] = null;
      const previousAccountKey = this.accountKeys[platform] ?? "";
      this.invalidateAccountData(platform, "");
      emitAccountChange({
        platform,
        accountKey: "",
        previousAccountKey,
        loggedIn: false,
      });
    },

    /**
     * 刷新所有第三方平台的账号资料
     * @returns 凭据失效的平台列表
     */
    async refreshAllProfiles(): Promise<ApiPlatform[]> {
      const results = await Promise.all(
        THIRD_PARTY_PLATFORMS.map(async (platform) => {
          await this.refreshProfile(platform);
          return this.authExpired[platform] ? platform : null;
        }),
      );
      return results.filter((platform): platform is ApiPlatform => !!platform);
    },

    /**
     * 登出指定平台
     *
     * 清空主进程会话与本地资料；网易云由既有退出登录链路处理。
     * 登出后该平台的账号维度数据整体作废，不留上一个账号的残影。
     * @param platform 音源平台
     */
    async logout(platform: ApiPlatform): Promise<void> {
      if (platform === "netease") return;
      await clearPlatformSession(platform);
      const previousAccountKey = this.accountKeys[platform] ?? "";
      this.platformProfiles[platform] = null;
      // 账号维度数据整体作废：红心集合、歌单列表缓存、当前平台的歌单列表
      this.invalidateAccountData(platform, "");
      emitAccountChange({
        platform,
        accountKey: "",
        previousAccountKey,
        loggedIn: false,
      });
    },
  },

  // 持久化（只存非凭据字段）
  persist: {
    key: "platform-store",
    pick: ["currentPlatform", "platformProfiles", "accountKeys"],
  },
});
