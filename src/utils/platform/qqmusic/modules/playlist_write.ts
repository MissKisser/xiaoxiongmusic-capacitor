/**
 * QQ 音乐歌单写操作模块
 *
 * 覆盖：创建歌单、改名、删除歌单、加歌、删歌、收藏歌单、取消收藏、红心。
 * 所有写入都遵循「写入 → 读回确认 → 才返回成功」；读回不符时返回失败且不自动重试。
 *
 * @author Hackerdallas
 */

import { qmRequest, getQQMusicUin } from "../core/request";
import { coreLog } from "../core/logger";
import { LIKED_DIR_ID } from "./user_playlist";
import type { QMModule, QMParams } from "../core/types";

const positiveInt = (value: unknown): number | undefined => {
  const num = typeof value === "string" && /^\d{1,15}$/.test(value) ? Number(value) : value;
  return typeof num === "number" && Number.isSafeInteger(num) && num > 0 ? num : undefined;
};

/**
 * 写入类接口要求的 Referer（必须带尾斜杠）
 */
const WRITE_REFERER = "https://y.qq.com/";

/** 歌单写操作返回体统一形状 */
interface WriteResult {
  retCode?: number;
  result?: {
    tid?: number | string;
    dirId?: number | string;
    updateTime?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * 从自建歌单列表中定位某个 tid 对应的普通目录
 * @param list 自建 + 收藏歌单列表
 * @param tid 歌单 tid
 * @returns 该歌单的目录号
 */
const ownedDirIdOf = (list: unknown[], tid: number): number => {
  const matches = (list as Array<Record<string, unknown>>).filter(
    (item) => item && positiveInt(item.tid) === tid,
  );
  if (matches.length !== 1) throw new Error(`歌单 ${tid} 在自建列表中不唯一`);
  const entry = matches[0];
  const dirId = positiveInt(entry.dirId);
  if (!dirId) throw new Error(`歌单 ${tid} 缺少 dirId`);
  if (entry.dirType !== undefined && entry.dirType !== 0) {
    throw new Error(`歌单 ${tid} 不是自建目录，拒绝写入`);
  }
  if (dirId >= 200) throw new Error(`歌单 ${tid} 是系统目录，拒绝写入`);
  return dirId;
};

/**
 * 读取当前账号的自建 + 收藏歌单原始列表
 */
const readOwnedList = async (): Promise<unknown[]> => {
  const uin = getQQMusicUin();
  if (!uin || uin === "0") throw new Error("未登录");
  const data = await qmRequest<{ v_playlist?: unknown[] }>(
    "music.musicasset.PlaylistBaseRead",
    "GetPlaylistByUin",
    { uin },
    { session: false, referer: WRITE_REFERER },
  );
  return data?.v_playlist ?? [];
};

/**
 * 读取歌曲的红心状态
 * @param songIds 歌曲数字 id 列表
 * @returns 以歌曲 id 为键的红心状态
 */
const readSongFavStatus = async (songIds: number[]): Promise<Record<string, boolean>> => {
  const data = await qmRequest<{ m_fan?: Record<string, boolean> }>(
    "music.musicasset.SongFavRead",
    "IsSongFanById",
    { v_songId: songIds },
    { session: false, referer: WRITE_REFERER },
  );
  return data?.m_fan ?? {};
};

/**
 * 创建歌单
 * @param params.name 歌单名（最多 20 字）
 */
export const playlist_create: QMModule = async (params: QMParams) => {
  const name = String(params.name ?? "").trim();
  if (!name) return { code: 400, message: "name required" };
  if ([...name].length > 20) return { code: 400, message: "歌单名最多 20 字" };

  const data = await qmRequest<WriteResult>(
    "music.musicasset.PlaylistBaseWrite",
    "AddPlaylist",
    { dirName: name },
    { session: false, referer: WRITE_REFERER },
  );

  if (data?.retCode !== 0 || !data?.result) {
    coreLog.warn("[qm-playlist] 创建歌单失败:", data?.retCode);
    return { code: 502, message: "创建歌单失败", retCode: data?.retCode };
  }

  const tid = positiveInt(data.result.tid);
  const dirId = positiveInt(data.result.dirId);
  if (!tid || !dirId) return { code: 502, message: "创建歌单返回缺少 tid/dirId" };

  // 读回确认：歌单应出现在自建列表中
  const list = await readOwnedList();
  const read = list.find(
    (item) =>
      (item as Record<string, unknown>) &&
      positiveInt((item as Record<string, unknown>).tid) === tid,
  ) as Record<string, unknown> | undefined;
  if (!read || positiveInt(read.dirId) !== dirId) {
    return { code: 502, message: "创建后读回校验失败", tid, dirId };
  }

  return { code: 200, tid, dirId, name: String(read.dirName ?? name), verified: true };
};

/**
 * 读取歌单编辑信息（保留描述 / 封面 / 标签用）
 * @param dirId 歌单目录号
 */
const readEditInfo = async (dirId: number) => {
  const data = await qmRequest<{
    dirinfo?: {
      title?: string;
      desc?: string;
      picurl?: string;
      picurl2?: string;
      dir_show?: number;
      tag?: Array<{ id: number; name: string }>;
    };
  }>(
    "music.srfDissInfo.aiDissInfo",
    "uniform_get_Dissinfo",
    { dirid: dirId, optype: 3, tag: 1, userinfo: 0, pic_dpi: 300 },
    { session: false, referer: WRITE_REFERER },
  );
  const info = data?.dirinfo;
  if (!info) throw new Error("歌单编辑信息不可读");
  return {
    title: info.title ?? "",
    desc: info.desc ?? "",
    picurl: info.picurl ?? "",
    picurl2: info.picurl2 ?? "",
    dirShow: info.dir_show === 2 ? 2 : 1,
    tag: info.tag ?? [],
  };
};

/**
 * 改名歌单
 * @param params.tid 歌单 tid
 * @param params.name 新名字
 */
export const playlist_rename: QMModule = async (params: QMParams) => {
  const tid = positiveInt(params.tid);
  const name = String(params.name ?? "").trim();
  if (!tid) return { code: 400, message: "tid required" };
  if (!name) return { code: 400, message: "name required" };
  if ([...name].length > 20) return { code: 400, message: "歌单名最多 20 字" };

  const dirId = ownedDirIdOf(await readOwnedList(), tid);
  const before = await readEditInfo(dirId);

  const data = await qmRequest<WriteResult>(
    "music.musicasset.PlaylistBaseWrite",
    "EditPlaylist",
    {
      dirId,
      mask: 95,
      dirNewName: name,
      dirNewDesc: before.desc,
      dirNewPicUrl: before.picurl,
      dirNewPicUrl2: before.picurl2,
      dirNewtaglist: before.tag.map((tag) => tag.id).join(","),
      dirShow: before.dirShow,
    },
    { session: false, referer: WRITE_REFERER },
  );

  if (data?.retCode !== 0 || !data?.result) {
    coreLog.warn("[qm-playlist] 改名失败:", data?.retCode);
    return { code: 502, message: "改名失败", retCode: data?.retCode };
  }
  if (positiveInt(data.result.dirId) !== dirId || positiveInt(data.result.tid) !== tid) {
    return { code: 502, message: "改名返回的 tid/dirId 不匹配" };
  }

  const after = await readEditInfo(dirId);
  if (after.title !== name) {
    return { code: 502, message: `改名后读回校验失败：当前标题 ${after.title}` };
  }

  return { code: 200, tid, dirId, name: after.title, verified: true };
};

/**
 * 删除歌单
 * @param params.tid 歌单 tid
 */
export const playlist_delete: QMModule = async (params: QMParams) => {
  const tid = positiveInt(params.tid);
  if (!tid) return { code: 400, message: "tid required" };

  const dirId = ownedDirIdOf(await readOwnedList(), tid);

  const data = await qmRequest<WriteResult>(
    "music.musicasset.PlaylistBaseWrite",
    "DelPlaylist",
    { dirId },
    { session: false, referer: WRITE_REFERER },
  );

  if (data?.retCode !== 0 || !data?.result) {
    coreLog.warn("[qm-playlist] 删除歌单失败:", data?.retCode);
    return { code: 502, message: "删除歌单失败", retCode: data?.retCode };
  }
  if (positiveInt(data.result.dirId) !== dirId || positiveInt(data.result.tid) !== tid) {
    return { code: 502, message: "删除返回的 tid/dirId 不匹配" };
  }

  // 读回确认：歌单应已不在列表中
  const list = await readOwnedList();
  const still = list.find(
    (item) =>
      (item as Record<string, unknown>) &&
      positiveInt((item as Record<string, unknown>).tid) === tid,
  );
  if (still) return { code: 502, message: "删除后读回校验失败：歌单仍存在" };

  return { code: 200, tid, deleted: true, verified: true };
};

/**
 * 往歌单加歌 / 从歌单删歌
 * @param params.tid 歌单 tid（目标歌单）
 * @param params.op add | del
 * @param params.songs [{ id, type }]，type 目前仅支持 0
 * @param params.like 为 true 时写入「我喜欢」系统目录（红心）
 */
export const playlist_tracks: QMModule = async (params: QMParams) => {
  const op = String(params.op ?? "add");
  const songs = Array.isArray(params.songs) ? (params.songs as Array<Record<string, unknown>>) : [];
  if (!["add", "del"].includes(op)) return { code: 400, message: "op 必须是 add 或 del" };
  if (songs.length < 1 || songs.length > 100) {
    return { code: 400, message: "songs 数量需在 1~100 之间" };
  }

  const v_songInfo = songs.map((song) => {
    const id = positiveInt(song.id);
    if (!id) throw new Error(`歌曲 id 非法: ${String(song.id)}`);
    if (song.type !== 0 && song.type !== undefined) {
      throw new Error(`暂不支持的歌曲类型: ${String(song.type)}`);
    }
    return { songId: id, songType: 0 };
  });
  const songIds = v_songInfo.map((song) => song.songId);

  const like = params.like === true;
  let dirId: number;
  let tid: number | undefined;

  if (like) {
    // 红心 = 往系统「我喜欢」目录写
    dirId = LIKED_DIR_ID;
  } else {
    const rawTid = positiveInt(params.tid);
    if (!rawTid) return { code: 400, message: "tid required" };
    dirId = ownedDirIdOf(await readOwnedList(), rawTid);
    tid = rawTid;
  }

  const data = await qmRequest<WriteResult>(
    "music.musicasset.PlaylistDetailWrite",
    op === "add" ? "AddSonglist" : "DelSonglist",
    { dirId, v_songInfo },
    { session: false, referer: WRITE_REFERER },
  );

  if (data?.retCode !== 0 || !data?.result) {
    coreLog.warn("[qm-playlist] 写歌曲失败:", data?.retCode);
    return { code: 502, message: "写歌曲失败", retCode: data?.retCode };
  }

  if (like) {
    // 红心路径改用「按歌曲 id 读回红心状态」判定写入结果
    const status = await readSongFavStatus(songIds);
    const expected = op === "add";
    const mismatched = songIds.filter((id) => Boolean(status[String(id)]) !== expected);
    if (mismatched.length > 0) {
      return {
        code: 502,
        message: `红心状态读回校验失败：${mismatched.length} 首与预期不符`,
      };
    }
  } else {
    const changed = data.result.dirId === dirId && positiveInt(data.result.tid) === tid;
    const cleared = data.result.dirId === 0 && (data.result.tid === 0 || data.result.tid === "0");
    if (!changed && !cleared) {
      return { code: 502, message: "写歌曲返回的 dirId/tid 不匹配" };
    }
  }

  return { code: 200, changed: true, dirId, tid: tid ?? null, verified: true };
};

/**
 * 收藏 / 取消收藏歌单
 * @param params.tid 歌单 tid
 * @param params.subscribed true 收藏 / false 取消
 */
export const playlist_subscribe: QMModule = async (params: QMParams) => {
  const tid = positiveInt(params.tid);
  const subscribed = params.subscribed;
  if (!tid) return { code: 400, message: "tid required" };
  if (typeof subscribed !== "boolean") return { code: 400, message: "subscribed 必须是布尔值" };

  const uin = getQQMusicUin();
  if (!uin || uin === "0") return { code: 401, message: "未登录" };

  const data = await qmRequest<{
    result?: number;
    v_failedPlaylistId?: unknown[];
  }>(
    "music.musicasset.PlaylistFavWrite",
    subscribed ? "FavPlaylist" : "CancelFavPlaylist",
    { uin, v_playlistId: [tid] },
    { session: false, referer: WRITE_REFERER },
  );

  if (data?.result !== 0 || (data?.v_failedPlaylistId?.length ?? 0) > 0) {
    coreLog.warn("[qm-playlist] 收藏状态写入失败:", data?.result, data?.v_failedPlaylistId);
    return { code: 502, message: "收藏状态写入失败", result: data?.result };
  }

  // 读回确认
  const status = await qmRequest<{ m_fan?: Record<string, boolean> }>(
    "music.musicasset.PlaylistFavRead",
    "IsPlaylistFan",
    { v_tid: [tid] },
    { session: false, referer: WRITE_REFERER },
  );
  const actual = status?.m_fan?.[String(tid)];
  if (actual !== subscribed) {
    return { code: 502, message: `收藏状态读回校验失败：当前为 ${String(actual)}` };
  }

  return { code: 200, tid, subscribed, verified: true };
};
