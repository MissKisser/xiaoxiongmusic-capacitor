/**
 * QQ 音乐推荐流（对应网易云「私人FM」的刷歌能力）
 *
 * 走 music.recommend.RecommendFeed / get_recommend_feed 协议。
 *
 * @author Hackerdallas
 */

import { qmRequest } from "../core/request";
import { coreLog } from "../core/logger";
import type { QMModule, QMParams } from "../core/types";

/** 单次推荐流默认取回的曲目数 */
const DEFAULT_LIMIT = 20;

/** 单次推荐流最多回查详情的曲目数 */
const MAX_DETAIL_FETCH = 20;

/** 去除搜索结果的命中高亮标签 */
const stripHighlight = (text: unknown): string =>
  typeof text === "string" ? text.replace(/<\/?em>/g, "") : "";

/**
 * 拼接歌手名
 * @param singers 歌手数组
 * @returns 形如 A / B 的歌手名
 */
const formatSingerName = (singers: unknown): string => {
  if (!Array.isArray(singers)) return "";
  return singers
    .map((item: any) => stripHighlight(item?.name))
    .filter(Boolean)
    .join(" / ");
};

/**
 * 归一化推荐流中的单曲卡片
 * @param card 上游卡片
 * @returns 归一化后的推荐条目
 */
const normalizeCard = (card: any): Record<string, unknown> | null => {
  const source = card || {};
  const songId = Number(source.id ?? 0);
  if (!songId) return null;
  return {
    id: String(songId),
    name: stripHighlight(source.title ?? ""),
    artist: stripHighlight(source.subtitle ?? ""),
    cover: source.cover ?? "",
  };
};

/**
 * 按歌曲数字 id 回查歌曲详情（mid / 时长 / 专辑 / 付费标记）
 * @param songId 歌曲数字 id
 * @returns 歌曲详情；查不到时返回 null
 */
const fetchSongDetail = async (songId: number): Promise<any | null> => {
  const data = await qmRequest<any>("music.pf_song_detail_svr", "get_song_detail_yqq", {
    song_num: 1,
    song_id: songId,
  });
  const track = data?.track_info || data?.song_info || null;
  return track && (track.mid || track.id) ? track : null;
};

/**
 * 归一化歌曲详情为推荐流曲目
 * @param track 歌曲详情
 * @param fallback 卡片兜底信息
 * @returns 归一化后的曲目
 */
const normalizeTrack = (track: any, fallback: Record<string, any>): Record<string, unknown> => {
  const album = track?.album || {};
  const pictureMid = album.mid || album.pmid || "";
  return {
    id: String(track?.id ?? fallback.id ?? ""),
    mid: track?.mid ?? "",
    name: stripHighlight(track?.title || track?.name || fallback.name || ""),
    artist: formatSingerName(track?.singer) || fallback.artist || "",
    artists: (Array.isArray(track?.singer) ? track.singer : []).map((item: any) => ({
      id: String(item?.id ?? ""),
      mid: item?.mid ?? "",
      name: stripHighlight(item?.name ?? ""),
    })),
    album: stripHighlight(album.name ?? ""),
    albumMid: pictureMid,
    duration: (track?.interval ?? 0) * 1000,
    cover: fallback.cover || (pictureMid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${pictureMid}.jpg` : ""),
    file: track?.file ?? {},
    pay: track?.pay ?? {},
  };
};

/**
 * 读取 QQ 音乐推荐流（刷歌数据源）
 * @param params.limit 取回的曲目数
 */
export const songfm: QMModule = async (params: QMParams) => {
  const limit = Math.min(MAX_DETAIL_FETCH, Math.max(1, Number(params.limit) || DEFAULT_LIMIT));

  try {
    const data = await qmRequest<any>("music.recommend.RecommendFeed", "get_recommend_feed", {
      direction: 1,
      page: 1,
    });

    const shelves = Array.isArray(data?.v_shelf) ? data.v_shelf : [];
    const cards: Record<string, any>[] = [];
    for (const shelf of shelves) {
      for (const niche of Array.isArray(shelf?.v_niche) ? shelf.v_niche : []) {
        for (const card of Array.isArray(niche?.v_card) ? niche.v_card : []) {
          // type 200 = 单曲卡片；其余类型是歌单 / 榜单 / 直播等非单曲条目
          if (Number(card?.type) !== 200) continue;
          const normalized = normalizeCard(card);
          if (normalized) cards.push(normalized);
        }
      }
    }

    // 同名同歌手的推荐条目按歌曲 id 去重
    const unique: Record<string, any>[] = [];
    const seen = new Set<string>();
    for (const card of cards) {
      if (seen.has(card.id)) continue;
      seen.add(card.id);
      unique.push(card);
    }

    const picked = unique.slice(0, limit);
    const details = await Promise.all(
      picked.map((card) => fetchSongDetail(Number(card.id)).catch(() => null)),
    );

    const songs = picked
      .map((card, index) => {
        const track = details[index];
        if (!track) return null;
        return normalizeTrack(track, card);
      })
      .filter(Boolean);

    return {
      code: 200,
      total: songs.length,
      songs,
      shelves: shelves.map((shelf: any) => ({
        id: shelf?.id ?? 0,
        title: stripHighlight(shelf?.title_content ?? ""),
        template: stripHighlight(shelf?.title_template ?? ""),
      })),
    };
  } catch (err) {
    coreLog.error("[qm-songfm] QQ 音乐推荐流获取异常:", err);
    return {
      code: 502,
      message: `QQ 音乐推荐流获取失败: ${(err as Error)?.message ?? String(err)}`,
    };
  }
};
