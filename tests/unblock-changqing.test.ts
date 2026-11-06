/**
 * 长青换源单测 (unblock/changqing.ts)
 *
 * 上游打桩打在本地 http 封装层的传输底座（globalThis.fetch，node 测试环境走
 * http.ts 的 fetch 路径），不连真实上游。覆盖四块判据：
 * 1. QQ 平台自带 mid 直查：零检索，直接探测取链；
 * 2. 非 QQ 平台：走 QQ 音乐公开检索换 mid，首个检索词换到候选即停；
 * 3. 真实音频时长闸门：公益站返回另一版本时按实测时长拒绝交付；
 * 4. 失败取证响应地址偏离请求地址（发生过跳转）：按非业务错误处理，不计入熔断；
 * 5. 取链命中「HTTP 200 + 业务错误 JSON」：按上游故障计入熔断，连续到阈值即熔断。
 */

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import getChangqingSongUrl from '../src/utils/unblock/changqing'
import {
  FETCH_FAILED_REASON,
  MISSING_ARTIST_REASON,
  MISSING_TITLE_REASON,
  UPSTREAM_UNAVAILABLE_REASON,
} from '../src/utils/unblock/match'

/** QQ 音乐检索接口入口 */
const QM_API_URL = 'https://u.y.qq.com/cgi-bin/musicu.fcg'

/** 长青取链主机 */
const CHANNEL_HOST = 'https://musicapi.haitangw.net/music/qq_kw.php'

/** MPEG1 Layer3 128kbps 帧头（bitrateIndex 9、采样率 44100） */
const MP3_HEADER_128K = Uint8Array.from([0xff, 0xfb, 0x94, 0x00])

/**
 * 构造 128kbps MP3 的体积与时长（字节/秒 = 码率 ÷ 8）
 * @param durationSec 时长（秒）
 * @returns 总字节数
 */
const mp3Bytes = (durationSec: number): number => (durationSec * 128 * 1000) / 8

/**
 * 构造 fetch 桩响应
 * @param init 响应要素（状态码 / 响应头 / 文本或字节体 / 最终地址）
 * @returns 形如 Response 的桩对象
 */
const buildResponse = (init: {
  status?: number
  headers?: Record<string, string>
  text?: string
  bytes?: Uint8Array
  url?: string
}): Response => {
  const status = init.status ?? 200
  const bodyText = init.text ?? ''
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers(init.headers ?? {}),
    url: init.url ?? 'https://stub.local/',
    body: undefined,
    text: async () => bodyText,
    arrayBuffer: async () =>
      init.bytes ? (init.bytes.slice().buffer as ArrayBuffer) : new TextEncoder().encode(bodyText).buffer,
  } as unknown as Response
}

/** QQ 检索响应构造器入参 */
interface QqSearchSong {
  mid: string
  title: string
  singer: string
  interval: number
}

/**
 * 构造 QQ 检索接口的成功响应体
 * @param songs 候选条目
 * @returns JSON 文本
 */
const buildQqSearchBody = (songs: QqSearchSong[]): string =>
  JSON.stringify({
    code: 0,
    request: {
      code: 0,
      data: { body: { item_song: songs.map((song) => ({ ...song, singer: [{ name: song.singer }] })) } },
    },
  })

/** 桩配置 */
interface StubConfig {
  /** QQ 检索响应（null 表示抛网络异常） */
  qqSearch: () => { status: number; body: string } | null
  /** 长青取链探测响应 */
  channel: (url: string) => {
    status: number
    headers?: Record<string, string>
    body: string
    bytes?: Uint8Array
    /** 最终响应地址（缺省回显请求地址，模拟未发生跳转） */
    finalUrl?: string
  }
}

/** 打桩期间记录到的请求 */
let requests: { url: string; method: string; body?: string }[] = []

/** 原始 fetch 引用 */
const originalFetch = globalThis.fetch

/**
 * 安装 fetch 桩：QQ 检索走 POST musicu.fcg，长青取链走 GET qq_kw.php
 * @param config 桩配置
 */
const installStub = (config: StubConfig): void => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = typeof init?.body === 'string' ? init.body : undefined
    requests.push({ url, method, body })
    if (url.startsWith(QM_API_URL)) {
      const outcome = config.qqSearch()
      if (!outcome) throw new Error('network down')
      return buildResponse({ status: outcome.status, text: outcome.body })
    }
    if (url.startsWith(CHANNEL_HOST)) {
      const outcome = config.channel(url)
      return buildResponse({
        status: outcome.status,
        headers: outcome.headers,
        text: outcome.body,
        bytes: outcome.bytes,
        url: outcome.finalUrl ?? url,
      })
    }
    return buildResponse({ status: 404, text: '' })
  }) as typeof globalThis.fetch
}

/**
 * 构造音频直链探测响应（206 + MP3 帧头）
 * @param durationSec 实测时长（秒）
 * @returns 探测响应要素
 */
const audioProbeResponse = (durationSec: number) => {
  const total = Math.round(mp3Bytes(durationSec))
  return {
    status: 206,
    headers: { 'content-range': `bytes 0-3/${total}` },
    body: '',
    bytes: MP3_HEADER_128K,
  }
}

