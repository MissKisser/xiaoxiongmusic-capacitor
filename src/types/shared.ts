/**
 * @fileoverview 所有主进程和渲染进程都需要用到的、且不依赖其他文件的类型定义
 *
 * 本模块只描述共享的数据契约，不依赖任何其他模块，
 * 因此可作为叶子模块被任意模块安全引用。
 */

/** 支持的音源平台 */
export type ApiPlatform = "netease" | "qqmusic" | "kugou";

/**
 * 歌曲解锁服务器
 *
 * 标识获取歌曲播放地址时可用的站外解锁源，决定解锁链的尝试顺序与各源的超时预算。
 */
export enum SongUnlockServer {
  /** 网易云音乐（按歌曲 ID 寻址） */
  NETEASE = "netease",
  /** 波点音乐 */
  BODIAN = "bodian",
  /** 酷我音乐 */
  KUWO = "kuwo",
  /** 歌曲宝（上游已失效，不入换源链；保留枚举以兼容存量设置数据） */
  GEQUBAO = "gequbao",
  /** 咪咕音乐 */
  MIGU = "migu",
  /** 长青聚合 */
  CHANGQING = "changqing",
  /** 落雪音源（lx 协议自定义源） */
  LXMUSIC = "lxmusic",
  /** 星海音源（lx 协议网易云通道） */
  XINGHAI = "xinghai",
}

/**
 * 平台接口失败原因分类
 *
 * - AUTH_EXPIRED：登录凭据已失效，需要重新登录
 * - BUSINESS_ERROR：上游给出明确业务结论（非登录态问题）
 * - UNKNOWN：未归类的失败（网络故障等）
 */
export type PlatformErrorCode = "AUTH_EXPIRED" | "BUSINESS_ERROR" | "UNKNOWN";

/**
 * 通用响应包装
 *
 * 失败时除文案外还带上失败原因分类与上游业务码，
 * 渲染端据此区分「凭据失效」与「网络抖动」，避免误登出。
 */
export type ApiCallResponse =
  | { ok: true; data?: unknown }
  | {
      ok: false;
      error: string;
      errorCode?: PlatformErrorCode;
      /** 上游外层业务码 */
      outer?: number;
      /** 上游内层业务码 */
      inner?: number;
    };

/** 平台账号资料 */
export interface PlatformProfile {
  /** 平台内用户 ID */
  userId: string;
  /** 昵称 */
  nickname: string;
  /** 头像地址 */
  avatarUrl: string;
  /** 是否为会员 */
  isVip: boolean;
  /** 会员等级 */
  vipLevel: number;
}

/** 第三方音源平台 API 接口 */
export interface PlatformMusicApi {
  /**
   * 调用平台接口
   * @param platform 音源平台
   * @param name 接口名
   * @param params 接口参数
   */
  call: (
    platform: ApiPlatform,
    name: string,
    params?: Record<string, unknown>,
  ) => Promise<ApiCallResponse>;
  /**
   * 清空指定平台的登录态
   * @param platform 音源平台
   */
  clearSession: (platform: ApiPlatform) => Promise<void>;
  /**
   * 列出指定平台可用的模块名
   * @param platform 音源平台
   */
  listModules: (platform: ApiPlatform) => Promise<{ ok: boolean; modules: string[] }>;
}

/**
 * 循环模式
 *
 * off: 不循环 | list: 列表循环 | one: 单曲循环
 */
export type RepeatModeType = "off" | "list" | "one";

/**
 * 随机模式
 *
 * off: 关闭 | on: 随机播放 | heartbeat: 心动模式
 */
export type ShuffleModeType = "off" | "on" | "heartbeat";

/**
 * 用于 "play-mode-change" 事件的负载结构
 */
export interface PlayModePayload {
  repeatMode: RepeatModeType;
  shuffleMode: ShuffleModeType;
}
