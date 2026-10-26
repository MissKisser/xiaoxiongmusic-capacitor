/**
 * 酷狗音乐平台纯 JS 加密与签名工具
 *
 * 覆盖：
 * - 协议 A 网关签名：signatureAndroidParams
 * - 协议 B 云歌单加密：AES-128-CBC + RSA-PKCS1 传参
 * - 播放取链密钥签名：signKey (MD5(hash + signKeySalt + appid + mid + userid))
 * - Web 版 API 请求签名：signatureWebParams
 * - 设备数据加密与解密：AES-128-CBC
 * - RSA 免填充无缝签名：rsaEncryptKugou
 *
 * @author Hackerdallas
 */

import CryptoJS from "crypto-js";
import JSEncrypt from "jsencrypt";
import { getKgAppid, getKgClientver, isKugouConceptMode } from "./config";

/** 酷狗 Android 签名盐值（标准版） */
export const ANDROID_SIGN_SALT = "OIlwieks28dk2k092lksi2UIkp";

/** 酷狗 Android 签名盐值（概念版） */
export const LITE_SIGN_SALT = "LnT6xpN3khm36zse0QzvmgTZ3waWdRSA";

/** 酷狗 Web 签名盐值 */
export const WEB_SIGN_SALT = "NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt";

/** 酷狗 key 签名盐值（标准版） */
export const SIGN_KEY_SALT = "57ae12eb6890223e355ccfcb74edf70d";

/** 酷狗 key 签名盐值（概念版） */
export const LITE_SIGN_KEY_SALT = "185672dd44712f60bb1736df5a377e82";

/** 酷狗标准版 RSA 公钥 */
export const KG_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDIAG7QOELSYoIJvTFJhMpe1s/gbjDJX51HBNnEl5HXqTW6lQ7LC8jr9fWZTwusknp+sVGzwd40MwP6U5yDE27M/X1+UR4tvOGOqp94TJtQ1EPnWGWXngpeIW5GxoQGao1rmYWAu6oi1z9XkChrsUdC6DJE5E221wf/4WLFxwAtRQIDAQAB
-----END PUBLIC KEY-----`;

/** 酷狗概念版 RSA 公钥 */
export const KG_LITE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDECi0Np2UR87scwrvTr72L6oO01rBbbBPriSDFPxr3Z5syug0O24QyQO8bg27+0+4kBzTBTBOZ/WWU0WryL1JSXRTXLgFVxtzIY41Pe7lPOgsfTCn5kZcvKhYKJesKnnJDNr5/abvTGf+rHG3YRwsCHcQ08/q6ifSioBszvb3QiwIDAQAB
-----END PUBLIC KEY-----`;

/** 标准版 RSA 公钥大整数模数 (1024-bit) */
const MODULUS_STANDARD = BigInt(
  "0xc8006ed03842d2628209bd314984ca5ed6cfe06e30c95f9d4704d9c49791d7a935ba950ecb0bc8ebf5f5994f0bac927a7eb151b3c1de343303fa539c83136eccfd7d7e511e2dbce18eaa9f784c9b50d443e75865979e0a5e216e46c684066a8d6b998580bbaa22d73f5790286bb14742e83244e44db6d707ffe162c5c7002d45",
);

/** 概念版 RSA 公钥大整数模数 (1024-bit) */
const MODULUS_LITE = BigInt(
  "0xc40a2d0da76511f3bb1cc2bbd3afbd8bea83b4d6b05b6c13eb8920c53f1af7679b32ba0d0edb843240ef1b836efed3ee240734c14c1399fd6594d16af22f52525d14d72e0155c6dcc8638d4f7bb94f3a0b1f4c29f991972f2a160a25eb0a9e724336be7f69bbd319ffab1c6dd8470b021dc434f3faba89f4a2a01b33bdbdd08b",
);

/** RSA 公钥通用指数 */
const RSA_EXPONENT = 65537n;

/**
 * 快速模幂运算
 * @param base 底数
 * @param exp 指数
 * @param mod 模数
 * @returns 模幂结果
 */
const modPow = (base: bigint, exp: bigint, mod: bigint): bigint => {
  let result = 1n;
  base = base % mod;
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % mod;
    exp >>= 1n;
    base = (base * base) % mod;
  }
  return result;
};

