/**
 * 网易云端点映射表:前端路径 -> NCM 真实 URI + 签名方式 + 数据构造。
 *
 * 前端 request({ url: "/playlist/detail", params: {...} }) 进来后,
 * localNcmRequest 查此表得到真实 URI、签名方式(weapi/eapi)以及
 * 如何从 params 构造请求 data。对齐 @neteasecloudmusicapienhanced/api
 * 各 module 的 data 构造逻辑。
 *
 * xeapi 端点(如 /song/url/v1)不列入此表 -> 本地化时抛错 -> 回退服务器。
 * 多步端点(如 /playlist/track/all)暂不列入 -> 同样回退服务器。
 *
 * 作者:Hackerdallas
 */

import { cookieObjectToString, parseSetCookie } from "./setCookie";

/** 签名方式 */
export type CryptoType = "weapi" | "eapi" | "linuxapi";

/** 单个端点的映射配置 */
export interface EndpointConfig {
  /**
   * NCM 真实 URI,如 /api/v6/playlist/detail。
   * 动态 URI(如 /api/v1/album/{id})用函数,从 query 取参。
   */
  uri: string | ((query: Record<string, any>) => string);
  /** 签名方式 */
  crypto: CryptoType;
  /**
   * 从合并 query(params + data)构造 NCM 真实 body。
   * @param query 前端传入的合并参数
   * @returns NCM 期望的 data 对象
   */
  buildData: (query: Record<string, any>) => Record<string, any>;
/**
 * 后处理:对 NCM 返回的 body 做与 ncm module 一致的变换。
   * 大部分端点不需要,默认 identity。
   * @param headers 响应头(CapacitorHttp 已将多个同名头合并为逗号串)
   */
  transform?: (
    body: any,
    query: Record<string, any>,
    headers?: Record<string, string>,
  ) => any;
  /**
   * 多步请求:主请求完成后,基于其结果发起后续请求并返回最终 body。
   * req 是内部请求函数:(uri, crypto, data) => Promise<body>。
   * 用于 /playlist/track/all 等两步端点。
   */
  followUp?: (
    body: any,
    query: Record<string, any>,
    req: (uri: string, crypto: CryptoType, data: Record<string, any>) => Promise<any>,
  ) => Promise<any>;
}

/** 解析 URI(字符串或函数) */
export function resolveUri(
  config: EndpointConfig,
  query: Record<string, any>,
): string {
  return typeof config.uri === "function" ? config.uri(query) : config.uri;
}

/**
 * 端点映射表。key 是前端调用时用的 url(如 /playlist/detail)。
 * 未列入此表的端点会在 localNcmRequest 中抛错 -> 回退服务器。
 */
