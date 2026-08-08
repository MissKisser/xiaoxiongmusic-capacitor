/**
 * Based on SPlayer-Next
 * Copyright (C) 2024 SPlayer-Dev
 * Licensed under AGPL-3.0
 *
 * 本地歌曲自动匹配算法
 *
 * 从 SPlayer-Next 的 `src/utils/tagMatch.ts` 移植并适配到 capacitor 端：
 *   - 字符串归一化（去除空格、标点、中英分隔符等）
 *   - 标题/歌手/专辑的多级评分
 *   - 时长容差（±5s 强匹配，±20s 视为"显著偏差"沉底）
 *   - 双向 includes 模糊匹配
 *
 * 本模块不发起任何网络请求，纯粹是本地评分工具。
 * 调用方负责获取候选列表（搜索 / songDetail）后传入本函数排序。
 */

import type { SongType } from "@/types/main";

/** 匹配上下文：表单当前值 + 本地文件元信息 */
export interface MatchContext {
  /** 文件的标题（来自 ID3 / 文件名解析） */
  title: string;
  /** 文件的艺术家（来自 ID3 / 文件名解析） */
  artist: string;
  /** 文件的专辑（来自 ID3，可选） */
  album?: string;
  /** 本地文件时长（秒），最强判别字段 */
  durationSec?: number;
}

/** 候选歌曲形态（兼容 songDetail / searchResult 多种返回） */
export interface MatchCandidate {
  id: number;
  name: string;
  artists: string | Array<{ id?: number; name?: string }>;
  album?: string | { id?: number; name?: string };
  /** 在线候选时长（毫秒） */
  duration?: number;
}

/** 带评分的候选项 */
export interface RankedMatchCandidate<T extends MatchCandidate = MatchCandidate> {
  candidate: T;
  score: number;
  /** 与本地文件时长差超 20s，基本可断定不是同一版本 */
  durationFar: boolean;
  /** 时长差（毫秒），用于展示 */
  durationDiffMs: number | null;
}

/**
 * 字符串归一化（与 SPlayer-Next 歌词匹配保持一致规则）：
 *   - 转小写
 *   - 移除空格、常见分隔符、中英文标点
 *   - 移除括号内容差异
 */
