/**
 * QQ 音乐热搜词
 *
 * 走 tencent_musicsoso_hotkey.HotkeyService / GetHotkeyForQQMusicPC 接口。
 *
 * @author Hackerdallas
 */

import { qmRequest } from "../core/request";
import { coreLog } from "../core/logger";
import type { QMModule } from "../core/types";

/**
 * 归一化热搜条目
 * @param item 接口返回的热搜条目
 * @param index 条目序号
 * @returns 归一化后的热搜条目
 */
const normalizeHotItem = (item: any, index: number): Record<string, unknown> => {
  const source = item || {};
  return {
    rank: index + 1,
    keyword: source.query || source.title || "",
    id: source.hotkey_id ?? source.id ?? "",
    score: Number(source.score) || 0,
    cover: source.cover_pic_url ?? "",
    description: source.description ?? "",
  };
};

/**
 * 读取 QQ 音乐站内热搜榜
 */
export const hot_search: QMModule = async () => {
  try {
    const data = await qmRequest<any>(
      "tencent_musicsoso_hotkey.HotkeyService",
      "GetHotkeyForQQMusicPC",
      { search_id: "", uin: 0 },
    );

    const list = ((data && data.vec_hotkey) || []).map(normalizeHotItem);

    return {
      code: 200,
      total: list.length,
      list,
      raw: data,
    };
  } catch (err) {
    coreLog.error("[qm-hot-search] QQ 音乐热搜获取异常:", err);
    return {
      code: 502,
      message: `QQ 音乐热搜获取失败: ${(err as Error)?.message ?? String(err)}`,
    };
  }
};
