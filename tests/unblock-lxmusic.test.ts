/**
 * 落雪音源换源单测 (unblock/lxmusic.ts)
 *
 * 上游打桩打在本地 http 封装层的传输底座（globalThis.fetch，node 测试环境走
 * http.ts 的 fetch 路径），不连真实上游。覆盖六块判据：
 * 1. 缺歌名 / 缺歌手：直接 404，零上游请求；
 * 2. QQ 平台自带 mid 直查：token 携带设备标识与访问者 IP，取链参数与 lx 协议一致，
 *    http 直链升级 https 后通过身份校验、时长闸门与体积校验；
 * 3. 直链文件 id 不属于目标曲目：身份校验拒绝交付；
 * 4. 320k 业务失败降级 128k；
 * 5. 实测时长偏离目标时长：时长闸门拒绝交付；
 * 6. 非 QQ 平台：走 QQ 检索换 mid，候选过三重校验后取链。
 */

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import getLxmusicSongUrl from '../src/utils/unblock/lxmusic'
import {
  FETCH_FAILED_REASON,
  MISSING_ARTIST_REASON,
  MISSING_TITLE_REASON,
} from '../src/utils/unblock/match'

/** lx 后端 IP 探测地址 */
const LX_IP_ENDPOINT = 'https://yy.zddyr.top/ip.php'

/** lx 后端取链地址前缀 */
const LX_API_PREFIX = 'https://yy.zddyr.top/lx/api/'

/** QQ 音乐接口入口（检索与详情共用） */
const QM_API_URL = 'https://u.y.qq.com/cgi-bin/musicu.fcg'

/** 目标歌曲 mid */
const SONG_MID = '002MXZNu1GToOk'

/** 目标曲目 media mid */
const MEDIA_MID = '002MXZNu1GToOk00'

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

/** lx 取链响应构造器 */
type LxHandler = (quality: string) => { status: number; body: Record<string, unknown> }

/** 桩配置 */
interface StubConfig {
  /** lx 取链响应（按音质档位） */
  lx: LxHandler
  /** QQ 直链探测的实测时长（秒）；undefined 表示探测失败 */
  audioDurationSec?: number
}

/** 打桩期间记录到的请求 */
let requests: { url: string; method: string; body?: string; headers?: Record<string, string> }[] = []

/** 原始 fetch 引用 */
const originalFetch = globalThis.fetch

/**
 * 安装 fetch 桩：IP 探测、lx 取链、QQ 检索 / 详情、直链探测各按地址分发
 * @param config 桩配置
 */
const installStub = (config: StubConfig): void => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = typeof init?.body === 'string' ? init.body : undefined
    const headers = (init?.headers ?? {}) as Record<string, string>
    requests.push({ url, method, body, headers })
    if (url.startsWith(LX_IP_ENDPOINT)) {
      return buildResponse({ text: JSON.stringify({ ip: '203.0.113.7' }) })
    }
    if (url.startsWith(LX_API_PREFIX)) {
      const quality = new URL(url).searchParams.get('quality') ?? ''
      const outcome = config.lx(quality)
      return buildResponse({ status: outcome.status, text: JSON.stringify(outcome.body) })
    }
    if (url.startsWith(QM_API_URL)) {
      const param = JSON.parse(body ?? '{}')
      const method1 = param?.request?.method ?? ''
      if (method1 === 'DoSearchForQQMusicMobile') {
        return buildResponse({
          text: JSON.stringify({
            code: 0,
            request: {
              code: 0,
              data: {
                body: {
                  item_song: [
                    {
                      mid: SONG_MID,
                      title: '晴天',
                      singer: [{ name: '周杰伦' }],
                      interval: 192,
                    },
                  ],
                },
              },
            },
          }),
        })
      }
      return buildResponse({
        text: JSON.stringify({
          code: 0,
          request: {
            code: 0,
            data: {
              track_info: {
                mid: SONG_MID,
                title: '晴天',
                singer: [{ name: '周杰伦' }],
                interval: 192,
                file: { media_mid: MEDIA_MID },
              },
            },
          },
        }),
      })
    }
    if (config.audioDurationSec === undefined) {
      return buildResponse({ status: 403, text: '' })
    }
    const total = Math.round(mp3Bytes(config.audioDurationSec))
    return buildResponse({
      status: 206,
      headers: { 'content-range': `bytes 0-3/${total}` },
      bytes: MP3_HEADER_128K,
    })
  }) as typeof globalThis.fetch
}

/** 目标歌曲（QQ mid 直查用） */
const target = { title: '晴天', artist: '周杰伦', duration: 192 }

