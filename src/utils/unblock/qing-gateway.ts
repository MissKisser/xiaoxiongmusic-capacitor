/**
 * 青听（海棠坞）音乐解析网关协议工具
 *
 * 封装上游网关的签名认证与票据换取协议：
 * 1. 进程级 deviceId 单例管理；
 * 2. 内存 Ticket 缓存、懒加载与到期前刷新；
 * 3. 基于 HMAC-SHA256 的 X-Qing-* 防篡改签名头计算。
 *
 * 与服务端实现的差异仅在密码学原语的载体：服务端用 node:crypto 的
 * createHash / createHmac / randomBytes，本实现用仓库既有依赖 crypto-js 的
 * SHA256 / HmacSHA256（hex 输出与服务端 digest('hex') 逐字一致）与
 * Web Crypto 的 getRandomValues（WebView 与 Node 均内置）。
 * 上游请求经 http 封装层发起（语义为 validateStatus 恒真，状态码由调用方判读）。
 */
import CryptoJS from 'crypto-js'
import { unblockRequest } from './http'

/** 网关 App ID 常量 */
const APP_ID = 'qingmusic-android'

/** 网关版本号常量 */
const APP_VERSION = '1.4.0'

/** 网关签名密钥常量 */
const SIGN_SECRET = 'qm-gw-7c1f4e9a2b8d5360e1a7c4f9b2d8036c'

/** 上游网关主机 */
const PRIMARY_HOST = 'https://musicserver.haitangw.cc'

/** 票据换取端点路径 */
const TICKET_PATH = '/v1/gateway/ticket'

/** 单次换票请求超时时间（毫秒） */
const TICKET_TIMEOUT_MS = 8000

/** 票据提前刷新窗口（毫秒）：到期前 10 分钟自动换票 */
const REFRESH_AHEAD_MS = 10 * 60 * 1000

/** 默认票据有效时长（秒）：12 小时 */
const DEFAULT_TTL_SECONDS = 43200

/**
 * 生成指定字节数的随机十六进制串
 *
 * 与服务端 crypto.randomBytes(n).toString('hex') 同形态（小写 hex）。
 * @param byteLength 字节数
 * @returns 2*byteLength 长度的小写十六进制串
 */
const randomHex = (byteLength: number): string => {
  const bytes = new Uint8Array(byteLength)
  globalThis.crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** 进程内固定的设备标识 */
const DEVICE_ID = `qingmusic-android-${randomHex(16)}`

/** 内存中的票据缓存 */
interface TicketCache {
  ticket: string
  expiresAt: number
}

let ticketCache: TicketCache | null = null
let pendingTicketPromise: Promise<string> | null = null

/**
 * 提取用于签名计算的请求路径（去除协议、域名、hash 与 query）
 * @param pathOrUrl 请求路径或完整 URL
 * @returns 规整后的路径
 */
function extractSignaturePath(pathOrUrl: string): string {
  let p = String(pathOrUrl || '')
  const protoIdx = p.indexOf('://')
  if (protoIdx !== -1) {
    p = p.slice(protoIdx + 3)
    const slashIdx = p.indexOf('/')
    if (slashIdx === -1) return '/'
    p = p.slice(slashIdx)
  }
  const hashIdx = p.indexOf('#')
  if (hashIdx !== -1) p = p.slice(0, hashIdx)
  const queryIdx = p.indexOf('?')
  if (queryIdx !== -1) p = p.slice(0, queryIdx)
  if (!p.startsWith('/')) p = `/${p}`
  return p
}

/**
 * 构建网关基础签名请求头
 * @param method HTTP 请求方法
 * @param path 请求路径
 * @param body 请求体字符串
 * @returns 签名请求头键值对
 */
function buildSignatureHeaders(
  method: string,
  path: string,
  body: string,
): Record<string, string> {
  const ts = Date.now().toString()
  const nonce = randomHex(16)
  const signaturePath = extractSignaturePath(path)
  const bodySha256 = CryptoJS.SHA256(body || '').toString(CryptoJS.enc.Hex)

  const stringToSign = [
    APP_ID,
    ts,
    nonce,
    method.toUpperCase(),
    signaturePath,
    bodySha256,
  ].join('\n')

  const signature = CryptoJS.HmacSHA256(stringToSign, SIGN_SECRET).toString(CryptoJS.enc.Hex)

  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'X-Qing-App-Id': APP_ID,
    'X-Qing-App-Version': APP_VERSION,
    'X-Qing-Device-Id': DEVICE_ID,
    'X-Qing-Ts': ts,
    'X-Qing-Nonce': nonce,
    'X-Qing-Sign': signature,
  }
}

/**
 * 向上游网关申请新的 Gateway Ticket
 * @returns 新签发的 Ticket 字符串
 */
async function requestTicket(): Promise<string> {
  const now = Date.now()
  const bodyObj = {
    deviceId: DEVICE_ID,
    appVersion: APP_VERSION,
    platform: 'android',
  }
  const bodyStr = JSON.stringify(bodyObj)
  const headers = buildSignatureHeaders('POST', TICKET_PATH, bodyStr)

  const response = await unblockRequest({
    url: `${PRIMARY_HOST}${TICKET_PATH}`,
    method: 'POST',
    headers,
    data: bodyStr,
    timeout: TICKET_TIMEOUT_MS,
  })

  if (response.status !== 200 && response.status !== 201) {
    throw new Error(`Ticket 请求返回 HTTP ${response.status}`)
  }

  const data = (response.data instanceof Uint8Array ? {} : response.data || {}) as {
    ticket?: string
    expiresAt?: number | string
    ttlSeconds?: number
    graceSeconds?: number
  }

  if (!data.ticket || typeof data.ticket !== 'string') {
    throw new Error('Ticket 响应缺少合法 ticket 字段')
  }

  const exp = Number(data.expiresAt)
  let expiresAtMs: number
  if (!exp || Number.isNaN(exp)) {
    const ttlSec = Number(data.ttlSeconds) || DEFAULT_TTL_SECONDS
    expiresAtMs = now + ttlSec * 1000
  } else if (exp < 1e11) {
    expiresAtMs = exp * 1000
  } else {
    expiresAtMs = exp
  }

  ticketCache = {
    ticket: data.ticket,
    expiresAt: expiresAtMs,
  }

  return data.ticket
}

/**
 * 确保获取有效的网关 Ticket（支持内存缓存与到期前刷新）
 * @returns 有效的 Ticket 字符串
 */
async function ensureTicket(): Promise<string> {
  const now = Date.now()
  if (ticketCache && ticketCache.expiresAt - now > REFRESH_AHEAD_MS) {
    return ticketCache.ticket
  }

  if (pendingTicketPromise) {
    return pendingTicketPromise
  }

  pendingTicketPromise = requestTicket().finally(() => {
    pendingTicketPromise = null
  })

  return pendingTicketPromise
}

/**
 * 获取青听网关完整的鉴权请求头（签名头 + Authorization Bearer）
 * @param method HTTP 请求方法（例如 POST）
 * @param path 请求路径（例如 /v1/music/resolve-url）
 * @param body 请求体字符串
 * @returns 完整的请求头字典
 */
export async function getQingGatewayHeaders(
  method: string,
  path: string,
  body: string,
): Promise<Record<string, string>> {
  const ticket = await ensureTicket()
  const headers = buildSignatureHeaders(method, path, body)
  headers.Authorization = `Bearer ${ticket}`
  return headers
}

/**
 * 作废当前缓存的网关 Ticket，下次请求将强制重新拉取
 */
export function invalidateQingTicket(): void {
  ticketCache = null
  pendingTicketPromise = null
}
