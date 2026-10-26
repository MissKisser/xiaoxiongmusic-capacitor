/**
 * QQ 音乐：专辑详情与专辑歌曲
 *
 * 读取任意专辑的歌曲列表，并从歌曲条目中还原专辑概要信息。
 * 专辑以 mid 定位；歌曲条目带音质档位、付费标记与各档位文件体积。
 *
 * @author Hackerdallas
 */

import { qmRequest } from "../core/request";
import { coreLog } from "../core/logger";
import type { QMModule, QMParams } from "../core/types";

/**
 * 拼接歌手名
 * @param singers 歌手数组
 * @returns 拼接后的歌手名
 */
const formatSingerName = (singers: unknown): string => {
  if (!Array.isArray(singers) || singers.length === 0) return "";
  return singers
    .map((item) => (item as { name?: string })?.name || "")
    .filter(Boolean)
    .join(" / ");
};

/**
 * 归一化歌手条目
 * @param singer 接口返回的歌手
 * @returns 归一化后的歌手
 */
const normalizeSinger = (singer: any): Record<string, unknown> => ({
  id: String(singer?.id ?? ""),
  mid: singer?.mid ?? "",
  name: singer?.name ?? "",
});

/**
 * 归一化歌曲条目
 * 歌曲 ID 在部分账号下超出安全整数范围，一律以字符串透传
 * @param song 接口返回的歌曲
 * @param albumMid 专辑 mid，用于补齐缺失的专辑标识
 * @returns 归一化后的歌曲
 */
const normalizeSong = (song: any, albumMid: string): Record<string, unknown> => {
  const file = song.file || {};
  const pay = song.pay || {};

  return {
    id: String(song.id ?? ""),
    mid: song.mid ?? "",
    name: song.title ?? "",
    artist: formatSingerName(song.singer),
    artists: (song.singer || []).map(normalizeSinger),
    album: (song.album && song.album.name) || "",
    albumMid: (song.album && song.album.mid) || albumMid,
    duration: (song.interval ?? 0) * 1000,
    mediaMid: file.media_mid ?? "",
    pay: {
      payalbum: pay.pay_month === 0 && (pay.price_album ?? 0) > 0 ? 1 : 0,
      payplay: pay.pay_play ?? 0,
    },
    size128: file.size_128mp3 ?? 0,
    size320: file.size_320mp3 ?? 0,
    sizeApe: file.size_ape ?? 0,
    sizeFlac: file.size_flac ?? 0,
    sizeOgg: file.size_192ogg ?? 0,
    sizeHiRes: (file.size_new && file.size_new[0]) ?? 0,
    hiResSampleRate: file.hires_sample ?? 0,
    hiResBitDepth: file.hires_bitdepth ?? 0,
  };
};

/**
 * 读取专辑详情与专辑歌曲
 * @param params.mid 专辑 mid
 */
export const album: QMModule = async (params: QMParams) => {
  const mid = String(params.mid ?? params.albumMid ?? "").trim();
  if (!mid) return { code: 400, message: "mid required" };

  try {
    const data = await qmRequest<any>("music.musichallAlbum.AlbumSongList", "GetAlbumSongList", {
      albumMid: mid,
      albumID: 0,
      begin: 0,
      num: 999,
      order: 2,
    });

    const songs = ((data && data.songList) || [])
      .map((entry: any) => (entry && entry.songInfo) || null)
      .filter((song: any) => song && song.mid)
      .map((song: any) => normalizeSong(song, mid));

    const albumMid = (data && data.albumMid) || mid;

    return {
      code: 200,
      mid,
      albumMid,
      total: (data && data.totalNum) ?? songs.length,
      album: {
        mid: albumMid,
        name: songs.length > 0 ? (songs[0].album as string) : "",
        artist: songs.length > 0 ? (songs[0].artist as string) : "",
      },
      songs,
      raw: data,
    };
  } catch (err) {
    coreLog.error("[qm-album] 读取专辑异常:", err);
    return {
      code: 502,
      message: `读取专辑失败: ${(err as Error)?.message ?? String(err)}`,
    };
  }
};
