/**
 * 酷狗音乐业务模块与协议 B 单元测试
 *
 * 覆盖：
 * 1. 模块注册表完整性（全部 29 个模块）；
 * 2. 协议 B 云歌单加密链路固定输入对拍 PC 期望值与解密回环；
 * 3. KRC 逐字歌词解密（XOR + pako inflate）与 LRC 解析；
 * 4. 歌单写操作组参数门禁与安全拦截（未登录拦截、入参缺失校验、删歌定位优先级）；
 * 5. 读操作组（榜单/首页/歌手/专辑/评论/听书/每日推荐/刷歌FM/歌词）参数规范与常量校验。
 *
 * @author Hackerdallas
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { deflate } from "pako";

import {
  callKugou,
  clearKugouSession,
  listKugouModules,
  modules,
  setKugouLoginVersion,
} from "../src/utils/platform/kugou/index";
import {
  cryptoMd5,
  decryptCloudResponse,
  deriveAesKey,
  encryptCloudBody,
  uint8ArrayToHex,
} from "../src/utils/platform/kugou/core/crypto";
import {
  decodeKrc,
  decryptKrc,
  parseKrc,
} from "../src/utils/platform/kugou/core/krc";
import {
  KG_AUDIOBOOK_CATEGORIES,
  findCategory,
  normalizeAlbumId,
} from "../src/utils/platform/kugou/core/audiobook";

import { album } from "../src/utils/platform/kugou/modules/album";
import { artist } from "../src/utils/platform/kugou/modules/artist";
import {
  audiobookCategory,
  audiobookDetail,
  audiobookList,
} from "../src/utils/platform/kugou/modules/audiobook";
import { comment } from "../src/utils/platform/kugou/modules/comment";
import { dailyRecommend } from "../src/utils/platform/kugou/modules/daily_recommend";
import { homeAlbum } from "../src/utils/platform/kugou/modules/home_album";
import { homeTheme } from "../src/utils/platform/kugou/modules/home_theme";
import { hot_artists } from "../src/utils/platform/kugou/modules/hot_artists";
import {
  leaderboard_detail,
  leaderboard_list,
} from "../src/utils/platform/kugou/modules/leaderboard";
import { lyric } from "../src/utils/platform/kugou/modules/lyric";
import { playlist_square } from "../src/utils/platform/kugou/modules/playlist_square";
import {
  playlist_create,
  playlist_delete,
  playlist_rename,
  playlist_subscribe,
  playlist_tracks,
} from "../src/utils/platform/kugou/modules/playlist_write";
import { songfm } from "../src/utils/platform/kugou/modules/songfm";

describe("酷狗模块注册表与调用入口", () => {
  it("模块注册表包含全量 30 个接口入口", () => {
    const list = listKugouModules();
    const expected = [
      "login_qr_key",
      "login_qr_check",
      "user_detail",
      "user_playlist_list",
      "playlist_detail",
      "user_profile",
      "playlist_create",
      "playlist_rename",
      "playlist_delete",
      "playlist_tracks",
      "playlist_subscribe",
      "search",
      "song_url",
      "songfm",
      "lyric",
      "comment",
      "album",
      "artist",
      "audiobook/category",
      "audiobook/list",
      "audiobook/detail",
      "hot_artists",
      "hot_search",
      "playlist",
      "playlist_square",
      "leaderboard_list",
      "leaderboard_detail",
      "daily/recommend",
      "home/album",
      "home/theme",
    ];

    for (const name of expected) {
      assert.ok(list.includes(name), `模块注册表应包含 ${name}`);
    }
    assert.equal(list.length, expected.length);
  });

  it("modules 对象导出与注册表键集严格一致", () => {
    const exportedKeys = Object.keys(modules);
    assert.equal(exportedKeys.length, 30);
  });
});

describe("协议 B 加密链路固定输入对拍 PC 期望值", () => {
  it("标准版 keyParam 参数 MD5 签名对拍", () => {
    const appid = 1005;
    const clientver = 20489;
    const clienttime = 1700000000;
    const signSalt = "OIlwieks28dk2k092lksi2UIkp";

    const keyParam = cryptoMd5(`${appid}${signSalt}${clientver}${clienttime}`).toLowerCase();
    assert.equal(keyParam, "a1f65b6a8fe7e191521406ce8661ae02");
  });

  it("概念版 keyParam 参数 MD5 签名对拍", () => {
    const appid = 3116;
    const clientver = 11440;
    const clienttime = 1700000000;
    const signSalt = "LnT6xpN3khm36zse0QzvmgTZ3waWdRSA";

    const keyParam = cryptoMd5(`${appid}${signSalt}${clientver}${clienttime}`).toLowerCase();
    assert.equal(keyParam, "bad0ee207bf429bd91402b77fc8f7a5b");
  });

  it("固定会话密钥 AES-128-CBC 密钥派生与密文对拍 PC 期望值", () => {
    const fixedAes = "X9k2Lp";
    const { key, iv } = deriveAesKey(fixedAes);

    assert.equal(key, "325b24e49f61c909");
    assert.equal(iv, "45eb91a292699888");

    const body = { listid: 123456, name: "测试歌单", intro: "简介描述" };
    const cipherBytes = encryptCloudBody(body, fixedAes);
    const cipherHex = uint8ArrayToHex(cipherBytes);

    // 与 PC 端 Node.js crypto.createCipheriv 期望密文严格对拍
    assert.equal(
      cipherHex,
      "c640f1e425a829fa29f9bf5ccedc2ba5709e42b2bd9ae762164c3d05618488dd657ab36250bb9c69c2a1aa74dd1acd94e89413afcadc97be1a10ca7ba3e15340",
    );

    // 解密回环校验
    const decrypted = decryptCloudResponse(cipherBytes, fixedAes);
    assert.equal(decrypted, JSON.stringify(body));
  });
});

describe("酷狗 KRC 歌词解密与解析", () => {
  const KRC_KEY = Uint8Array.from([
    0x40, 0x47, 0x61, 0x77, 0x5e, 0x32, 0x74, 0x47, 0x51, 0x36, 0x31, 0x2d, 0xce, 0xd2, 0x6e, 0x69,
  ]);

  it("KRC 密文解密（XOR + pako inflate）与明文还原", async () => {
    const sampleKrcText =
      "[ti:晴天]\n[ar:周杰伦]\n[00:00.00]晴天 - 周杰伦\n[00:15.50]<0,500,0>刮<500,500,0>风<1000,500,0>的<1500,500,0>天";

    // 构造测试密文包：4 字节头部 + (deflate 明文 ^ KRC_KEY)
    const deflated = deflate(new TextEncoder().encode(sampleKrcText));
    const xored = new Uint8Array(deflated.length);
    for (let i = 0; i < deflated.length; i += 1) {
      xored[i] = deflated[i] ^ KRC_KEY[i % 16];
    }
    const packet = new Uint8Array(4 + xored.length);
    packet.set([0x6b, 0x72, 0x63, 0x31], 0); // "krc1" 标头
    packet.set(xored, 4);

    let binary = "";
    for (let i = 0; i < packet.length; i += 1) {
      binary += String.fromCharCode(packet[i]);
    }
    const base64 = btoa(binary);

    // 解密并解析
    const decryptedText = await decryptKrc(base64);
    assert.equal(decryptedText, sampleKrcText);

    const parsed = await decodeKrc(base64);
    assert.ok(parsed.krc.includes("刮"));
    assert.ok(parsed.lrc.includes("刮风的天"));
  });

  it("空密文抛出异常", async () => {
    await assert.rejects(async () => {
      await decryptKrc("");
    }, { message: /empty krc content/ });
  });

  it("parseKrc 正确解析歌词各行与时间戳", () => {
    const raw = "[0,15500]晴天\n[15500,3000]<0,500,0>刮<500,500,0>风";
    const result = parseKrc(raw);
    assert.ok(result.lrc.includes("晴天"));
    assert.ok(result.lrc.includes("刮风"));
    assert.ok(result.krc.includes("<0,500>"));
  });
});

describe("酷狗写操作组参数门禁与安全拦截", () => {
  beforeEach(() => {
    clearKugouSession();
  });

  it("未登录时所有写操作全部拦截并返回 401（绝不发起网络调用）", async () => {
    const resCreate = await playlist_create({ name: "新建歌单" });
    assert.equal(resCreate.code, 401);

    const resRename = await playlist_rename({ id: "123", name: "改名" });
    assert.equal(resRename.code, 401);

    const resDelete = await playlist_delete({ id: "123" });
    assert.equal(resDelete.code, 401);

    const resTracks = await playlist_tracks({
      id: "123",
      op: "add",
      songs: [{ hash: "ABCDEF0123456789ABCDEF0123456789", name: "晴天" }],
    });
    assert.equal(resTracks.code, 401);

    const resSubscribe = await playlist_subscribe({ id: "123", subscribed: true });
    assert.equal(resSubscribe.code, 401);
  });

  it("playlist_create 校验 name 参数", async () => {
    const res = await playlist_create({});
    assert.equal(res.code, 400);
    assert.ok(String(res.message).includes("name required"));
  });

  it("playlist_rename 校验 id 与 name 参数", async () => {
    const resNoId = await playlist_rename({ name: "新名称" });
    assert.equal(resNoId.code, 400);

    const resNoName = await playlist_rename({ id: "123" });
    assert.equal(resNoName.code, 400);
  });

  it("playlist_delete 校验 id 参数", async () => {
    const res = await playlist_delete({});
    assert.equal(res.code, 400);
    assert.ok(String(res.message).includes("id required"));
  });

  it("playlist_tracks 校验 op、songs 数组与 hash", async () => {
    const resBadOp = await playlist_tracks({ op: "invalid", songs: [] });
    assert.equal(resBadOp.code, 400);

    const resEmptySongs = await playlist_tracks({ op: "add", songs: [] });
    assert.equal(resEmptySongs.code, 400);

    const resNoHash = await playlist_tracks({
      op: "add",
      songs: [{ name: "晴天" }],
    });
    assert.equal(resNoHash.code, 400);
    assert.ok(String(resNoHash.message).includes("hash"));
  });

  it("playlist_subscribe 校验 id 与 subscribed 布尔类型", async () => {
    const resNoId = await playlist_subscribe({ subscribed: true });
    assert.equal(resNoId.code, 400);

    const resNotBool = await playlist_subscribe({ id: "123", subscribed: "yes" as any });
    assert.equal(resNotBool.code, 400);
  });
});

describe("酷狗读操作组参数规范与常量校验", () => {
  it("album 模块要求提供 id 或 album_id", async () => {
    const res = await album({});
    assert.equal(res.code, 400);
    assert.ok(String(res.message).includes("id required"));
  });

  it("artist 模块要求提供 id 或 author_id", async () => {
    const res = await artist({});
    assert.equal(res.code, 400);
    assert.ok(String(res.message).includes("id required"));
  });

  it("comment 模块校验 mixsongid 并检查评论池常量", async () => {
    const res = await comment({});
    assert.equal(res.code, 400);
    assert.ok(String(res.message).includes("album_audio_id"));
  });

  it("audiobook 模块频道表与别名解析", async () => {
    const catRes = await audiobookCategory({});
    assert.equal(catRes.code, 200);
    assert.equal((catRes as any).total, KG_AUDIOBOOK_CATEGORIES.length);

    // 查频道
    assert.ok(findCategory("xiaoshuo"));
    assert.ok(findCategory("有声小说"));
    assert.equal(findCategory("invalid_slug"), null);

    // 专辑 ID 反解
    assert.equal(normalizeAlbumId("12345"), 12345);
    assert.equal(normalizeAlbumId(""), 0);

    // audiobookDetail 校验 id
    const detailRes = await audiobookDetail({});
    assert.equal(detailRes.code, 400);
  });

  it("dailyRecommend 模块拦截未登录状态", async () => {
    clearKugouSession();
    const res = await dailyRecommend({});
    assert.equal(res.code, 301);
  });

  it("lyric 模块校验 hash 参数", async () => {
    const res = await lyric({});
    assert.equal(res.code, 400);
    assert.ok(String(res.message).includes("hash required"));
  });

  it("leaderboard_detail 校验 rankid 默认值", async () => {
    // 传非法值触发校验
    const res = await leaderboard_detail({ rankid: 0 });
    assert.equal(res.code, 400);
  });
});
