/**
 * QQ 音乐业务模块单元测试
 *
 * 覆盖：
 * 1. 模块注册表完整性与缓存策略校验；
 * 2. QRC 逐字歌词与 LRC 歌词解析；
 * 3. QRC 密文 Triple DES + pako 解压缩还原；
 * 4. 写操作组（建单/改名/删单/加删歌/收藏）参数门禁与鉴权拦截；
 * 5. 读操作组（专辑/歌手/评论/单曲详情/每日推荐/识曲/搜索上限）参数规范与口径校验。
 *
 * @author Hackerdallas
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  callQQMusic,
  listQQMusicModules,
} from "../src/utils/platform/qqmusic/index";
import {
  decryptQrc,
  parseLyric,
} from "../src/utils/platform/qqmusic/core/qrc";
import {
  qrcDecrypt,
  qrcEncrypt,
} from "../src/utils/platform/qqmusic/core/tripledes";
import { deflate } from "pako";

import { album } from "../src/utils/platform/qqmusic/modules/album";
import { artist } from "../src/utils/platform/qqmusic/modules/artist";
import { comment } from "../src/utils/platform/qqmusic/modules/comment";
import { dailyRecommend } from "../src/utils/platform/qqmusic/modules/daily_recommend";
import { match } from "../src/utils/platform/qqmusic/modules/match";
import { search } from "../src/utils/platform/qqmusic/modules/search";
import {
  playlist_create,
  playlist_delete,
  playlist_rename,
  playlist_subscribe,
  playlist_tracks,
} from "../src/utils/platform/qqmusic/modules/playlist_write";
import { song_info } from "../src/utils/platform/qqmusic/modules/song_info";

describe("QM 模块注册表与调用入口", () => {
  it("模块注册表包含全量 34 个接口入口", () => {
    const list = listQQMusicModules();
    const expected = [
      "login_qr_key",
      "login_qr_check",
      "user_detail",
      "user_playlist_list",
      "user_liked_songs",
      "song_detail",
      "subscription_status",
      "playlist_detail",
      "playlist_edit_info",
      "playlist_create",
      "playlist_rename",
      "playlist_delete",
      "playlist_tracks",
      "playlist_subscribe",
      "song_url",
      "lyric",
      "comment",
      "search",
      "match",
      "hot_search",
      "leaderboard",
      "leaderboard_list",
      "leaderboard_detail",
      "song_info",
      "song_list",
      "songfm",
      "album",
      "artist",
      "daily/recommend",
      "home/recommend",
      "home/square",
      "home/singer",
      "home/album",
    ];

    for (const name of expected) {
      assert.ok(list.includes(name), `模块注册表应包含 ${name}`);
    }
    assert.equal(list.length, expected.length);
  });

  it("调用未知模块时抛出明确异常", async () => {
    await assert.rejects(
      async () => {
        await callQQMusic("invalid_module_name");
      },
      {
        message: /未知的 QQ 音乐接口: invalid_module_name/,
      },
    );
  });
});

describe("QM 歌词与 QRC 解密解析", () => {
  it("解析标准 LRC 格式歌词行与时间戳", () => {
    const lrc = "[00:01.50]第一行歌词\n[00:05.200]第二行歌词\n[01:10.00]第三行歌词";
    const res = parseLyric(lrc);
    assert.equal(res.format, "lrc");
    assert.equal(res.lines.length, 3);
    assert.equal(res.lines[0].time, 1500);
    assert.equal(res.lines[0].text, "第一行歌词");
    assert.equal(res.lines[0].duration, 0);
    assert.deepEqual(res.lines[0].words, []);

    assert.equal(res.lines[1].time, 5200);
    assert.equal(res.lines[1].text, "第二行歌词");

    assert.equal(res.lines[2].time, 70000);
    assert.equal(res.lines[2].text, "第三行歌词");
  });

  it("从 QRC XML 封装中提取正文并反转义 XML 实体", () => {
    const xml =
      '<?xml version="1.0" encoding="utf-8"?>\n' +
      "<QrcInfos><LyricInfo><Lyric_1 LyricType=\"1\" LyricContent=\"[1000,2000]测(0,500)试(500,500)&quot;&amp;&lt;&gt;\n[3000,1500]歌(0,500)词(500,1000)\"/>" +
      "</LyricInfo></QrcInfos>";
    const res = parseLyric(xml);
    assert.equal(res.format, "qrc");
    assert.equal(res.lines.length, 2);

    const line1 = res.lines[0];
    assert.equal(line1.time, 1000);
    assert.equal(line1.duration, 2000);
    assert.equal(line1.words.length, 2);
    assert.equal(line1.words[0].text, "测");
    assert.equal(line1.words[0].start, 1000);
    assert.equal(line1.words[0].duration, 500);
    assert.equal(line1.words[1].text, "试");
    assert.equal(line1.words[1].start, 1500);
    assert.equal(line1.words[1].duration, 500);

    const line2 = res.lines[1];
    assert.equal(line2.time, 3000);
    assert.equal(line2.duration, 1500);
    assert.equal(line2.words.length, 2);
    assert.equal(line2.words[0].text, "歌");
    assert.equal(line2.words[1].text, "词");
  });

  it("Triple DES 解密与 pako 解压缩全流程回环验证", () => {
    const QRC_KEY = new TextEncoder().encode("!@#)(*$%123ZXC!@!@#)(NHL");
    const rawLyric = "[1000,2000]原(0,500)始(500,500)歌(1000,500)词(1500,500)";

    // 1. pako deflate 压缩
    const compressed = deflate(new TextEncoder().encode(rawLyric));

    // 2. Triple DES 加密
    const encrypted = qrcEncrypt(compressed, QRC_KEY);

    // 3. 转十六进制密文字符串
    const hex = Array.from(encrypted)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    // 4. decryptQrc 解密并解压
    const decrypted = decryptQrc(hex);
    assert.equal(decrypted, rawLyric);
  });

  it("空密文或非法数据抛出异常", () => {
    assert.throws(() => decryptQrc(""), { message: /没有可解密的数据/ });
    assert.throws(() => decryptQrc("   "), { message: /没有可解密的数据/ });
  });
});

describe("QM 写操作组参数门禁与安全拦截", () => {
  it("playlist_create 校验歌单名称", async () => {
    const res1 = (await playlist_create({})) as any;
    assert.equal(res1.code, 400);
    assert.equal(res1.message, "name required");

    const res2 = (await playlist_create({ name: "   " })) as any;
    assert.equal(res2.code, 400);
    assert.equal(res2.message, "name required");

    const longName = "一".repeat(21);
    const res3 = (await playlist_create({ name: longName })) as any;
    assert.equal(res3.code, 400);
    assert.equal(res3.message, "歌单名最多 20 字");
  });

  it("playlist_rename 校验 tid 与歌单名称", async () => {
    const res1 = (await playlist_rename({ name: "新名称" })) as any;
    assert.equal(res1.code, 400);
    assert.equal(res1.message, "tid required");

    const res2 = (await playlist_rename({ tid: 12345 })) as any;
    assert.equal(res2.code, 400);
    assert.equal(res2.message, "name required");

    const res3 = (await playlist_rename({ tid: 12345, name: "一".repeat(21) })) as any;
    assert.equal(res3.code, 400);
    assert.equal(res3.message, "歌单名最多 20 字");
  });

  it("playlist_delete 校验 tid", async () => {
    const res1 = (await playlist_delete({})) as any;
    assert.equal(res1.code, 400);
    assert.equal(res1.message, "tid required");
  });

  it("playlist_tracks 校验 op 与 songs 数量范围", async () => {
    const res1 = (await playlist_tracks({ op: "update", songs: [{ id: 100 }] })) as any;
    assert.equal(res1.code, 400);
    assert.equal(res1.message, "op 必须是 add 或 del");

    const res2 = (await playlist_tracks({ op: "add", songs: [] })) as any;
    assert.equal(res2.code, 400);
    assert.equal(res2.message, "songs 数量需在 1~100 之间");

    const tooMany = Array.from({ length: 101 }, (_, i) => ({ id: i + 1 }));
    const res3 = (await playlist_tracks({ op: "add", songs: tooMany })) as any;
    assert.equal(res3.code, 400);
    assert.equal(res3.message, "songs 数量需在 1~100 之间");
  });

  it("playlist_subscribe 校验 tid 与布尔值，并拦截未登录", async () => {
    const res1 = (await playlist_subscribe({ subscribed: true })) as any;
    assert.equal(res1.code, 400);
    assert.equal(res1.message, "tid required");

    const res2 = (await playlist_subscribe({ tid: 12345, subscribed: "true" as any })) as any;
    assert.equal(res2.code, 400);
    assert.equal(res2.message, "subscribed 必须是布尔值");

    // 未登录时拦截
    const res3 = (await playlist_subscribe({ tid: 12345, subscribed: true })) as any;
    assert.equal(res3.code, 401);
    assert.equal(res3.message, "未登录");
  });
});

describe("QM 读操作组入参门禁与规范", () => {
  it("album 模块要求提供 mid", async () => {
    const res = (await album({})) as any;
    assert.equal(res.code, 400);
    assert.equal(res.message, "mid required");
  });

  it("artist 模块要求提供 mid", async () => {
    const res = (await artist({})) as any;
    assert.equal(res.code, 400);
    assert.equal(res.message, "mid required");
  });

  it("comment 模块要求提供歌曲 id 或 mid", async () => {
    const res = (await comment({})) as any;
    assert.equal(res.code, 400);
    assert.equal(res.message, "id required");
  });

  it("song_info 模块要求提供 mid", async () => {
    const res = (await song_info({})) as any;
    assert.equal(res.code, 400);
    assert.equal(res.message, "mid required");
  });

  it("dailyRecommend 模块拦截未登录状态", async () => {
    const res = (await dailyRecommend({})) as any;
    assert.equal(res.code, 301);
    assert.equal(res.message, "需要登录");
  });

  it("match 模块要求提供 keywords 检索词", async () => {
    const res = (await match({})) as any;
    assert.equal(res.code, 400);
    assert.equal(res.message, "keywords required");
  });

  it("search 模块校验关键词与搜索类型", async () => {
    const res1 = (await search({})) as any;
    assert.equal(res1.code, 400);
    assert.equal(res1.message, "keywords required");

    const res2 = (await search({ keywords: "周杰伦", type: 999 })) as any;
    assert.equal(res2.code, 400);
    assert.match(res2.message, /unsupported search type/);
  });
});
