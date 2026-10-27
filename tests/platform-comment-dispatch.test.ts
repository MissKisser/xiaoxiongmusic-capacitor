/**
 * 评论平台分发单元测试 (dispatchComments / dispatchHotComments)
 *
 * 覆盖：
 * 1. 平台评论分页参数拼装（QQ mid/type/page/limit、酷狗 mixsongid/type/page/limit）
 * 2. 游标透传（请求侧传入上一页游标、响应侧回传下一页游标）
 * 3. 空响应降级（空列表 / hasMore=false / cursor 缺省）
 * 4. 热门评论通道的通道映射与固定首页参数
 * 5. 平台评论 id 的稳定数值化
 *
 * 通过 setPlatformCallInterceptor 拦截传输层，不发起真实网络请求。
 *
 * @author Hackerdallas
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { dispatchComments, dispatchHotComments } from "../src/api/platform/dispatch";
import {
  setPlatformCallInterceptor,
  type PlatformCallInterceptor,
} from "../src/api/platform/music";
import type { ApiPlatform } from "../src/types/shared";

/** 拦截到的最近一次模块调用 */
let lastCall: { platform: ApiPlatform; name: string; params: Record<string, unknown> } | null = null;

/**
 * 用固定响应装载拦截器
 * @param platform 目标平台
 * @param name 目标模块名
 * @param payload 模块原生返回
 */
const stubModule = (
  platform: ApiPlatform,
  name: string,
  payload: Record<string, unknown>,
): void => {
  const interceptor: PlatformCallInterceptor = async (calledPlatform, calledName, params) => {
    if (calledPlatform !== platform || calledName !== name) return undefined;
    lastCall = { platform: calledPlatform, name: calledName, params: params ?? {} };
    return payload;
  };
  setPlatformCallInterceptor(interceptor);
};

