/**
 * QQ 音乐 QRC 逐字歌词解密与解析
 *
 * 采用纯前端标准 Web API（Uint8Array、TextDecoder、TextEncoder）
 * 并使用 pako 进行 zlib / inflate / gzip 流解压，完全消灭 Node.js 运行时依赖。
 *
 * @author Hackerdallas
 */

import { inflate, inflateRaw, ungzip } from "pako";
import { qrcDecrypt } from "./tripledes";

/** QRC 逐字歌词行 */
export interface QrcLyricWord {
  /** 文字 */
  text: string;
  /** 起始毫秒 */
  start: number;
  /** 时长毫秒 */
  duration: number;
}

/** QRC / LRC 歌词行 */
export interface QrcLyricLine {
  /** 行起始毫秒 */
  time: number;
  /** 行时长毫秒，LRC 恒为 0 */
  duration: number;
  /** 行文本 */
  text: string;
  /** 逐字信息，LRC 恒为空数组 */
  words: QrcLyricWord[];
}

/** 歌词解析结果 */
export interface ParsedLyric {
  /** 歌词格式：qrc / lrc */
  format: string;
  /** 歌词正文 */
  content: string;
  /** 逐行歌词 */
  lines: QrcLyricLine[];
}

/**
 * QRC 解密密钥 - 24 字节
 */
const QRC_KEY = new TextEncoder().encode("!@#)(*$%123ZXC!@!@#)(NHL");

/**
 * 将十六进制字符串转为 Uint8Array
 * @param hex 十六进制字符串
 * @returns 字节数组
 */
const hexToUint8Array = (hex: string): Uint8Array => {
  const cleanHex = hex.trim();
  const len = cleanHex.length;
  const bytes = new Uint8Array(Math.floor(len / 2));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
};

/**
 * 解密 QRC 歌词密文
 * 使用 Triple DES 解密 + pako 解压缩
 *
 * @param encryptedQrc 十六进制编码的加密歌词字符串
 * @returns 解密后的歌词文本
 */
export function decryptQrc(encryptedQrc: string): string {
  if (!encryptedQrc || encryptedQrc.trim() === "") {
    throw new Error("没有可解密的数据");
  }

  // 1. Hex 转 Uint8Array
  const encryptedData = hexToUint8Array(encryptedQrc);

  // 2. Triple DES 解密
  const decrypted = qrcDecrypt(encryptedData, QRC_KEY);

  const decoder = new TextDecoder("utf-8");

  // 3. 解压数据（尝试多种格式）
  // 尝试 1: zlib inflate (带 zlib header)
  try {
    const decompressed = inflate(decrypted);
    return decoder.decode(decompressed);
  } catch {
    // 格式不匹配时继续尝试下一种解压器
  }

  // 尝试 2: raw inflate (无 header)
  try {
    const decompressed = inflateRaw(decrypted);
    return decoder.decode(decompressed);
  } catch {
    // 格式不匹配时继续尝试下一种解压器
  }

  // 尝试 3: gzip unzip
  try {
    const decompressed = ungzip(decrypted);
    return decoder.decode(decompressed);
  } catch {
    // 格式不匹配时走下方的原文兜底
  }

  // 尝试 4: 可能数据本身未压缩
  const str = decoder.decode(decrypted);
  if (str.includes("[") || str.includes("<")) {
    return str;
  }

  throw new Error("无法解压数据");
}

/**
 * 解开 XML 实体转义
 * @param text 原始文本
 * @returns 解开实体后的文本
 */
const decodeXmlEntities = (text: string): string =>
  String(text)
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

/**
 * 从 QRC 的 XML 封装里提取歌词正文
 *
 * QRC 文本形如 `<?xml ...?><QrcInfos><LyricInfo><Lyric_1 LyricType="1" LyricContent="..."/>`
 * @param text 歌词原文
 * @returns 歌词格式与正文
 */
const extractContent = (text: string): { format: string; content: string } => {
  const source = String(text || "");
  const matched = source.match(/LyricContent="([\s\S]*?)"(?:\s*\/>|\s*>)/);
  if (!matched) return { format: "lrc", content: source };
  return { format: "qrc", content: decodeXmlEntities(matched[1]) };
};

/**
 * 解析 LRC 行的时间标签
 * @param tag 时间标签，如 `00:12.34`
 * @returns 毫秒数，解析失败返回 0
 */
const parseLrcTag = (tag: string): number => {
  const matched = String(tag).match(/(\d+):(\d{1,2})(?:[.:](\d{1,3}))?/);
  if (!matched) return 0;
  const minutes = Number(matched[1]);
  const seconds = Number(matched[2]);
  const fraction = matched[3] ? Number("0." + matched[3]) : 0;
  return Math.round((minutes * 60 + seconds) * 1000 + fraction * 1000);
};

/**
 * 解析 QRC 行的逐字内容
 *
 * 行格式为 `[行起始毫秒,行时长毫秒]字(相对起始毫秒,时长毫秒)字(...)`
 * @param body 行正文
 * @returns 逐字信息与整行文本
 */
const parseQrcBody = (body: string): { words: QrcLyricWord[]; text: string } => {
  const words: QrcLyricWord[] = [];
  const pattern = /\((\d+),(\d+)\)/g;
  let cursor = 0;
  let matched = pattern.exec(body);

  while (matched !== null) {
    words.push({
      text: body.slice(cursor, matched.index),
      start: Number(matched[1]),
      duration: Number(matched[2]),
    });
    cursor = matched.index + matched[0].length;
    matched = pattern.exec(body);
  }

  return { words, text: words.map((word) => word.text).join("") };
};

/**
 * 把歌词正文解析成逐行（逐字）结构
 * @param content 歌词正文
 * @param format 歌词格式：qrc / lrc
 * @returns 歌词行数组
 */
const parseLines = (content: string, format: string): QrcLyricLine[] => {
  const lines: QrcLyricLine[] = [];
  const text = String(content || "");

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;

    if (format === "qrc") {
      const matched = line.match(/^\[(\d+),(\d+)\](.*)$/);
      if (!matched) continue;
      const lineStart = Number(matched[1]);
      const parsed = parseQrcBody(matched[3]);
      lines.push({
        time: lineStart,
        duration: Number(matched[2]),
        text: parsed.text,
        words: parsed.words.map((word) => ({
          text: word.text,
          start: lineStart + word.start,
          duration: word.duration,
        })),
      });
      continue;
    }

    const matched = line.match(/^\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\](.*)$/);
    if (!matched) continue;
    lines.push({
      time: parseLrcTag(matched[1] + ":" + matched[2]),
      duration: 0,
      text: matched[3].trim(),
      words: [],
    });
  }

  return lines;
};

/**
 * 解析 QQ 音乐歌词文本
 *
 * 同时兼容 QRC 的 XML 封装与裸 LRC 文本
 * @param text 歌词原文
 * @returns 歌词格式、正文与逐行结构
 */
export const parseLyric = (text: string): ParsedLyric => {
  const { format, content } = extractContent(text);
  return { format, content, lines: parseLines(content, format) };
};
