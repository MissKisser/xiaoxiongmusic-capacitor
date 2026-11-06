/**
 * 咪咕换源单测 (unblock/migu.ts)
 *
 * 上游打桩打在本地 http 封装层的传输底座（globalThis.fetch，node 测试环境走
 * http.ts 的 fetch 路径），不连真实上游。覆盖五块判据：
 * 1. 缺歌名 / 缺歌手：直接 404，零上游请求；
 * 2. 完整成功路径：检索响应带混淆层（魔数 + 种子 + 固定密钥）逐字节还原、
 *    取链响应为明文 JSON（无魔数直通）、HEAD 体积校验通过；
 * 3. 取链业务码 440000：逐曲拒绝不计入熔断，重复换源仍发起请求；
 * 4. 检索业务码 440047（上游责任业务码）：整轮检索失败计入熔断；
 * 5. 检索整轮 HTTP 5xx：连续到阈值即熔断，熔断期内零上游请求。
 */

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import getMiguSongUrl from '../src/utils/unblock/migu'
import { CircuitBreaker } from '../src/utils/unblock/resilience'
import {
  FETCH_FAILED_REASON,
  MISSING_ARTIST_REASON,
  MISSING_TITLE_REASON,
  UPSTREAM_UNAVAILABLE_REASON,
} from '../src/utils/unblock/match'

/** 咪咕检索端点（与服务端一致的地址形态，桩按前缀分发） */
const MIGU_SEARCH_URL = 'https://c.musicapp.migu.cn/v1.0/content/search_all.do'

/** 咪咕取链端点 */
const MIGU_LISTEN_URL = 'https://c.musicapp.migu.cn/strategy/listen-url/h5/v2.4'

/** 咪咕响应混淆的固定密钥（与服务端模块一致的协议常量） */
const MIGU_KEY = 'Jk8qzuePiJ1qE3mDYhLQ3T73DtDoAhLP'

/**
 * 构造咪咕混淆响应体（与被测还原算法互逆）
 * @param json 明文 JSON 文本
 * @returns 带魔数与种节的混淆字节
 */
const encodeMiguResponse = (json: string): Uint8Array => {
  const seed = 7
  const plain = new TextEncoder().encode(json)
  const data = new Uint8Array(4 + plain.length)
  data.set([0xab, 0xcd, 0x01, seed], 0)
  for (let i = 0; i < plain.length; i += 1) {
    data[4 + i] = (plain[i] - seed + MIGU_KEY.charCodeAt(i % MIGU_KEY.length)) & 0xff
  }
  return data
}

/**
 * 构造 fetch 桩响应
 * @param init 响应要素（状态码 / 响应头 / 文本或字节体）
 * @returns 形如 Response 的桩对象
 */
const buildResponse = (init: {
  status?: number
  headers?: Record<string, string>
  text?: string
  bytes?: Uint8Array
}): Response => {
  const status = init.status ?? 200
  const bodyText = init.text ?? ''
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers(init.headers ?? {}),
    url: 'https://stub.local/',
    body: undefined,
    text: async () => bodyText,
    arrayBuffer: async () =>
      init.bytes ? (init.bytes.slice().buffer as ArrayBuffer) : new TextEncoder().encode(bodyText).buffer,
  } as unknown as Response
}

/** 桩配置：检索响应（按关键词返回混淆或明文字节）、取链响应与直链体积 */
interface StubConfig {
  /** 检索响应构造器（返回 null 表示 HTTP 500） */
  search: () => { status: number; bytes?: Uint8Array } | null
  /** 取链响应构造器 */
  listen: () => { status: number; bytes?: Uint8Array }
  /** 直链 HEAD 体积探测返回的 content-length */
  audioLength: number
}

/** 打桩期间记录到的请求 */
let requests: { url: string; method: string }[] = []

/** 原始 fetch 引用 */
const originalFetch = globalThis.fetch

/**
 * 安装 fetch 桩：按地址前缀分发到检索 / 取链 / 直链体积探测
 * @param config 桩配置
 */
