/**
 * 平台数据层共用工具
 *
 * QQ 音乐与酷狗的归一化逻辑里有几段结构完全一致的基础动作
 * （地址升级、歌手串拆分、歌手条目归一化、数字 id 稳定派生），
 * 统一收敛到这里，平台文件只保留各自的归一化差异。
 *
 * @author Hackerdallas
 */

import type { ApiPlatform } from "@/types/shared";
import type { PlatformArtist } from "./types";

/**
 * 把 http / 协议相对地址升级为 https
 * @param url 原始地址
 * @returns 安全地址
 */
export const secureUrl = (url: unknown): string => {
  if (typeof url !== "string" || !url) return "";
  if (url.startsWith("//")) return `https:${url}`;
  return url.replace(/^http:\/\//, "https://");
};

/**
 * 歌手串分隔符
 *
 * QQ 音乐用 ` / ` 连接歌手；酷狗用 `、`（也有 `,` `;` `/`）连接合作歌手。
 * 合作曲的歌手串若不拆开，会被当成一个不存在的「组合」歌手。
 */
const QQ_ARTIST_SEPARATORS = " / ";
const KUGOU_ARTIST_SEPARATORS = /、|,|;|\s*\/\s*/;

/**
 * 按平台口径把平台的歌手串拆成歌手数组
 *
 * 歌手串里没有平台主键，拆分后的条目 `id` 留空，
 * 由调用方按需派生稳定数字 id。
 * @param artist 歌手串
 * @param platform 来源平台
 * @returns 歌手数组
 */
export const splitArtistsByPlatform = (
  artist: unknown,
  platform: ApiPlatform,
): PlatformArtist[] => {
  if (typeof artist !== "string" || !artist) return [];
  const names =
    platform === "kugou"
      ? artist.split(KUGOU_ARTIST_SEPARATORS)
      : artist.split(QQ_ARTIST_SEPARATORS);
  return names
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => ({ id: "", name }));
};

/**
 * 归一化歌手条目
 * @param singer 歌手条目
 * @param mid 歌手平台主键（QQ 音乐为 mid，酷狗无此概念）
 * @returns 归一化歌手
 */
export const normalizeArtistEntry = (
  singer: Record<string, any>,
  mid?: string,
): PlatformArtist => ({
  id: String(singer?.id ?? ""),
  name: String(singer?.name ?? ""),
  mid: mid || undefined,
});

/**
 * 取歌手条目的平台定位主键
 *
 * QQ 音乐以 mid 定位，缺 mid 时无法定位歌手，主键留空；
 * 酷狗以 author_id 定位，上游只给歌手名的曲目主键留空
 * （酷狗歌手接口支持按名反查，名字不是主键）。
 * @param platform 来源平台
 * @param artist 归一化歌手
 * @returns 平台内主键，取不到时为 undefined
 */
export const resolveArtistPlatformId = (
  platform: ApiPlatform,
  artist: PlatformArtist,
): string | undefined => {
  if (platform === "qqmusic") return artist.mid || undefined;
  const id = String(artist.id ?? "").trim();
  return /^\d+$/.test(id) ? id : undefined;
};

/** 派生数字 id 的保留区间下界（平台真实数字 id 均远小于该值） */
const DERIVED_ID_BASE = 2000000000;

/** 派生数字 id 的保留区间长度 */
const DERIVED_ID_RANGE = 1000000000;

/**
 * 由平台字符串主键派生稳定的数字 id
 *
 * 平台条目有时只给字符串主键（QQ 音乐 mid / 酷狗 hash），
 * 应用内歌曲模型要求数字 id，这里用 FNV-1a 32 位散列派生一个
 * 落在保留高位区间的正整数：同一主键恒得同一数字，
 * 且不会与平台真实数字 id 混淆。
 *
 * `platformId` 始终是权威主键，数字 id 只作列表内匹配用的稳定占位。
 * @param seed 派生种子（平台字符串主键，缺省时用名称）
 * @returns 稳定的正整数 id
 */
export const deriveStableId = (seed: string): number => {
  const text = String(seed ?? "");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const offset = (hash >>> 0) % DERIVED_ID_RANGE;
  return DERIVED_ID_BASE + offset;
};

/**
 * 取条目上第一个可用的数字 id
 *
 * 平台给的是数字字符串时直接用；给的是空串或非数字时按种子派生，
 * 保证结果非 0 且同一输入恒得同一值。
 * @param raw 平台给出的原始 id
 * @param seed 派生种子（平台字符串主键或名称）
 * @returns 数字 id
 */
export const toNumericId = (raw: unknown, seed: string): number => {
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  return deriveStableId(seed);
};

/**
 * 秒级时间戳的判定上界
 *
 * 秒级时间戳表示的日期远早于 2001 年，毫秒级时间戳从 2001 年起，
 * 真实数据里两者的量级差异极大，用该上界即可稳定区分两种单位。
 */
const SECONDS_TIMESTAMP_LIMIT = 1e12;

/**
 * 把平台时间戳统一换算为毫秒
 *
 * 第三方平台（QQ 音乐 / 酷狗）的时间戳单位不统一：接口给的是秒级，
 * 直接按毫秒渲染会把 2026 年的时间显示成 1970 年。
 * 这里按量级判定单位：小于上界的视为秒级并换算，
 * 已是毫秒的（网易云口径）按原值返回。
 * @param value 平台给出的时间戳
 * @returns 毫秒时间戳；取不到有效值时为 undefined
 */
export const toMillisTimestamp = (value: unknown): number | undefined => {
  const time = Number(value);
  if (!Number.isFinite(time) || time <= 0) return undefined;
  return time < SECONDS_TIMESTAMP_LIMIT ? time * 1000 : time;
};

/**
 * 日期文本的解析模式
 *
 * 平台的上游时间除时间戳外还常给日期文本，形态有
 * `2026-10-23 08:30:01`、`2026-10-23`、`2026-10-23 19:00` 等，
 * 日期与时间之间可能是空格、制表符或 `T`。
 */
const DATE_TEXT_PATTERN =
  /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T]+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/;

/**
 * 把平台给出的时间统一换算为毫秒
 *
 * 平台的上游时间有三种形态：秒级时间戳、毫秒级时间戳与日期文本。
 * 数值按量级区分秒与毫秒（同 {@link toMillisTimestamp}），
 * 文本按本地时区解析成日期，避免时区偏移把日期挪到前后一天。
 * @param value 平台给出的时间
 * @returns 毫秒时间戳；取不到有效值时为 undefined
 */
export const toMillisDateTime = (value: unknown): number | undefined => {
  if (value === null || value === undefined || value === "") return undefined;
  if (typeof value === "number") return toMillisTimestamp(value);
  const text = String(value).trim();
  if (!text) return undefined;
  // 纯数字按时间戳处理
  if (/^\d+$/.test(text)) return toMillisTimestamp(text);
  const matched = DATE_TEXT_PATTERN.exec(text);
  if (!matched) return undefined;
  const [, year, month, day, hour, minute, second] = matched;
  const time = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour ?? 0),
    Number(minute ?? 0),
    Number(second ?? 0),
  ).getTime();
  return Number.isFinite(time) ? time : undefined;
};
