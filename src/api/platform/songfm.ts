/**
 * 平台推荐流数据层（渲染端）
 *
 * 对应网易云的「私人 FM」能力：网易云由 `/personal_fm` 直接给一串曲目，
 * QQ 音乐与酷狗音乐没有等价端点，改由主进程的 `songfm` 模块给出**个性化推荐流**，
 * 曲目形状与网易云一致，页面层无需区分平台。
 *
 * 与网易云的三点差异：
 * - 网易云的私人 FM 是**登录态**接口；QQ 的推荐流同样需要登录态，
 *   酷狗的推荐流匿名可用（带登录态多 1 条），
 *   凭据由主进程持有，渲染端只发无凭据的只读请求；
 * - 网易云一次给 3 首、播完再取；QQ 与酷狗一次给一批（实测每次调用的曲目几乎不重复），
 *   播完再取下一批即可。
 */

import { platformRequest } from "./http";
import { normalizeQqSong, QQ_MUSIC } from "./qqmusic";
import { KUGOU, normalizeKgSongFM } from "./kugou";
import { toSongType } from "./types";
import type { SongType } from "@/types/main";

/** 主进程推荐流模块的原生返回 */
interface SongFMResponse {
  code?: number;
  total?: number;
  songs?: Array<Record<string, any>>;
  message?: string;
}

/**
 * 读取 QQ 音乐推荐流（刷歌数据源）
 * @param limit 本次取回的曲目数
 * @returns 归一化后的曲目列表
 */
export const qqSongFM = async (limit = 20): Promise<SongType[]> => {
  const res = await platformRequest<SongFMResponse>(QQ_MUSIC, "songfm", { limit });
  return (res?.songs ?? []).map(normalizeQqSong).map(toSongType);
};

/**
 * 读取酷狗音乐推荐流（刷歌数据源）
 * @param limit 本次取回的曲目数
 * @returns 归一化后的曲目列表
 */
export const kgSongFM = async (limit = 20): Promise<SongType[]> => {
  const res = await platformRequest<SongFMResponse>(KUGOU, "songfm", { limit });
  return (res?.songs ?? []).map(normalizeKgSongFM).map(toSongType);
};
