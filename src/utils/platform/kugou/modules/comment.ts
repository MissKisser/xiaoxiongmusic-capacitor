/**
 * 酷狗音乐评论模块（只读）
 *
 * 端点：POST /mcomment/v1/cmtlist（评论池 code 决定评论对象类型）
 * - 歌曲池：fc4be23b4e972707f36b8a828a93ba8a
 * - 专辑池：94f1792ced1df89aa68a7939eaf2efca
 * - 歌单池：ca53b96fe5a1d9c22d71c8f522ef7c4f
 *
 * @author Hackerdallas
 */

import { kgErrorCode, kgGatewayRequest } from "../core/request";
import { coreLog } from "../core/logger";
import type { KGModule, KGParams } from "../core/types";

/** 歌曲评论池 */
const COMMENT_POOL_SONG = "fc4be23b4e972707f36b8a828a93ba8a";

/** 专辑评论池 */
const COMMENT_POOL_ALBUM = "94f1792ced1df89aa68a7939eaf2efca";

/** 歌单评论池 */
const COMMENT_POOL_PLAYLIST = "ca53b96fe5a1d9c22d71c8f522ef7c4f";

/** 评论池与对象类型的对应关系 */
const POOL_BY_TYPE: Record<string, string> = {
  song: COMMENT_POOL_SONG,
  album: COMMENT_POOL_ALBUM,
  playlist: COMMENT_POOL_PLAYLIST,
};

/** 原始评论条目 */
type RawComment = Record<string, any>;

/** 跨页去重记忆 */
const pageIdMemory = new Map<string, { page: number; ids: Set<string>; expireAt: number }>();

/** 跨页去重记忆存活时长（毫秒） */
const PAGE_ID_MEMORY_TTL = 3 * 60 * 1000;

/**
 * 按评论 id 去重：页内去重 + 与上一页去重
 * @param key 评论对象标识
 * @param page 当前页码
 * @param items 本页原始评论
 * @returns 去重后的评论与被剔除的条数
 */
const dedupeComments = (
  key: string,
  page: number,
  items: RawComment[],
): { items: RawComment[]; removed: number } => {
  const memory = pageIdMemory.get(key);
  const previousIds =
    memory && memory.page === page - 1 && memory.expireAt > Date.now()
      ? memory.ids
      : new Set<string>();

  const seen = new Set<string>();
  const kept: RawComment[] = [];
  let removed = 0;
  for (const item of items) {
    const id = String(item?.id ?? "");
    if (!id || seen.has(id) || previousIds.has(id)) {
      removed += 1;
      continue;
    }
    seen.add(id);
    kept.push(item);
  }

  pageIdMemory.set(key, { page, ids: seen, expireAt: Date.now() + PAGE_ID_MEMORY_TTL });
  return { items: kept, removed };
};

/**
 * 解析评论对象 id（album_audio_id 口径）
 * @param params 调用参数
 * @returns 解析出的 id，取不到时返回空串
 */
const resolveMixSongId = (params: KGParams): string => {
  const candidates = [
    params.mixsongid,
    params.mixSongId,
    params.albumAudioId,
    params.album_audio_id,
    params.extId,
  ];
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null) continue;
    const text = String(candidate).trim();
    if (text) return text;
  }
  return "";
};

interface NormalizedComment {
  id: string;
  content: string;
  time: string;
  likedCount: number;
  replyCount: number;
  parentId: string;
  parentUserId: string;
  isAuthor: boolean;
  user: {
    id: string;
    name: string;
    avatar: string;
  };
  images: Array<{
    url: string;
    width: number;
    height: number;
  }>;
  replies: NormalizedComment[];
  location: string;
}

/**
 * 归一化单条评论
 * @param raw 原始评论条目
 * @returns 对外评论对象
 */
