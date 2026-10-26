/**
 * 平台共用工具函数测试 (common.ts)
 *
 * 覆盖：时间戳换算 (toMillisTimestamp/toMillisDateTime)、稳定ID派生、
 * 歌手拆分与归一化、安全链接转换等。
 *
 * @author Hackerdallas
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  deriveStableId,
  normalizeArtistEntry,
  resolveArtistPlatformId,
  secureUrl,
  splitArtistsByPlatform,
  toMillisDateTime,
  toMillisTimestamp,
  toNumericId,
} from "../src/api/platform/common";

describe("安全地址升级 secureUrl", () => {
  it("将 http 升级为 https", () => {
    assert.equal(secureUrl("http://example.com/cover.jpg"), "https://example.com/cover.jpg");
  });

  it("将协议相对地址 // 升级为 https:", () => {
    assert.equal(secureUrl("//example.com/avatar.png"), "https://example.com/avatar.png");
  });

  it("保留已是 https 的地址", () => {
    assert.equal(secureUrl("https://example.com/pic.jpg"), "https://example.com/pic.jpg");
  });

  it("空值或非字符串返回空串", () => {
    assert.equal(secureUrl(""), "");
    assert.equal(secureUrl(null), "");
    assert.equal(secureUrl(undefined), "");
  });
});

describe("歌手串拆分 splitArtistsByPlatform", () => {
  it("QQ 音乐使用 ' / ' 拆分合作歌手", () => {
    const list = splitArtistsByPlatform("周杰伦 / 林俊杰 / 陈奕迅", "qqmusic");
    assert.equal(list.length, 3);
    assert.equal(list[0].name, "周杰伦");
    assert.equal(list[1].name, "林俊杰");
    assert.equal(list[2].name, "陈奕迅");
  });

  it("酷狗使用顿号、逗号、分号、斜杠拆分", () => {
    const list1 = splitArtistsByPlatform("王菲、那英", "kugou");
    assert.equal(list1.length, 2);
    assert.equal(list1[0].name, "王菲");
    assert.equal(list1[1].name, "那英");

    const list2 = splitArtistsByPlatform("张学友;刘德华,黎明 / 郭富城", "kugou");
    assert.equal(list2.length, 4);
    assert.equal(list2[0].name, "张学友");
    assert.equal(list2[1].name, "刘德华");
    assert.equal(list2[2].name, "黎明");
    assert.equal(list2[3].name, "郭富城");
  });

  it("空字符串或非字符串返回空数组", () => {
    assert.deepEqual(splitArtistsByPlatform("", "qqmusic"), []);
    assert.deepEqual(splitArtistsByPlatform(null, "kugou"), []);
  });
});

describe("歌手条目归一化与平台ID提取", () => {
  it("normalizeArtistEntry 映射基本字段并保留 mid", () => {
    const artist = normalizeArtistEntry({ id: 1001, name: "周杰伦" }, "0025NhlN2yWrP4");
    assert.equal(artist.id, "1001");
    assert.equal(artist.name, "周杰伦");
    assert.equal(artist.mid, "0025NhlN2yWrP4");
  });

  it("resolveArtistPlatformId 提取 QQ mid 与酷狗数字 author_id", () => {
    const qqArtist = { id: "1001", name: "周杰伦", mid: "0025NhlN2yWrP4" };
    assert.equal(resolveArtistPlatformId("qqmusic", qqArtist), "0025NhlN2yWrP4");

    const kgArtist = { id: "3060", name: "许嵩" };
    assert.equal(resolveArtistPlatformId("kugou", kgArtist), "3060");

    const kgInvalid = { id: "non-numeric", name: "未知" };
    assert.equal(resolveArtistPlatformId("kugou", kgInvalid), undefined);
  });
});

describe("稳定数字 ID 派生 deriveStableId 与 toNumericId", () => {
  it("同输入恒输出相同正整数，且落在保留区间内 [2e9, 3e9)", () => {
    const id1 = deriveStableId("0039MnYb0qxYAc");
    const id2 = deriveStableId("0039MnYb0qxYAc");
    assert.equal(id1, id2);
    assert.ok(id1 >= 2000000000 && id1 < 3000000000);
  });

  it("不同输入产生不同散列值", () => {
    const id1 = deriveStableId("hash_a");
    const id2 = deriveStableId("hash_b");
    assert.notEqual(id1, id2);
  });

  it("toNumericId 正整数直接采用，非数字或非法值走稳定派生", () => {
    assert.equal(toNumericId(123456, "seed"), 123456);
    assert.equal(toNumericId("987654", "seed"), 987654);

    const derived = toNumericId("invalid", "my_seed");
    assert.equal(derived, deriveStableId("my_seed"));

    const derivedZero = toNumericId(0, "zero_seed");
    assert.equal(derivedZero, deriveStableId("zero_seed"));
  });
});

describe("时间戳秒转毫秒换算 toMillisTimestamp", () => {
  it("秒级时间戳 (< 1e12) 乘 1000 换算为毫秒", () => {
    const seconds = 1700000000;
    assert.equal(toMillisTimestamp(seconds), 1700000000000);
    assert.equal(toMillisTimestamp(String(seconds)), 1700000000000);
  });

  it("毫秒级时间戳 (>= 1e12) 原样返回", () => {
    const millis = 1700000000000;
    assert.equal(toMillisTimestamp(millis), 1700000000000);
  });

  it("非法时间戳返回 undefined", () => {
    assert.equal(toMillisTimestamp(0), undefined);
    assert.equal(toMillisTimestamp(-100), undefined);
    assert.equal(toMillisTimestamp("invalid"), undefined);
    assert.equal(toMillisTimestamp(null), undefined);
  });
});

describe("日期文本与混合时间解析 toMillisDateTime", () => {
  it("解析标准 YYYY-MM-DD HH:mm:ss", () => {
    const ms = toMillisDateTime("2026-10-23 08:30:00");
    assert.ok(typeof ms === "number" && ms > 0);
    const date = new Date(ms!);
    assert.equal(date.getFullYear(), 2026);
    assert.equal(date.getMonth(), 9); // 10月从0开始
    assert.equal(date.getDate(), 23);
    assert.equal(date.getHours(), 8);
    assert.equal(date.getMinutes(), 30);
  });

  it("解析带斜杠格式 YYYY/MM/DD", () => {
    const ms = toMillisDateTime("2026/05/01");
    assert.ok(typeof ms === "number");
    const date = new Date(ms!);
    assert.equal(date.getFullYear(), 2026);
    assert.equal(date.getMonth(), 4);
    assert.equal(date.getDate(), 1);
  });

  it("纯数字文本或数字作为时间戳处理", () => {
    assert.equal(toMillisDateTime("1700000000"), 1700000000000);
    assert.equal(toMillisDateTime(1700000000), 1700000000000);
  });

  it("空值或非日期文本返回 undefined", () => {
    assert.equal(toMillisDateTime(""), undefined);
    assert.equal(toMillisDateTime("not a date"), undefined);
    assert.equal(toMillisDateTime(null), undefined);
  });
});
