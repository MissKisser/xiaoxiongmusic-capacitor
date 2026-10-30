/**
 * 搜索平台分发单测 (dispatch.ts dispatchSearch / dispatchHotSearch, suggest.ts dispatchSearchSuggest)
 *
 * 通过 setPlatformCallInterceptor 拦截平台数据面调用，覆盖：
 * 1. 搜索分类到平台模块参数的映射（QQ / 酷狗 search 模块的 type 口径与关键词透传）；
 * 2. 分页参数拼装（页码透传、QQ 单页 40 上限收敛、hasMore 翻页判定）；
 * 3. 平台返回结构差异的归一化（platform / platformId 在四类结果上透出）；
 * 4. 空响应降级（空搜索结果、酷狗热搜空列表、空热搜列表、空建议分组）。
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
import { dispatchSearch, dispatchHotSearch } from "../src/api/platform/dispatch";
import { dispatchSearchSuggest } from "../src/api/platform/suggest";
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

describe("搜索分类到平台参数映射", () => {
  it("QQ 音乐四类搜索映射到 search 模块的 type 口径（0 单曲 / 2 歌单 / 8 专辑 / 9 歌手）", async () => {
    installInterceptor(() => ({}));
    const categories = [
      { category: "song", type: 0 },
      { category: "playlist", type: 2 },
      { category: "album", type: 8 },
      { category: "artist", type: 9 },
    ] as const;
    for (const { category, type } of categories) {
      await dispatchSearch("qqmusic", { keyword: "周杰伦", category, page: 1, limit: 30 });
    }
    assert.equal(calls.length, 4);
    for (let index = 0; index < categories.length; index += 1) {
      assert.equal(calls[index].platform, "qqmusic");
      assert.equal(calls[index].name, "search");
      assert.equal(calls[index].params.keywords, "周杰伦");
      assert.equal(calls[index].params.type, categories[index].type);
      assert.equal(calls[index].params.page, 1);
      assert.equal(calls[index].params.limit, 30);
    }
  });

  it("酷狗四类搜索映射到 search 模块的 type 口径，关键词与页码透传", async () => {
    installInterceptor(() => ({}));
    const categories = [
      { category: "song", type: 0 },
      { category: "playlist", type: 2 },
      { category: "album", type: 8 },
      { category: "artist", type: 9 },
    ] as const;
    for (const { category, type } of categories) {
      await dispatchSearch("kugou", { keyword: "国风", category, page: 1, limit: 30 });
    }
    assert.equal(calls.length, 4);
    for (let index = 0; index < categories.length; index += 1) {
      assert.equal(calls[index].platform, "kugou");
      assert.equal(calls[index].name, "search");
      assert.equal(calls[index].params.keywords, "国风");
      assert.equal(calls[index].params.type, categories[index].type);
      assert.equal(calls[index].params.page, 1);
      assert.equal(calls[index].params.limit, 30);
    }
  });
});

describe("搜索分页参数拼装", () => {
  it("QQ 音乐单页上限收敛为 40，页码透传", async () => {
    installInterceptor(() => ({ total: 0 }));
    await dispatchSearch("qqmusic", { keyword: "jay", category: "song", page: 3, limit: 50 });
    assert.equal(calls[0].params.page, 3);
    assert.equal(calls[0].params.limit, 40);
  });

  it("QQ 音乐未超上限的页大小原样透传", async () => {
    installInterceptor(() => ({ total: 0 }));
    await dispatchSearch("qqmusic", { keyword: "jay", category: "song", page: 1, limit: 30 });
    assert.equal(calls[0].params.limit, 30);
  });

  it("酷狗页大小不受 QQ 上限约束，按原值透传", async () => {
    installInterceptor(() => ({ total: 0 }));
    await dispatchSearch("kugou", { keyword: "guofeng", category: "song", page: 2, limit: 50 });
    assert.equal(calls[0].params.page, 2);
    assert.equal(calls[0].params.limit, 50);
  });

  it("hasMore 按 page * limit < total 判定：中间页为真、末页为假", async () => {
    // QQ：total 100，单页 40 → 第 2 页（累计 80）还有，第 3 页（累计 120）没有
    installInterceptor(() => ({ total: 100, songs: [] }));
    const middlePage = await dispatchSearch("qqmusic", {
      keyword: "jay",
      category: "song",
      page: 2,
      limit: 50,
    });
    assert.equal(middlePage.total, 100);
    assert.equal(middlePage.hasMore, true);
    const lastPage = await dispatchSearch("qqmusic", {
      keyword: "jay",
      category: "song",
      page: 3,
      limit: 50,
    });
    assert.equal(lastPage.hasMore, false);
  });
});

describe("平台返回结构归一化", () => {
  it("QQ 单曲结果归一为应用内歌曲并带平台归属（platformId 取 mid）", async () => {
    installInterceptor((_platform, name) => {
      assert.equal(name, "search");
      return {
        total: 1,
        songs: [
          {
            id: 101,
            mid: "001abc",
            name: "晴天",
            artist: "周杰伦",
            album: { name: "叶惠美" },
            duration: 269000,
          },
        ],
      };
    });
    const result = await dispatchSearch("qqmusic", { keyword: "晴天", category: "song", page: 1, limit: 30 });
    assert.equal(result.total, 1);
    assert.equal(result.songs.length, 1);
    const song = result.songs[0];
    assert.equal(song.name, "晴天");
    assert.equal(song.platform, "qqmusic");
    assert.equal(song.platformId, "001abc");
    assert.equal(song.artists[0].name, "周杰伦");
    assert.equal(song.album.name, "叶惠美");
    assert.equal(result.playlists.length, 0);
    assert.equal(result.albums.length, 0);
    assert.equal(result.artists.length, 0);
  });

  it("酷狗单曲结果归一为应用内歌曲并带平台归属（platformId 取 hash）", async () => {
    installInterceptor(() => ({
      total: 1,
      songs: [
        {
          hash: "KGHASH01",
          mixSongId: 9001,
          name: "试听曲",
          artist: "测试歌手",
          albumId: "77",
          album: "测试专辑",
        },
      ],
    }));
    const result = await dispatchSearch("kugou", { keyword: "试听", category: "song", page: 1, limit: 30 });
    const song = result.songs[0];
    assert.equal(song.name, "试听曲");
    assert.equal(song.platform, "kugou");
    assert.equal(song.platformId, "KGHASH01");
    assert.equal(song.artists[0].name, "测试歌手");
  });

  it("QQ 歌单 / 专辑 / 歌手结果分别落位到对应分组并带平台归属", async () => {
    installInterceptor((_platform, _name, params) => {
      const type = params.type as number;
      if (type === 2) {
        return {
          total: 1,
          playlists: [{ id: "P123", name: "平台歌单", cover: "", trackCount: 10, creator: "造物主" }],
        };
      }
      if (type === 8) {
        return {
          total: 1,
          albums: [{ id: "A456", albumId: "A456", name: "平台专辑", cover: "", trackCount: 12 }],
        };
      }
      return {
        total: 1,
        artists: [{ id: "artistMid", name: "平台歌手", albumCount: 5, songCount: 50 }],
      };
    });
    const playlists = await dispatchSearch("qqmusic", { keyword: "好歌", category: "playlist", page: 1, limit: 30 });
    assert.equal(playlists.playlists.length, 1);
    assert.equal(playlists.playlists[0].name, "平台歌单");
    assert.equal(playlists.playlists[0].platform, "qqmusic");
    assert.equal(playlists.playlists[0].platformId, "P123");

    const albums = await dispatchSearch("qqmusic", { keyword: "好碟", category: "album", page: 1, limit: 30 });
    assert.equal(albums.albums.length, 1);
    assert.equal(albums.albums[0].name, "平台专辑");
    assert.equal(albums.albums[0].platform, "qqmusic");
    assert.equal(albums.albums[0].platformId, "A456");

    const artists = await dispatchSearch("qqmusic", { keyword: "好声", category: "artist", page: 1, limit: 30 });
    assert.equal(artists.artists.length, 1);
    assert.equal(artists.artists[0].name, "平台歌手");
    assert.equal(artists.artists[0].platform, "qqmusic");
    assert.ok(artists.artists[0].platformId);
  });

  it("酷狗歌单结果归一为封面模型并带平台归属", async () => {
    installInterceptor(() => ({
      total: 1,
      playlists: [{ id: "KG-P1", name: "酷狗歌单", cover: "", trackCount: 8, playCount: 100, creator: "小编" }],
    }));
    const result = await dispatchSearch("kugou", { keyword: "夜跑", category: "playlist", page: 1, limit: 30 });
    assert.equal(result.playlists.length, 1);
    assert.equal(result.playlists[0].name, "酷狗歌单");
    assert.equal(result.playlists[0].platform, "kugou");
    assert.equal(result.playlists[0].platformId, "KG-P1");
  });
});

describe("空响应降级", () => {
  it("平台搜索空响应归一为全空结果（total 0 / hasMore false）", async () => {
    installInterceptor(() => ({}));
    for (const platform of ["qqmusic", "kugou"] as const) {
      for (const category of ["song", "playlist", "album", "artist"] as const) {
        const result = await dispatchSearch(platform, { keyword: "无结果", category, page: 1, limit: 30 });
        assert.equal(result.total, 0, `${platform}/${category} total 应为 0`);
        assert.equal(result.hasMore, false, `${platform}/${category} hasMore 应为 false`);
        assert.deepEqual(result.songs, []);
        assert.deepEqual(result.playlists, []);
        assert.deepEqual(result.albums, []);
        assert.deepEqual(result.artists, []);
      }
    }
  });

  it("酷狗热搜走原生热搜模块 hot_search，条目不带热度值", async () => {
    installInterceptor(() => ({
      total: 2,
      list: [
        { rank: 1, keyword: "说好再见却再也不见", description: "" },
        { rank: 2, keyword: "我好像在哪见过你", description: "" },
      ],
    }));
    const hot = await dispatchHotSearch("kugou");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].platform, "kugou");
    assert.equal(calls[0].name, "hot_search");
    assert.equal(calls[0].params.limit, 20);
    assert.deepEqual(hot, [
      { searchWord: "说好再见却再也不见", content: "" },
      { searchWord: "我好像在哪见过你", content: "" },
    ]);
    // 上游不提供热度值，条目不含 score
    assert.equal(hot[0].score, undefined);
  });

  it("酷狗热搜模块返回空列表时降级为空数组", async () => {
    installInterceptor(() => ({ total: 0, list: [] }));
    const hot = await dispatchHotSearch("kugou");
    assert.deepEqual(hot, []);
  });

  it("QQ 热搜空列表降级为空数组", async () => {
    installInterceptor(() => ({ total: 0, list: [] }));
    const hot = await dispatchHotSearch("qqmusic");
    assert.deepEqual(hot, []);
  });

  it("QQ 热搜条目归一为网易云形状（searchWord / score / content）", async () => {
    installInterceptor(() => ({
      total: 1,
      list: [{ rank: 1, keyword: "热词", score: 99, cover: "", description: "热度说明" }],
    }));
    const hot = await dispatchHotSearch("qqmusic");
    assert.equal(hot.length, 1);
    assert.equal(hot[0].searchWord, "热词");
    assert.equal(hot[0].score, 99);
    assert.equal(hot[0].content, "热度说明");
  });

  it("平台建议在搜索全空时退化为带空分组的同构结构", async () => {
    installInterceptor(() => ({}));
    const suggest = await dispatchSearchSuggest("kugou", "空空如也");
    assert.deepEqual(suggest.order, ["songs", "artists", "albums", "playlists"]);
    assert.deepEqual(suggest.songs, []);
    assert.deepEqual(suggest.artists, []);
    assert.deepEqual(suggest.albums, []);
    assert.deepEqual(suggest.playlists, []);
  });
});
