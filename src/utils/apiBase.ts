/**
 * 后端服务基地址（单一来源）
 *
 * 真实取值来自构建期环境变量 `VITE_API_BASE_URL`（见 .env.development / .env.production /
 * .env.debug / .env.example），由 Vite 在构建时静态内联。各模块一律从此处引用，
 * 禁止再硬编码域名，换域名只需改 env 文件并重新构建，无需改动业务代码。
 *
 * 非 Vite 运行环境（如 vitest / tsx 直接执行）拿不到 import.meta.env，
 * 回落到默认值，保证测试与脚本链路可用。
 */
import { DEFAULT_API_BASE_URL } from "@/constants/backend";

/** 后端服务基地址（不含尾部斜杠） */
export const API_BASE_URL = String(
  (import.meta as unknown as { env?: Record<string, string> })?.env?.VITE_API_BASE_URL ||
    DEFAULT_API_BASE_URL,
).replace(/\/+$/, "");
