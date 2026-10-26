/**
 * QQ 音乐模块通用类型定义
 *
 * @author Hackerdallas
 */

/** 模块入参字典 */
export type QMParams = Record<string, any>;

/** 模块执行函数类型 */
export type QMModule = (params: QMParams) => Promise<any>;

/** 统一模块返回结构 */
export interface QMResponse<T = any> {
  code: number;
  message?: string;
  data?: T;
  [key: string]: unknown;
}