describe('落雪换源 lxmusic', () => {
  beforeEach(() => {
    requests = []
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('缺少歌名或歌手时直接失败，且不请求上游', async () => {
    installStub({
      lx: () => ({ status: 200, body: { code: 200, url: 'http://dl.stream.qq.music.qq.com/x.mp3' } }),
      audioDurationSec: 192,
    })
    const noTitle = await getLxmusicSongUrl({ title: '', artist: '周杰伦', duration: 192 })
    assert.equal(noTitle.code, 404)
    assert.equal(noTitle.reason, MISSING_TITLE_REASON)
    const noArtist = await getLxmusicSongUrl({ title: '晴天', artist: '', duration: 192 })
    assert.equal(noArtist.code, 404)
    assert.equal(noArtist.reason, MISSING_ARTIST_REASON)
    assert.equal(requests.length, 0)
  })

  it('QQ mid 直查：token 与取链参数符合 lx 协议，http 直链升级 https 并通过三重把关', async () => {
    installStub({
      lx: () => ({
        status: 200,
        body: { code: 200, url: `http://dl.stream.qq.music.qq.com/M500${SONG_MID}.mp3?vkey=abc` },
      }),
      audioDurationSec: 192,
    })
    const result = await getLxmusicSongUrl(target, { platform: 'qqmusic', platformId: SONG_MID })
    assert.equal(result.code, 200)
    assert.ok(result.url?.startsWith(`https://dl.stream.qq.music.qq.com/M500${SONG_MID}.mp3?`))
    assert.equal(result.lengthVerified, true)
    // 取链参数与 lx 协议一致，token 载荷含设备标识与访问者 IP
    const lxCall = requests.find((item) => item.url.startsWith(LX_API_PREFIX))
    assert.ok(lxCall)
    const params = new URL(lxCall.url).searchParams
    assert.equal(params.get('source'), 'qq')
    assert.equal(params.get('songmid'), SONG_MID)
    assert.equal(params.get('name'), '晴天')
    assert.equal(params.get('singer'), '周杰伦')
    assert.equal(params.get('interval'), '03:12')
    assert.equal(params.get('quality'), '320k')
    const token = lxCall.headers?.['X-Token'] ?? ''
    assert.ok(token)
    const payload = JSON.parse(atob(token)) as Record<string, unknown>
    assert.equal(payload.ip, '203.0.113.7')
    assert.equal(typeof payload.device_id, 'string')
    assert.ok((payload.device_id as string).length > 0)
    // QQ mid 直查不触发检索，只读曲目详情
    const qmCalls = requests.filter((item) => item.url.startsWith(QM_API_URL))
    assert.equal(qmCalls.length, 1)
    assert.equal(JSON.parse(qmCalls[0].body ?? '{}').request.method, 'get_song_detail_yqq')
  })

  it('直链文件 id 不属于目标曲目时拒绝交付', async () => {
    installStub({
      lx: () => ({
        status: 200,
        body: { code: 200, url: 'http://dl.stream.qq.music.qq.com/M800000cZNr42YkLl1.mp3?vkey=abc' },
      }),
      audioDurationSec: 192,
    })
    const result = await getLxmusicSongUrl(target, { platform: 'qqmusic', platformId: SONG_MID })
    assert.equal(result.code, 404)
    assert.equal(result.url, null)
    assert.equal(result.reason, FETCH_FAILED_REASON)
  })

  it('320k 业务失败降级 128k 后交付', async () => {
    installStub({
      lx: (quality) =>
        quality === '320k'
          ? { status: 200, body: { code: 500, msg: '获取失败' } }
          : { status: 200, body: { code: 200, url: `http://dl.stream.qq.music.qq.com/M500${SONG_MID}.mp3` } },
      audioDurationSec: 192,
    })
    const result = await getLxmusicSongUrl(target, { platform: 'qqmusic', platformId: SONG_MID })
    assert.equal(result.code, 200)
    assert.ok(result.url?.startsWith(`https://dl.stream.qq.music.qq.com/M500${SONG_MID}.mp3`))
    assert.equal(result.lengthVerified, true)
    const lxQualities = requests
      .filter((item) => item.url.startsWith(LX_API_PREFIX))
      .map((item) => new URL(item.url).searchParams.get('quality'))
    assert.deepEqual(lxQualities, ['320k', '128k'])
  })

  it('实测时长偏离目标时长超容差时拒绝交付', async () => {
    installStub({
      lx: () => ({
        status: 200,
        body: { code: 200, url: `http://dl.stream.qq.music.qq.com/M500${SONG_MID}.mp3?vkey=abc` },
      }),
      audioDurationSec: 100,
    })
    const result = await getLxmusicSongUrl(target, { platform: 'qqmusic', platformId: SONG_MID })
    assert.equal(result.code, 404)
    assert.equal(result.url, null)
    assert.equal(result.reason, FETCH_FAILED_REASON)
  })

  it('非 QQ 平台走 QQ 检索换 mid 后取链', async () => {
    installStub({
      lx: () => ({
        status: 200,
        body: { code: 200, url: `http://dl.stream.qq.music.qq.com/M500${SONG_MID}.mp3?vkey=abc` },
      }),
      audioDurationSec: 192,
    })
    const result = await getLxmusicSongUrl(target, { platform: 'netease', platformId: '5257160' })
    assert.equal(result.code, 200)
    assert.ok(result.url?.startsWith(`https://dl.stream.qq.music.qq.com/M500${SONG_MID}.mp3`))
    const searchCall = requests.find(
      (item) =>
        item.url.startsWith(QM_API_URL) &&
        JSON.parse(item.body ?? '{}').request?.method === 'DoSearchForQQMusicMobile',
    )
    assert.ok(searchCall)
    assert.equal(JSON.parse(searchCall.body ?? '{}').request.param.query, '晴天-周杰伦')
    assert.equal(new URL(requests.find((item) => item.url.startsWith(LX_API_PREFIX))!.url).searchParams.get('songmid'), SONG_MID)
  })
})
