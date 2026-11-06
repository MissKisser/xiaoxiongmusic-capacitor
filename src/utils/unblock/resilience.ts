/**
 * 换源链运行时健壮性原语
 *
 * 换源链面对三类上游不稳定：
 * 1. 整站故障 —— 上游整站不可用时（持续返回 5xx），成功贡献为 0，每次还要白等到超时；
 * 2. 检索限流 —— 高频检索会被上游拒绝；
 * 3. 取链瞬时故障 —— 偶发 5xx，重试即可救回。
 *
 * 三者都需要「感知失败 → 降级 → 自愈」的闭环，本模块把这三种能力收敛为一组
 * 无外部依赖的内存态原语：
 * - `CircuitBreaker`：连续失败熔断，熔断期满进入半开状态放一次探测；
 * - `TTLCache`：短时效结果缓存，避免对同一目标重复打上游；
 * - `sleep` / `isUpstreamFault` / `extractBusinessError`：退避等待与上游故障判定。
 *
 * 故障判定除了传输层错误，还覆盖「HTTP 200 + 业务错误 JSON」这一形态：
 * 上游用成功状态码裹着失败结论，不单独识别就会被当成健康源，熔断永不触发。
 *
 * 所有状态都是纯内存态：进程重启即重置，不落盘、不产生界面提示，只写日志。
 */

/** 熔断器状态 */
export type CircuitState = 'closed' | 'open' | 'half-open'

/** 熔断器构造参数 */
export type CircuitBreakerOptions = {
  /** 熔断器名称，用于日志描述 */
  name: string
  /** 连续失败达到该次数后熔断 */
  failureThreshold: number
  /** 熔断持续时长（毫秒），期满后进入半开状态 */
  openDurationMs: number
  /** 状态变化回调 */
  onStateChange?: (message: string) => void
}

/**
 * 电路断路器
 *
 * 状态机：
 * - closed：正常放行，连续失败次数累计到阈值后转入 open；
 * - open：直接拒绝请求（不发起上游调用），持续到熔断期满；
 * - half-open：放行一次探测请求，成功则回到 closed，失败则重新进入 open。
 *
 * 半开状态下同一时刻只允许一个探测请求在途，避免并发探测把刚恢复的上游再次打挂。
 */
export class CircuitBreaker {
  /** 当前状态 */
  private state: CircuitState = 'closed'
  /** 连续失败次数 */
  private consecutiveFailures = 0
  /** 进入熔断的时刻 */
  private openedAt = 0
  /** 半开状态下是否有探测请求在途 */
  private probeInFlight = false

  constructor(private readonly options: CircuitBreakerOptions) {}

  /**
   * 当前熔断状态
   * @returns 熔断状态
   */
  get currentState(): CircuitState {
    return this.state
  }

  /**
   * 熔断剩余时长
   * @returns 剩余毫秒数；未处于熔断状态时为 0
   */
  remainingOpenMs(): number {
    if (this.state !== 'open') return 0
    return Math.max(0, this.options.openDurationMs - (Date.now() - this.openedAt))
  }

  /**
   * 是否放行本次请求
   *
   * 熔断状态返回 false（调用方应直接跳过，不发起上游请求）；
   * 熔断期满时转入半开并放行一次探测请求。
   * @returns 是否放行
   */
  canRequest(): boolean {
    if (this.state === 'open') {
      if (Date.now() - this.openedAt < this.options.openDurationMs) return false
      this.state = 'half-open'
      this.probeInFlight = false
      this.options.onStateChange?.(
        `${this.options.name} 熔断期满，转入半开状态，放行一次探测请求`,
      )
    }
    if (this.state === 'half-open') {
      if (this.probeInFlight) return false
      this.probeInFlight = true
      return true
    }
    return true
  }

  /**
   * 记录一次成功
   *
   * 成功即清零连续失败计数；半开状态下的成功视为上游已恢复，直接解除熔断。
   */
  recordSuccess(): void {
    this.probeInFlight = false
    this.consecutiveFailures = 0
    if (this.state !== 'closed') {
      this.state = 'closed'
      this.options.onStateChange?.(`${this.options.name} 探测成功，熔断解除`)
    }
  }

  /**
   * 记录一次失败
   *
   * 半开状态下的失败视为上游仍未恢复，重新熔断一个完整周期；
   * 闭合状态下累计到阈值时熔断。
   */
  recordFailure(): void {
    this.probeInFlight = false
    if (this.state === 'open') return
    this.consecutiveFailures += 1
    if (this.state === 'half-open') {
      this.open()
      this.options.onStateChange?.(`${this.options.name} 探测失败，继续熔断`)
      return
    }
    if (this.consecutiveFailures >= this.options.failureThreshold) {
      this.open()
      this.options.onStateChange?.(
        `${this.options.name} 连续 ${this.consecutiveFailures} 次失败，熔断 ${Math.round(
          this.options.openDurationMs / 1000,
        )} 秒`,
      )
    }
  }

  /**
   * 进入熔断状态
   */
  private open(): void {
    this.state = 'open'
    this.openedAt = Date.now()
  }
}

/**
 * 短时效内存缓存
 *
 * 只缓存「可复用且短时有效」的上游结果（检索候选池、关键词检索结果），
 * 命中即跳过对同一目标的上游调用。纯内存态，进程重启即失效。
 */
