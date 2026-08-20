/**
 * 网易云本地化 API 入口。
 *
 * 在 Capacitor 端 + settingStore.useLocalApi 开启时,
 * src/utils/request.ts 会把请求路由到 localNcmRequest,
 * 由其在 WebView 内完成签名 + CapacitorHttp 直连 music.163.com,
 * 不经 music.viaxv.top 服务器。失败时由 request.ts 回退服务器。
 *
 * 作者:Hackerdallas
 */

export { localNcmRequest } from "./client";
export { hasEndpoint, getEndpoint, ENDPOINT_MAP } from "./endpoints";
export type { EndpointConfig, CryptoType } from "./endpoints";
