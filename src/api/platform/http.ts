/**
 * 平台数据面请求适配层
 *
 * Capacitor 环境消灭本地 Fastify 服务，凡是经由 platformRequest /
 * platformRequestBody / platformWriteRequest 的调用均直调本地核心模块注册表。
 * 若有直接发 HTTP 的场景，适配走 src/utils/platform/http.ts。
 *
 * @author Hackerdallas
 */

import type { ApiPlatform } from "@/types/shared";
import { platformCall } from "./music";

/**
 * 发起平台数据面请求（直调核心模块）
 * @param platform 音源平台
 * @param moduleName 模块名（与模块注册表同名）
 * @param params 业务参数
 * @returns 模块返回的业务数据
 */
export const platformRequest = async <T = unknown>(
  platform: ApiPlatform,
  moduleName: string,
  params: Record<string, unknown> = {},
): Promise<T> => {
  return platformCall<T>(platform, moduleName, params);
};

/**
 * 发起平台数据面请求并取回业务体
 *
 * 核心模块的业务失败通过响应体里的字段（code/reason/status）表达，
 * 直接取回交给调用方翻译。
 * @param platform 音源平台
 * @param moduleName 模块名
 * @param params 业务参数
 * @returns 模块返回的业务数据
 */
export const platformRequestBody = async <T = unknown>(
  platform: ApiPlatform,
  moduleName: string,
  params: Record<string, unknown> = {},
): Promise<T> => {
  try {
    return await platformRequest<T>(platform, moduleName, params);
  } catch (error: any) {
    if (error && typeof error === "object") {
      if (error.response?.data) return error.response.data as T;
      if (error.data) return error.data as T;
      if (typeof error.code === "number" || typeof error.errorCode === "number") {
        return {
          code: error.code ?? error.errorCode,
          message: error.message,
        } as unknown as T;
      }
    }
    throw error;
  }
};

/**
 * 发起平台数据面写操作请求
 * @param platform 音源平台
 * @param moduleName 模块名
 * @param params 业务参数
 * @returns 模块返回的业务数据
 */
export const platformWriteRequest = async <T = unknown>(
  platform: ApiPlatform,
  moduleName: string,
  params: Record<string, unknown> = {},
): Promise<T> => {
  return platformCall<T>(platform, moduleName, params);
};
