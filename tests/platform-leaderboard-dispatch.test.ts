/**
 * 榜单平台分发单测 (dispatch.ts dispatchLeaderboardGroups / dispatchLeaderboardDetail / dispatchLeaderboard)
 *
 * 通过 setPlatformCallInterceptor 拦截平台数据面调用，覆盖：
 * 1. 榜单分组取数（QQ / 酷狗 leaderboard_list 模块路由、酷狗分组号透传、清单结构归一化）；
 * 2. 平台 id 归一化（boardId 到 QQ topid / 酷狗 rankid 的映射、曲目平台主键透出）；
 * 3. 分页（酷狗按页取回 + hasMore 判定，QQ 一次全量无翻页）；
 * 4. 空响应降级（网易云无榜单数据源、上游空响应归一为空结果）。
 *
 * @author Hackerdallas
 */

import "./helpers/setup";
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  setPlatformCallInterceptor,
  type PlatformCallInterceptor,
} from "../src/api/platform/music";
import {
  dispatchLeaderboard,
  dispatchLeaderboardDetail,
  dispatchLeaderboardGroups,
} from "../src/api/platform/dispatch";
import type { ApiPlatform } from "../src/types/shared";

/** 拦截到的数据面调用记录 */
interface RecordedCall {
  platform: ApiPlatform;
  name: string;
  params: Record<string, unknown>;
}

let calls: RecordedCall[] = [];

/**
 * 安装拦截器，按平台与模块名返回桩响应并记录调用
 * @param respond 桩响应构造器
 */
const installInterceptor = (
  respond: (platform: ApiPlatform, name: string, params: Record<string, unknown>) => unknown,
): void => {
  const interceptor: PlatformCallInterceptor = (platform, name, params) => {
    calls.push({ platform, name, params: params ?? {} });
    return respond(platform, name, params ?? {});
  };
  setPlatformCallInterceptor(interceptor);
};

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  setPlatformCallInterceptor(null);
});

describe("榜单分组取数", () => {
  it("QQ 音乐分组清单路由到 leaderboard_list 模块并归一化分组结构", async () => {
    installInterceptor((_platform, name) => {
      assert.equal(name, "leaderboard_list");
      return {
        groups: [
          {
            groupId: 1,
            groupName: "巅峰榜",
            toplists: [
              {
                topId: 26,
                title: "流行指数榜",
                subTitle: "每周四更新",
                period: "第 42 期",
                updateTime: "2026-10-23",
                cover: "https://example.com/qq-board.jpg",
                total: 100,
                tracks: [
                  { title: "晴天", singer: "周杰伦" },
                  { title: "稻香", singer: "周杰伦" },
                  { title: "夜曲", singer: "周杰伦" },
                  { title: "不该被截断的第四首", singer: "某人" },
                ],
              },
            ],
          },
        ],
      };
    });
    const groups = await dispatchLeaderboardGroups("qqmusic");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].platform, "qqmusic");
    assert.equal(groups.length, 1);
    assert.equal(groups[0].groupId, 1);
    assert.equal(groups[0].groupName, "巅峰榜");
    const board = groups[0].toplists[0];
    assert.equal(board.topId, 26);
    assert.equal(board.title, "流行指数榜");
    assert.equal(board.period, "第 42 期");
    assert.equal(board.total, 100);
    assert.equal(board.groupName, "巅峰榜");
    // 曲目前览最多保留前三首
    assert.equal(board.tracks?.length, 3);
    assert.equal(board.tracks?.[0].first, "晴天");
    assert.equal(board.tracks?.[0].second, "周杰伦");
  });

  it("酷狗分组清单透传分组号，榜单号兼容 rankId 字段", async () => {
    installInterceptor((_platform, _name, params) => {
      assert.equal(params.groupId, 7);
      return {
        groups: [
          {
            groupId: 7,
            groupName: "特色榜",
            toplists: [{ rankId: 3000, title: "飙升榜", total: 500 }],
          },
        ],
      };
    });
    const groups = await dispatchLeaderboardGroups("kugou", { groupId: 7 });
    assert.equal(calls[0].name, "leaderboard_list");
    assert.equal(groups[0].toplists[0].topId, 3000);
    assert.equal(groups[0].toplists[0].title, "飙升榜");
    // 清单源不带曲目时预览为空数组，卡片据此只保留信息位
    assert.deepEqual(groups[0].toplists[0].tracks, []);
  });

  it("网易云没有分组榜单：恒返回空清单且不发起数据面调用", async () => {
    const groups = await dispatchLeaderboardGroups("netease");
    assert.deepEqual(groups, []);
    assert.equal(calls.length, 0);
  });
});

