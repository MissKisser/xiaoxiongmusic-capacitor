/**
 * 酷狗听书核心数据层
 *
 * 听书专辑与普通音乐专辑共用同一套 ID 体系：
 * - 专辑 ID 即 album_id
 * - 章节即该专辑下的曲目，章节音频沿用普通歌曲的 hash 播放链路
 * - category: 普通音乐专辑为 1，听书专辑为 2
 *
 * @author Hackerdallas
 */

import { fillCover } from "./config";
import { kgRequest } from "./request";

/** 听书专辑检索端点 */
export const KG_TS_SEARCH_URL = "http://mobilecdn.kugou.com/api/v3/search/album";

/** 听书专辑详情端点 */
export const KG_TS_ALBUM_INFO_URL = "http://mobilecdn.kugou.com/api/v3/album/info";

/** 听书专辑章节端点 */
export const KG_TS_ALBUM_SONG_URL = "http://mobilecdn.kugou.com/api/v3/album/song";

/** 听书专辑在专辑接口里的分类值（普通音乐专辑为 1） */
export const KG_AUDIOBOOK_CATEGORY = 2;

/** 听书频道定义 */
export interface KGAudiobookCategory {
  /** 官网频道路径片段，同时也是本平台对外的分类标识 */
  slug: string;
  /** 频道中文名 */
  name: string;
  /** 该频道的取材关键字，检索时配合 category=2 使用 */
  keyword: string;
}

/**
 * 听书频道表
 */
export const KG_AUDIOBOOK_CATEGORIES: KGAudiobookCategory[] = [
  { slug: "xiaoshuo", name: "有声小说", keyword: "小说" },
  { slug: "ertong", name: "儿童天地", keyword: "儿童" },
  { slug: "xiangsheng", name: "相声曲艺", keyword: "相声" },
  { slug: "qinggan", name: "情感生活", keyword: "情感" },
  { slug: "yueyu", name: "粤语", keyword: "粤语" },
  { slug: "zhumian", name: "助眠解压", keyword: "助眠" },
  { slug: "yule", name: "娱乐段子", keyword: "段子" },
  { slug: "guangboju", name: "广播剧", keyword: "广播剧" },
  { slug: "lishi", name: "国学", keyword: "国学" },
  { slug: "chongdian", name: "自我充电", keyword: "成长" },
  { slug: "erciyuan", name: "二次元", keyword: "二次元" },
  { slug: "zhongxiaoxue", name: "中小学必备", keyword: "中小学" },
  { slug: "waiyu", name: "外语", keyword: "英语" },
];

/**
 * 把听书官网的 base36 专辑别名反解为数字专辑 ID
 * @param encoded 官网专辑别名
 * @returns 数字专辑 ID，无法解析时返回 0
 */
export const decodeAlbumId = (encoded: unknown): number => {
  const text = String(encoded ?? "").trim();
  if (!text || !/^[0-9a-z]+$/i.test(text)) return 0;

  const value = parseInt(text, 36);
  if (!Number.isFinite(value)) return 0;
  return Math.floor(value / 1296);
};

/**
 * 把外部传入的专辑标识归一成数字专辑 ID
 * @param id 专辑标识
 * @returns 数字专辑 ID，无法解析时返回 0
 */
export const normalizeAlbumId = (id: unknown): number => {
  const text = String(id === undefined || id === null ? "" : id).trim();
  if (!text) return 0;
  if (/^\d+$/.test(text)) return Number(text);

  const alias = text.split("/").filter(Boolean).pop() || text;
  return decodeAlbumId(alias);
};

/**
 * 按标识查听书频道
 * @param category 频道标识（slug、中文名或取材关键字）
 * @returns 频道定义，未命中时返回 null
 */
export const findCategory = (category: unknown): KGAudiobookCategory | null => {
  const text = String(category === undefined || category === null ? "" : category)
    .trim()
    .toLowerCase();
  if (!text) return null;

  return (
    KG_AUDIOBOOK_CATEGORIES.find(
      (item) =>
        item.slug.toLowerCase() === text ||
        item.name.toLowerCase() === text ||
        item.keyword.toLowerCase() === text,
    ) || null
  );
};

/**
 * 反转义 HTML 实体并清洗
 * @param text 原始文本
 * @returns 清洗后的文本
 */
export const decodeText = (text: unknown): string => {
  if (!text) return "";
  return String(text)
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'");
};

/**
 * 读取听书专辑检索结果
 * @param options 检索参数
 * @returns 专辑条目、总数与上游原始响应
 */
