/**
 * QQ 音乐登录态生命周期单测：鉴权分类与续期触发条件
 *
 * 覆盖判据：
 * - 鉴权分类表：登录读取类的 1000 判失效，写类 musicasset 的 1000 不判失效；
 * - 结构化错误：错误对象携带 outer / inner / authExpired；
 * - 续期触发：按凭据有效期判断是否该在过期前主动续期。
 *
 * @author Hackerdallas
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  AUTH_EXPIRED_INNER_CODE,
  QQMusicApiError,
  isAuthExpiredCode,
  isQQMusicAuthExpired,
  isWriteAssetModule,
} from "../src/utils/platform/qqmusic/core/auth";
import {
  REFRESH_THRESHOLD_RATIO,
  resolveCredentialTTL,
  shouldRefreshCredential,
  toDurationMs,
  toTimestampMs,
} from "../src/utils/platform/qqmusic/core/credential";

describe("QM 鉴权分类表", () => {
  it("登录读取类的 1000 判为凭据失效", () => {
    assert.equal(isAuthExpiredCode("music.UserInfo.userInfoServer", 1000), true);
    assert.equal(isAuthExpiredCode("VipLogin.VipLoginInter", 1000), true);
    assert.equal(isAuthExpiredCode("music.recommend.RecommendFeed", 1000), true);
    assert.equal(isAuthExpiredCode("music.musicasset.PlaylistBaseRead", 1000), true);
  });

  it("写类 musicasset 的 1000 是授权失败，不判凭据失效", () => {
    assert.equal(isAuthExpiredCode("music.musicasset.PlaylistBaseWrite", 1000), false);
    assert.equal(isAuthExpiredCode("music.musicasset.PlaylistDetailWrite", 1000), false);
    assert.equal(isAuthExpiredCode("music.musicasset.PlaylistFavWrite", 1000), false);
    assert.equal(isAuthExpiredCode("music.asset.MusicAsset", 1000), false);
    assert.equal(isWriteAssetModule("music.musicasset.SongFavWrite"), true);
    assert.equal(isWriteAssetModule("music.musicasset.PlaylistBaseRead"), false);
  });

  it("104400 / 104401 在任何 module 上都判为凭据失效", () => {
    for (const module of [
      "music.UserInfo.userInfoServer",
      "music.musicasset.PlaylistBaseWrite",
      "music.asset.MusicAsset",
    ]) {
      assert.equal(isAuthExpiredCode(module, 104400), true);
      assert.equal(isAuthExpiredCode(module, 104401), true);
    }
  });

  it("500003 与其它业务码不判凭据失效", () => {
    assert.equal(isAuthExpiredCode("music.UserInfo.userInfoServer", 500003), false);
    assert.equal(isAuthExpiredCode("music.asset.MusicAsset", 500003), false);
    assert.equal(isAuthExpiredCode("music.UserInfo.userInfoServer", 40000), false);
    assert.equal(isAuthExpiredCode("music.UserInfo.userInfoServer", 0), false);
    assert.equal(AUTH_EXPIRED_INNER_CODE, 1000);
  });
});

describe("QM 结构化错误", () => {
  it("携带 outer / inner / module / method 与鉴权标记", () => {
    const error = new QQMusicApiError({
      outer: 0,
      inner: 1000,
      module: "music.UserInfo.userInfoServer",
      method: "GetLoginUserInfo",
      authExpired: true,
    });
    assert.equal(error.outer, 0);
    assert.equal(error.inner, 1000);
    assert.equal(error.module, "music.UserInfo.userInfoServer");
    assert.equal(error.method, "GetLoginUserInfo");
    assert.equal(error.authExpired, true);
    assert.equal(isQQMusicAuthExpired(error), true);
    assert.match(error.message, /outer=0 inner=1000/);
  });

  it("非鉴权失效的业务错误不触发登出判定", () => {
    const error = new QQMusicApiError({
      outer: 0,
      inner: 500003,
      module: "music.asset.MusicAsset",
      method: "QueryQQMusicAsset",
      authExpired: false,
    });
    assert.equal(isQQMusicAuthExpired(error), false);
    assert.equal(isQQMusicAuthExpired(new Error("network down")), false);
  });
});

describe("凭据有效期读取", () => {
  it("秒级签发时刻与秒级有效期归一化为毫秒", () => {
    const ttl = resolveCredentialTTL(
      {
        psrf_musickey_createtime: "1792568633",
        qm_key_expires_in: "259200",
      },
      1792568633000,
    );
    assert.ok(ttl);
    assert.equal(ttl.issuedAt, 1792568633000);
    assert.equal(ttl.expiresInMs, 259200000);
    assert.equal(ttl.expiresAt, 1792568633000 + 259200000);
    assert.equal(ttl.remainingMs, 259200000);
  });

  it("毫秒级历史写法同样可读", () => {
    assert.equal(toTimestampMs(1792568633000), 1792568633000);
    assert.equal(toTimestampMs(1792568633), 1792568633000);
    assert.equal(toDurationMs(259200), 259200000);
    assert.equal(toDurationMs(259200000), 259200000);
  });

  it("缺少签发时刻或有效期时返回 null", () => {
    assert.equal(resolveCredentialTTL({}), null);
    assert.equal(resolveCredentialTTL({ psrf_musickey_createtime: "1792568633" }), null);
    assert.equal(resolveCredentialTTL({ qm_key_expires_in: "259200" }), null);
  });
});

describe("续期触发条件", () => {
  const issuedAt = 1_700_000_000_000;
  const expiresInMs = 3 * 24 * 60 * 60 * 1000;

  it("剩余有效期不足四分之一时触发续期", () => {
    const ttl = {
      issuedAt,
      expiresInMs,
      expiresAt: issuedAt + expiresInMs,
      remainingMs: expiresInMs,
    };
    const threshold = issuedAt + expiresInMs * REFRESH_THRESHOLD_RATIO;
    assert.equal(shouldRefreshCredential(ttl, threshold - 1), false);
    assert.equal(shouldRefreshCredential(ttl, threshold), true);
    assert.equal(shouldRefreshCredential(ttl, issuedAt + expiresInMs), true);
  });

  it("缺少有效期信息时不触发续期", () => {
    assert.equal(shouldRefreshCredential(null, Date.now()), false);
  });
});
