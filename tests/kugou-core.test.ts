/**
 * 酷狗音乐平台核心逻辑、鉴权判定与模块门禁单元测试
 *
 * @author Hackerdallas
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  callKugou,
  clearKugouSession,
  getKgAppid,
  getKgClientver,
  isKugouAuthExpired,
  isKugouAuthExpiredCode,
  isKugouConceptMode,
  KugouApiError,
  listKugouModules,
  setKugouLoginVersion,
} from "../src/utils/platform/kugou";
import {
  createKugouRequestContext,
} from "../src/utils/platform/kugou/core/cloud";
import {
  collectArtistNames,
  extractEntryTitle,
  extractSongTitle,
} from "../src/utils/platform/kugou/core/song_title";
import {
  extractUrls,
  pickHashOffset,
  pickStatus,
  playableUrls,
} from "../src/utils/platform/kugou/core/song_url";
import { saveSessionCookies } from "../src/utils/platform/sessionStore";

describe("酷狗平台核心逻辑与模式跟随", () => {
  beforeEach(() => {
    clearKugouSession();
  });

  it("客户端模式动态切换：标准版与概念版 appid 及 clientver 跟随", () => {
    setKugouLoginVersion("standard");
    assert.equal(isKugouConceptMode(), false);
    assert.equal(getKgAppid(), 1005);
    assert.equal(getKgClientver(), 20489);

    setKugouLoginVersion("concept");
    assert.equal(isKugouConceptMode(), true);
    assert.equal(getKgAppid(), 3116);
    assert.equal(getKgClientver(), 11440);
  });

  it("写操作与协议请求上下文动态跟随登录模式（防 20017 错误）", () => {
    // 未登录时返回 null
    assert.equal(createKugouRequestContext(), null);

    // 写入模拟登录会话
    saveSessionCookies("kugou", {
      token: "mock_token_abc",
      userid: "1123056595",
      dfid: "mock_dfid_123",
    });

    // 概念版模式下上下文包含概念版标识
    setKugouLoginVersion("concept");
    const ctxConcept = createKugouRequestContext();
    assert.ok(ctxConcept);
    assert.equal(ctxConcept?.appid, 3116);
    assert.equal(ctxConcept?.clientver, 11440);
    assert.equal(ctxConcept?.userid, "1123056595");
    assert.equal(ctxConcept?.token, "mock_token_abc");

    // 标准版模式下上下文切换为标准版标识
    setKugouLoginVersion("standard");
    const ctxStandard = createKugouRequestContext();
    assert.ok(ctxStandard);
    assert.equal(ctxStandard?.appid, 1005);
    assert.equal(ctxStandard?.clientver, 20489);
  });
});

describe("酷狗鉴权状态分类与异常对象", () => {
  it("非零且非 200 业务码判定为鉴权失效", () => {
    assert.equal(isKugouAuthExpiredCode(0), false);
    assert.equal(isKugouAuthExpiredCode(200), false);
    assert.equal(isKugouAuthExpiredCode(20006), true);
    assert.equal(isKugouAuthExpiredCode(20017), true);
    assert.equal(isKugouAuthExpiredCode(1001), true);
  });

  it("KugouApiError 结构化异常", () => {
    const error = new KugouApiError(20017, "clientver mismatch");
    assert.equal(error.name, "KugouApiError");
    assert.equal(error.errorCode, 20017);
    assert.equal(error.upstreamMessage, "clientver mismatch");
    assert.equal(isKugouAuthExpired(error), true);

    const normalError = new Error("network failed");
    assert.equal(isKugouAuthExpired(normalError), false);
  });
});

describe("歌名剥离与歌手归一化", () => {
  it("从各种格式剥离纯歌名", () => {
    // 典型酷狗云歌单格式：歌手们 - 歌名.mp3
    assert.equal(
      extractSongTitle("周杰伦、阿信 - 说好不哭.mp3", { artistNames: ["周杰伦", "阿信"] }),
      "说好不哭",
    );

    // 歌名含副标题与连字符
    assert.equal(
      extractSongTitle("周杰伦 - 晴天 - Live.flac", { artistNames: ["周杰伦"] }),
      "晴天 - Live",
    );

    // 无扩展名，指定首段为歌手
    assert.equal(
      extractSongTitle("周杰伦 - 青花瓷", { artistPrefix: true }),
      "青花瓷",
    );
  });

  it("从歌曲条目收集全部歌手名", () => {
    const entry = {
      singerinfo: [{ name: "陈奕迅", id: 1001 }],
      artists: [{ name: "王菲", id: "2001" }],
      singername: "张学友",
    };
    const artists = collectArtistNames(entry);
    assert.ok(artists.includes("陈奕迅"));
    assert.ok(artists.includes("王菲"));
    assert.ok(artists.includes("张学友"));
  });

  it("extractEntryTitle 正确提取条目歌名", () => {
    const entry = {
      name: "邓紫棋 - 光年之外.flac",
      singerinfo: [{ name: "邓紫棋" }],
    };
    assert.equal(extractEntryTitle(entry), "光年之外");
  });
});

describe("播放地址判据与直链提取", () => {
  it("正确提取 status 与试听 hashOffset", () => {
    const responseWithOffset = {
      status: 2,
      hash_offset: { start_ms: 0, end_ms: 60000 },
    };
    assert.equal(pickStatus(responseWithOffset), 2);
    assert.deepEqual(pickHashOffset(responseWithOffset), { start_ms: 0, end_ms: 60000 });

    const responseTransParam = {
      status: 1,
      trans_param: { hash_offset: { start_ms: 1000, end_ms: 30000 } },
    };
    assert.deepEqual(pickHashOffset(responseTransParam), { start_ms: 1000, end_ms: 30000 });
  });

  it("可播放直链提取并过滤 mp4 视频", () => {
    const audioRes = {
      url: "https://fs.kugou.com/audio.mp3",
      backup_url: ["https://fs2.kugou.com/audio.mp3"],
      extName: "mp3",
    };
    assert.equal(playableUrls(audioRes).length, 2);

    const videoRes = {
      url: "https://fs.kugou.com/video.mp4",
      extName: "mp4",
    };
    assert.equal(playableUrls(videoRes).length, 0);
  });
});

describe("酷狗模块注册表与入参门禁拦截", () => {
  beforeEach(() => {
    clearKugouSession();
  });

  it("注册表包含本波交付的全部核心模块", () => {
    const registered = listKugouModules();
    assert.ok(registered.includes("login_qr_key"));
    assert.ok(registered.includes("login_qr_check"));
    assert.ok(registered.includes("user_detail"));
    assert.ok(registered.includes("user_playlist_list"));
    assert.ok(registered.includes("playlist_detail"));
    assert.ok(registered.includes("user_profile"));
    assert.ok(registered.includes("search"));
    assert.ok(registered.includes("song_url"));
    assert.ok(registered.includes("playlist"));
  });

  it("调用未知模块抛出明确异常", async () => {
    await assert.rejects(
      async () => {
        await callKugou("non_existent_module");
      },
      { message: /未知的酷狗音乐接口: non_existent_module/ },
    );
  });

  it("各模块入参门禁严格校验", async () => {
    // song_url 校验 hash
    const urlRes = await callKugou("song_url", {});
    assert.equal((urlRes as any).code, 400);

    // search 校验 keywords
    const searchRes = await callKugou("search", {});
    assert.equal((searchRes as any).code, 400);

    // playlist 校验 id
    const playlistRes = await callKugou("playlist", {});
    assert.equal((playlistRes as any).code, 400);

    // user_detail 未登录直接返回 loggedIn: false
    const detailRes = await callKugou("user_detail", {});
    assert.equal((detailRes as any).code, 200);
    assert.equal((detailRes as any).loggedIn, false);

    // user_playlist_list 未登录返回 401
    const listRes = await callKugou("user_playlist_list", {});
    assert.equal((listRes as any).code, 401);
  });
});