export const searchAudiobookAlbums = async (options: {
  keyword: string;
  category?: number;
  page?: number;
  pagesize?: number;
}): Promise<{ total: number; list: Record<string, any>[]; raw: unknown }> => {
  const {
    keyword,
    category = KG_AUDIOBOOK_CATEGORY,
    page = 1,
    pagesize = 20,
  } = options;

  const query = new URLSearchParams({
    keyword,
    category: String(category),
    page: String(page),
    pagesize: String(pagesize),
    format: "json",
  });

  const raw = await kgRequest<{ data?: Record<string, any> }>(
    `${KG_TS_SEARCH_URL}?${query.toString()}`,
  );
  const data = raw?.data ?? {};
  const list = Array.isArray(data.lists)
    ? data.lists
    : Array.isArray(data.info)
      ? data.info
      : [];

  return {
    total: Number(data.total || list.length),
    list,
    raw,
  };
};

/**
 * 读取听书专辑元信息
 * @param albumId 数字专辑 ID
 * @returns 专辑元信息与上游原始响应
 */
export const fetchAudiobookDetail = async (
  albumId: number,
): Promise<{ detail: Record<string, any>; raw: unknown }> => {
  const raw = await kgRequest<{ data?: Record<string, any> }>(
    `${KG_TS_ALBUM_INFO_URL}?albumid=${encodeURIComponent(albumId)}&format=json`,
  );
  return { detail: raw?.data ?? {}, raw };
};

/**
 * 读取听书专辑的章节列表
 * @param albumId 数字专辑 ID
 * @param page 页码，从 1 开始
 * @param pagesize 每页条数
 * @returns 章节条目、章节总数与上游原始响应
 */
export const fetchAudiobookTracks = async (
  albumId: number,
  page = 1,
  pagesize = 30,
): Promise<{ total: number; list: Record<string, any>[]; raw: unknown }> => {
  const query = new URLSearchParams({
    albumid: String(albumId),
    page: String(page),
    pagesize: String(pagesize),
    format: "json",
  });

  const raw = await kgRequest<{ data?: Record<string, any> }>(
    `${KG_TS_ALBUM_SONG_URL}?${query.toString()}`,
  );
  const data = raw?.data ?? {};
  const list = Array.isArray(data.info) ? data.info : [];

  return {
    total: Number(data.total || list.length),
    list,
    raw,
  };
};

/**
 * 把播音者串拆成播音者列表
 * @param speaker 播音者串
 * @returns 播音者列表
 */
export const splitSpeakers = (speaker: string): Array<{ id: string; name: string }> => {
  if (!speaker) return [];
  return speaker
    .split(/、|,|;/)
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => ({ id: "", name }));
};

/**
 * 把上游专辑条目映射为对外的听书专辑卡片
 * @param raw 上游专辑条目
 * @returns 对外专辑对象
 */
export const normalizeAlbum = (raw: Record<string, any>) => {
  const source = raw || {};
  const coverTemplate = source.imgurl || "";
  const speaker = decodeText(source.singername || "");

  return {
    id: String(source.albumid ?? ""),
    albumId: Number(source.albumid ?? 0),
    name: decodeText(source.albumname || ""),
    cover: fillCover(coverTemplate, 300) ?? "",
    coverOriginal: fillCover(coverTemplate, 480) ?? "",
    speaker,
    speakers: splitSpeakers(speaker),
    episodeCount: Number(source.songcount ?? 0),
    publishTime: source.publishtime || "",
    intro: decodeText(source.intro || ""),
    category: Number(source.category ?? KG_AUDIOBOOK_CATEGORY),
    privilege: Number(source.privilege ?? 0),
    buyCount: Number(source.buycount ?? 0),
  };
};

/**
 * 把上游章节条目映射为对外的听书章节
 * @param raw 上游章节条目
 * @param index 章节序号，从 1 开始
 * @returns 对外章节对象
 */
export const normalizeTrack = (raw: Record<string, any>, index: number) => {
  const source = raw || {};
  const filename = decodeText(source.filename || "");
  const splitAt = filename.indexOf(" - ");
  const speaker = splitAt > 0 ? filename.slice(0, splitAt).trim() : "";
  const title = splitAt > 0 ? filename.slice(splitAt + 3).trim() : filename;
  const duration = Number(source.duration ?? 0);

  return {
    index,
    id: String(source.album_audio_id ?? ""),
    albumAudioId: Number(source.album_audio_id ?? 0),
    audioId: Number(source.audio_id ?? 0),
    hash: source.hash || "",
    title,
    speaker,
    duration,
    durationMs: duration * 1000,
    size: Number(source.filesize ?? 0),
    privilege: Number(source.privilege ?? 0),
    payType: Number(source.pay_type ?? 0),
    extName: String(source.extname ?? ""),
  };
};
