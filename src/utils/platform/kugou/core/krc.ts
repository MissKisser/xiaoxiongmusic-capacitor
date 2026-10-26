/**
 * 酷狗音乐 KRC 逐字歌词解密与解析
 *
 * 加密链路：base64 字符串去掉头 4 字节 → 与 16 字节固定密钥循环 XOR →
 * pako inflate 解压 → UTF-8 明文。
 *
 * @author Hackerdallas
 */

import { inflate } from "pako";
import { decodeName } from "./config";

/** KRC 解密用的 16 字节固定密钥 */
const KRC_KEY = Uint8Array.from([
  0x40, 0x47, 0x61, 0x77, 0x5e, 0x32, 0x74, 0x47, 0x51, 0x36, 0x31, 0x2d, 0xce, 0xd2, 0x6e, 0x69,
]);

/** KRC 头部的 id 标记行 */
const HEAD_ID_REG = /^.*\[id:\$\w+\]\n/;
/** 翻译与罗马音承载行 */
const LANGUAGE_REG = /\[language:([\w=/+=]+)\]/;
/** 承载行的整行匹配 */
const LANGUAGE_LINE_REG = /\[language:[\w=/+=]+\]\n?/;
/** 行首时间标签（全局） */
const LINE_TIME_REG = /\[((\d+),\d+)\].*/g;
/** 行首时间标签（单行） */
const LINE_TIME_EACH_REG = /\[((\d+),\d+)\].*/;

/**
 * Base64 字符串转 Uint8Array
 * @param base64 Base64 编码字符串
 * @returns 二进制字节数组
 */
const base64ToUint8Array = (base64: string): Uint8Array => {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

/**
 * Base64 字符串转 UTF-8 明文
 * @param base64 Base64 编码字符串
 * @returns UTF-8 字符串
 */
export const base64ToUtf8 = (base64: string): string => {
  const bytes = base64ToUint8Array(base64);
  return new TextDecoder("utf-8").decode(bytes);
};

/**
 * 把毫秒格式化成 MM:SS.xxx
 * @param ms 毫秒数
 * @returns 时间标签
 */
export const msToTimeTag = (ms: number): string => {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const x = Math.floor(ms % 1000);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${x}`;
};

/**
 * 解密一段 KRC base64 内容
 * @param base64 KRC 的 base64 文本
 * @returns 解压后的 UTF-8 明文
 */
export const decryptKrc = async (base64: string): Promise<string> => {
  if (!base64) throw new Error("empty krc content");
  const rawBytes = base64ToUint8Array(base64);
  const buf = rawBytes.subarray(4);
  for (let i = 0; i < buf.length; i += 1) {
    buf[i] ^= KRC_KEY[i % 16];
  }
  const out = inflate(buf);
  return new TextDecoder("utf-8").decode(out);
};

/**
 * 解析解密后的 KRC 明文
 * @param raw 解密后的明文
 * @returns 四种歌词文本
 */
export const parseKrc = (
  raw: string,
): {
  lrc: string;
  krc: string;
  trans: string;
  roma: string;
} => {
  let text = String(raw).replace(/\r/g, "");
  if (HEAD_ID_REG.test(text)) text = text.replace(HEAD_ID_REG, "");

  let transLines: string[] | undefined;
  let romaLines: string[] | undefined;
  const langMatch = text.match(LANGUAGE_REG);
  if (langMatch) {
    text = text.replace(LANGUAGE_LINE_REG, "");
    try {
      const json = JSON.parse(base64ToUtf8(langMatch[1])) as {
        content?: Array<{ lyricContent?: unknown[][]; type?: number }>;
      };
      for (const item of json.content || []) {
        const lines = (item.lyricContent || []).map((arr) => arr.join(""));
        if (item.type === 0) romaLines = lines;
        else if (item.type === 1) transLines = lines;
      }
    } catch {
      // 译文解析失败不影响主歌词
    }
  }

  let idx = 0;
  const krcBody = text.replace(LINE_TIME_REG, (line) => {
    const match = line.match(LINE_TIME_EACH_REG);
    if (!match) return line;
    const timeTag = msToTimeTag(parseInt(match[2], 10));
    if (romaLines && romaLines[idx] !== undefined) {
      romaLines[idx] = `[${timeTag}]${romaLines[idx]}`;
    }
    if (transLines && transLines[idx] !== undefined) {
      transLines[idx] = `[${timeTag}]${transLines[idx]}`;
    }
    idx += 1;
    return line.replace(match[1], timeTag);
  });

  const krc = decodeName(krcBody.replace(/<(\d+,\d+),\d+>/g, "<$1>"));
  const lrc = krc.replace(/<\d+,\d+>/g, "");

  return {
    lrc,
    krc,
    trans: decodeName(transLines ? transLines.join("\n") : ""),
    roma: decodeName(romaLines ? romaLines.join("\n") : ""),
  };
};

/**
 * 解密并解析一段 KRC base64 内容
 * @param base64Content KRC 的 base64 文本
 * @returns 四种歌词文本
 */
export const decodeKrc = async (
  base64Content: string,
): Promise<{ lrc: string; krc: string; trans: string; roma: string }> => {
  const text = await decryptKrc(base64Content);
  return parseKrc(text);
};