const installStub = (config: StubConfig): void => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    requests.push({ url, method })
    if (url.startsWith(MIGU_SEARCH_URL)) {
      const outcome = config.search()
      if (!outcome) return buildResponse({ status: 500 })
      return buildResponse({ status: outcome.status, bytes: outcome.bytes })
    }
    if (url.startsWith(MIGU_LISTEN_URL)) {
      const outcome = config.listen()
      return buildResponse({ status: outcome.status, bytes: outcome.bytes })
    }
    return buildResponse({
      status: 200,
      headers: { 'content-length': String(config.audioLength) },
      text: '',
    })
  }) as typeof globalThis.fetch
}

/**
 * 构造一条能通过三重校验的咪咕检索响应（混淆体）
 * @param title 歌名
 * @param artist 歌手
 * @param durationSec 时长（秒）
 * @returns 混淆响应字节
 */
const buildSearchPayload = (title: string, artist: string, durationSec: number): Uint8Array => {
  const pqSize = (durationSec * 128 * 1000) / 8 // 128kbps 换算的字节数（字节/秒 = 码率 ÷ 8）
  return encodeMiguResponse(
    JSON.stringify({
      code: '000000',
      songResultData: {
        result: [
          {
            contentId: '69905301122',
            copyrightId: '1000',
            name: title,
            singers: [{ name: artist }],
            rateFormats: [{ formatType: 'PQ', resourceType: 'PQ', size: pqSize }],
          },
        ],
      },
    }),
  )
}

/**
 * 构造明文 JSON 取链响应（无魔数，验证还原层对明文直通）
 * @param url 直链
 * @param durationSec 权威时长（秒）
 * @returns 明文字节
 */
const buildListenPayload = (url: string, durationSec: number): Uint8Array =>
  new TextEncoder().encode(
    JSON.stringify({ code: '000000', data: { url, song: { duration: durationSec } } }),
  )

/** 注入用熔断器工厂：阈值 3、熔断 10 分钟 */
const freshBreaker = (): CircuitBreaker =>
  new CircuitBreaker({ name: '咪咕(测试)', failureThreshold: 3, openDurationMs: 10 * 60 * 1000 })

