/**
 * 酷狗音乐平台鉴权状态判定
 *
 * 酷狗网关将登录态失效、付费墙及参数校验错误混于统一业务错误码中。
 * 遵循平台规约：仅在登录态探测（user_detail）处将非零/非200业务码判定为登录态失效；
 * 其余接口保持业务错误原样上抛供调用侧按需分流。
 *
 * @author Hackerdallas
 */

/** 视为成功的业务错误码集合 */
const SUCCESS_CODES: ReadonlySet<number> = new Set([0, 200]);

/** 酷狗业务错误异常类 */
export class KugouApiError extends Error {
  /** 业务错误码 */
  readonly errorCode: number;
  /** 上游返回的原始文案 */
  readonly upstreamMessage: string;

  /**
   * 构造酷狗业务异常
   * @param errorCode 业务错误码
   * @param upstreamMessage 上游提示文案
   */
  constructor(errorCode: number, upstreamMessage = "") {
    super(`KG API error_code=${errorCode}${upstreamMessage ? ` msg=${upstreamMessage}` : ""}`);
    this.name = "KugouApiError";
    this.errorCode = errorCode;
    this.upstreamMessage = upstreamMessage;
  }
}

/**
 * 判断业务码是否代表登录态失效
 * @param errorCode 业务错误码
 * @returns 是否代表登录态失效
 */
export const isKugouAuthExpiredCode = (errorCode: number): boolean =>
  !SUCCESS_CODES.has(errorCode);

/**
 * 判断异常对象是否属于登录态失效错误
 * @param error 捕获到的异常
 * @returns 是否为登录态失效
 */
export const isKugouAuthExpired = (error: unknown): boolean =>
  error instanceof KugouApiError && isKugouAuthExpiredCode(error.errorCode);
