/**
 * 酷狗音乐首页「场景电台」主题卡
 *
 * 端点：POST http://gateway.kugou.com/everydayrec.service/v1/mul_theme_category_recommend
 *
 * @author Hackerdallas
 */

import { kgGatewayRequest } from "../core/request";
import { decodeName, fillCover } from "../core/config";
import { coreLog } from "../core/logger";
import type { KGModule, KGParams } from "../core/types";

/** 多主题推荐端点（网关相对路径） */
const KG_MUL_THEME_PATH = "/everydayrec.service/v1/mul_theme_category_recommend";

/** 网关地址 */
const KG_GATEWAY_BASE_URL = "http://gateway.kugou.com";

/** 场景电台默认条数 */
const DEFAULT_LIMIT = 6;

/** 场景电台条数上限 */
const MAX_LIMIT = 12;

/** 上游原始条目 */
type RawEntry = Record<string, any>;

/**
 * 归一化主题卡
 * @param detail 上游 theme_detail
 * @returns 归一化后的主题卡
 */
const normalizeTheme = (detail: RawEntry) => {
  const source = detail || {};
  return {
    id: String(source.id ?? source.theme_category_id ?? ""),
    title: decodeName(source.title ?? ""),
    tag: decodeName(source.tag ?? ""),
    subTitle: decodeName(source.sub_title ?? ""),
    cover: fillCover(source.pic ?? source.card_pic ?? "", 300) ?? "",
  };
};

/**
 * 读取酷狗音乐场景电台主题卡
 * @param params.limit 取回的条数
 */
export const homeTheme: KGModule = async (params: KGParams) => {
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number(params.limit ?? DEFAULT_LIMIT) || DEFAULT_LIMIT),
  );

  try {
    const body = await kgGatewayRequest<{
      data?: {
        theme_list?: RawEntry[];
        all_theme_detail_list?: RawEntry[];
      };
    }>(KG_MUL_THEME_PATH, {
      method: "POST",
      baseURL: KG_GATEWAY_BASE_URL,
      data: { show_theme_category_ids: "" },
    });

    const data = body?.data || {};
    const details: RawEntry[] = [];
    const seen = new Set<string>();
    const catalog = Array.isArray(data.all_theme_detail_list) ? data.all_theme_detail_list : [];
    const themed = Array.isArray(data.theme_list) ? data.theme_list : [];
    for (const detail of [...catalog, ...themed]) {
      const raw = detail?.theme_detail ?? detail;
      const id = String(raw?.id ?? "");
      if (!id || seen.has(id)) continue;
      seen.add(id);
      details.push(raw);
    }

    const list = details
      .slice(0, limit)
      .map(normalizeTheme)
      .filter((item: { id: string }) => !!item.id);

    return {
      code: 200,
      total: details.length,
      list,
    };
  } catch (err) {
    coreLog.error("[kg-home-theme] 酷狗场景电台获取异常:", err);
    return {
      code: 502,
      message: `酷狗场景电台获取失败: ${(err as Error)?.message ?? String(err)}`,
    };
  }
};