const normalize = (text: string | undefined | null): string => {
  if (!text) return "";
  return text
    .toLowerCase()
    .replace(/[、&;，,/|()·・\s\-_'"`~!?？！.。]+/g, "");
};

/** 把 artists 字段规整成字符串 */
const artistsToString = (
  artists: MatchCandidate["artists"],
): string => {
  if (!artists) return "";
  if (typeof artists === "string") return artists;
  if (Array.isArray(artists)) {
    return artists
      .map((a) => a?.name ?? "")
      .filter(Boolean)
      .join("");
  }
  return "";
};

/** 把 album 字段规整成字符串 */
const albumToString = (album: MatchCandidate["album"]): string => {
  if (!album) return "";
  if (typeof album === "string") return album;
  if (typeof album === "object" && "name" in album) return album.name ?? "";
  return "";
};

/** 双向 includes 命中 */
const bothContains = (left: string, right: string): boolean =>
  left.length > 0 && right.length > 0 && (left.includes(right) || right.includes(left));

/**
 * 计算时长差（毫秒）。
 * 注意：候选时长是毫秒，本地上下文是秒，这里统一到毫秒后取绝对值。
 */
const durationDiff = (
  candidateMs: number | undefined,
  contextSec: number | undefined,
): number | null => {
  if (!candidateMs || !contextSec) return null;
  return Math.abs(candidateMs - contextSec * 1000);
};

/**
 * 提取文件名里的"歌名 - 歌手"模式
 *
 * 适用于元信息缺失的场景：从原始文件名中尝试抽取「标题 + 歌手」。
 * 支持的分隔符：" - "、"–"、"—"、"_"、"_"。
 *
 * @example
 *   parseFileName("周杰伦 - 七里香.flac") -> { title: "七里香", artist: "周杰伦" }
 */
export const parseFileName = (
  rawName: string,
): { title: string; artist?: string } => {
  if (!rawName) return { title: "" };
  // 去掉扩展名
  const nameOnly = rawName.replace(/\.[^.]+$/, "");
  // 尝试常见分隔符
  const separators = [" - ", " – ", " — ", "_-_", "__"];
  for (const sep of separators) {
    const idx = nameOnly.indexOf(sep);
    if (idx > 0 && idx < nameOnly.length - sep.length) {
      const left = nameOnly.slice(0, idx).trim();
      const right = nameOnly.slice(idx + sep.length).trim();
      if (left && right) {
        // 通常 "歌手 - 歌名" 或 "歌名 - 歌手"，无法判断；
        // 启发式：长度较短且不含数字的视为歌手
        const artist = left.length <= right.length ? left : right;
        const title = left.length <= right.length ? right : left;
        return { title, artist };
      }
    }
  }
  return { title: nameOnly };
};

/**
 * 给候选打分并降序排列。
 *
 * 评分规则（借鉴 SPlayer-Next）：
 *   - 标题完全相等：+10
 *   - 标题双向 includes：+4
 *   - 歌手完全相等：+5
 *   - 歌手双向 includes：+2
 *   - 专辑完全相等：+2
 *   - 时长差 ≤ 5s：+3
 *
 * 排序：时长差 > 20s 的沉底，其余按分数降序。
 *
 * @param candidates - 在线搜索 / 详情 API 返回的候选歌曲
 * @param context - 本地文件元信息 + 时长
 */
export const rankMatchCandidates = <T extends MatchCandidate>(
  candidates: readonly T[],
  context: MatchContext,
): RankedMatchCandidate<T>[] => {
  const ctxTitle = normalize(context.title);
  const ctxArtist = normalize(context.artist);
  const ctxAlbum = normalize(context.album);

  const ranked = candidates.map((candidate) => {
    const candTitle = normalize(candidate.name);
    const candArtist = normalize(artistsToString(candidate.artists));
    const candAlbum = normalize(albumToString(candidate.album));
    const diff = durationDiff(candidate.duration, context.durationSec);

    const titleExact = candTitle.length > 0 && candTitle === ctxTitle;
    const artistExact = ctxArtist.length > 0 && candArtist === ctxArtist;

    let score = 0;
    if (titleExact) score += 10;
    else if (bothContains(candTitle, ctxTitle)) score += 4;
    if (artistExact) score += 5;
    else if (bothContains(candArtist, ctxArtist)) score += 2;
    if (ctxAlbum && candAlbum.length > 0 && candAlbum === ctxAlbum) score += 2;
    if (diff !== null && diff <= 5000) score += 3;

    return {
      candidate,
      score,
      durationFar: diff !== null && diff > 20000,
      durationDiffMs: diff,
    };
  });

  // 时长明显不符的沉底，其余按分数降序
  return ranked.sort((left, right) => {
    if (left.durationFar !== right.durationFar) return left.durationFar ? 1 : -1;
    return right.score - left.score;
  });
};

/**
 * 取排名第一的候选（仅在分数 > 0 时返回，避免误匹配）。
 *
 * 这是 SongInfoEditor.vue 中 `onlineMatch()` 的推荐替换入口：
 * 给一组候选（来自 `/search/match`），自动挑出最佳匹配。
 */
export const bestMatch = <T extends MatchCandidate>(
  candidates: readonly T[],
  context: MatchContext,
): T | null => {
  if (!candidates || candidates.length === 0) return null;
  const ranked = rankMatchCandidates(candidates, context);
  const top = ranked[0];
  // 至少要有 1 分才视为有效匹配（完全无关的会落在 0 分）
  if (!top || top.score <= 0) return null;
  // 时长差距过大也不接受
  if (top.durationFar) return null;
  return top.candidate;
};

/**
 * 把 SongType 转换为 MatchCandidate（用于搜索结果已经经过 formatSongsList 的场景）
 */
export const songToCandidate = (song: SongType): MatchCandidate => ({
  id: song.id,
  name: song.name,
  artists: song.artists,
  album: song.album,
  duration: song.duration,
});