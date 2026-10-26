/**
 * 平台能力矩阵、路由可见性、错误文案与音乐调用测试 (capability.ts, errorText.ts, music.ts)
 *
 * 覆盖：
 * 1. 路由可用性判定与网易云行为零回归 (isRouteSupported)
 * 2. 首页区块支持度 (isHomeSectionSupported)
 * 3. 标签页可见性 (DISCOVER_TABS, LIKE_TABS)
 * 4. 平台错误文案翻译与播放失败原因解析 (describeFailure, describePlaybackFailure)
 * 5. 核心调用桥梁契约同构性 (executePlatformCall, PlatformAuthExpiredError)
 *
 * @author Hackerdallas
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  DISCOVER_TABS,
  isHomeSectionSupported,
  isRouteSupported,
  LIKE_TABS,
  NETEASE_ONLY_ROUTES,
  PLATFORM_UNSUPPORTED_ROUTES,
  RADIO_ROUTES,
} from "../src/api/platform/capability";
import {
  describeFailure,
  describePlaybackFailure,
  KG_ERROR_TEXT,
  PLATFORM_REASON_TEXT,
  PLAYBACK_FAILED_TEXT,
  resolvePlaybackFailureText,
} from "../src/api/platform/errorText";
import {
  executePlatformCall,
  listPlatformModules,
  PlatformAuthExpiredError,
} from "../src/api/platform/music";
import {
  dispatchLikedSongIds,
  invalidatePlaylistListCache,
  toCoverType,
  type DispatchPlaylist,
} from "../src/api/platform/dispatch";
import type { SongType } from "../src/types/main";

describe("平台能力与路由可见性 capability", () => {
  it("网易云独有路由仅网易云放行，第三方平台拦截", () => {
    for (const route of NETEASE_ONLY_ROUTES) {
      assert.equal(isRouteSupported("netease", route), true, `网易云应支持路由: ${route}`);
      assert.equal(isRouteSupported("qqmusic", route), false, `QQ音乐应拦截路由: ${route}`);
      assert.equal(isRouteSupported("kugou", route), false, `酷狗应拦截路由: ${route}`);
    }
  });

  it("有声内容路由：网易云与酷狗（听书）放行，QQ 音乐拦截", () => {
    for (const route of RADIO_ROUTES) {
      assert.equal(isRouteSupported("netease", route), true);
      assert.equal(isRouteSupported("kugou", route), true);
      assert.equal(isRouteSupported("qqmusic", route), false);
    }
  });

  it("平台专属每日推荐页：网易云拦截，第三方平台放行", () => {
    assert.equal(isRouteSupported("netease", "platform-daily-songs"), false);
    assert.equal(isRouteSupported("qqmusic", "platform-daily-songs"), true);
    assert.equal(isRouteSupported("kugou", "platform-daily-songs"), true);
  });

  it("通用路由全平台放行", () => {
    const commonRoutes = ["discover-playlists", "discover-toplists", "discover-artists", "setting"];
    for (const route of commonRoutes) {
      assert.equal(isRouteSupported("netease", route), true);
      assert.equal(isRouteSupported("qqmusic", route), true);
      assert.equal(isRouteSupported("kugou", route), true);
    }
  });

  it("首页区块支持度 isHomeSectionSupported", () => {
    // QQ 支持 square, recommend, singer, album
    assert.equal(isHomeSectionSupported("qqmusic", "square"), true);
    assert.equal(isHomeSectionSupported("qqmusic", "recommend"), true);
    assert.equal(isHomeSectionSupported("qqmusic", "radioTheme"), false);

    // 酷狗支持 square, singer, album, radioTheme；不支持 recommend
    assert.equal(isHomeSectionSupported("kugou", "radioTheme"), true);
    assert.equal(isHomeSectionSupported("kugou", "recommend"), false);

    // 网易云全量支持
    assert.equal(isHomeSectionSupported("netease", "anything"), true);
  });

  it("标签页真源定义完整性", () => {
    assert.equal(DISCOVER_TABS.netease.length, 4);
    assert.equal(DISCOVER_TABS.qqmusic.length, 3);
    assert.equal(DISCOVER_TABS.kugou.length, 3);

    assert.equal(LIKE_TABS.netease.length, 5);
    assert.equal(LIKE_TABS.qqmusic.length, 1);
    assert.equal(LIKE_TABS.kugou.length, 1);
  });
});

describe("错误文案翻译 errorText", () => {
  it("酷狗业务错误码翻译", () => {
    assert.equal(describeFailure("kugou", undefined, "创建歌单失败：error_code=20010"), KG_ERROR_TEXT["20010"]);
    assert.equal(describeFailure("kugou", undefined, "error_code=20017"), KG_ERROR_TEXT["20017"]);
    assert.equal(describeFailure("kugou", undefined, "error_code=30203"), KG_ERROR_TEXT["30203"]);
  });

  it("HTTP 状态码与通用错误描述", () => {
    assert.equal(describeFailure("qqmusic", 401), "登录状态已失效，请重新登录后再试");
    assert.equal(describeFailure("qqmusic", 404), "未找到目标歌单，或该平台暂未开放此能力");
    assert.equal(describeFailure("qqmusic", 400, "参数错误"), "参数错误");
  });

  it("describePlaybackFailure 播放失败原因翻译", () => {
    assert.equal(describePlaybackFailure("qqmusic", { reason: "need_pay" }), PLATFORM_REASON_TEXT.need_pay);
    assert.equal(describePlaybackFailure("qqmusic", { reason: "no_authorization" }), PLATFORM_REASON_TEXT.no_authorization);
    assert.equal(describePlaybackFailure("qqmusic", { reason: "filename_rejected" }), PLATFORM_REASON_TEXT.filename_rejected);
    assert.equal(describePlaybackFailure("qqmusic", { reason: "vkey_error" }), PLATFORM_REASON_TEXT.vkey_error);

    // 酷狗 status
    assert.equal(describePlaybackFailure("kugou", { status: 3 }), "当前账号没有该歌曲的播放权限，已尝试换源未成功");
    assert.equal(describePlaybackFailure("kugou", { status: 2 }), "该歌曲需要付费，已尝试换源未成功");
    assert.equal(describePlaybackFailure("kugou", { privilege: 10 }), "该歌曲需要付费，已尝试换源未成功");
    assert.equal(describePlaybackFailure("kugou", { status: 1, privilege: 0 }), PLAYBACK_FAILED_TEXT);
  });

  it("resolvePlaybackFailureText 优先级：平台错误优先于本地原因", () => {
    const text = resolvePlaybackFailureText(
      { platform: "qqmusic", reason: "need_pay" },
      "本地未开启换源",
    );
    assert.equal(text, PLATFORM_REASON_TEXT.need_pay);

    const fallback = resolvePlaybackFailureText(undefined, "无匹配歌曲");
    assert.equal(fallback, "无匹配歌曲");
  });
});

describe("直调核心桥梁 music.ts", () => {
  it("listPlatformModules 正确列出 QQ 音乐与酷狗核心模块", () => {
    const qqMods = listPlatformModules("qqmusic");
    assert.ok(qqMods.includes("search"));
    assert.ok(qqMods.includes("song_url"));
    assert.ok(qqMods.includes("user_playlist_list"));

    const kgMods = listPlatformModules("kugou");
    assert.ok(kgMods.includes("search"));
    assert.ok(kgMods.includes("song_url"));
    assert.ok(kgMods.includes("playlist_tracks"));
  });

  it("executePlatformCall 调用不支持的平台返回 UNKNOWN 错误响应", async () => {
    const res = await executePlatformCall("netease", "search");
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.equal(res.errorCode, "UNKNOWN");
    }
  });

  it("PlatformAuthExpiredError 保留平台标识与业务码", () => {
    const err = new PlatformAuthExpiredError("qqmusic", "登录凭据已失效", 0, 1000);
    assert.equal(err.platform, "qqmusic");
    assert.equal(err.message, "登录凭据已失效");
    assert.equal(err.outer, 0);
    assert.equal(err.inner, 1000);
    assert.ok(err instanceof Error);
  });
});

describe("分派层基础能力 dispatch", () => {
  it("toCoverType 规范转换 DispatchPlaylist 结构", () => {
    const playlist: DispatchPlaylist = {
      id: "123456",
      name: "我的测试歌单",
      cover: "https://example.com/cover.jpg",
      count: 25,
      playCount: 1000,
      description: "歌单简介",
      creatorName: "创建者小明",
      createTime: 1700000000000,
      updateTime: 1700000050000,
      platform: "qqmusic",
      platformId: "123456",
      subscribed: false,
      isLiked: true,
      sourceReadable: true,
    };

    const cover = toCoverType(playlist);
    assert.equal(cover.id, "123456");
    assert.equal(cover.name, "我的测试歌单");
    assert.equal(cover.cover, "https://example.com/cover.jpg");
    assert.equal(cover.count, 25);
    assert.equal(cover.playCount, 1000);
    assert.equal(cover.creator?.name, "创建者小明");
    assert.equal(cover.createTime, 1700000000000);
    assert.equal(cover.sourceReadable, true);
  });

  it("dispatchLikedSongIds 提取正整数 ID 并隔离网易云", async () => {
    // 网易云恒返回空集合
    const neteaseIds = await dispatchLikedSongIds("netease");
    assert.equal(neteaseIds.size, 0);

    // 传入指定曲目列表
    const tracks: SongType[] = [
      { id: 101, name: "歌1", artists: "", album: "", cover: "", duration: 0, free: 0, mv: null, type: "song" },
      { id: 202, name: "歌2", artists: "", album: "", cover: "", duration: 0, free: 0, mv: null, type: "song" },
      { id: 0, name: "非法", artists: "", album: "", cover: "", duration: 0, free: 0, mv: null, type: "song" },
      { id: -5, name: "非法", artists: "", album: "", cover: "", duration: 0, free: 0, mv: null, type: "song" },
    ];

    const qqIds = await dispatchLikedSongIds("qqmusic", tracks);
    assert.equal(qqIds.size, 2);
    assert.ok(qqIds.has(101));
    assert.ok(qqIds.has(202));
    assert.ok(!qqIds.has(0));

    const kgIds = await dispatchLikedSongIds("kugou", tracks);
    assert.equal(kgIds.size, 2);
    assert.ok(kgIds.has(101));
    assert.ok(kgIds.has(202));
  });

  it("invalidatePlaylistListCache 可正常执行不抛异常", () => {
    assert.doesNotThrow(() => invalidatePlaylistListCache("qqmusic"));
    assert.doesNotThrow(() => invalidatePlaylistListCache("kugou"));
    assert.doesNotThrow(() => invalidatePlaylistListCache());
  });
});