describe("评论平台分发 dispatchComments / dispatchHotComments", () => {
  beforeEach(() => {
    lastCall = null;
  });

  afterEach(() => {
    setPlatformCallInterceptor(null);
  });

  it("QQ 评论：sortType=3 映射最新通道，页码与每页数量按原值透传", async () => {
    stubModule("qqmusic", "comment", {
      comments: [
        {
          id: "c1",
          content: "好听",
          publishTime: 1700000000,
          praiseNum: 5,
          nick: "小明",
          encryptedUin: "enc-1",
        },
      ],
      total: 100,
      hasMore: true,
      nextCursor: "cursor-next",
    });

    const result = await dispatchComments("qqmusic", {
      id: 123,
      platformId: "MID_ABC",
      type: 0,
      page: 2,
      pageSize: 20,
      sortType: 3,
      cursor: "cursor-prev",
    });

    assert.ok(lastCall, "应拦截到 comment 模块调用");
    assert.equal(lastCall.params.mid, "MID_ABC");
    assert.equal(lastCall.params.type, "new");
    assert.equal(lastCall.params.page, 2);
    assert.equal(lastCall.params.limit, 20);
    assert.equal(lastCall.params.cursor, "cursor-prev");

    assert.equal(result.total, 100);
    assert.equal(result.hasMore, true);
    assert.equal(result.cursor, "cursor-next");
    assert.equal(result.comments.length, 1);
    assert.equal(result.comments[0].content, "好听");
    // QQ 的秒级时间戳换算为毫秒口径
    assert.equal(result.comments[0].time, 1700000000000);
    assert.equal(result.comments[0].likedCount, 5);
    assert.equal(result.comments[0].user.name, "小明");
  });

  it("QQ 评论：sortType 非 3 映射热门通道", async () => {
    stubModule("qqmusic", "comment", { comments: [], total: 0, hasMore: false });
    await dispatchComments("qqmusic", { id: 1, sortType: 2 });
    assert.equal(lastCall?.params.type, "hot");
  });

  it("QQ 评论：缺省 platformId 时回退数字 id 字符串", async () => {
    stubModule("qqmusic", "comment", { comments: [], total: 0, hasMore: false });
    await dispatchComments("qqmusic", { id: 456, sortType: 3 });
    assert.equal(lastCall?.params.mid, "456");
  });

  it("QQ 评论：数字型游标（网易口径）不透传给平台，收敛为空串", async () => {
    stubModule("qqmusic", "comment", { comments: [], total: 0, hasMore: false });
    await dispatchComments("qqmusic", { id: 1, sortType: 3, cursor: 1700000000000 });
    assert.equal(lastCall?.params.cursor, "");
  });

  it("酷狗评论：mixsongid 取数字 id，歌曲池与分页参数拼装", async () => {
    stubModule("kugou", "comment", {
      comments: [
        {
          id: "kg-1",
          content: "支持",
          time: "2023-11-14 22:13:20",
          likedCount: 3,
          user: { id: "u1", name: "小红", avatar: "https://imge.kugou.com/a{size}.jpg" },
        },
      ],
      total: 40,
      page: 3,
      maxPage: 5,
      nextCursor: undefined,
    });

    const result = await dispatchComments("kugou", {
      id: 789,
      type: 0,
      page: 3,
      pageSize: 20,
      sortType: 3,
    });

    assert.ok(lastCall, "应拦截到 comment 模块调用");
    assert.equal(lastCall.params.mixsongid, "789");
    assert.equal(lastCall.params.type, "song");
    assert.equal(lastCall.params.page, 3);
    assert.equal(lastCall.params.limit, 20);

    // 酷狗不给 hasMore，用「当前页 < 总页数」判定
    assert.equal(result.hasMore, true);
    assert.equal(result.comments.length, 1);
    assert.equal(result.comments[0].likedCount, 3);
  });

  it("空响应降级：QQ 空列表返回空分页且游标缺省", async () => {
    stubModule("qqmusic", "comment", { comments: [], total: 0, hasMore: false });
    const result = await dispatchComments("qqmusic", { id: 1, platformId: "MID", sortType: 3 });
    assert.deepEqual(result.comments, []);
    assert.equal(result.hasMore, false);
    assert.equal(result.cursor, undefined);
    assert.equal(result.total, 0);
  });

  it("空响应降级：酷狗无更多页时不误报 hasMore", async () => {
    stubModule("kugou", "comment", { comments: [], total: 0, page: 1, maxPage: 0 });
    const result = await dispatchComments("kugou", { id: 2, sortType: 3 });
    assert.deepEqual(result.comments, []);
    assert.equal(result.hasMore, false);
    assert.equal(result.cursor, undefined);
  });

  it("热门评论：QQ 走热门通道固定首页空游标", async () => {
    stubModule("qqmusic", "comment", {
      comments: [
        { id: "hot-1", content: "热评", publishTime: 1600000000, praiseNum: 999, nick: "大V" },
      ],
      total: 1,
      hasMore: false,
    });
    const result = await dispatchHotComments("qqmusic", { id: 1, platformId: "MID", type: 0 });
    assert.equal(lastCall?.params.mid, "MID");
    assert.equal(lastCall?.params.type, "hot");
    assert.equal(lastCall?.params.page, 1);
    assert.equal(lastCall?.params.cursor, "");
    assert.equal(result.comments.length, 1);
    assert.equal(result.comments[0].content, "热评");
  });

  it("热门评论：酷狗复用列表端点取第一页", async () => {
    stubModule("kugou", "comment", { comments: [], total: 0, page: 1, maxPage: 1 });
    const result = await dispatchHotComments("kugou", { id: 3, type: 0, pageSize: 20 });
    assert.equal(lastCall?.params.mixsongid, "3");
    assert.equal(lastCall?.params.type, "song");
    assert.equal(lastCall?.params.page, 1);
    assert.equal(lastCall?.params.limit, 20);
    // maxPage=1 时当前页已是末页
    assert.equal(result.hasMore, false);
  });

  it("平台评论 id 数值化稳定：同一平台 id 恒映射同一数字 id", async () => {
    const rawComment = {
      id: "1!AbCdEf",
      content: "稳定",
      publishTime: 1500000000,
      praiseNum: 1,
      nick: "用户",
    };
    stubModule("qqmusic", "comment", {
      comments: [rawComment],
      total: 1,
      hasMore: false,
    });
    const first = await dispatchComments("qqmusic", { id: 1, platformId: "MID", sortType: 3 });
    const second = await dispatchComments("qqmusic", { id: 1, platformId: "MID", sortType: 3 });
    assert.equal(first.comments[0].id, second.comments[0].id);
    assert.ok(Number.isInteger(first.comments[0].id));
    assert.ok(first.comments[0].id > 0);
  });
});
