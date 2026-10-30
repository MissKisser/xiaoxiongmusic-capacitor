/**
 * 酷狗音乐热搜词模块
 *
 * 走网关原生热搜榜接口：
 * - 主通道：GET /api/v3/search/hot_tab（网关签名，路由头 msearch.kugou.com）
 * - 兜底通道：GET https://mobileservice.kugou.com/api/v5/search/hot/list（免签名）
 *
 * 上游两个接口均不返回真实热度值，因此条目不含 score 字段（不伪造热度分）。
 * 上游 reason 与 keyword 恒等，描述若直接展示会与热搜词重复，
 * 故归一化时 description 统一留空，待上游给出真实描述后再启用。
 *
 * @author Hackerdallas
 */

import { kgGatewayRequest, kgRequest } from "../core/request";
import { coreLog } from "../core/logger";
import type { KGModule, KGParams } from "../core/types";

/** 网关热搜榜路径 */
const KG_HOT_TAB_PATH = "/api/v3/search/hot_tab";

/** 网关热搜榜路由头 */
const KG_HOT_TAB_ROUTER = "msearch.kugou.com";

/** 兜底热搜词接口 */
const KG_HOT_LIST_URL = "https://mobileservice.kugou.com/api/v5/search/hot/list";

/** 默认热搜榜名 */
const DEFAULT_TAB_NAME = "热搜榜";

/** 默认条数 */
const DEFAULT_LIMIT = 20;

/** 条数上限 */
const MAX_LIMIT = 50;

/** 上游原始条目 */
type RawEntry = Record<string, any>;

/**
 * 归一化热搜条目
 * @param item 接口返回的热搜条目
 * @param index 条目序号
 * @returns 归一化后的热搜条目
 */
const normalizeHotItem = (item: RawEntry, index: number) => {
  const source = item || {};
  return {
    rank: index + 1,
    keyword: String(source.keyword ?? "").trim(),
    // 上游 reason 与 keyword 恒等，描述留空以避免界面重复展示
    description: "",
  };
};

/**
 * 归一化热搜列表
 *
 * 榜位以有效条数计：空词被丢弃后，后续条目的榜位仍然连续。
 * @param items 接口返回的热搜条目列表
 * @returns 归一化后的热搜条目列表
 */
const normalizeHotList = (items: RawEntry[]): Record<string, unknown>[] => {
  const list: Record<string, unknown>[] = [];
  for (const item of items) {
    const normalized = normalizeHotItem(item, list.length);
    if (!normalized.keyword) continue;
    list.push(normalized);
  }
  return list;
};

/**
 * 读取网关热搜榜
 *
 * 网关一次返回多个热搜榜（热搜榜 / 飙升榜 / 外语热搜 等），
 * 取指定榜名，榜名不存在时退回第一个榜。
 * @param tabName 榜名
 * @returns 榜内热搜词原始条目
 */
const fetchHotTab = async (tabName: string): Promise<RawEntry[]> => {
  const body = await kgGatewayRequest<{ data?: { list?: RawEntry[] } }>(KG_HOT_TAB_PATH, {
    method: "GET",
    params: { navid: 1, plat: 2 },
    headers: { "x-router": KG_HOT_TAB_ROUTER },
  });

  const tabs = Array.isArray(body?.data?.list) ? body.data.list : [];
  const tab =
    tabs.find((item) => String(item?.name ?? "").trim() === tabName) ?? tabs[0] ?? null;
  const keywords = tab?.keywords;
  return Array.isArray(keywords) ? keywords : [];
};

/**
 * 读取兜底热搜词列表
 * @returns 热搜词原始条目
 */
const fetchFallbackHotList = async (): Promise<RawEntry[]> => {
  const body = await kgRequest<{ data?: { info?: RawEntry[] } }>(KG_HOT_LIST_URL);
  const info = body?.data?.info;
  return Array.isArray(info) ? info : [];
};

/**
 * 读取酷狗音乐热搜词
 * @param params.limit 条数上限，默认 20
 * @param params.tab 热搜榜名，默认「热搜榜」
 */
export const hot_search: KGModule = async (params: KGParams) => {
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number(params.limit ?? DEFAULT_LIMIT) || DEFAULT_LIMIT),
  );
  const tabName = String(params.tab ?? DEFAULT_TAB_NAME).trim() || DEFAULT_TAB_NAME;

  try {
    let raw: RawEntry[] = [];
    try {
      raw = await fetchHotTab(tabName);
    } catch (err) {
      coreLog.warn("[kg-hot-search] 酷狗热搜榜主通道失败，转用兜底通道:", err);
    }

    // 主通道无数据时降级到兜底通道
    if (raw.length === 0) {
      raw = await fetchFallbackHotList();
    }

    const list = normalizeHotList(raw).slice(0, limit);

    return {
      code: 200,
      total: list.length,
      list,
    };
  } catch (err) {
    coreLog.error("[kg-hot-search] 酷狗热搜获取异常:", err);
    return {
      code: 502,
      message: `酷狗热搜获取失败: ${(err as Error)?.message ?? String(err)}`,
    };
  }
};
