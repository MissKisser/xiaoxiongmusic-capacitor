/**
 * 酷狗音乐平台模块类型定义
 *
 * @author Hackerdallas
 */

/** 模块调用入参 */
export type KGParams = Record<string, unknown>;

/** 模块函数签名 */
export type KGModule = (params: KGParams) => Promise<unknown>;

/** 音质档位 */
export type Quality = "128k" | "320k" | "flac" | "flac24bit";

/** 酷狗标准化歌曲对象 */
export interface KGSong {
  id: string;
  audioId: number;
  albumAudioId?: number;
  hash: string;
  name: string;
  artist: string;
  artistId?: string | number;
  artists?: Array<{ id?: string | number; name: string }>;
  album: string;
  albumId: string | number;
  cover?: string;
  coverOriginal?: string;
  interval: number;
  duration: number;
  qualities: Quality[];
  hashes: Partial<Record<Quality, string>>;
  sizes: Partial<Record<Quality, number>>;
  pay?: {
    payplay?: number;
    privilege?: number;
    feetype?: number;
    pkg_price?: number;
    price?: number;
  };
}

/** 专辑信息条目 */
export interface KGAlbumItem {
  id: string;
  name: string;
  cover?: string;
  artist: string;
  artistId?: string | number;
  trackCount: number;
  publishTime?: string;
  intro?: string;
}

/** 歌手信息条目 */
export interface KGArtistItem {
  id: string;
  name: string;
  cover?: string;
  albumCount: number;
  songCount: number;
  fansCount?: number;
}

/** 歌单信息条目 */
export interface KGPlaylistItem {
  id: string;
  name: string;
  cover?: string;
  creator: string;
  trackCount: number;
  playCount: number;
}

/** 酷狗网关通用响应体 */
export interface KGRawBody {
  status?: number;
  error_code?: number;
  errcode?: number;
  err_code?: number;
  data?: unknown;
  info?: unknown;
  [key: string]: unknown;
}

/** 协议请求上下文 */
export interface KgRequestContext {
  /** 客户端标识 */
  appid: number;
  /** 客户端版本号 */
  clientver: number;
  /** 签名盐值 */
  signSalt: string;
  /** RSA 公钥（协议 B 传参用，缺省时用概念版公钥） */
  publicKey?: string;
  /** 设备 MID（十进制字符串） */
  mid: string;
  /** 设备指纹 */
  dfid: string;
  /** 账号 userid */
  userid: string;
  /** 登录 token */
  token: string;
  /** 秒级时间戳 */
  clienttime: number;
}

/** 构造好的网络请求 */
export interface BuiltRequest {
  /** 完整请求地址 */
  url: string;
  /** 请求头 */
  headers: Record<string, string>;
  /** 请求体（协议 A 为 JSON 字符串，协议 B 为密文字节数组） */
  body: string | Uint8Array;
  /** 协议 B 的 AES 会话串，用于解密响应 */
  aes?: string;
}

/** 请求发送结果 */
export interface KgSendResult {
  /** HTTP 状态码 */
  status: number;
  /** 解析后的业务响应体 */
  body: any;
}
