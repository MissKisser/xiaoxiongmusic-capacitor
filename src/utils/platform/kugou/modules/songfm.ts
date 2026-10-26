/**
 * 酷狗音乐刷歌（推荐流）
 *
 * 一次批次 = 「主选流」全部条目排前 + 「补池」补足到 limit 排后，
 * 对外形状：{ code, total, songs, source }。
 *
 * @author Hackerdallas
 */

import { kgGatewayRequest } from "../core/request";
import { decodeName, fillCover } from "../core/config";
import { coreLog } from "../core/logger";
import type { KGModule, KGParams } from "../core/types";

/** 主选流端点（网关相对路径） */
const KG_FEED_PATH = "/genesisapi/v1/newepoch_song_rec/feed";

/** 主选流与主题推荐端点的网关地址 */
const KG_GATEWAY_BASE_URL = "http://gateway.kugou.com";

/** 多主题推荐端点 */
const KG_MUL_THEME_PATH = "/everydayrec.service/v1/mul_theme_category_recommend";

/** 单主题推荐端点 */
const KG_THEME_PATH = "/everydayrec.service/v1/theme_category_recommend";

/** 每日推荐端点（兜底补池） */
const KG_DAILY_PATH = "/everyday/api/v1/more";

/** 每日推荐端点所属域名 */
const KG_DAILY_BASE_URL = "http://everydayrec.service.kugou.com";

/** 单批默认曲目数 */
const DEFAULT_LIMIT = 20;

/** 单批曲目数上限 */
const MAX_LIMIT = 50;

/** 每批补池随机取用的主题数 */
const POOL_THEME_COUNT = 2;

/** 上游原始条目 */
type RawEntry = Record<string, any>;

/**
 * 拆分歌手串
 * @param name 歌手串
 * @returns 歌手名数组
 */
const splitArtistNames = (name: unknown): string[] =>
  decodeName(String(name ?? ""))
    .split(/、|,|;|\s*\/\s*/)
    .map((item) => item.trim())
    .filter(Boolean);

/**
 * 洗牌（Fisher-Yates）
 * @param list 原数组
 * @returns 洗牌后的新数组
 */
