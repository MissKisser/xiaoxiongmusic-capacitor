/**
 * 平台 UI 逻辑单测 (platform-ui-logic.test.ts)
 *
 * 覆盖：
 * 1. 路由可用性与守卫能力矩阵接线 (isRouteSupported, NETEASE_ONLY_ROUTES, RADIO_ROUTES)
 * 2. 首页区块能力矩阵与规整 (isHomeSectionSupported, normalizePlatformHomeSections)
 * 3. 收藏统计多平台映射逻辑 (useLikeStats 口径隔离与路由参数生成)
 * 4. 平台菜单状态映射与能力裁剪 (个人漫游/刷歌切换、播客电台/听书切换)
 *
 * @author Hackerdallas
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// 环境初始化
import "./helpers/setup";

import {
  isRouteSupported,
  isHomeSectionSupported,
  NETEASE_ONLY_ROUTES,
  RADIO_ROUTES,
  PLATFORM_UNSUPPORTED_ROUTES,
  PLATFORM_PLAYLIST_TYPE_QUERY,
} from "../src/api/platform/capability";
import {
  normalizePlatformHomeSections,
  PLATFORM_HOME_SECTION_KEYS,
  PLATFORM_HOME_SECTION_DEFAULTS,
} from "../src/stores/setting";
import { useLikeStats } from "../src/composables/useLikeStats";
import { useDataStore, usePlatformStore } from "../src/stores";
import { createPinia, setActivePinia } from "pinia";

describe("平台 UI 逻辑与能力矩阵接线", () => {
  it("路由守卫能力矩阵接线：第三方平台正确排除网易云专有页面", () => {
    // 网易云专属页面在第三方平台必须被拦截
    for (const route of NETEASE_ONLY_ROUTES) {
      assert.equal(isRouteSupported("qqmusic", route), false, `QQ 音乐应拦截 ${route}`);
      assert.equal(isRouteSupported("kugou", route), false, `酷狗应拦截 ${route}`);
      assert.equal(isRouteSupported("netease", route), true, `网易云应放行 ${route}`);
    }

    // 平台每日推荐页面在网易云平台必须被拦截
    assert.equal(isRouteSupported("netease", "platform-daily-songs"), false);
    assert.equal(isRouteSupported("qqmusic", "platform-daily-songs"), true);
    assert.equal(isRouteSupported("kugou", "platform-daily-songs"), true);

    // 有声内容在 QQ 音乐必须被拦截，在网易云与酷狗（听书）放行
    for (const route of RADIO_ROUTES) {
      assert.equal(isRouteSupported("qqmusic", route), false);
      assert.equal(isRouteSupported("kugou", route), true);
      assert.equal(isRouteSupported("netease", route), true);
    }
  });

  it("首页区块能力矩阵：正确识别各平台支持的数据源", () => {
    // QQ 音乐支持：square, recommend, singer, album
    assert.equal(isHomeSectionSupported("qqmusic", "square"), true);
    assert.equal(isHomeSectionSupported("qqmusic", "recommend"), true);
    assert.equal(isHomeSectionSupported("qqmusic", "singer"), true);
    assert.equal(isHomeSectionSupported("qqmusic", "album"), true);
    assert.equal(isHomeSectionSupported("qqmusic", "radioTheme"), false);

    // 酷狗音乐支持：square, singer, album, radioTheme（无 recommend）
    assert.equal(isHomeSectionSupported("kugou", "square"), true);
    assert.equal(isHomeSectionSupported("kugou", "recommend"), false);
    assert.equal(isHomeSectionSupported("kugou", "singer"), true);
    assert.equal(isHomeSectionSupported("kugou", "album"), true);
    assert.equal(isHomeSectionSupported("kugou", "radioTheme"), true);
  });

  it("平台首页栏目规整 normalizePlatformHomeSections：剔除废弃键并补齐默认项", () => {
    // 包含未知键与缺失项
    const dirty = [
      { key: "album", name: "自定义新碟", order: 2, visible: true },
      { key: "obsolete_key", name: "已废弃栏目", order: 1, visible: true },
    ];
    const normalized = normalizePlatformHomeSections(dirty);

    // 必须剔除 obsolete_key
    assert.equal(normalized.some((item) => item.key === ("obsolete_key" as any)), false);

    // 必须保留已知条目配置
    const album = normalized.find((item) => item.key === "album");
    assert.ok(album);
    assert.equal(album.name, "自定义新碟");
    assert.equal(album.order, 2);

    // 必须补齐所有缺席的已知键
    for (const key of PLATFORM_HOME_SECTION_KEYS) {
      assert.equal(normalized.some((item) => item.key === key), true, `必须补齐 ${key}`);
    }
  });

  it("收藏统计条目 useLikeStats：网易云与第三方平台口径严格隔离", () => {
    setActivePinia(createPinia());
    const dataStore = useDataStore();
    const platformStore = usePlatformStore();

    // 1. 网易云平台下的统计条目
    platformStore.currentPlatform = "netease";
    dataStore.userData.userId = 12345;
    dataStore.userLikeData.playlists = [
      { id: 1, name: "我喜欢的音乐", userId: 12345 } as any,
      { id: 2, name: "创建歌单1", userId: 12345 } as any,
      { id: 3, name: "收藏歌单1", userId: 67890 } as any,
    ];
    dataStore.userLikeData.albums = [{ id: 101 } as any];

    const stats = useLikeStats();
    const neteaseStats = stats.value;

    assert.equal(neteaseStats.find((s) => s.label === "歌单")?.length, 1); // 排除首项系统喜欢后的自建歌单
    assert.equal(neteaseStats.find((s) => s.label === "专辑")?.length, 1);

    // 2. 切换至第三方平台（QQ 音乐）
    platformStore.currentPlatform = "qqmusic";
    platformStore.playlists = {
      owned: [
        { id: 201, platform: "qqmusic", platformId: "201", name: "我喜欢", isLiked: true, count: 698, playCount: 0 },
        { id: 202, platform: "qqmusic", platformId: "202", name: "自建1", count: 10, playCount: 0 },
      ],
      favorites: [
        { id: 301, platform: "qqmusic", platformId: "301", name: "收藏歌单1", count: 50, playCount: 0 },
      ],
    };

    const qqStats = stats.value;
    const ownedStat = qqStats.find((s) => s.label === "创建");
    const favStat = qqStats.find((s) => s.label === "收藏");
    const likedStat = qqStats.find((s) => s.label === "喜欢");

    assert.ok(ownedStat);
    assert.equal(ownedStat.length, 2);
    assert.equal(ownedStat.query?.type, PLATFORM_PLAYLIST_TYPE_QUERY[0]);

    assert.ok(favStat);
    assert.equal(favStat.length, 1);
    assert.equal(favStat.query?.type, PLATFORM_PLAYLIST_TYPE_QUERY[1]);

    assert.ok(likedStat);
    assert.equal(likedStat.length, 698);
    assert.equal(likedStat.name, "like-songs");
  });
});
