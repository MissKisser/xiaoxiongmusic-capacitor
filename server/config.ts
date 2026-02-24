/**
 * 独立配置模块（不依赖 Electron）
 */

/**
 * 是否为开发环境
 * 如果 NODE_ENV 未设置，默认使用 production
 */
export const isDev = process.env.NODE_ENV === "development";

/**
 * 服务器端口
 */
export const port = Number(process.env.VITE_SERVER_PORT || process.env.PORT || 25884);

/**
 * 默认 AMLL TTML DB Server
 */
export const defaultAMLLDbServer = "https://amlldb.bikonoo.com/ncm-lyrics/%s.ttml";
