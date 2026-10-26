/**
 * QQ 音乐：歌曲评论
 *
 * 按歌曲取评论。type 为 hot 时取热门评论，为 new 时按时间取最新评论。
 * 游标翻页用 cursor 传入上一次的 nextCursor。
 *
 * @author Hackerdallas
 */

import { qmRequest } from "../core/request";
import { coreLog } from "../core/logger";
import type { QMModule, QMParams } from "../core/types";

/**
 * 从歌曲详情响应中取出歌曲主体
 * @param data 接口返回的数据段
 * @returns 歌曲主体，取不到时返回 null
 */
const pickTrack = (data: any): any => {
  if (!data) return null;
  if (data.track_info) return data.track_info;
  if (data.song_info) return data.song_info;
  if (Array.isArray(data.songs) && data.songs[0]) return data.songs[0];
  if (data.songid || data.mid) return data;
  return null;
};

/**
 * 归一化评论条目
 * 上游字段是大驼峰，这里统一转成小驼峰
 * @param item 接口返回的评论
 * @returns 归一化后的评论
 */
const normalizeComment = (item: any): Record<string, unknown> => {
  const source = item || {};

  return {
    id: source.CmId ?? "",
    content: source.Content ?? "",
    nick: source.Nick ?? "",
    avatar: source.Avatar ?? "",
    location: source.Location ?? "",
    pic: source.Pic ?? "",
    encryptedUin: source.EncryptUin ?? "",
    praiseNum: source.PraiseNum ?? 0,
    replyCount: source.ReplyCnt ?? 0,
    publishTime: source.PubTime ?? 0,
    seqNo: source.SeqNo ?? "",
    songId: source.SongId ?? "",
    replies: (source.RepliedComments || []).map(normalizeComment),
    subComments: (source.SubComments || []).map(normalizeComment),
  };
};

/**
 * 解析歌曲的数字 ID
 * 传入的已是数字 ID 时直接返回；传入 mid 时用歌曲详情接口换算
 * @param value 歌曲 mid 或数字 ID
 * @returns 数字歌曲 ID，解析不出来时返回空串
 */
const resolveSongId = async (value: string): Promise<string> => {
  if (/^\d+$/.test(value)) return value;

  const detail = await qmRequest("music.pf_song_detail_svr", "get_song_detail_yqq", {
    song_type: 0,
    song_mid: value,
  });
  const track = pickTrack(detail);
  return track ? String(track.id ?? "") : "";
};

/**
 * 读取歌曲评论
 * @param params.mid 歌曲 mid 或数字歌曲 ID
 * @param params.type 评论类型：hot / new
 * @param params.page 页码，从 1 开始
 * @param params.limit 每页条数
 * @param params.cursor 游标，取上一页的 nextCursor
 */
export const comment: QMModule = async (params: QMParams) => {
  const raw = String(params.mid ?? params.song_mid ?? params.id ?? "").trim();
  if (!raw) return { code: 400, message: "id required" };

  const type = params.type === "new" ? "new" : "hot";
  const page = Math.max(1, Number(params.page ?? 1) || 1);
  const limit = Math.min(100, Math.max(1, Number(params.limit ?? 20) || 20));
  const cursor = String(params.cursor ?? "");

  try {
    const songId = await resolveSongId(raw);
    if (!songId) {
      return { code: 502, message: `解析歌曲 ID 失败: ${raw}` };
    }

    const param: Record<string, unknown> = {
      BizType: 1,
      BizId: songId,
      LastCommentSeqNo: cursor,
      PageSize: limit,
      PageNum: page - 1,
      PicEnable: 1,
      ...(type === "hot"
        ? { HotType: 1, WithAirborne: 0 }
        : { HashTagID: "", SelfSeeEnable: 1, AudioEnable: 1 }),
    };

    const data = await qmRequest<any>(
      "music.globalComment.CommentRead",
      type === "hot" ? "GetHotCommentList" : "GetNewCommentList",
      param,
    );

    const list = (data && data.CommentList) || {};
    const comments = (list.Comments || []).map(normalizeComment);
    const hasMore = list.HasMore === 1;

    return {
      code: 200,
      id: songId,
      mid: /^\d+$/.test(raw) ? "" : raw,
      type,
      page,
      total: list.Total ?? comments.length,
      hasMore,
      nextCursor: hasMore
        ? comments.length > 0
          ? (comments[comments.length - 1].seqNo as string)
          : ""
        : "",
      comments,
      raw: data,
    };
  } catch (err) {
    coreLog.error("[qm-comment] 读取歌曲评论异常:", err);
    return {
      code: 502,
      message: `读取歌曲评论失败: ${(err as Error)?.message ?? String(err)}`,
    };
  }
};
