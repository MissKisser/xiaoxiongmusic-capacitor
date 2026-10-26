/**
 * QQ 音乐鉴权状态判定与异常类型
 *
 * 区分凭据失效（需重新登录或续期）与业务授权失败：
 * - 读取类接口（资料、歌单、推荐等）的 1000 业务码判定为凭据失效；
 * - 写类 musicasset.*Write 与 music.asset.MusicAsset 的 1000 判定为授权失败（非凭据失效）；
 * - 104400 / 104401 在任何接口上均明确判定为凭据失效。
 *
 * @author Hackerdallas
 */

/** 明确表示「未登录 / 登录态失效」的 inner 业务码（与 module 无关） */
export const LOGIN_REQUIRED_INNER_CODES: ReadonlySet<number> = new Set([104400, 104401]);

/** 读取类接口上表示「凭据已过期」的 inner 业务码 */
export const AUTH_EXPIRED_INNER_CODE = 1000;

/** 写类授权接口的 module 命名规律 */
const WRITE_ASSET_MODULE_PATTERN = /^music\.musicasset\..*Write$/;

/** 写类授权接口的 module 白名单 */
const WRITE_ASSET_MODULES: ReadonlySet<string> = new Set(["music.asset.MusicAsset"]);

/**
 * 判断某个 module 是否属于写类授权接口
 * @param module 业务 module 名称
 * @returns 是否为写类授权接口
 */
export const isWriteAssetModule = (module: string): boolean =>
  WRITE_ASSET_MODULE_PATTERN.test(module) || WRITE_ASSET_MODULES.has(module);

/**
 * 判定业务码是否代表凭据失效
 * @param module 业务 module 名称
 * @param innerCode 内层业务码
 * @returns 是否判定为凭据失效
 */
export const isAuthExpiredCode = (module: string, innerCode: number): boolean => {
  if (LOGIN_REQUIRED_INNER_CODES.has(innerCode)) return true;
  if (innerCode !== AUTH_EXPIRED_INNER_CODE) return false;
  return !isWriteAssetModule(module);
};

/** QQ 音乐业务错误描述 */
export interface QQMusicErrorInfo {
  /** 外层业务码 */
  outer: number;
  /** 内层业务码 */
  inner: number;
  /** 业务 module */
  module: string;
  /** 业务 method */
  method: string;
  /** 是否判定为凭据失效 */
  authExpired: boolean;
}

/**
 * QQ 音乐业务异常
 */
export class QQMusicApiError extends Error {
  /** 外层业务码 */
  readonly outer: number;
  /** 内层业务码 */
  readonly inner: number;
  /** 业务 module */
  readonly module: string;
  /** 业务 method */
  readonly method: string;
  /** 是否判定为凭据失效 */
  readonly authExpired: boolean;

  /**
   * 构造 QQ 音乐业务异常
   * @param info 错误详细信息
   */
  constructor(info: QQMusicErrorInfo) {
    super(
      `QM API 错误: outer=${info.outer} inner=${info.inner} module=${info.module} method=${info.method}`,
    );
    this.name = "QQMusicApiError";
    this.outer = info.outer;
    this.inner = info.inner;
    this.module = info.module;
    this.method = info.method;
    this.authExpired = info.authExpired;
  }
}

/**
 * 判断异常对象是否属于凭据失效
 * @param error 捕获到的异常对象
 * @returns 是否为凭据失效异常
 */
export const isQQMusicAuthExpired = (error: unknown): boolean =>
  error instanceof QQMusicApiError && error.authExpired;
