/**
 * QQ 音乐歌单广场与歌单详情
 *
 * 两种模式：
 * - 不传 id：歌单广场列表，走 c.y.qq.com 的 fcg_get_diss_by_tag.fcg
 * - 传 id：歌单详情与歌曲，走 c.y.qq.com 的 fcg_ucc_getcdinfo_byids_cp.fcg（JSONP 响应）
 *
 * @author Hackerdallas
 */

import { QM_HEADERS } from "../core/config";
import { sessionToCookieHeader } from "../core/credential";
import { getQQMusicCookies } from "../core/request";
import { coreLog } from "../core/logger";
import { platformRequest } from "../../http";
import type { QMModule, QMParams } from "../core/types";

/** 歌单广场列表接口 */
const SQUARE_URL = "https://c.y.qq.com/splcloud/fcgi-bin/fcg_get_diss_by_tag.fcg";

/** 歌单详情接口 */
const DETAIL_URL = "https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg";

/** 歌单接口 Referer（带尾斜杠） */
const LIST_REFERER = "https://y.qq.com/";

/** 请求超时（毫秒） */
const LIST_TIMEOUT_MS = 8000;

/**
 * 去掉搜索结果的命中高亮标签
 * @param text 原始文本
 * @returns 处理后的文本
 */
const stripHighlight = (text: unknown): string =>
  typeof text === "string" ? text.replace(/<\/?em>/g, "") : "";

/**
 * 拼接歌手名
 * @param singers 歌手数组
 * @returns 形如 A / B 的歌手名
 */
const formatSingerName = (singers: unknown): string => {
  if (!Array.isArray(singers)) return "";
  return singers
    .map((item) => stripHighlight((item as { name?: string })?.name))
    .filter(Boolean)
    .join(" / ");
};

/**
 * 发起一次 GET 请求
 * @param url 请求地址
 * @param cookie Cookie 请求头
 * @returns 响应正文
 */
const fetchText = async (url: string, cookie?: string): Promise<string> => {
  const headers: Record<string, string> = { ...QM_HEADERS, Referer: LIST_REFERER };
  if (cookie) headers.Cookie = cookie;

  const response = await platformRequest<string>({
    url,
    method: "GET",
    headers,
    timeout: LIST_TIMEOUT_MS,
    responseType: "text",
  });

  if (response.status !== 200) {
    throw new Error(`QQ 音乐歌单接口 HTTP ${response.status}`);
  }

  return response.data;
};

/**
 * 解析 JSONP 响应
 * @param text 响应正文
 * @returns 解析后的 JSON
 */
const parseJsonp = (text: string): any => {
  const trimmed = String(text)
    .trim()
    .replace(/^jsonCallback\s*\(/, "")
    .replace(/\)\s*;?$/, "");
  return JSON.parse(trimmed);
};

/**
 * 归一化广场歌单条目
 * @param item 接口返回的歌单条目
 * @returns 归一化后的歌单条目
 */
const normalizeSquareItem = (item: any): Record<string, unknown> => {
  const source = item || {};
  const creator = source.creator || {};
  return {
    id: String(source.dissid ?? ""),
    name: stripHighlight(source.dissname ?? ""),
    cover: stripHighlight(source.imgurl ?? ""),
    creator: stripHighlight(creator.name ?? ""),
    creatorUin: String(creator.qq ?? ""),
    playCount: source.listennum ?? 0,
    description: stripHighlight(source.introduction ?? ""),
    createTime: source.createtime ?? "",
    updateTime: source.commit_time ?? "",
  };
};

/**
 * 归一化歌单歌曲
 * @param item 接口返回的歌曲条目
 * @returns 归一化后的歌曲
 */
const normalizeSong = (item: any): Record<string, unknown> => {
  const source = item || {};
  return {
    id: String(source.songid ?? ""),
    mid: source.songmid ?? "",
    name: stripHighlight(source.songname ?? ""),
    artist: formatSingerName(source.singer),
    artists: (Array.isArray(source.singer) ? source.singer : []).map((singer: any) => ({
      id: String(singer?.id ?? ""),
      mid: singer?.mid ?? "",
      name: stripHighlight(singer?.name ?? ""),
    })),
    album: stripHighlight(source.albumname ?? ""),
    albumMid: source.albummid ?? "",
    duration: (source.interval ?? 0) * 1000,
    mediaMid: source.strMediaMid ?? "",
    pay: source.pay ?? {},
    size128: source.size128 ?? 0,
    size320: source.size320 ?? 0,
    sizeApe: source.sizeape ?? 0,
    sizeFlac: source.sizeflac ?? 0,
    sizeOgg: source.sizeogg ?? 0,
  };
};