describe('长青换源 changqing', () => {
  beforeEach(() => {
    requests = []
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('缺少歌名或歌手时直接失败，且不请求上游', async () => {
    installStub({ qqSearch: () => ({ status: 200, body: buildQqSearchBody([]) }), channel: () => audioProbeResponse(192) })
    const noTitle = await getChangqingSongUrl({ title: '', artist: '周杰伦', duration: 192 })
    assert.equal(noTitle.code, 404)
    assert.equal(noTitle.reason, MISSING_TITLE_REASON)
    const noArtist = await getChangqingSongUrl({ title: '晴天', artist: ' ', duration: 192 })
    assert.equal(noArtist.code, 404)
    assert.equal(noArtist.reason, MISSING_ARTIST_REASON)
    assert.equal(requests.length, 0)
  })

  it('QQ 平台自带 mid 直查：零检索，探测通过后交付直链', async () => {
    installStub({ qqSearch: () => ({ status: 200, body: buildQqSearchBody([]) }), channel: () => audioProbeResponse(192) })
    const result = await getChangqingSongUrl(
      { title: '晴天', artist: '周杰伦', duration: 192 },
      { platform: 'qqmusic', platformId: '002MXZNu1GToOk' },
    )
    assert.equal(result.code, 200)
    assert.ok(result.url?.startsWith(`${CHANNEL_HOST}?`))
    assert.equal(result.lengthVerified, true)
    const fetchUrl = new URL(result.url ?? '')
    assert.equal(fetchUrl.searchParams.get('type'), 'mp3')
    assert.equal(fetchUrl.searchParams.get('id'), '002MXZNu1GToOk')
    assert.equal(fetchUrl.searchParams.get('level'), 'standard')
    // 直查路径不应触发 QQ 检索
    assert.equal(requests.some((item) => item.url.startsWith(QM_API_URL)), false)
  })

  it('非 QQ 平台走 QQ 检索换 mid，首个检索词换到候选即停', async () => {
    installStub({
      qqSearch: () => ({
        status: 200,
        body: buildQqSearchBody([{ mid: '0039MnYb0qxYhV', title: '晴天', singer: '周杰伦', interval: 192 }]),
      }),
      channel: () => audioProbeResponse(192),
    })
    const result = await getChangqingSongUrl(
      { title: '晴天', artist: '周杰伦', duration: 192 },
      { platform: 'netease', platformId: '5257160' },
    )
    assert.equal(result.code, 200)
    assert.ok(result.url?.includes('id=0039MnYb0qxYhV'))
    const searchCalls = requests.filter((item) => item.url.startsWith(QM_API_URL))
    assert.equal(searchCalls.length, 1)
    const param = JSON.parse(searchCalls[0].body ?? '{}')
    assert.equal(param.request.module, 'music.search.SearchCgiService')
    assert.equal(param.request.method, 'DoSearchForQQMusicMobile')
    assert.equal(param.request.param.query, '晴天 周杰伦')
    assert.equal(param.request.param.num_per_page, 20)
  })

  it('实测时长偏离请求时长超容差时拒绝交付', async () => {
    installStub({ qqSearch: () => ({ status: 200, body: buildQqSearchBody([]) }), channel: () => audioProbeResponse(100) })
    const result = await getChangqingSongUrl(
      { title: '晴天', artist: '周杰伦', duration: 192 },
      { platform: 'qqmusic', platformId: '002MXZNu1GToOk' },
    )
    assert.equal(result.code, 404)
    assert.equal(result.url, null)
    assert.equal(result.reason, FETCH_FAILED_REASON)
  })

  it('取证响应地址偏离请求地址（发生过跳转）按非业务错误处理，不计入熔断', async () => {
    const errorBody = JSON.stringify({ code: 201, msg: 'error' })
    installStub({
      qqSearch: () => ({ status: 200, body: buildQqSearchBody([]) }),
      // 跳转后的落地页也带着业务错误 JSON，但最终地址已偏离请求地址，
      // 等义于服务端 maxRedirects 0 下拿到 30x：属单曲问题，不触发熔断
      channel: (url) => ({
        status: 200,
        headers: { 'content-length': String(errorBody.length) },
        body: errorBody,
        finalUrl: `${url}&landing=redirected`,
      }),
    })
    for (let round = 1; round <= 4; round += 1) {
      const result = await getChangqingSongUrl(
        { title: '枫', artist: '周杰伦', duration: 259 },
        { platform: 'qqmusic', platformId: '003Nz2So3XXYek' },
      )
      assert.equal(result.reason, FETCH_FAILED_REASON, `第 ${round} 轮应判取链失败而非源熔断`)
    }
    // 四轮取链始终发起探测与取证请求：跳转形态不计入熔断，熔断器从未打开
    assert.ok(requests.length >= 4 * 2 * 2, `跳转形态不应触发熔断，实际请求数: ${requests.length}`)
  })

  it('取链命中业务错误 JSON 按上游故障计入熔断，连续到阈值即零请求', async () => {
    const errorBody = JSON.stringify({ code: 201, msg: 'error' })
    installStub({
      qqSearch: () => ({ status: 200, body: buildQqSearchBody([]) }),
      channel: () => ({ status: 200, headers: { 'content-length': String(errorBody.length) }, body: errorBody }),
    })
    for (let round = 1; round <= 3; round += 1) {
      const result = await getChangqingSongUrl(
        { title: '枫', artist: '周杰伦', duration: 259 },
        { platform: 'qqmusic', platformId: '003Nz2So3XXYek' },
      )
      assert.equal(result.reason, FETCH_FAILED_REASON, `第 ${round} 轮应判取链失败`)
    }
    const callsBeforeSkip = requests.length
    // 每轮取链先探测后取证：两个音质档位各产生探测与取证请求
    assert.ok(callsBeforeSkip >= 3 * 2 * 2)
    const skipped = await getChangqingSongUrl(
      { title: '枫', artist: '周杰伦', duration: 259 },
      { platform: 'qqmusic', platformId: '003Nz2So3XXYek' },
    )
    assert.equal(skipped.code, 404)
    assert.equal(skipped.url, null)
    assert.equal(skipped.reason, UPSTREAM_UNAVAILABLE_REASON)
    assert.equal(requests.length, callsBeforeSkip)
  })
})
