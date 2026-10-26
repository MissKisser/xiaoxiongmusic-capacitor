/**
 * 平台能力与路由可见性
 *
 * 页面层据此判断「当前平台是否支持某个功能」：
 * - 不支持的入口在侧边栏 / 标签页里隐藏；
 * - 不支持的路由由路由守卫拦截，直接输 URL 时给出提示并回到首页。
 *
 * 真源有两处，职责不同：
 * - **标签页可见性**：`DISCOVER_TABS` / `LIKE_TABS`，
 *   逐平台列出该平台展示的子页，缺省不在表内即隐藏；
 * - **路由可用性**：`NETEASE_ONLY_ROUTES`（网易云独有能力）
 *   与 `PLATFORM_UNSUPPORTED_ROUTES`（部分平台缺数据源），
 *   统一由 `isRouteSupported` 判定。
 *
 * 两张表互相独立：标签页决定「展示哪些入口」，
 * 路由表决定「直达 URL 是否放行」，不再有第三份能力清单。
 *
 * @author Hackerdallas
 */

import type { ApiPlatform } from "@/types/shared";

/**
 * 网易云独有能力对应的路由
 *
 * 这些路由在第三方平台下既没有数据源，也无从降级，
 * 故隐藏入口并在路由守卫里拦截直达。
 */
export const NETEASE_ONLY_ROUTES: string[] = [
  // 我的云盘
  "cloud",
  // 每日推荐
  "daily-songs",
  // MV
  "video",
  // 歌曲百科
  "song-wiki",
  // 收藏子页（专辑 / 歌手 / 视频 / 播客）
  "like-albums",
  "like-artists",
  "like-videos",
  "like-radios",
  // 搜索子页（视频 / 播客）
  "search-videos",
  "search-radios",
  // 歌手视频子页
  "artist-videos",
  // 发现页「最新音乐」（新碟 / 新歌，平台侧无对应数据源）
  "discover-new",
];

/**
 * 有声内容路由
 *
 * 网易云下是播客电台，酷狗下是听书（同属「有声内容」入口），
 * 两个平台各走各的数据源；QQ 音乐两端都没有数据源。
 */
export const RADIO_ROUTES: string[] = ["radio", "radio-hot", "radio-type"];

/**
 * 平台级路由限制
 *
 * 某些子页只在部分平台有数据源，
 * 这些平台下对应入口已隐藏，路由守卫同样拦截直达。
 */
export const PLATFORM_UNSUPPORTED_ROUTES: Record<ApiPlatform, string[]> = {
  // 平台每日推荐页是第三方平台专属页面，网易云走既有的「每日推荐」页
  netease: ["platform-daily-songs"],
  qqmusic: [...RADIO_ROUTES],
  kugou: [],
};

/**
 * 判断路由在指定平台下是否可用
 *
 * 判定顺序：平台级不支持表 → 网易云专属早退 → 网易云独有能力表。
 * 平台级不支持表必须先判，否则网易云的早退会把
 * `PLATFORM_UNSUPPORTED_ROUTES.netease` 里的条目放行（该表本就是网易云专属的排除项）。
 * @param platform 音源平台
 * @param routeName 路由名
 * @returns 是否可用
 */
export const isRouteSupported = (platform: ApiPlatform, routeName: string): boolean => {
  if ((PLATFORM_UNSUPPORTED_ROUTES[platform] ?? []).includes(routeName)) return false;
  if (platform === "netease") return true;
  if (NETEASE_ONLY_ROUTES.includes(routeName)) return false;
  return true;
};

/**
 * 第三方平台首页区块的数据源支持
 *
 * 区块键的并集在 `src/stores/setting.ts` 的 `PLATFORM_HOME_SECTION_KEYS`，
 * 这里声明各平台实际有数据源的区块子集：
 * 没有数据源的区块在该平台下既不渲染，也不进配置面板。
 */
export const HOME_SECTION_SUPPORT: Record<Exclude<ApiPlatform, "netease">, readonly string[]> = {
  qqmusic: ["square", "recommend", "singer", "album"],
  // 酷狗没有「为你推荐」的数据源，但多一个独有能力「场景电台」（主题卡入口）
  kugou: ["square", "singer", "album", "radioTheme"],
};

/**
 * 判断首页区块在指定平台下是否有数据源
 * @param platform 音源平台
 * @param key 首页区块键
 * @returns 是否有数据源
 */
export const isHomeSectionSupported = (platform: ApiPlatform, key: string): boolean => {
  if (platform === "netease") return true;
  return (HOME_SECTION_SUPPORT[platform] ?? []).includes(key);
};

/**
 * 平台标签页
 */
export interface PlatformTab {
  /** 路由名 */
  name: string;
  /** 标签文案 */
  label: string;
}

