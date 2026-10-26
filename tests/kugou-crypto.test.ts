/**
 * 酷狗音乐三签名协议与纯 JS 加密算法单元测试
 *
 * 与 PC 端（Electron 仓）实现期望输出严格对拍：
 * 1. 协议 A 网关签名（signatureAndroidParams）
 * 2. 云歌单协议 B（buildCloudRequest / AES-128-CBC / deriveAesKey）
 * 3. /v5/url 取链密钥签名（signKey）
 * 4. Web 接口签名（signatureWebParams）
 * 5. 免填充 RSA 加密（rsaEncryptKugou）
 * 6. 设备 MID 大整数计算（calculateMid）
 * 7. 设备数据对称加解密回环
 *
 * @author Hackerdallas
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ANDROID_SIGN_SALT,
  calculateMid,
  cryptoMd5,
  decryptCloudResponse,
  decryptKugouDeviceData,
  deriveAesKey,
  encryptCloudBody,
  encryptKugouDeviceData,
  getDeviceMid,
  KG_LITE_PUBLIC_KEY,
  KG_PUBLIC_KEY,
  LITE_SIGN_KEY_SALT,
  LITE_SIGN_SALT,
  rsaEncryptKugou,
  SIGN_KEY_SALT,
  signatureAndroidParams,
  signatureWebParams,
  signKey,
  signParamsKey,
  uint8ArrayToHex,
  WEB_SIGN_SALT,
} from "../src/utils/platform/kugou/core/crypto";
import { setKugouLoginVersion } from "../src/utils/platform/kugou/core/config";

describe("酷狗三签名协议与核心加密对拍测试", () => {
  it("协议 A 网关签名：标准版与概念版固定输入对拍", () => {
    const testParams = {
      appid: 1005,
      clientver: 20489,
      mid: "1234567890123456789",
      dfid: "test-dfid-123",
      clienttime: 1700000000,
      token: "sample_token_xyz",
      userid: "1123056595",
    };
    const testBody = JSON.stringify({ listid: "12345", type: 1 });

    // 标准版模式
    setKugouLoginVersion("standard");
    const sigAStandard = signatureAndroidParams(testParams, testBody);
    assert.equal(sigAStandard, "85a210e5878c33b02f1e575f07215614");

    // 概念版模式
    setKugouLoginVersion("concept");
    const sigALite = signatureAndroidParams(testParams, testBody);
    assert.equal(sigALite, "d1a47e41effc4e913b1136f7aa4738be");
  });

  it("/v5/url 播放取链 key 签名：标准版与概念版固定输入对拍", () => {
    const testHash = "0123456789abcdef0123456789abcdef";
    const testMid = "9876543210987654321";
    const testUid = 1123056595;

    // 标准版
    setKugouLoginVersion("standard");
    const keyStandard = signKey(testHash, testMid, testUid, 1005);
    assert.equal(keyStandard, "be6362029fec298dd0a28b945ce67206");

    // 概念版
    setKugouLoginVersion("concept");
    const keyLite = signKey(testHash, testMid, testUid, 3116);
    assert.equal(keyLite, "ca4a37b0a583b1d06fa8f780ec7f750c");
  });

  it("云歌单协议 B：AES 会话密钥派生与密文回环对拍", () => {
    const fixedAes = "a1B2c3";
    const { key, iv } = deriveAesKey(fixedAes);

    assert.equal(key, "c384985ae5122eb5");
    assert.equal(iv, "c7c3cfc1faff7278");

    // 加密并与 PC 输出密文十六进制严格对拍
    const cloudBody = { listid: "999", name: "my playlist" };
    const cipherBytes = encryptCloudBody(cloudBody, fixedAes);
    const cipherHex = uint8ArrayToHex(cipherBytes);
    assert.equal(
      cipherHex,
      "d227cbcc0a73d02a3458729ac793505ed2bf674d936ed7f056aa4c4f17920dbefe23be3384704ff4deda8774162c848b",
    );

    // 解密回环校验
    const decrypted = decryptCloudResponse(cipherBytes, fixedAes);
    assert.equal(decrypted, JSON.stringify(cloudBody));
  });

  it("云歌单协议 B：keyParam 参数签名对拍", () => {
    const keyParamStandard = cryptoMd5(`1005${ANDROID_SIGN_SALT}204891700000000`);
    assert.equal(keyParamStandard, "a1f65b6a8fe7e191521406ce8661ae02");

    const keyParamLite = cryptoMd5(`3116${LITE_SIGN_SALT}114401700000000`);
    assert.equal(keyParamLite, "bad0ee207bf429bd91402b77fc8f7a5b");
  });

  it("Web 接口签名（signatureWebParams）对拍", () => {
    const params = {
      appid: 1001,
      clientver: 20489,
      mid: "99790686432224818962300930261315687559",
      type: 1,
    };
    const sig = signatureWebParams(params);
    assert.equal(sig, "3c84d4d32ac9ec62212ca928ea595ab1");
  });

  it("设备 MID 计算：BigInt 大整数进制转换对拍", () => {
    const mid = calculateMid("xiaoxiongmusic-kugou-device-mid");
    assert.equal(mid, "99790686432224818962300930261315687559");
    assert.equal(getDeviceMid(), "99790686432224818962300930261315687559");
  });

  it("免填充 RSA 加密（rsaEncryptKugou）：与 PC Node RSA_NO_PADDING 对拍", () => {
    const data = { token: "test_token_123", clienttime: 1700000000 };
    const encryptedHex = rsaEncryptKugou(data, KG_PUBLIC_KEY);

    assert.equal(
      encryptedHex,
      "b1b5fbb98dfc3dfa7ba7856390322038c8c859bf9f61509ecac6c5385dd46f2148f55cbf5f4603efdf6acc698a0825aa4950e2ab45a17c738e7d303b305130990d8daa45d9adcd14564e3d013316822508db429af1ecb5d1c7f0d86e10745ef0f0447a6b42afd274da5750aff1fa1aa7b12e7d18574974bf970dbc885cd6fcc4",
    );
  });

  it("设备数据 AES-128-CBC 加解密回环测试", () => {
    const original = {
      device: "marble",
      battery: 100,
      manufacturer: "Xiaomi",
    };
    const encrypted = encryptKugouDeviceData(original);
    assert.ok(encrypted.key);
    assert.equal(encrypted.key.length, 6);
    assert.ok(encrypted.content);

    const decrypted = decryptKugouDeviceData(encrypted.content, encrypted.key) as typeof original;
    assert.deepEqual(decrypted, original);
  });
});