export const ENDPOINT_MAP: Record<string, EndpointConfig> = {
  // ===== 歌曲 =====

  /** 歌曲详情 */
  "/song/detail": {
    uri: "/api/v3/song/detail",
    crypto: "weapi",
    buildData: (q) => {
      const ids = String(q.ids ?? q.id ?? "")
        .split(/\s*,\s*/)
        .filter(Boolean);
      return {
        c: "[" + ids.map((id) => `{"id":${id}}`).join(",") + "]",
      };
    },
  },

  /** 歌曲音质详情 */
  "/song/music/detail": {
    uri: "/api/song/music/detail/get",
    crypto: "eapi",
    buildData: (q) => ({ songId: q.id }),
  },

  /** 客户端歌曲下载链接 */
  "/song/download/url": {
    uri: "/api/song/enhance/download/url",
    crypto: "eapi",
    buildData: (q) => ({ id: q.id, br: parseInt(q.br ?? 999000) }),
  },

  /**
   * 旧版歌曲链接(weapi/eapi 兼容)。/song/url/v1 用 xeapi 不本地化,
   * 本地化时把 /song/url/v1 重定向到这里(参数从 level 推导 br)。
   * 见 client.ts 的 url 重写逻辑。
   */
  "/song/url": {
    uri: "/api/song/enhance/player/url",
    crypto: "eapi",
    buildData: (q) => {
      const ids = String(q.id).split(",");
      return { ids: JSON.stringify(ids), br: parseInt(q.br ?? 999000) };
    },
    transform: (body, q) => {
      // 按 ids 顺序重排,对齐 ncm module
      const ids = String(q.id).split(",");
      const result = body?.data ?? [];
      result.sort(
        (a: any, b: any) => ids.indexOf(String(a.id)) - ids.indexOf(String(b.id)),
      );
      return { code: 200, data: result };
    },
  },

  // ===== 歌单 =====

  /** 歌单详情 */
  "/playlist/detail": {
    uri: "/api/v6/playlist/detail",
    crypto: "eapi",
    buildData: (q) => ({ id: q.id, n: 100000, s: q.s ?? 8 }),
  },

  // ===== 歌词 =====

  /** 新版歌词(含逐字) */
  "/lyric/new": {
    uri: "/api/song/lyric/v1",
    crypto: "eapi",
    buildData: (q) => ({
      id: q.id,
      cp: false,
      tv: 0,
      lv: 0,
      rv: 0,
      kv: 0,
      yv: 0,
      ytv: 0,
      yrv: 0,
    }),
  },

  // ===== 搜索 =====

  /** 搜索 */
  "/cloudsearch": {
    uri: "/api/cloudsearch/pc",
    crypto: "eapi",
    buildData: (q) => ({
      s: q.keywords,
      type: q.type ?? 1,
      limit: q.limit ?? 30,
      offset: q.offset ?? 0,
      total: true,
    }),
  },

  /** 热搜列表 */
  "/search/hot/detail": {
    uri: "/api/hotsearchlist/get",
    crypto: "weapi",
    buildData: () => ({}),
  },

  /** 搜索建议(动态 uri) */
  "/search/suggest": {
    uri: (q) =>
      `/api/search/suggest/${q.type === "mobile" ? "keyword" : "web"}`,
    crypto: "weapi",
    buildData: (q) => ({ s: q.keywords ?? "" }),
  },

  // ===== 推荐 / FM =====

  /** 个性化歌单推荐 */
  "/personalized": {
    uri: "/api/personalized/playlist",
    crypto: "weapi",
    buildData: (q) => ({ limit: q.limit ?? 30, total: true, n: 1000 }),
  },

  /** 私人 FM */
  "/personal_fm": {
    uri: "/api/v1/radio/get",
    crypto: "weapi",
    buildData: () => ({}),
  },

  /** FM 垃圾桶(不喜欢) */
  "/fm_trash": {
    uri: "/api/radio/trash/add",
    crypto: "weapi",
    buildData: (q) => ({
      songId: q.id,
      alg: "RT",
      time: q.time ?? 25,
    }),
  },

  // ===== 排行榜 =====

  /** 所有榜单 */
  "/toplist": {
    uri: "/api/toplist",
    crypto: "eapi",
    buildData: () => ({}),
  },

  /** 所有榜单内容摘要 */
  "/toplist/detail": {
    uri: "/api/toplist/detail",
    crypto: "weapi",
    buildData: () => ({}),
  },

  // ===== 登录 =====

  /** 二维码 key */
  "/login/qr/key": {
    uri: "/api/login/qrcode/unikey",
    crypto: "eapi",
    buildData: () => ({ type: 3 }),
    transform: (body) => ({ data: body, code: 200 }),
  },

  /**
   * 二维码状态检查。
   * 直连 eapi 时登录 Cookie 只存在于 Set-Cookie 响应头,
   * 需在此提取并拼入 body.cookie,供扫码成功分支校验 MUSIC_U。
   */
  "/login/qr/check": {
    uri: "/api/login/qrcode/client/login",
    crypto: "eapi",
    buildData: (q) => ({ key: q.key, type: 3 }),
    transform: (body, _query, headers) => ({
      ...body,
      cookie: cookieObjectToString(
        parseSetCookie(headers?.["Set-Cookie"] ?? headers?.["set-cookie"]),
      ),
    }),
  },

  /** 登录状态 */
  "/login/status": {
    uri: "/api/w/nuser/account/get",
    crypto: "weapi",
    buildData: () => ({}),
    transform: (body) => (body?.code === 200 ? { data: { ...body } } : body),
  },

  /** 刷新登录 */
  "/login/refresh": {
    uri: "/api/login/token/refresh",
    crypto: "eapi",
    buildData: () => ({}),
  },

  /** 退出登录 */
  "/logout": {
    uri: "/api/logout",
    crypto: "eapi",
    buildData: () => ({}),
  },

  // ===== 用户 =====

  /** 用户歌单 */
  "/user/playlist": {
    uri: "/api/user/playlist",
    crypto: "weapi",
    buildData: (q) => ({
      uid: q.uid,
      limit: q.limit ?? 30,
      offset: q.offset ?? 0,
      includeVideo: true,
    }),
  },

  /** 用户云盘 */
  "/user/cloud": {
    uri: "/api/v1/cloud/get",
    crypto: "weapi",
    buildData: (q) => ({ limit: q.limit ?? 30, offset: q.offset ?? 0 }),
  },

  /** 用户详情(动态 uri) */
  "/user/detail": {
    uri: (q) => `/api/v1/user/detail/${q.uid}`,
    crypto: "weapi",
    buildData: () => ({}),
    transform: (body) => {
      // 把所有 avatarImgId_str 替换为 avatarImgIdStr
      const json = JSON.stringify(body).replace(
        /avatarImgId_str/g,
        "avatarImgIdStr",
      );
      return JSON.parse(json);
    },
  },

  // ===== 专辑 =====

  /** 专辑内容(动态 uri) */
  "/album": {
    uri: (q) => `/api/v1/album/${q.id}`,
    crypto: "weapi",
    buildData: () => ({}),
  },

  /** 专辑动态信息 */
  "/album/detail/dynamic": {
    uri: "/api/album/detail/dynamic",
    crypto: "weapi",
    buildData: (q) => ({ id: q.id }),
  },

  /** 已收藏专辑列表 */
  "/album/sublist": {
    uri: "/api/album/sublist",
    crypto: "weapi",
    buildData: (q) => ({
      limit: q.limit ?? 25,
      offset: q.offset ?? 0,
      total: true,
    }),
  },

  /** 最新专辑 */
  "/album/newest": {
    uri: "/api/discovery/newAlbum",
    crypto: "weapi",
    buildData: () => ({}),
  },

  /** 全部新碟 */
  "/album/new": {
    uri: "/api/album/new",
    crypto: "weapi",
    buildData: (q) => ({
      limit: q.limit ?? 30,
      offset: q.offset ?? 0,
      total: true,
      area: q.area ?? "ALL",
    }),
  },

  // ===== 歌手 =====

  /** 歌手歌曲 */
  "/artist/songs": {
    uri: "/api/v1/artist/songs",
    crypto: "eapi",
    buildData: (q) => ({
      id: q.id,
      private_cloud: "true",
      work_type: 1,
      order: q.order ?? "hot",
      offset: q.offset ?? 0,
      limit: q.limit ?? 100,
    }),
  },

  /** 歌手专辑列表(动态 uri) */
  "/artist/album": {
    uri: (q) => `/api/artist/albums/${q.id}`,
    crypto: "weapi",
    buildData: (q) => ({
      limit: q.limit ?? 30,
      offset: q.offset ?? 0,
      total: true,
    }),
  },

  /** 歌手介绍 */
  "/artist/desc": {
    uri: "/api/artist/introduction",
    crypto: "weapi",
    buildData: (q) => ({ id: q.id }),
  },

  /** 歌手详情 */
  "/artist/detail": {
    uri: "/api/artist/head/info/get",
    crypto: "eapi",
    buildData: (q) => ({ id: q.id }),
  },

  // ===== 电台 =====

  /** 电台个性推荐 */
  "/dj/personalize/recommend": {
    uri: "/api/djradio/personalize/rcmd",
    crypto: "weapi",
    buildData: (q) => ({ limit: q.limit ?? 6 }),
  },

  // ===== 每日推荐 =====

  /** 每日推荐歌曲 */
  "/recommend/songs": {
    uri: "/api/v3/discovery/recommend/songs",
    crypto: "weapi",
    buildData: (q) => ({ afresh: q.afresh }),
  },

  /** 每日推荐歌单 */
  "/recommend/resource": {
    uri: "/api/v1/discovery/recommend/resource",
    crypto: "weapi",
    buildData: () => ({}),
  },

  // ===== 搜索补充 =====

  /** 默认搜索关键词 */
  "/search/default": {
    uri: "/api/search/defaultkeyword/get",
    crypto: "eapi",
    buildData: () => ({}),
  },

  // ===== 用户补充 =====

  /** 用户账号信息(注意与 /login/status 的 w/nuser 路径不同) */
  "/user/account": {
    uri: "/api/nuser/account/get",
    crypto: "weapi",
    buildData: () => ({}),
  },

  /** 用户订阅计数 */
  "/user/subcount": {
    uri: "/api/subcount",
    crypto: "weapi",
    buildData: () => ({}),
  },

  /** 喜欢列表 */
  "/likelist": {
    uri: "/api/song/like/get",
    crypto: "eapi",
    buildData: (q) => ({ uid: q.uid }),
  },

  // ===== 歌手/榜单补充 =====

  /** 热门歌手 */
  "/top/artists": {
    uri: "/api/artist/top",
    crypto: "weapi",
    buildData: (q) => ({
      limit: q.limit ?? 50,
      offset: q.offset ?? 0,
      total: true,
    }),
  },

  /** 收藏的歌手 */
  "/artist/sublist": {
    uri: "/api/artist/sublist",
    crypto: "weapi",
    buildData: (q) => ({
      limit: q.limit ?? 50,
      offset: q.offset ?? 0,
      total: true,
    }),
  },

  // ===== MV / 电台补充 =====

  /** 收藏的 MV */
  "/mv/sublist": {
    uri: "/api/cloudvideo/allvideo/sublist",
    crypto: "weapi",
    buildData: (q) => ({
      limit: q.limit ?? 25,
      offset: q.offset ?? 0,
      total: true,
    }),
  },

  /** 全部 MV */
  "/mv/all": {
    uri: "/api/mv/all",
    crypto: "eapi",
    buildData: (q) => ({
      tags: JSON.stringify({
        地区: q.area ?? "全部",
        类型: q.type ?? "全部",
        排序: q.order ?? "上升最快",
      }),
      offset: q.offset ?? 0,
      total: "true",
      limit: q.limit ?? 30,
    }),
  },

  /** 收藏的电台 */
  "/dj/sublist": {
    uri: "/api/djradio/get/subed",
    crypto: "weapi",
    buildData: (q) => ({
      limit: q.limit ?? 30,
      offset: q.offset ?? 0,
      total: true,
    }),
  },

  /** 电台推荐 */
  "/dj/recommend": {
    uri: "/api/djradio/recommend/v1",
    crypto: "weapi",
    buildData: () => ({}),
  },

  // ===== 两步端点 =====

  /**
   * 歌单全部歌曲(两步):
   * 1) /api/v6/playlist/detail 拿 trackIds
   * 2) /api/v3/song/detail 按 offset/limit 切片拿详情
   * 返回 { songs, privileges, code } 对齐服务器版结构。
   */
  "/playlist/track/all": {
    uri: "/api/v6/playlist/detail",
    crypto: "eapi",
    buildData: (q) => ({ id: q.id, n: 100000, s: q.s ?? 8 }),
    followUp: async (body, q, req) => {
      const trackIds = (body?.playlist?.trackIds || []).map(
        (t: any) => t.id,
      );
      const limit = parseInt(q.limit) || 1000;
      const offset = parseInt(q.offset) || 0;
      const slice = trackIds.slice(offset, offset + limit);
      const detail = await req("/api/v3/song/detail", "weapi", {
        c: "[" + slice.map((id: any) => `{"id":${id}}`).join(",") + "]",
      });
      return {
        songs: detail?.songs ?? [],
        privileges: detail?.privileges ?? [],
        code: 200,
      };
    },
  },

  // ===== 搜索补充(全量对齐) =====

  /** 旧版搜索(type=2000 语音搜索走 voice 端点,此处仅常规) */
  "/search": {
    uri: "/api/search/get",
    crypto: "eapi",
    buildData: (q) => ({
      s: q.keywords,
      type: q.type ?? 1,
      limit: q.limit ?? 30,
      offset: q.offset ?? 0,
    }),
  },

  /** 本地/云盘歌曲搜索匹配 */
  "/search/match": {
    uri: "/api/search/match/new",
    crypto: "eapi",
    buildData: (q) => ({
      songs: JSON.stringify([
        {
          title: q.title ?? "",
          album: q.album ?? "",
          artist: q.artist ?? "",
          duration: q.duration ?? 0,
          persistId: q.md5,
        },
      ]),
    }),
  },

  /** 搜索多重匹配 */
  "/search/multimatch": {
    uri: "/api/search/suggest/multimatch",
    crypto: "weapi",
    buildData: (q) => ({ type: q.type ?? 1, s: q.keywords ?? "" }),
  },

  // ===== 歌曲/喜欢 =====

  /** 喜欢/取消喜欢歌曲 */
  "/like": {
    uri: "/api/radio/like",
    crypto: "weapi",
    buildData: (q) => ({
      alg: "itembased",
      trackId: q.id,
      like: q.like == "false" ? false : true,
      time: "3",
    }),
  },

  /** 旧版歌词 */
  "/lyric": {
    uri: "/api/song/lyric",
    crypto: "eapi",
    buildData: (q) => ({
      id: q.id,
      tv: -1,
      lv: -1,
      rv: -1,
      kv: -1,
      _nmclfl: 1,
    }),
  },

  /** 下载链接 v1 */
  "/song/download/url/v1": {
    uri: "/api/song/enhance/download/url/v1",
    crypto: "eapi",
    buildData: (q) => ({ id: q.id, level: q.level, br: q.br }),
  },

  /** 心动模式 */
  "/playmode/intelligence/list": {
    uri: "/api/playmode/intelligence/list",
    crypto: "eapi",
    buildData: (q) => ({
      songId: q.id,
      type: "fromPlayOne",
      playlistId: q.pid,
      startMusicId: q.sid ?? q.id,
      count: q.count ?? 1,
    }),
  },

  /** 新歌速递 */
  "/top/song": {
    uri: "/api/v1/discovery/new/songs",
    crypto: "weapi",
    buildData: (q) => ({ areaId: q.type ?? 0, total: true }),
  },

  /** 热门歌手(动态 uri,id 走路径) */
  "/artists": {
    uri: (q) => `/api/v1/artist/${q.id}`,
    crypto: "weapi",
    buildData: () => ({}),
  },

  // ===== 推荐补充 =====

  /** 推荐新音乐 */
  "/personalized/newsong": {
    uri: "/api/personalized/newsong",
    crypto: "weapi",
    buildData: (q) => ({
      type: "recommend",
      limit: q.limit ?? 10,
      areaId: q.areaId ?? 0,
    }),
  },

  /** 每日推荐不感兴趣 */
  "/recommend/songs/dislike": {
    uri: "/api/v2/discovery/recommend/dislike",
    crypto: "eapi",
    buildData: (q) => ({ resId: q.id, resType: 4, sceneType: 1 }),
  },

  // ===== 歌手/专辑操作 =====

  /** 歌手分类列表 */
  "/artist/list": {
    uri: "/api/v1/artist/list",
    crypto: "weapi",
    buildData: (q) => ({
      initial: isNaN(q.initial)
        ? (q.initial ?? "").toUpperCase().charCodeAt() || undefined
        : q.initial,
      offset: q.offset ?? 0,
      limit: q.limit ?? 30,
      total: true,
      type: q.type ?? "1",
      area: q.area,
    }),
  },

  /** 歌手 MV */
  "/artist/mv": {
    uri: "/api/artist/mvs",
    crypto: "weapi",
    buildData: (q) => ({
      artistId: q.id,
      limit: q.limit,
      offset: q.offset,
      total: true,
    }),
  },

  /** 收藏/取消收藏歌手 */
  "/artist/sub": {
    uri: (q) => `/api/artist/${q.t == 1 ? "sub" : "unsub"}`,
    crypto: "weapi",
    buildData: (q) => ({
      artistId: q.id,
      artistIds: `[${q.id}]`,
    }),
  },

  /** 收藏/取消收藏专辑 */
  "/album/sub": {
    uri: (q) => `/api/album/${q.t == 1 ? "sub" : "unsub"}`,
    crypto: "weapi",
    buildData: (q) => ({ id: q.id }),
  },

  /** 用户等级 */
  "/user/level": {
    uri: "/api/user/level",
    crypto: "weapi",
    buildData: () => ({}),
  },

  // ===== 评论 =====

  /** 评论(threadId 由资源类型映射拼接) */
  "/comment/new": {
    uri: "/api/v2/resource/comments",
    crypto: "eapi",
    buildData: (q) => {
      const typeMap: Record<string, string> = {
        "0": "R_SO_4_",
        "1": "R_MV_5_",
        "2": "A_PL_0_",
        "3": "R_AL_3_",
        "4": "A_DJ_1_",
        "5": "R_VI_62_",
        "6": "A_EV_2_",
        "7": "A_DR_14_",
      };
      const pageSize = q.pageSize ?? 20;
      const pageNo = q.pageNo ?? 1;
      let sortType = Number(q.sortType) || 99;
      if (sortType === 1) sortType = 99;
      let cursor: string | number = "";
      if (sortType === 99) cursor = (pageNo - 1) * pageSize;
      else if (sortType === 2) cursor = `normalHot#${(pageNo - 1) * pageSize}`;
      else if (sortType === 3) cursor = q.cursor ?? "";
      return {
        threadId: (typeMap[String(q.type)] ?? "") + q.id,
        pageNo,
        showInner: true,
        pageSize,
        cursor,
        sortType,
      };
    },
  },

  /** 热门评论(动态 uri) */
  "/comment/hot": {
    uri: (q) => {
      const typeMap: Record<string, string> = {
        "0": "R_SO_4_",
        "1": "R_MV_5_",
        "2": "A_PL_0_",
        "3": "R_AL_3_",
        "4": "A_DJ_1_",
        "5": "R_VI_62_",
        "6": "A_EV_2_",
        "7": "A_DR_14_",
      };
      return `/api/v1/resource/hotcomments/${typeMap[String(q.type)] ?? ""}${q.id}`;
    },
    crypto: "weapi",
    buildData: (q) => ({
      rid: q.id,
      limit: q.limit ?? 20,
      offset: q.offset ?? 0,
      beforeTime: q.before ?? 0,
    }),
  },

  // ===== 歌单操作 =====

  /** 歌单增删歌曲 */
  "/playlist/tracks": {
    uri: "/api/playlist/manipulate/tracks",
    crypto: "eapi",
    buildData: (q) => ({
      op: q.op,
      pid: q.pid,
      trackIds: JSON.stringify(String(q.tracks).split(",")),
      imme: "true",
    }),
  },

  /** 歌单分类标签 */
  "/playlist/catlist": {
    uri: "/api/playlist/catalogue",
    crypto: "eapi",
    buildData: () => ({}),
  },

  /** 精品歌单标签 */
  "/playlist/highquality/tags": {
    uri: "/api/playlist/highquality/tags",
    crypto: "weapi",
    buildData: () => ({}),
  },

  // ===== 电台(全量) =====

  /** 电台详情 */
  "/dj/detail": {
    uri: "/api/djradio/v2/get",
    crypto: "weapi",
    buildData: (q) => ({ id: q.rid }),
  },

  /** 电台节目列表 */
  "/dj/program": {
    uri: "/api/dj/program/byradio",
    crypto: "weapi",
    buildData: (q) => ({
      radioId: q.rid,
      limit: q.limit ?? 30,
      offset: q.offset ?? 0,
      asc: q.asc !== "false" && q.asc !== false,
    }),
  },

  /** 电台节目详情 */
  "/dj/program/detail": {
    uri: "/api/dj/program/detail",
    crypto: "weapi",
    buildData: (q) => ({ id: q.id }),
  },

  /** 热门电台 */
  "/dj/radio/hot": {
    uri: "/api/djradio/hot",
    crypto: "weapi",
    buildData: (q) => ({
      cateId: q.cateId,
      limit: q.limit ?? 30,
      offset: q.offset ?? 0,
    }),
  },

  /** 电台分类 */
  "/dj/catelist": {
    uri: "/api/djradio/category/get",
    crypto: "weapi",
    buildData: () => ({}),
  },

  /** 电台分类推荐 */
  "/dj/category/recommend": {
    uri: "/api/djradio/home/category/recommend",
    crypto: "weapi",
    buildData: () => ({}),
  },

  /** 电台分类推荐(按类型) */
  "/dj/recommend/type": {
    uri: "/api/djradio/recommend",
    crypto: "weapi",
    buildData: (q) => ({ cateId: q.type }),
  },

  /** 收藏/取消收藏电台 */
  "/dj/sub": {
    uri: (q) => `/api/djradio/${q.t == 1 ? "sub" : "unsub"}`,
    crypto: "weapi",
    buildData: (q) => ({ id: q.rid }),
  },

  /** 电台榜单 */
  "/dj/toplist": {
    uri: "/api/djradio/toplist",
    crypto: "weapi",
    buildData: (q) => ({
      limit: q.limit ?? 100,
      offset: q.offset ?? 0,
      type: q.type === "hot" ? 1 : 0,
    }),
  },

  // ===== 视频/MV =====

  /** MV 详情 */
  "/mv/detail": {
    uri: "/api/v1/mv/detail",
    crypto: "weapi",
    buildData: (q) => ({ id: q.mvid }),
  },

  /** 视频详情 */
  "/video/detail": {
    uri: "/api/cloudvideo/v1/video/detail",
    crypto: "weapi",
    buildData: (q) => ({ id: q.id }),
  },

  /** MV 地址 */
  "/mv/url": {
    uri: "/api/song/enhance/play/mv/url",
    crypto: "weapi",
    buildData: (q) => ({ id: q.id, r: q.r ?? 1080 }),
  },

  /** 视频地址 */
  "/video/url": {
    uri: "/api/cloudvideo/playurl",
    crypto: "weapi",
    buildData: (q) => ({
      ids: `["${q.id}"]`,
      resolution: q.res ?? 1080,
    }),
  },

  /** MV 互动数据 */
  "/mv/detail/info": {
    uri: "/api/comment/commentthread/info",
    crypto: "weapi",
    buildData: (q) => ({
      threadid: `R_MV_5_${q.mvid}`,
      composeliked: true,
    }),
  },

  /** 视频互动数据 */
  "/video/detail/info": {
    uri: "/api/comment/commentthread/info",
    crypto: "weapi",
    buildData: (q) => ({
      threadid: `R_VI_62_${q.vid}`,
      composeliked: true,
    }),
  },
};

/** 判断端点是否支持本地化 */
export function hasEndpoint(url: string): boolean {
  return url in ENDPOINT_MAP;
}

/** 查询端点配置 */
export function getEndpoint(url: string): EndpointConfig | undefined {
  return ENDPOINT_MAP[url];
}