/**
 * 第三方平台歌单分组的路由参数
 *
 * QQ 音乐与酷狗把「我创建的歌单」与「我收藏的歌单」分成两套目录语义，
 * 收藏页用该参数区分当前展示的分组，
 * 账号信息区的统计入口按同一口径跳到对应分组。
 */
export const PLATFORM_PLAYLIST_TYPE_QUERY = ["owned", "favorites"] as const;

/**
 * 各平台在发现页的子页可见性
 *
 * 标签页可见性的唯一真源：逐平台列出要展示的子页，
 * 不在表内的子页在该平台下隐藏（路由是否放行另由 `isRouteSupported` 判定）。
 */
export const DISCOVER_TABS: Record<ApiPlatform, PlatformTab[]> = {
  netease: [
    { name: "discover-playlists", label: "歌单广场" },
    { name: "discover-toplists", label: "排行榜" },
    { name: "discover-artists", label: "歌手" },
    { name: "discover-new", label: "最新音乐" },
  ],
  qqmusic: [
    { name: "discover-playlists", label: "歌单广场" },
    { name: "discover-toplists", label: "排行榜" },
    { name: "discover-artists", label: "歌手" },
  ],
  kugou: [
    { name: "discover-playlists", label: "歌单广场" },
    { name: "discover-toplists", label: "排行榜" },
    { name: "discover-artists", label: "歌手" },
  ],
};

/**
 * 各平台在收藏页的子页可见性
 *
 * 第三方平台只有「收藏的歌单」有对应数据源。
 */
export const LIKE_TABS: Record<ApiPlatform, PlatformTab[]> = {
  netease: [
    { name: "like-playlists", label: "歌单" },
    { name: "like-albums", label: "专辑" },
    { name: "like-artists", label: "歌手" },
    { name: "like-videos", label: "视频" },
    { name: "like-radios", label: "播客" },
  ],
  qqmusic: [{ name: "like-playlists", label: "歌单" }],
  kugou: [{ name: "like-playlists", label: "歌单" }],
};

/** 平台展示元信息（名称与单字简标） */
export const PLATFORM_META: Record<ApiPlatform, { name: string; short: string }> = {
  netease: { name: "网易云音乐", short: "云" },
  qqmusic: { name: "QQ 音乐", short: "Q" },
  kugou: { name: "酷狗音乐", short: "K" },
};

/** 平台菜单条目 */
export interface PlatformListItem {
  /** 平台标识 */
  platform: ApiPlatform;
  /** 平台名称 */
  name: string;
  /** 单字简标 */
  short: string;
  /** 是否为当前激活平台 */
  active: boolean;
  /** 是否已登录 */
  loggedIn: boolean;
  /** 昵称 */
  nickname: string;
  /** 头像地址 */
  avatarUrl: string;
}

/** 平台条目点击分发动作 */
export type PlatformSelectAction =
  | { type: "login-netease" }
  | { type: "login-platform"; platform: ApiPlatform }
  | { type: "switch-platform"; platform: ApiPlatform };

/**
 * 构建平台账号列表条目
 * @param current 当前激活的平台
 * @param neteaseState 网易云登录状态与资料
 * @param profiles 第三方平台资料映射
 * @returns 平台账号列表
 */
export const buildPlatformListItems = (
  current: ApiPlatform,
  neteaseState: { loggedIn: boolean; nickname?: string; avatarUrl?: string },
  profiles: Partial<Record<ApiPlatform, { nickname?: string; userId?: string | number; avatarUrl?: string } | null>>,
): PlatformListItem[] => {
  return (Object.keys(PLATFORM_META) as ApiPlatform[]).map((platform) => {
    if (platform === "netease") {
      return {
        platform,
        name: PLATFORM_META.netease.name,
        short: PLATFORM_META.netease.short,
        active: current === platform,
        loggedIn: neteaseState.loggedIn,
        nickname: neteaseState.nickname || "未知用户名",
        avatarUrl: neteaseState.avatarUrl ?? "",
      };
    }
    const profile = profiles[platform];
    return {
      platform,
      name: PLATFORM_META[platform].name,
      short: PLATFORM_META[platform].short,
      active: current === platform,
      loggedIn: !!profile,
      nickname:
        String(profile?.nickname ?? "").trim() ||
        String(profile?.userId ?? "").trim() ||
        PLATFORM_META[platform].name,
      avatarUrl: profile?.avatarUrl ?? "",
    };
  });
};

/**
 * 解析用户点击平台条目时的响应动作
 * @param item 平台条目（含平台与登录状态）
 * @returns 响应动作（网易云登录 / 平台登录 / 切换平台）
 */
export const resolvePlatformSelectAction = (item: {
  platform: ApiPlatform;
  loggedIn: boolean;
}): PlatformSelectAction => {
  if (!item.loggedIn) {
    if (item.platform === "netease") {
      return { type: "login-netease" };
    }
    return { type: "login-platform", platform: item.platform };
  }
  return { type: "switch-platform", platform: item.platform };
};

