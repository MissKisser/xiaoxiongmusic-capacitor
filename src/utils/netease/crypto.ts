/**
 * 网易云 weapi / eapi / linuxapi 纯 JS 签名实现
 *
 * 移植自 @neteasecloudmusicapienhanced/api 的 util/crypto.js,
 * 去掉 Node 专属依赖(node-forge / crypto / zlib / xeapi),
 * 改为 crypto-js + BigInt(WebView 原生支持)。
 *
 * 关键差异:原版用 node-forge 的 `publicKey.encrypt(str, 'NONE')`
 * 做 raw RSA(无 padding),jsencrypt 只支持 PKCS1,故此处用 BigInt
 * 直接实现 textbook RSA: m = utf8_bytes_as_bigint, c = m^e mod n,
 * 输出 256 字符 hex(1024-bit 模数)。与 forge 'NONE' 输出等价。
 *
 * 作者:Hackerdallas
 */

import CryptoJS from "crypto-js";

/** AES CBC/ECB 通用 IV(weapi 用,linuxapi/eapi 用 ECB 不需要) */
const IV = "0102030405060708";

/** weapi 第一级 AES 固定密钥 */
const PRESET_KEY = "0CoJUm6Qyw8W8jud";

/** linuxapi AES-ECB 密钥 */
const LINUXAPI_KEY = "rFgB&h#%2?^eDg:Q";

/** eapi AES-ECB 密钥 */
const EAPI_KEY = "e82ckenh8dichen8";

/** 生成 secretKey 用的字符集(base62,无序) */
const BASE62 = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/**
 * NCM RSA 公钥(modulus + exponent),从 PEM 解析得到。
 * PEM 原文:
 * -----BEGIN PUBLIC KEY-----
 * MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDgtQn2JZ34ZC28NWYpAUd98iZ3
 * 7BUrX/aKzmFbt7clFSs6sXqHauqKWqdtLkF2KexO40H1YTX8z2lSgBBOAxLsvakl
 * V8k4cBFK9snQXE9/DDaFt6Rr7iVZMldczhC0JNgTz+SHXT6CBHuX3e9SdB1Ua44o
 * ncaTWz7OBGLbCiK45wIDAQAB
 * -----END PUBLIC KEY-----
 */
const NCM_RSA_MODULUS = BigInt(
  "0x00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7",
);
const NCM_RSA_EXPONENT = 65537n;
/** 1024-bit 模数对应 128 字节密文 -> 256 hex 字符 */
const NCM_RSA_HEX_LEN = 256;

/**
 * 平方乘方快速模幂, BigInt 版本。
 * 等价于 forge 的 `publicKey.encrypt(str, 'NONE')` 的核心运算。
 */
function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  base = base % mod;
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % mod;
    exp >>= 1n;
    base = (base * base) % mod;
  }
  return result;
}

/** UTF-8 字节(大头序)转 BigInt */
function bytesToBigInt(bytes: Uint8Array): bigint {
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex ? BigInt("0x" + hex) : 0n;
}

/** BigInt 转 hex 字符串,左补零到指定长度 */
function bigIntToHexPadded(value: bigint, length: number): string {
  return value.toString(16).padStart(length, "0");
}

/**
 * raw RSA 加密(无 padding),等价于 forge `encrypt(str, 'NONE')`。
 * 输入字符串按 UTF-8 编码为字节,当作大整数 m,计算 c = m^e mod n,
 * 输出 256 字符 hex。
 */
export function rsaEncrypt(str: string): string {
  const bytes = new TextEncoder().encode(str);
  const m = bytesToBigInt(bytes);
  const c = modPow(m, NCM_RSA_EXPONENT, NCM_RSA_MODULUS);
  return bigIntToHexPadded(c, NCM_RSA_HEX_LEN);
}

/** 生成 16 字符随机 secretKey(从 base62 取) */
function generateSecretKey(): string {
  let key = "";
  for (let i = 0; i < 16; i++) {
    key += BASE62.charAt(Math.floor(Math.random() * BASE62.length));
  }
  return key;
}

/**
 * AES 加密。对齐原版 aesEncrypt(text, mode, key, iv, format)。
 *
 * @param text 待加密字符串
 * @param mode 'cbc' | 'ecb'
 * @param key AES-128 密钥(16 字符)
 * @param iv CBC 用 IV;ECB 模式下传空串即可
 * @param format 'base64' | 'hex'
 */
export function aesEncrypt(
  text: string,
  mode: "cbc" | "ecb",
  key: string,
  iv: string,
  format: "base64" | "hex" = "base64",
): string {
  const modeMap = { cbc: CryptoJS.mode.CBC, ecb: CryptoJS.mode.ECB };
  const encrypted = CryptoJS.AES.encrypt(
    CryptoJS.enc.Utf8.parse(text),
    CryptoJS.enc.Utf8.parse(key),
    {
      iv: iv ? CryptoJS.enc.Utf8.parse(iv) : undefined,
      mode: modeMap[mode],
      padding: CryptoJS.pad.Pkcs7,
    },
  );
  if (format === "base64") {
    return encrypted.toString();
  }
  return encrypted.ciphertext.toString().toUpperCase();
}

/** weapi 签名。返回 { params, encSecKey },作为 form-urlencoded body。 */
export function weapi(object: Record<string, any>): {
  params: string;
  encSecKey: string;
} {
  const text = JSON.stringify(object);
  const secretKey = generateSecretKey();
  return {
    params: aesEncrypt(
      aesEncrypt(text, "cbc", PRESET_KEY, IV),
      "cbc",
      secretKey,
      IV,
    ),
    // secretKey 按字符反转后做 raw RSA
    encSecKey: rsaEncrypt(secretKey.split("").reverse().join("")),
  };
}

/**
 * eapi 签名。返回 { params },作为 form-urlencoded body。
 *
 * @param url API 路径,如 /api/song/enhance/player/url
 * @param object 请求数据对象
 */
export function eapi(
  url: string,
  object: Record<string, any> | string,
): { params: string } {
  const text =
    typeof object === "object" ? JSON.stringify(object) : String(object);
  const message = `nobody${url}use${text}md5forencrypt`;
  const digest = CryptoJS.MD5(message).toString();
  const data = `${url}-36cd479b6b5-${text}-36cd479b6b5-${digest}`;
  return {
    params: aesEncrypt(data, "ecb", EAPI_KEY, "", "hex"),
  };
}

/** linuxapi 签名。返回 { eparams },作为 form-urlencoded body。 */
export function linuxapi(object: Record<string, any>): { eparams: string } {
  const text = JSON.stringify(object);
  return {
    eparams: aesEncrypt(text, "ecb", LINUXAPI_KEY, "", "hex"),
  };
}