/**
 * 将 Uint8Array 转换为十六进制字符串
 * @param bytes 字节数组
 * @returns 十六进制字符串
 */
export const uint8ArrayToHex = (bytes: Uint8Array): string => {
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
};

/**
 * 将十六进制字符串转换为 Uint8Array
 * @param hex 十六进制字符串
 * @returns 字节数组
 */
export const hexToUint8Array = (hex: string): Uint8Array => {
  const cleanHex = hex.length % 2 === 0 ? hex : `0${hex}`;
  const len = cleanHex.length / 2;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = parseInt(cleanHex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
};

/**
 * 将 Base64 编码字符串转换为十六进制字符串
 * @param b64 Base64 字符串
 * @returns 十六进制字符串
 */
export const base64ToHex = (b64: string): string => {
  const binary = typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
  let hex = "";
  for (let i = 0; i < binary.length; i++) {
    hex += binary.charCodeAt(i).toString(16).padStart(2, "0");
  }
  return hex;
};

/**
 * 将 CryptoJS 的 WordArray 转换为 Uint8Array
 * @param wordArray WordArray 对象
 * @returns 对应的 Uint8Array
 */
export const wordArrayToUint8Array = (wordArray: CryptoJS.lib.WordArray): Uint8Array => {
  const { words, sigBytes } = wordArray;
  const u8 = new Uint8Array(sigBytes);
  for (let i = 0; i < sigBytes; i++) {
    const byte = (words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
    u8[i] = byte;
  }
  return u8;
};

/**
 * 将 Uint8Array 转换为 CryptoJS 的 WordArray
 * @param u8 字节数组
 * @returns 对应的 WordArray
 */
export const uint8ArrayToWordArray = (u8: Uint8Array): CryptoJS.lib.WordArray => {
  const words: number[] = [];
  for (let i = 0; i < u8.length; i++) {
    words[i >>> 2] |= u8[i] << (24 - (i % 4) * 8);
  }
  return CryptoJS.lib.WordArray.create(words, u8.length);
};

/**
 * 获取当前登录版本模式下的盐值集合与公钥
 * @returns 盐值与公钥对象
 */
export const currentSalts = () => ({
  androidSign: isKugouConceptMode() ? LITE_SIGN_SALT : ANDROID_SIGN_SALT,
  signKey: isKugouConceptMode() ? LITE_SIGN_KEY_SALT : SIGN_KEY_SALT,
  publicKey: isKugouConceptMode() ? KG_LITE_PUBLIC_KEY : KG_PUBLIC_KEY,
});

/**
 * 计算 MD5 哈希（32位小写 hex）
 * @param data 待计算的数据
 * @returns 32位小写 hex 字符串
 */
export const cryptoMd5 = (data: string | Uint8Array | Record<string, unknown>): string => {
  if (typeof data === "string") {
    return CryptoJS.MD5(data).toString(CryptoJS.enc.Hex).toLowerCase();
  }
  if (data instanceof Uint8Array) {
    const words = uint8ArrayToWordArray(data);
    return CryptoJS.MD5(words).toString(CryptoJS.enc.Hex).toLowerCase();
  }
  const text = JSON.stringify(data ?? {});
  return CryptoJS.MD5(text).toString(CryptoJS.enc.Hex).toLowerCase();
};

/**
 * 根据 GUID 计算设备 MID（大整数进制转换）
 * @param guid 设备 GUID
 * @returns MID 十进制字符串
 */
export const calculateMid = (guid = "550e8400-e29b-41d4-a716-446655440000"): string => {
  const digest = cryptoMd5(guid);
  return BigInt(`0x${digest}`).toString(10);
};

let cachedMid: string | null = null;

/**
 * 获取或生成固定设备 MID
 * @returns MID 十进制字符串
 */
export const getDeviceMid = (): string => {
  if (!cachedMid) {
    cachedMid = calculateMid("xiaoxiongmusic-kugou-device-mid");
  }
  return cachedMid;
};

/**
 * Android 网关 API 签名（协议 A）
 * 算法：MD5(salt + 排序后的 key=value + body + salt)
 * @param params 查询或请求参数表
 * @param data 可选的请求体数据
 * @returns 32位十六进制签名
 */
export const signatureAndroidParams = (
  params: Record<string, unknown>,
  data: string | Uint8Array = "",
): string => {
  const paramsString = Object.keys(params)
    .sort()
    .map((key) => {
      const val = typeof params[key] === "object" ? JSON.stringify(params[key]) : params[key];
      return `${key}=${val ?? ""}`;
    })
    .join("");
  const bodyStr = typeof data === "string" ? data : new TextDecoder("utf-8").decode(data);
  const salt = currentSalts().androidSign;
  return cryptoMd5(`${salt}${paramsString}${bodyStr}${salt}`);
};

/**
 * Web 版 API 请求签名
 * @param params 请求参数
 * @returns 32位十六进制签名
 */
export const signatureWebParams = (params: Record<string, unknown>): string => {
  const paramsString = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key] ?? ""}`)
    .join("");
  return cryptoMd5(`${WEB_SIGN_SALT}${paramsString}${WEB_SIGN_SALT}`);
};

/**
 * 参数密钥签名（signParamsKey）
 * 算法：MD5(appid + salt + clientver + data)
 * @param data 签名数据
 * @param appid 应用标识
 * @param clientver 客户端版本
 * @returns 32位签名
 */
export const signParamsKey = (
  data: string | number,
  appid = getKgAppid(),
  clientver = getKgClientver(),
): string => {
  return cryptoMd5(`${appid}${currentSalts().androidSign}${clientver}${data}`);
};

/**
 * 播放取链密钥签名（signKey）
 * 算法：MD5(hash + signKeySalt + appid + mid + userid)
 * @param hash 音频哈希
 * @param mid 设备 MID
 * @param userid 账号 userid
 * @param appid 应用标识
 * @returns 32位签名
 */
export const signKey = (
  hash: string,
  mid = getDeviceMid(),
  userid: number | string = 0,
  appid = getKgAppid(),
): string => {
  return cryptoMd5(`${hash}${currentSalts().signKey}${appid}${mid}${userid}`);
};

/**
 * 清除响应文本中的标签包裹（<!--KG_TAG_RES_START--> 等）
 * @param text 原始响应文本
 * @returns 纯 JSON 文本
 */
export const cleanKgResponse = (text: string): string => {
  return text
    .trim()
    .replace(/^<!--KG_TAG_RES_START-->/, "")
    .replace(/<!--KG_TAG_RES_END-->$/, "");
};

/**
 * 执行酷狗免填充 RSA 加密 (RSA_NO_PADDING)
 * 采用教科书 RSA：输入置于 128 字节块首部，尾部补零，c = m^e mod n，输出 256 位十六进制
 * @param data 待加密对象
 * @param publicKeyPem 自定义公钥 PEM，默认按当前模式选取
 * @returns 256位十六进制密文字符串
 */
export const rsaEncryptKugou = (
  data: Record<string, unknown>,
  publicKeyPem?: string,
): string => {
  const jsonStr = JSON.stringify(data);
  const inputBytes = new TextEncoder().encode(jsonStr);
  const block = new Uint8Array(128);
  block.set(inputBytes.subarray(0, 128));

  const isLite = publicKeyPem
    ? publicKeyPem === KG_LITE_PUBLIC_KEY
    : isKugouConceptMode();
  const modulus = isLite ? MODULUS_LITE : MODULUS_STANDARD;

  const m = BigInt(`0x${uint8ArrayToHex(block)}`);
  const c = modPow(m, RSA_EXPONENT, modulus);
  return c.toString(16).padStart(256, "0");
};

/**
 * 执行酷狗 PKCS#1 填充 RSA 加密
 * @param data 待加密对象
 * @param publicKeyPem 自定义公钥 PEM
 * @returns 十六进制密文字符串
 */
export const rsaEncryptKugouPkcs1 = (
  data: Record<string, unknown>,
  publicKeyPem?: string,
): string => {
  const encryptor = new JSEncrypt();
  encryptor.setPublicKey(publicKeyPem ?? currentSalts().publicKey);
  const jsonStr = JSON.stringify(data);
  const encBase64 = encryptor.encrypt(jsonStr);
  if (!encBase64) return "";
  return base64ToHex(encBase64);
};

/**
 * 生成指定长度的随机十六进制字符串
 * @param bytesCount 随机字节数
 * @returns 十六进制字符串
 */
const randomHex = (bytesCount: number): string => {
  const u8 = new Uint8Array(bytesCount);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(u8);
  } else {
    for (let i = 0; i < bytesCount; i++) {
      u8[i] = Math.floor(Math.random() * 256);
    }
  }
  return uint8ArrayToHex(u8);
};

/**
 * 加密设备注册信息
 * @param data 设备信息对象
 * @returns 随机 AES 密钥与 Base64 密文
 */
export const encryptKugouDeviceData = (
  data: Record<string, unknown>,
): { key: string; content: string } => {
  const key = randomHex(3); // 3 字节 -> 6 位 hex
  const digest = cryptoMd5(key);
  const aesKey = digest.slice(0, 16);
  const aesIv = digest.slice(16, 32);

  const encrypted = CryptoJS.AES.encrypt(
    CryptoJS.enc.Utf8.parse(JSON.stringify(data)),
    CryptoJS.enc.Utf8.parse(aesKey),
    {
      iv: CryptoJS.enc.Utf8.parse(aesIv),
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7,
    },
  );

  return { key, content: encrypted.toString() };
};

/**
 * 解密设备注册响应信息
 * @param content 密文数据（Base64 字符串或 Uint8Array）
 * @param key 协商使用的 6 位 AES 密钥
 * @returns 解密解析后的对象
 */
export const decryptKugouDeviceData = (
  content: Uint8Array | string,
  key: string,
): unknown => {
  const digest = cryptoMd5(key);
  const aesKey = digest.slice(0, 16);
  const aesIv = digest.slice(16, 32);

  const cipherText =
    typeof content === "string"
      ? content
      : CryptoJS.enc.Base64.stringify(uint8ArrayToWordArray(content));

  const decrypted = CryptoJS.AES.decrypt(cipherText, CryptoJS.enc.Utf8.parse(aesKey), {
    iv: CryptoJS.enc.Utf8.parse(aesIv),
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  });

  const text = decrypted.toString(CryptoJS.enc.Utf8);
  return JSON.parse(text);
};

/**
 * 由 6 位 AES 会话串派生 16 字节密钥与 16 字节初始向量
 * @param aes 6 位会话串
 * @returns 密钥与初始向量映射
 */
export const deriveAesKey = (aes: string): { key: string; iv: string } => {
  const digest = cryptoMd5(aes);
  return { key: digest.slice(0, 16), iv: digest.slice(16, 32) };
};

/**
 * 协议 B：加密云歌单业务请求体
 * @param body 请求体对象
 * @param aes 6 位随机会话串
 * @returns 加密后的 Uint8Array 二进制字节
 */
export const encryptCloudBody = (
  body: Record<string, unknown>,
  aes: string,
): Uint8Array => {
  const { key, iv } = deriveAesKey(aes);
  const encrypted = CryptoJS.AES.encrypt(
    CryptoJS.enc.Utf8.parse(JSON.stringify(body ?? {})),
    CryptoJS.enc.Utf8.parse(key),
    {
      iv: CryptoJS.enc.Utf8.parse(iv),
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7,
    },
  );
  return wordArrayToUint8Array(encrypted.ciphertext);
};

/**
 * 协议 B：解密云歌单响应内容
 * @param raw 响应原始二进制或字符串
 * @param aes 请求时所用的 6 位会话串
 * @returns 解密后的 UTF-8 文本
 */
export const decryptCloudResponse = (
  raw: Uint8Array | string,
  aes: string,
): string => {
  try {
    const { key, iv } = deriveAesKey(aes);
    const cipherText =
      typeof raw === "string"
        ? raw
        : CryptoJS.enc.Base64.stringify(uint8ArrayToWordArray(raw));

    const decrypted = CryptoJS.AES.decrypt(cipherText, CryptoJS.enc.Utf8.parse(key), {
      iv: CryptoJS.enc.Utf8.parse(iv),
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7,
    });
    return decrypted.toString(CryptoJS.enc.Utf8);
  } catch {
    return typeof raw === "string" ? raw : new TextDecoder("utf-8").decode(raw);
  }
};