describe("榜单详情平台 id 归一化", () => {
  it("QQ 音乐详情把 boardId 映射为 topid 并透出曲目平台主键（mid）", async () => {
    installInterceptor((_platform, name, params) => {
      assert.equal(name, "leaderboard_detail");
      assert.equal(params.topid, 26);
      assert.equal(params.limit, 100);
      return {
        title: "流行指数榜",
        subTitle: "每周四更新",
        cover: "https://example.com/qq-board.jpg",
        total: 2,
        songs: [
          { id: 101, mid: "001abc", name: "晴天", singer: "周杰伦", interval: 269 },
          { id: 102, mid: "002def", name: "稻香", singer: "周杰伦", interval: 223 },
        ],
      };
    });
    const detail = await dispatchLeaderboardDetail("qqmusic", { boardId: 26, limit: 100 });
    assert.equal(detail.title, "流行指数榜");
    assert.equal(detail.total, 2);
    assert.equal(detail.songs.length, 2);
    assert.equal(detail.songs[0].name, "晴天");
    assert.equal(detail.songs[0].platform, "qqmusic");
    assert.equal(detail.songs[0].platformId, "001abc");
    // QQ 音乐一次给全量榜单曲目（无翻页概念），不回传 hasMore
    assert.equal(detail.hasMore, undefined);
  });

  it("酷狗详情把 boardId 映射为 rankid 并透出曲目平台主键（hash）", async () => {
    installInterceptor((_platform, name, params) => {
      assert.equal(name, "leaderboard_detail");
      assert.equal(params.rankid, 3000);
      return {
        title: "TOP500",
        subTitle: "酷狗音乐官方榜",
        cover: "https://example.com/kg-board.jpg",
        total: 500,
        songs: [{ hash: "KGHASH01", mixSongId: 9001, name: "试听曲", singer: "测试歌手" }],
      };
    });
    const detail = await dispatchLeaderboardDetail("kugou", { boardId: 3000 });
    assert.equal(calls[0].params.rankid, 3000);
    assert.equal(detail.songs[0].platform, "kugou");
    assert.equal(detail.songs[0].platformId, "KGHASH01");
  });

  it("网易云没有榜单详情数据源：返回空结果且不发起数据面调用", async () => {
    const detail = await dispatchLeaderboardDetail("netease", { boardId: 1 });
    assert.deepEqual(detail, { title: "", subTitle: "", cover: "", total: 0, songs: [] });
    assert.equal(calls.length, 0);
  });
});

describe("榜单详情分页", () => {
  it("酷狗按页取回：页码与页大小透传，hasMore 按累计进度判定", async () => {
    installInterceptor(() => ({ total: 300, songs: [] }));
    const middle = await dispatchLeaderboardDetail("kugou", {
      boardId: 3000,
      page: 2,
      limit: 100,
    });
    assert.equal(calls[0].params.page, 2);
    assert.equal(calls[0].params.limit, 100);
    // 第 2 页（累计 200 / 300）还有下一页
    assert.equal(middle.hasMore, true);
    const last = await dispatchLeaderboardDetail("kugou", {
      boardId: 3000,
      page: 3,
      limit: 100,
    });
    // 第 3 页（累计 300 / 300）没有下一页
    assert.equal(last.hasMore, false);
  });

  it("dispatchLeaderboard 缺省参数走各平台缺省榜单（QQ 热歌榜 / 酷狗 TOP500）", async () => {
    installInterceptor(() => ({ title: "榜", songs: [], total: 0 }));
    await dispatchLeaderboard("qqmusic", {});
    assert.equal(calls[0].name, "leaderboard");
    assert.equal(calls[0].params.topid, 26);
    assert.equal(calls[0].params.limit, 50);
    await dispatchLeaderboard("kugou", { rankid: 3000, page: 2, limit: 50 });
    assert.equal(calls[1].name, "leaderboard_detail");
    assert.equal(calls[1].params.rankid, 3000);
    assert.equal(calls[1].params.page, 2);
    assert.equal(calls[1].params.limit, 50);
  });
});

describe("榜单空响应降级", () => {
  it("平台清单空响应归一为空分组数组", async () => {
    installInterceptor(() => ({}));
    for (const platform of ["qqmusic", "kugou"] as const) {
      const groups = await dispatchLeaderboardGroups(platform);
      assert.deepEqual(groups, [], `${platform} 空清单应归一为空数组`);
    }
  });

  it("平台详情空响应归一为空结果（曲目为空 / 总数为 0）", async () => {
    installInterceptor(() => ({}));
    const qq = await dispatchLeaderboardDetail("qqmusic", { boardId: 26 });
    assert.equal(qq.total, 0);
    assert.deepEqual(qq.songs, []);
    const kg = await dispatchLeaderboardDetail("kugou", { boardId: 3000 });
    assert.equal(kg.total, 0);
    assert.deepEqual(kg.songs, []);
    // 上游未给总数时酷狗按「无下一页」收敛，不产生无意义的翻页请求
    assert.equal(kg.hasMore, false);
  });

  it("dispatchLeaderboard 对无数据源平台返回空结果", async () => {
    const empty = await dispatchLeaderboard("netease", {});
    assert.deepEqual(empty, { title: "", subTitle: "", cover: "", total: 0, songs: [] });
    assert.equal(calls.length, 0);
  });
});