export class TTLCache<T> {
  /** 缓存条目 */
  private readonly store = new Map<string, { value: T; expiresAt: number }>()

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 64,
  ) {}

  /**
   * 读取缓存条目
   * @param key 缓存键
   * @returns 命中时返回缓存值；未命中或已过期返回 undefined
   */
  get(key: string): T | undefined {
    const entry = this.store.get(key)
    if (!entry) return undefined
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key)
      return undefined
    }
    return entry.value
  }

  /**
   * 写入缓存条目
   *
   * 条目数超过上限时淘汰最早过期的一条，避免长期运行后内存无界增长。
   * @param key 缓存键
   * @param value 缓存值
   */
  set(key: string, value: T): void {
    if (this.store.size >= this.maxEntries) {
      let oldestKey: string | undefined
      let oldestExpire = Infinity
      for (const [itemKey, entry] of this.store) {
        if (entry.expiresAt < oldestExpire) {
          oldestExpire = entry.expiresAt
          oldestKey = itemKey
        }
      }
      if (oldestKey !== undefined) this.store.delete(oldestKey)
    }
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs })
  }

  /**
   * 清空缓存
   */
  clear(): void {
    this.store.clear()
  }
}

/**
 * 等待指定毫秒
 * @param ms 等待毫秒数
 * @returns 等待结束后的 Promise
 */
export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 从异常对象中提取上游 HTTP 状态码
 *
 * 兼容 axios 异常（`error.response.status`）与其它客户端的拒绝对象（`error.status`）。
 * @param error 异常对象
 * @returns HTTP 状态码；无法识别时返回 0
 */
export const extractHttpStatus = (error: unknown): number => {
  const payload = error as { response?: { status?: number }; status?: number; code?: unknown }
  const raw = payload?.response?.status ?? payload?.status ?? payload?.code
  const status = Number(raw)
  return Number.isFinite(status) && status > 0 ? status : 0
}

/** 上游业务错误载荷：上游在 HTTP 200 的响应体里给出的业务失败结构 */
export type BusinessError = {
  /** 上游给出的业务错误码 */
  code: number
  /** 上游给出的错误描述 */
  message: string
}

/** 视为成功的业务码：上游的成功约定不统一，这两者都表示成功 */
const SUCCESS_BUSINESS_CODES = new Set([0, 200])

/**
 * 把响应体解析成对象
 * @param payload 响应体（对象或 JSON 文本）
 * @returns 解析后的对象；不是可解析的 JSON 对象时返回 null
 */
const parseJsonPayload = (payload: unknown): Record<string, unknown> | null => {
  if (payload && typeof payload === 'object') return payload as Record<string, unknown>
  if (typeof payload !== 'string') return null
  const text = payload.trim()
  if (!text.startsWith('{')) return null
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/**
 * 解析上游响应体里的业务错误
 *
 * 部分上游在 HTTP 200 的响应体里给出业务失败（社区公益聚合站的取链端点失效时
 * 就会返回 `{"code":201,"msg":"error"}`），这类响应在传输层与成功完全一致。
 * 不单独识别出来，它会被当成「上游健康」计入熔断的成功计数：
 * 源已经整体失效，熔断却永远不会触发。
 * @param payload 响应体（对象或 JSON 文本）
 * @returns 业务错误信息；不是业务错误时返回 null
 */
export const extractBusinessError = (payload: unknown): BusinessError | null => {
  const body = parseJsonPayload(payload)
  if (!body) return null
  const raw = body.code
  const code = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(code) || SUCCESS_BUSINESS_CODES.has(code)) return null
  const detail = body.msg ?? body.message ?? body.error ?? ''
  return { code, message: String(detail) }
}

/**
 * 上游业务错误异常
 *
 * 用于把「HTTP 200 + 业务错误 JSON」显式抛成异常，
 * 让调用方按上游故障处理（计入熔断失败，而不是记成一次成功）。
 */
export class UpstreamBusinessError extends Error {
  /** 上游给出的业务错误码 */
  readonly businessCode: number
  /** 上游给出的错误描述 */
  readonly businessMessage: string

  constructor(error: BusinessError) {
    super(`上游业务错误 code=${error.code}${error.message ? `（${error.message}）` : ''}`)
    this.name = 'UpstreamBusinessError'
    this.businessCode = error.code
    this.businessMessage = error.message
  }
}

/**
 * 判断业务错误是否属于「上游源故障」
 *
 * 口径：
 * - 2xx / 5xx 语义的业务码（如 201、500）：上游没能给出可用资源，计入源故障；
 * - 4xx 语义的业务码（如 401「无此音质档位」）：请求本身不合法，属请求侧拒绝，
 *   不计入源故障 —— 否则一次参数错误就会把整条源熔断掉。
 * @param business 业务错误；为 null 时返回 false
 * @returns 是否为上游源故障
 */
export const isBusinessFault = (business: BusinessError | null): boolean => {
  if (!business) return false
  return !/^4\d\d$/.test(String(business.code))
}

/**
 * 判断异常是否属于「上游源故障」
 *
 * 判定口径：5xx（含 520 / 503）、连接失败、超时、DNS 失败等；
 * 4xx 属请求侧问题，不计入源故障（否则会把参数错误误判成源挂了）。
 * 上游以 HTTP 200 返回业务错误 JSON 的情况同样计入源故障。
 * @param error 异常对象
 * @returns 是否为上游源故障
 */
export const isUpstreamFault = (error: unknown): boolean => {
  if (error instanceof UpstreamBusinessError) return true
  const status = extractHttpStatus(error)
  if (status > 0) return status >= 500
  const payload = error as { code?: unknown; message?: unknown }
  const code = String(payload?.code ?? '')
  if (
    ['ECONNABORTED', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'ENOTFOUND'].includes(
      code,
    )
  ) {
    return true
  }
  const message = String(payload?.message ?? '')
  return /timeout|超时|socket hang up|network error/i.test(message)
}