describe('咪咕换源 migu', () => {
  beforeEach(() => {
    requests = []
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('缺少歌名时直接失败，且不请求上游', async () => {
    installStub({
      search: () => ({ status: 200, bytes: buildSearchPayload('晴天', '周杰伦', 192) }),
      listen: () => ({ status: 200, bytes: buildListenPayload('https://freetyst.nf.migu.cn/a.mp3', 192) }),
      audioLength: 3072000,
    })
    const result = await getMiguSongUrl({ title: '', artist: '周杰伦', duration: 192 }, freshBreaker())
    assert.equal(result.code, 404)
    assert.equal(result.url, null)
    assert.equal(result.reason, MISSING_TITLE_REASON)
    assert.equal(requests.length, 0)
  })

  it('缺少歌手时直接失败，且不请求上游', async () => {
    installStub({
      search: () => ({ status: 200, bytes: buildSearchPayload('晴天', '周杰伦', 192) }),
      listen: () => ({ status: 200, bytes: buildListenPayload('https://freetyst.nf.migu.cn/a.mp3', 192) }),
      audioLength: 3072000,
    })
    const result = await getMiguSongUrl({ title: '晴天', artist: '  ', duration: 192 }, freshBreaker())
    assert.equal(result.code, 404)
    assert.equal(result.url, null)
    assert.equal(result.reason, MISSING_ARTIST_REASON)
    assert.equal(requests.length, 0)
  })

  it('检索混淆响应逐字节还原，取链成功并通过体积校验', async () => {
    const directUrl = 'https://freetyst.nf.migu.cn/public/product01/2026/abc/320.mp3'
    installStub({
      search: () => ({ status: 200, bytes: buildSearchPayload('晴天', '周杰伦', 192) }),
      listen: () => ({ status: 200, bytes: buildListenPayload(directUrl, 192) }),
      audioLength: 3072000,
    })
    const result = await getMiguSongUrl(
      { title: '晴天', artist: '周杰伦', duration: 192 },
      freshBreaker(),
    )
    assert.equal(result.code, 200)
    assert.equal(result.url, directUrl)
    assert.equal(result.lengthVerified, true)
    // 两组关键词（歌名-歌手 / 歌名 歌手）都发起检索，取链带 PQ 档位，直链做 HEAD 体积探测
    const searchCalls = requests.filter((item) => item.url.startsWith(MIGU_SEARCH_URL))
    assert.equal(searchCalls.length, 2)
    assert.ok(
      searchCalls.some((item) => new URL(item.url).searchParams.get('text') === '晴天-周杰伦'),
    )
    assert.ok(
      searchCalls.some((item) => new URL(item.url).searchParams.get('text') === '晴天 周杰伦'),
    )
    const listenCall = requests.find((item) => item.url.startsWith(MIGU_LISTEN_URL))
    assert.ok(listenCall)
    assert.equal(new URL(listenCall.url).searchParams.get('toneFlag'), 'PQ')
    const headCall = requests.find((item) => item.method === 'HEAD')
    assert.ok(headCall?.url.startsWith('https://freetyst.nf.migu.cn/'))
  })

  it('取链业务码 440000 属逐曲拒绝，不计入熔断，重复换源仍发起请求', async () => {
    installStub({
      search: () => ({ status: 200, bytes: buildSearchPayload('夜曲', '周杰伦', 226) }),
      listen: () => ({
        status: 200,
        bytes: new TextEncoder().encode(JSON.stringify({ code: '440000', info: '无版权' })),
      }),
      audioLength: 0,
    })
    const breaker = freshBreaker()
    const first = await getMiguSongUrl({ title: '夜曲', artist: '周杰伦', duration: 226 }, breaker)
    assert.equal(first.code, 404)
    assert.equal(first.url, null)
    assert.equal(first.reason, FETCH_FAILED_REASON)
    assert.equal(breaker.currentState, 'closed')
    const callsAfterFirst = requests.length
    const second = await getMiguSongUrl({ title: '夜曲', artist: '周杰伦', duration: 226 }, breaker)
    assert.equal(second.reason, FETCH_FAILED_REASON)
    assert.equal(breaker.currentState, 'closed')
    // 第二次换源检索命中缓存，但取链仍要发起（未熔断）
    assert.ok(requests.length > callsAfterFirst)
    assert.ok(requests.some((item) => item.url.startsWith(MIGU_LISTEN_URL)))
  })

  it('检索整轮返回上游责任业务码时计入熔断，连续到阈值即跳过换源', async () => {
    installStub({
      search: () => ({
        status: 200,
        bytes: new TextEncoder().encode(JSON.stringify({ code: '440047', msg: 'server busy' })),
      }),
      listen: () => ({ status: 200, bytes: buildListenPayload('https://freetyst.nf.migu.cn/a.mp3', 192) }),
      audioLength: 3072000,
    })
    const breaker = freshBreaker()
    for (let round = 1; round <= 3; round += 1) {
      const result = await getMiguSongUrl({ title: '稻香', artist: '周杰伦', duration: 223 }, breaker)
      assert.equal(result.reason, UPSTREAM_UNAVAILABLE_REASON, `第 ${round} 轮应判源不可用`)
    }
    assert.equal(breaker.currentState, 'open')
    const callsBeforeSkip = requests.length
    const skipped = await getMiguSongUrl({ title: '稻香', artist: '周杰伦', duration: 223 }, breaker)
    assert.equal(skipped.code, 404)
    assert.equal(skipped.url, null)
    assert.equal(skipped.reason, UPSTREAM_UNAVAILABLE_REASON)
    assert.equal(requests.length, callsBeforeSkip)
  })

  it('检索整轮 HTTP 5xx 计入熔断，熔断期内零上游请求', async () => {
    installStub({
      search: () => null,
      listen: () => ({ status: 200, bytes: buildListenPayload('https://freetyst.nf.migu.cn/a.mp3', 192) }),
      audioLength: 3072000,
    })
    const breaker = freshBreaker()
    for (let round = 1; round <= 3; round += 1) {
      const result = await getMiguSongUrl({ title: '七里香', artist: '周杰伦', duration: 299 }, breaker)
      assert.equal(result.reason, UPSTREAM_UNAVAILABLE_REASON, `第 ${round} 轮应判源不可用`)
    }
    assert.equal(breaker.currentState, 'open')
    const callsBeforeSkip = requests.length
    const skipped = await getMiguSongUrl({ title: '七里香', artist: '周杰伦', duration: 299 }, breaker)
    assert.equal(skipped.reason, UPSTREAM_UNAVAILABLE_REASON)
    assert.equal(requests.length, callsBeforeSkip)
  })
})
