/**
 * 服务端 axios 语义的请求封装（严格状态码校验）
 *
 * 服务端换源模块的取数统一走 axios 默认 validateStatus（非 2xx 抛错），
 * resilience 的故障判定从 error.response.status 区分「4xx 请求侧 / 5xx 上游侧」。
 * 本地 http 封装层的 unblockRequest 语义是 validateStatus 恒真（任何状态码都正常返回），
 * 这里在其上补一层与 axios 一致的状态码抛错语义，使逐字移植的音源模块
 * 对「传输成功但状态码异常」的分支判定与服务端保持一致。
 */
import { unblockRequest } from './http'
import type { UnblockRequestOptions, UnblockHttpResponse } from './http'

/**
 * 发起带严格状态码校验的请求
 *
 * @param options 请求选项（透传给本地 http 封装层 unblockRequest）
 * @returns 统一响应；非 2xx 状态码时抛出携带 response.status 的异常，
 *          供 extractHttpStatus / isUpstreamFault 按服务端口径判读
 */
export const requestStrict = async (
  options: UnblockRequestOptions,
): Promise<UnblockHttpResponse> => {
  const response = await unblockRequest(options)
  if (response.status < 200 || response.status >= 300) {
    throw Object.assign(new Error(`Request failed with status code ${response.status}`), {
      response: { status: response.status },
    })
  }
  return response
}
