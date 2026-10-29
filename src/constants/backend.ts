/**
 * 自有后端服务地址常量
 *
 * 正式地址由构建期环境变量 `VITE_API_BASE_URL` 提供（见 .env.development /
 * .env.production / .env.debug / .env.example），换域名只需改 env 文件并重新构建。
 * 本模块只承载「环境变量缺失时」的兜底默认值，避免同一地址在多处重复硬编码。
 */

/** 自有后端服务默认地址（环境变量缺失时的兜底） */
export const DEFAULT_API_BASE_URL = "https://music.viaxv.cn";