const normalizeComment = (raw: RawComment): NormalizedComment => {
  const source = raw || {};
  const like = source.like || {};
  const user = {
    id: String(source.user_id ?? ""),
    name: source.user_name ?? "",
    avatar: source.user_pic ?? "",
  };

  return {
    id: String(source.id ?? ""),
    content: source.content ?? "",
    time: source.addtime ?? "",
    likedCount: Number(like.count ?? like.likenum ?? 0),
    replyCount: Number(source.reply_num ?? 0),
    parentId: String(source.delPid ?? 0),
    parentUserId: String(source.puser_id ?? 0),
    isAuthor: Boolean(source.author_name),
    user,
    images: Array.isArray(source.images)
      ? source.images.map((image: RawComment) => ({
          url: image?.url ?? "",
          width: image?.width ?? 0,
          height: image?.height ?? 0,
        }))
      : [],
    replies: Array.isArray(source.replys) ? source.replys.map(normalizeComment) : [],
    location: source.location ?? "",
  };
};

/**
 * 读取酷狗评论
 * @param params.mixsongid 评论对象 id（album_audio_id 口径）
 * @param params.type 评论对象类型：song / album / playlist
 * @param params.page 页码，从 1 开始
 * @param params.limit 每页条数
 */
export const comment: KGModule = async (params: KGParams) => {
  const id = resolveMixSongId(params);
  if (!id) {
    return {
      code: 400,
      message:
        "id required：酷狗评论需要 album_audio_id 口径的 id（字段名可用 mixsongid / mixSongId / albumAudioId / album_audio_id / extId）",
    };
  }

  const page = Math.max(1, Number(params.page ?? 1) || 1);
  const pageSize = Math.max(1, Number(params.limit ?? params.pagesize ?? 30) || 30);
  const type = String(params.type ?? "song").toLowerCase();
  const code = String(params.code ?? POOL_BY_TYPE[type] ?? COMMENT_POOL_SONG);

  let response: Record<string, any>;
  try {
    response = await kgGatewayRequest<Record<string, any>>("/mcomment/v1/cmtlist", {
      method: "POST",
      params: {
        ver: 6,
        mixsongid: id,
        need_show_image: 1,
        p: page,
        pagesize: pageSize,
        show_classify: 1,
        show_hotword_list: 1,
        extdata: "0",
        code,
      },
      allowBusinessError: true,
    });
  } catch (err) {
    coreLog.error("[kg-comment] 读取酷狗评论失败:", err);
    return {
      code: 502,
      message: `读取酷狗评论失败: ${(err as Error)?.message ?? String(err)}`,
    };
  }

  if (typeof response === "string") {
    return { code: 502, message: "酷狗评论接口返回非预期内容", raw: response };
  }

  const errCode = kgErrorCode(response);
  if (errCode !== 0) {
    const message = response.errmsg || response.msg || response.message || "";
    const hint = errCode === 10002 ? "；id 口径可能不对，需要 album_audio_id 而不是 audio_id" : "";
    return {
      code: 502,
      message: `酷狗评论接口返回错误：error_code=${errCode} ${message}${hint}`.trim(),
      id,
      type,
      page,
      pageSize,
      raw: response,
    };
  }

  const list = Array.isArray(response.list) ? response.list : [];
  const hotwords = Array.isArray(response.hot_word_list) ? response.hot_word_list : [];
  const classify = Array.isArray(response.classify_list) ? response.classify_list : [];

  const { items: uniqueList, removed } = dedupeComments(`${type}:${id}`, page, list);
  if (removed > 0) {
    coreLog.warn(`[kg-comment] 剔除重复评论 ${removed} 条（${type}:${id} 第 ${page} 页）`);
  }

  return {
    code: 200,
    id,
    type,
    page,
    pageSize,
    total: Number(response.count ?? list.length),
    count: uniqueList.length,
    maxPage: Number(response.maxPage ?? 0),
    comments: uniqueList.map(normalizeComment),
    hotwords: hotwords.map((word: RawComment) => ({
      id: String(word.id ?? ""),
      word: word.content ?? word.word ?? "",
      count: Number(word.count ?? word.cnt ?? 0),
    })),
    categories: classify.map((item: RawComment) => ({
      id: String(item.id ?? item.class_id ?? ""),
      name: item.label ?? item.name ?? item.class_name ?? "",
      count: Number(item.cnt ?? item.count ?? 0),
    })),
    raw: response,
  };
};
