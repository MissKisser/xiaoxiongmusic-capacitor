/**
 * 测试环境 AMLL 歌词解析桩
 *
 * node 单测环境无法加载 @applemusic-like-lyrics/lyric（wasm ESM 入口），
 * 由 amll-resolve-hook.mjs 将该包解析到本桩。
 * parseLrc 以仓库自研 contentParser 的 LRC 口径实现（行级时间标签 + 整行文本），
 * 满足翻译 / 音译对齐测试所需的行为。
 */

const TIME_TAG = /\[(\d{1,3}):(\d{1,2}(?:\.\d{1,3})?)\]/g;

/**
 * 解析 LRC 文本为行数组
 * @param content LRC 文本
 * @returns 行数组（无时间标签或空文本的行被跳过）
 */
export function parseLrc(content) {
  const lines = [];
  for (const raw of String(content ?? "").split(/\r?\n/)) {
    TIME_TAG.lastIndex = 0;
    const times = [];
    let match;
    while ((match = TIME_TAG.exec(raw)) !== null) {
      times.push(Math.round(Number(match[1]) * 60000 + Number(match[2]) * 1000));
    }
    if (!times.length) continue;
    const text = raw.replace(TIME_TAG, "").trim();
    if (!text) continue;
    for (const startTime of times) {
      lines.push({
        startTime,
        endTime: startTime,
        words: [{ word: text, startTime, endTime: startTime, romanWord: "" }],
        translatedLyric: "",
        romanLyric: "",
        isBG: false,
        isDuet: false,
      });
    }
  }
  return lines;
}

/**
 * 解析 TTML 文本（测试桩占位）
 * @returns 空行数组
 */
export function parseTTML() {
  return { lines: [] };
}

/**
 * 解析 YRC 文本（测试桩占位）
 * @returns 空行数组
 */
export function parseYrc() {
  return [];
}