/**
 * 取歌单广场列表
 * @param query 调用参数
 * @param cookie Cookie 请求头
 * @returns 归一化后的广场列表
 */
const fetchSquare = async (query: QMParams, cookie?: string): Promise<Record<string, unknown>> => {
  const limit = Math.max(1, Math.min(100, Number(query.limit) || 30));
  const page = Math.max(1, Number(query.page) || 1);
  const sin = (page - 1) * limit + 1;
  const ein = sin + limit - 1;
  const categoryId = String(query.categoryId ?? "10000000");
  const sortId = String(query.sortId ?? "5");

  const url =
    `${SQUARE_URL}?rnd=${Math.random().toFixed(16)}` +
    `&g_tk=5381&loginUin=0&hostUin=0&format=json` +
    `&inCharset=utf8&outCharset=utf-8&notice=0` +
    `&platform=yqq.json&needNewCode=0` +
    `&categoryId=${encodeURIComponent(categoryId)}` +
    `&sortId=${encodeURIComponent(sortId)}` +
    `&sin=${sin}&ein=${ein}`;

  const resText = await fetchText(url, cookie);
  const data = typeof resText === "string" ? JSON.parse(resText) : resText;
  const body = data.data || {};
  const list = (body.list || []).map(normalizeSquareItem);

  return {
    mode: "square",
    total: body.sum ?? list.length,
    page,
    limit,
    list,
    raw: data,
  };
};

/**
 * 取歌单详情与歌曲
 * @param id 歌单号
 * @param cookie Cookie 请求头
 * @returns 归一化后的歌单详情
 */
const fetchDetail = async (id: string, cookie?: string): Promise<Record<string, unknown>> => {
  const url =
    `${DETAIL_URL}?type=1&json=1&utf8=1&onlysonglist=0` +
    `&platform=yqq&needNewCode=0&disstid=${encodeURIComponent(id)}`;

  const resText = await fetchText(url, cookie);
  const data = parseJsonp(resText);
  const cd = (data.cdlist || [])[0];

  if (!cd) {
    const err = new Error(data.msg ? `歌单不可访问: ${data.msg}` : "歌单不存在") as Error & {
      notFound?: boolean;
      upstreamCode?: unknown;
    };
    err.notFound = true;
    err.upstreamCode = data.subcode ?? data.code;
    throw err;
  }

  const songs = (cd.songlist || []).map(normalizeSong);

  return {
    mode: "detail",
    id: String(cd.disstid ?? id),
    name: stripHighlight(cd.dissname ?? ""),
    description: stripHighlight(cd.desc ?? ""),
    creator: stripHighlight(cd.nickname || cd.nick || ""),
    cover: cd.logo ?? "",
    createTime: cd.ctime ?? 0,
    playCount: cd.visitnum ?? 0,
    commentCount: cd.cmtnum ?? 0,
    total: cd.songnum ?? songs.length,
    list: songs,
    raw: data,
  };
};

/**
 * 读取歌单广场列表或歌单详情
 * @param params.id 歌单号，缺省时返回广场列表
 * @param params.categoryId 广场分类号
 * @param params.sortId 广场排序号
 */
export const song_list: QMModule = async (params: QMParams) => {
  const id = String(params.id ?? params.disstid ?? "").trim();
  const cookie = sessionToCookieHeader(getQQMusicCookies());

  try {
    if (id) return { code: 200, ...(await fetchDetail(id, cookie)) };
    return { code: 200, ...(await fetchSquare(params, cookie)) };
  } catch (err) {
    const failure = err as Error & { notFound?: boolean; upstreamCode?: unknown };
    if (failure?.notFound) {
      return {
        code: 404,
        message: failure.message,
        upstreamCode: failure.upstreamCode ?? null,
      };
    }
    coreLog.error("[qm-song-list] QQ 音乐歌单获取异常:", err);
    return {
      code: 502,
      message: `QQ 音乐歌单获取失败: ${failure?.message ?? String(err)}`,
    };
  }
};