const shuffle = <T>(list: T[]): T[] => {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

/**
 * 收集音质档位的 hash 与文件大小
 * @param target 收集目标
 * @param quality 音质档位名
 * @param hash 该档位 hash
 * @param size 该档位文件大小
 */
const putQuality = (
  target: { hashes: Record<string, string>; sizes: Record<string, number> },
  quality: string,
  hash: unknown,
  size: unknown,
): void => {
  if (!hash || !size) return;
  target.hashes[quality] = String(hash);
  target.sizes[quality] = Number(size);
};

/**
 * 归一化主选流曲目
 * @param raw 上游动态条目
 * @returns 归一化后的曲目，无有效 hash 时返回 null
 */
const normalizeFeedSong = (raw: RawEntry): RawEntry | null => {
  const entry = raw || {};
  const extra = entry.song_extra || {};
  const audio = extra.audio_info || {};
  const base = extra.base_info || {};
  const copyright = extra.copyright || {};
  const trans = copyright.trans_param || {};
  const song = entry.song || {};

  const hash = String(audio.hash || "");
  if (!hash) return null;

  const artistNames = splitArtistNames(base.author_name || song.author_name);
  const artistName = artistNames.join(" / ");
  const interval = Math.round(Number(audio.timelength || 0) / 1000);

  const target: { hashes: Record<string, string>; sizes: Record<string, number> } = {
    hashes: {},
    sizes: {},
  };
  putQuality(target, "128k", audio.hash, audio.filesize);
  putQuality(target, "320k", audio.hash_320, audio.filesize_320);
  putQuality(target, "flac", audio.hash_flac, audio.filesize_flac);
  putQuality(target, "flac24bit", audio.hash_high, audio.filesize_high);

  const audition = copyright.audition || {};
  const hashOffset = trans.hash_offset || {};
  const trialDuration = Number(audition.end_ms || hashOffset.end_ms || 0);
  const qualities = copyright.qualities || {};
  const baseQuality = qualities["128"] || {};

  const coverTemplate = trans.union_cover || song.album_cover || "";

  return {
    id: String(base.album_audio_id || ""),
    mid: "",
    audioId: Number(base.audio_id || 0),
    albumAudioId: Number(base.album_audio_id || 0),
    mixSongId: String(base.album_audio_id || ""),
    hash,
    name: decodeName(base.songname || song.songname || ""),
    artist: artistName,
    artists: artistNames.map((name) => ({ id: "", name })),
    album: decodeName(base.album_name || ""),
    albumMid: "",
    albumId: String(base.album_id || song.album_id || ""),
    cover: fillCover(coverTemplate, 300) ?? "",
    coverOriginal: fillCover(coverTemplate, 480) ?? "",
    duration: interval * 1000,
    interval,
    qualities: Object.keys(target.hashes),
    hashes: target.hashes,
    sizes: target.sizes,
    pay: {
      payplay: Number(copyright.audio_pay_type || 0),
      privilege: Number(baseQuality.privilege ?? song.privilege_128 ?? 0),
      feetype: 0,
      pkgPrice: 0,
      price: 0,
    },
    trial: {
      available: trialDuration > 0,
      duration: trialDuration,
    },
    file: {},
    source: "feed",
  };
};

/**
 * 归一化补池曲目（扁平口径）
 * @param raw 上游曲目条目
 * @param source 来源标注
 * @returns 归一化后的曲目，无有效 hash 时返回 null
 */
export const normalizePoolSong = (raw: RawEntry, source: string): RawEntry | null => {
  const entry = raw || {};
  const trans = entry.trans_param || {};
  const hash = String(entry.hash_128 || entry.hash || "");
  if (!hash) return null;

  const singerInfo = Array.isArray(entry.singerinfo) ? entry.singerinfo : [];
  const singers = singerInfo.map((singer: RawEntry) => ({
    id: singer && singer.id !== undefined ? String(singer.id) : "",
    name: decodeName((singer && singer.name) || ""),
  }));
  const namedSingers = singers.filter((singer: { id: string; name: string }) => singer.name);
  const artists = namedSingers.length
    ? namedSingers
    : splitArtistNames(entry.author_name).map((name) => ({ id: "", name }));
  const artistName = artists.map((singer: { name: string }) => singer.name).join(" / ");

  const interval = Number(entry.time_length || 0);

  const target: { hashes: Record<string, string>; sizes: Record<string, number> } = {
    hashes: {},
    sizes: {},
  };
  putQuality(target, "128k", entry.hash_128 || entry.hash, entry.filesize_128 || entry.filesize);
  putQuality(target, "320k", entry.hash_320, entry.filesize_320);
  putQuality(target, "flac", entry.hash_flac, entry.filesize_flac);
  putQuality(target, "flac24bit", entry.hash_high, entry.filesize_high);

  const hashOffset = trans.hash_offset || {};
  const trialDuration = Number(hashOffset.end_ms || 0);

  const coverTemplate = entry.sizable_cover || trans.union_cover || "";

  return {
    id: String(entry.album_audio_id || ""),
    mid: "",
    audioId: Number(entry.songid || 0),
    albumAudioId: Number(entry.album_audio_id || 0),
    mixSongId: String(entry.album_audio_id || ""),
    hash,
    name: decodeName(entry.songname || ""),
    artist: artistName,
    artists,
    album: decodeName(entry.album_name || ""),
    albumMid: "",
    albumId: String(entry.album_id || ""),
    cover: fillCover(coverTemplate, 300) ?? "",
    coverOriginal: fillCover(coverTemplate, 480) ?? "",
    duration: interval * 1000,
    interval,
    qualities: Object.keys(target.hashes),
    hashes: target.hashes,
    sizes: target.sizes,
    pay: {
      payplay: Number(entry.pay_type || 0),
      privilege: Number(entry.privilege || 0),
      feetype: 0,
      pkgPrice: 0,
      price: 0,
    },
    trial: {
      available: trialDuration > 0,
      duration: trialDuration,
    },
    file: {},
    source,
  };
};

/**
 * 读取主选流
 * @returns 归一化后的主选曲目
 */
const fetchFeed = async (): Promise<RawEntry[]> => {
  const body = await kgGatewayRequest<RawEntry>(KG_FEED_PATH, {
    method: "GET",
    baseURL: KG_GATEWAY_BASE_URL,
  });
  const list = (body?.data && body.data.list) || [];
  if (!Array.isArray(list)) throw new Error("酷狗推荐流响应缺少曲目列表");
  return list.map(normalizeFeedSong).filter(Boolean) as RawEntry[];
};

/**
 * 读取主题目录与「随目录一起下发曲目」的主题
 * @returns 主题目录
 */
const fetchThemeCatalog = async (): Promise<{
  catalogIds: number[];
  local: Map<number, RawEntry[]>;
}> => {
  const body = await kgGatewayRequest<RawEntry>(KG_MUL_THEME_PATH, {
    method: "POST",
    baseURL: KG_GATEWAY_BASE_URL,
    data: { show_theme_category_ids: "" },
  });
  const data = body?.data || {};

  const local = new Map<number, RawEntry[]>();
  const themeList = Array.isArray(data.theme_list) ? data.theme_list : [];
  for (const theme of themeList) {
    const id = Number(theme?.theme_detail?.id);
    const songs = Array.isArray(theme?.song_list) ? theme.song_list : [];
    if (id && songs.length) local.set(id, songs);
  }

  const catalogIds: number[] = [];
  const details = Array.isArray(data.all_theme_detail_list) ? data.all_theme_detail_list : [];
  for (const detail of details) {
    const id = Number(detail?.id);
    if (id && !catalogIds.includes(id)) catalogIds.push(id);
  }
  if (!catalogIds.length && data.all_theme_id) {
    for (const part of String(data.all_theme_id).split(",")) {
      const id = Number(part.trim());
      if (id && !catalogIds.includes(id)) catalogIds.push(id);
    }
  }
  for (const id of local.keys()) {
    if (!catalogIds.includes(id)) catalogIds.push(id);
  }

  return { catalogIds, local };
};

/**
 * 读取单个主题的曲目
 * @param themeId 主题号
 * @returns 上游曲目列表
 */
const fetchSingleTheme = async (themeId: number): Promise<RawEntry[]> => {
  const body = await kgGatewayRequest<RawEntry>(KG_THEME_PATH, {
    method: "POST",
    baseURL: KG_GATEWAY_BASE_URL,
    data: { theme_category_id: themeId },
  });
  const list = (body?.data && body.data.song_list) || [];
  return Array.isArray(list) ? list : [];
};

/**
 * 读取每日推荐（兜底补池）
 * @returns 上游曲目列表
 */
const fetchDaily = async (): Promise<RawEntry[]> => {
  const body = await kgGatewayRequest<RawEntry>(KG_DAILY_PATH, {
    method: "POST",
    baseURL: KG_DAILY_BASE_URL,
    data: { platform: "Android", alldays: 1 },
  });
  const list = (body?.data && body.data.song_list) || [];
  return Array.isArray(list) ? list : [];
};

/**
 * 选出本批补池要用的主题并解析出曲目
 * @param catalog 主题目录
 * @returns 主题号与合并后的上游曲目
 */
const pickPoolThemes = async (catalog: {
  catalogIds: number[];
  local: Map<number, RawEntry[]>;
}): Promise<{ themes: number[]; songs: RawEntry[] }> => {
  const { catalogIds, local } = catalog;
  const shuffled = shuffle(catalogIds);

  const picked: number[] = [];
  const localFirst = shuffled.find((id) => local.has(id));
  if (localFirst !== undefined) picked.push(localFirst);
  for (const id of shuffled) {
    if (picked.length >= POOL_THEME_COUNT) break;
    if (!picked.includes(id)) picked.push(id);
  }

  const themes: number[] = [];
  const songs: RawEntry[] = [];
  let extraFetchUsed = false;

  for (const id of picked) {
    if (themes.includes(id)) continue;

    if (local.has(id)) {
      themes.push(id);
      songs.push(...local.get(id)!);
      continue;
    }

    if (!extraFetchUsed) {
      extraFetchUsed = true;
      try {
        const fetched = await fetchSingleTheme(id);
        if (fetched.length) {
          themes.push(id);
          songs.push(...fetched);
          continue;
        }
      } catch (err) {
        coreLog.warn("[kg-songfm] 酷狗单主题补取失败：", (err as Error)?.message ?? String(err));
      }
    }

    const fallback = shuffled.find(
      (candidate) => local.has(candidate) && !themes.includes(candidate),
    );
    if (fallback === undefined) continue;
    themes.push(fallback);
    songs.push(...local.get(fallback)!);
  }

  return { themes, songs };
};

/**
 * 读取酷狗音乐刷歌推荐流（刷歌数据源）
 * @param params.limit 本批取回的曲目数，默认 20，上限 50
 */
export const songfm: KGModule = async (params: KGParams) => {
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(params.limit) || DEFAULT_LIMIT));

  try {
    const primary = await fetchFeed();

    const need = Math.max(0, limit - primary.length);
    const pool: RawEntry[] = [];
    const themes: number[] = [];
    let poolSource = "theme";

    if (need > 0) {
      try {
        const catalog = await fetchThemeCatalog();
        const picked = await pickPoolThemes(catalog);
        themes.push(...picked.themes);
        pool.push(...picked.songs);
      } catch (err) {
        coreLog.warn(
          "[kg-songfm] 酷狗主题补池不可用，改用每日推荐：",
          (err as Error)?.message ?? String(err),
        );
        poolSource = "daily";
        try {
          pool.push(...(await fetchDaily()));
        } catch (dailyErr) {
          coreLog.warn(
            "[kg-songfm] 酷狗每日推荐补池不可用：",
            (dailyErr as Error)?.message ?? String(dailyErr),
          );
        }
      }
    }

    const poolSongs = shuffle(pool)
      .map((item) => normalizePoolSong(item, poolSource))
      .filter(Boolean)
      .slice(0, need) as RawEntry[];

    const songs: RawEntry[] = [];
    const seen = new Set<string>();
    for (const song of [...primary, ...poolSongs]) {
      if (!song.hash || seen.has(song.hash)) continue;
      seen.add(song.hash);
      songs.push(song);
      if (songs.length >= limit) break;
    }

    return {
      code: 200,
      total: songs.length,
      songs,
      source: {
        platform: "kugou",
        primary: "feed",
        pool: poolSource,
        themes,
        primaryCount: primary.length,
        poolCount: poolSongs.length,
      },
    };
  } catch (err) {
    coreLog.error("[kg-songfm] 酷狗刷歌推荐流获取异常:", err);
    return {
      code: 502,
      message: `酷狗刷歌推荐流获取失败: ${(err as Error)?.message ?? String(err)}`,
    };
  }
};
