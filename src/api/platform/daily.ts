/**
 * 平台每日推荐数据层（渲染端）
 *
 * 对应网易云的「每日推荐」能力：网易云由每日推荐歌单接口给出真实歌单号，
 * QQ 音乐与酷狗音乐的平台侧**不存在每日推荐歌单号**，
 * 改由主进程的每日推荐模块给出**按日期生成的稳定定位键 + 当日曲目**，
 * 曲目字段与两平台刷歌模块完全一致，页面层无需区分平台。
 *
 * 与网易云的两点差异：
 * - 每日推荐是**登录态**接口，未登录时主进程返回业务码 301；
 * - 平台侧没有歌单号，页面不能进歌单详情页，
 *   只能把当日曲目当作一组歌曲使用（载入播放队列）。
 */

import { platformRequestBody } from "./http";
import { normalizeQqSong, QQ_MUSIC } from "./qqmusic";
import { KUGOU, normalizeKgSongFM } from "./kugou";
import { toSongType } from "./types";
import type { PlatformSong } from "./types";
import type { SongType } from "@/types/main";

/** 主进程每日推荐模块的原生返回 */
interface DailyRecommendResponse {
  code?: number;
  id?: string;
  name?: string;
  cover?: string;
  coverSource?: string;
  count?: number;
  date?: string;
  isNew?: boolean;
  source?: string;
  songs?: Array<Record<string, any>>;
  message?: string;
}

/** 每日推荐定位信息与曲目 */
export interface DailyRecommend {
  /** 定位键（平台无歌单号，按日期生成） */
  id: string;
  /** 平台原名（QQ 音乐「今日推荐歌曲」/ 酷狗「每日歌曲推荐」） */
  name: string;
  /** 封面（平台未下发时取首曲专辑封面兜底） */
  cover: string;
  /** 曲目数 */
  count: number;
  /** 日期串（`YYYYMMDD`） */
  date: string;
  /** 当日曲目 */
  songs: SongType[];
}

/** 每日推荐读取结果 */
export interface DailyRecommendResult {
  /** 业务码：200 成功、301 未登录、其它为失败 */
  code: number;
  /** 成功时的数据 */
  data?: DailyRecommend;
  /** 失败文案 */
  message?: string;
}

/**
 * 读取某平台的每日推荐
 * @param platform 音源平台
 * @param normalize 曲目归一化函数
 * @returns 读取结果
 */
const readDailyRecommend = async (
  platform: typeof QQ_MUSIC | typeof KUGOU,
  normalize: (song: Record<string, any>) => PlatformSong,
): Promise<DailyRecommendResult> => {
  try {
    // 业务失败（未登录 / 上游异常）用响应体表达，这里取回业务体交给调用方翻译
    const res = await platformRequestBody<DailyRecommendResponse>(platform, "daily/recommend");
    if (!res || res.code !== 200) {
      return {
        code: Number(res?.code ?? 502) || 502,
        message: res?.message || "读取每日推荐失败",
      };
    }
    const songs = (res.songs ?? []).map((song) => normalize(song)).map(toSongType);
    return {
      code: 200,
      data: {
        id: String(res.id ?? ""),
        name: String(res.name ?? ""),
        cover: String(res.cover ?? ""),
        count: Number(res.count ?? songs.length),
        date: String(res.date ?? ""),
        songs,
      },
    };
  } catch (error) {
    return {
      code: 502,
      message: error instanceof Error ? error.message : String(error),
    };
  }
};

/**
 * 读取 QQ 音乐每日推荐（「今日推荐歌曲」）
 * @returns 读取结果
 */
export const qqDailyRecommend = async (): Promise<DailyRecommendResult> =>
  readDailyRecommend(QQ_MUSIC, normalizeQqSong);

/**
 * 读取酷狗音乐每日推荐（「每日歌曲推荐」）
 * @returns 读取结果
 */
export const kgDailyRecommend = async (): Promise<DailyRecommendResult> =>
  readDailyRecommend(KUGOU, normalizeKgSongFM);
