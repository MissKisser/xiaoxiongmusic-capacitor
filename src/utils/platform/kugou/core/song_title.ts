/**
 * 酷狗歌名剥离工具
 *
 * 剥除音频扩展名与歌手名前缀，统一公开歌单与云歌单中的歌名呈现口径。
 *
 * @author Hackerdallas
 */

/** 酷狗文件名形态的音频扩展名正则 */
const AUDIO_EXTENSION = /\.(mp3|flac|m4a|wav|ape|aac|ogg|oga|opus|wma|mp4|m4s|dsf|dff)$/i;

/** 酷狗连接多位歌手时使用的分隔符 */
const ARTIST_SEPARATOR = /[、,，;；]/;

/** 歌名剥离选项 */
export interface SongTitleOptions {
  /** 歌手名列表，用于定位歌名起点 */
  artistNames?: string[];
  /** 原始串是否确定按「歌手 - 歌名」形态组织 */
  artistPrefix?: boolean;
}

/**
 * 归一化歌手名：去掉所有空白与分隔符，便于逐字比较
 * @param value 歌手名
 * @returns 归一化后的歌手名
 */
const normalizeArtistName = (value: unknown): string =>
  String(value || "")
    .replace(/\s+/g, "")
    .replace(/[、,，;；]/g, "");

/**
 * 从歌曲条目里收集歌手名
 * @param song 歌曲条目
 * @returns 歌手名列表
 */
export const collectArtistNames = (song: any): string[] => {
  const names: string[] = [];
  const push = (value: unknown) => {
    const text = String(value || "").trim();
    if (text) names.push(text);
  };

  for (const singer of Array.isArray(song?.singerinfo) ? song.singerinfo : []) {
    push(singer && singer.name ? singer.name : singer);
  }
  for (const artist of Array.isArray(song?.artists) ? song.artists : []) {
    push(artist && artist.name ? artist.name : artist);
  }
  for (const flat of [song?.singername, song?.artist]) {
    const text = String(flat || "").trim();
    if (!text) continue;
    for (const part of text.split(ARTIST_SEPARATOR)) {
      push(part);
    }
  }

  return names;
};

/**
 * 归一化歌手段：去掉空白、歌手分隔符与连字符
 * @param value 歌手段原文
 * @returns 归一化后的歌手段
 */
const normalizeArtistBlock = (value: unknown): string =>
  String(value || "")
    .replace(/\s+/g, "")
    .replace(/[、,，;；-]/g, "");

/**
 * 判断候选歌手段与给定歌手名是否指同一批歌手
 * @param segments 候选歌手段原文
 * @param artistNames 给定的歌手名
 * @returns 指同一批歌手时为 true
 */
const matchesArtists = (segments: string[], artistNames: string[]): boolean => {
  const expected = artistNames.map(normalizeArtistName).filter(Boolean);
  if (expected.length === 0) return false;

  const names = new Set<string>();
  for (const segment of segments) {
    for (const part of segment.split(ARTIST_SEPARATOR)) {
      const name = normalizeArtistName(part);
      if (name) names.add(name);
    }
  }
  if (names.size === expected.length && expected.every((name) => names.has(name))) {
    return true;
  }

  return (
    expected.map(normalizeArtistBlock).join("") === segments.map(normalizeArtistBlock).join("")
  );
};

/**
 * 从酷狗原始歌名里剥离出纯歌名
 * @param fullName 原始歌名
 * @param options 剥离选项
 * @returns 纯歌名，取不到时返回空串
 */
export const extractSongTitle = (fullName: unknown, options: SongTitleOptions = {}): string => {
  const { artistNames = [], artistPrefix = false } = options;
  const source = String(fullName || "").trim();
  if (!source) return "";

  const hasExtension = AUDIO_EXTENSION.test(source);
  const segments = source
    .replace(AUDIO_EXTENSION, "")
    .split(" - ")
    .map((part) => part.trim())
    .filter(Boolean);
  if (segments.length === 0) return "";
  if (segments.length === 1) return segments[0];

  for (let count = 1; count < segments.length; count += 1) {
    if (matchesArtists(segments.slice(0, count), artistNames)) {
      return segments.slice(count).join(" - ");
    }
  }

  if (artistPrefix || hasExtension) {
    return segments.slice(1).join(" - ");
  }

  return segments.join(" - ");
};

/**
 * 从歌曲条目里取出纯歌名
 * @param entry 歌曲条目
 * @param options 剥离选项
 * @returns 纯歌名
 */
export const extractEntryTitle = (
  entry: any,
  options: SongTitleOptions & { nameFields?: string[] } = {},
): string => {
  const { nameFields = ["name"], artistPrefix = false } = options;
  const source = nameFields
    .map((field) => String((entry && entry[field]) || "").trim())
    .find((text) => text);
  if (!source) return "";

  return extractSongTitle(source, {
    artistNames: collectArtistNames(entry),
    artistPrefix,
  });
};
