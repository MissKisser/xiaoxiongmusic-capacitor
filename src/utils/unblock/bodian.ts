/**
 * 波点音乐换源
 *
 * 修复点：
 * 1. 候选列表取两套酷我索引并集后按「歌名 + 歌手 + 时长」三重校验排序，不再盲取 rank0；
 * 2. 直链先按「声明时长 × 码率」校验文件体积，拦截残缺文件。
 * 波点自带的「免广告」请求属于该换源链路的一部分，保留。
 *
 * 健壮性：整条换源挂熔断器（检索层与取链层共用），
 * 连续出现上游侧故障达到阈值即熔断，熔断期内零上游请求、直接快速拒绝；
 * 请求侧错误（4xx、参数错误、请求过期）与逐曲拒绝（歌曲已下线）不计入熔断计数。
 */
import type { SongUrlResult } from './types'
import { unblockLog } from './http'
import md5 from 'md5'
import {
  FETCH_FAILED_REASON,
  MATCH_FAILED_REASON,
  MISSING_ARTIST_REASON,
  MISSING_TITLE_REASON,
  NO_CANDIDATE_REASON,
  UPSTREAM_UNAVAILABLE_REASON,
  buildTarget,
  isPlausibleAudioLength,
  parseDurationParam,
  rankCandidates,
} from './match'
import { searchKuwoCandidates } from './kuwo-search'
import { probeContentLength } from './audio-length'
import { sanitizeUrl } from './sanitize'
import { CircuitBreaker, extractHttpStatus, isUpstreamFault } from './resilience'
import { requestStrict } from './http-strict'

/** 波点直链码率（kbps） */
const BODIAN_BITRATE_KBPS = 320

/** 单次解锁最多尝试的候选数 */
const MAX_CANDIDATE_TRY = 3

/** 整条换源连续失败多少次后熔断 */
const FAILURE_THRESHOLD = 3

/** 熔断持续时长（毫秒）：期间该源直接跳过，不发起任何请求 */
const BREAK_DURATION_MS = 10 * 60 * 1000

/** 同源同曲的失败日志节流窗口（毫秒） */
const FAIL_LOG_THROTTLE_MS = 10 * 1000

/** 失败日志节流表的最大条目数：超出后清理过期条目，避免长期运行内存无界增长 */
const FAIL_LOG_THROTTLE_MAX_ENTRIES = 64

/** 波点取链的成功业务码 */
const SUCCESS_CODE = 200

/**
 * 波点逐曲拒绝的业务码
 *
 * 该曲在波点侧已下线（20012）或没有正版权质（20018），属逐曲拒绝而非源故障，不计入熔断计数。
 */
const PER_SONG_REJECT_CODES = new Set([20012, 20018])

/**
 * 波点请求侧的业务码
 *
 * 参数错误（-10）、参数类型错误（-1，HTTP 400）与请求过期（435，签名或时间戳不合法）
 * 都是我方请求本身的问题，不计入熔断计数。
 */
const REQUEST_SIDE_CODES = new Set([-10, -1, 435])

/** 波点源熔断器：检索层与取链层共用 */
const sourceBreaker = new CircuitBreaker({
  name: '波点',
  failureThreshold: FAILURE_THRESHOLD,
  openDurationMs: BREAK_DURATION_MS,
  onStateChange: (message) => unblockLog.warn(`🔌 ${message}`),
})

/** 同源同曲的失败日志节流表：记录上一次写日志的时刻 */
const failureLogAt = new Map<string, number>()

/**
 * 记录一次换源失败
 *
 * 同源同曲在节流窗口内只写一条日志：换源链按优先级逐源尝试，
 * 同一首歌被反复重试时不至于刷屏。
 * @param target 目标歌曲信息
 * @param reason 失败原因（用户可读文案）
 */
const logUnlockFailure = (target: { title: string; artist: string }, reason: string): void => {
  const key = `bodian|${target.title}|${target.artist}`
  const now = Date.now()
  const last = failureLogAt.get(key) ?? 0
  if (now - last < FAIL_LOG_THROTTLE_MS) return
  if (failureLogAt.size >= FAIL_LOG_THROTTLE_MAX_ENTRIES) {
    for (const [itemKey, loggedAt] of failureLogAt) {
      if (now - loggedAt >= FAIL_LOG_THROTTLE_MS) failureLogAt.delete(itemKey)
    }
  }
  failureLogAt.set(key, now)
  unblockLog.warn(`⚠️ 波点 换源失败（${target.title} / ${target.artist}）：${reason}`)
}

/**
 * 生成随机设备 ID
 * @returns 随机设备号
 */
const getRandomDeviceId = () => {
  const min = 0
  const max = 100000000000
  const randomNum = Math.floor(Math.random() * (max - min + 1)) + min
  return randomNum.toString()
}

const deviceId = getRandomDeviceId()

/** 波点请求公共头 */
const buildHeaders = () => ({
  'user-agent': 'Dart/2.19 (dart:io)',
  plat: 'ar',
  channel: 'aliopen',
  devid: deviceId,
  ver: '3.9.0',
  host: 'bd-api.kuwo.cn',
  'X-Forwarded-For': '1.0.1.114',
})

/**
 * 直链体积探测专用请求头
 *
 * 直链落在酷我 CDN 上，必须用 CDN 自身的请求头去探测：
 * 带上 `host: bd-api.kuwo.cn` 会被 CDN 直接拒绝，探测结果恒为空，
 * 体积校验会被静默跳过，残缺文件因此得以放行。
 * @returns 只含 UA 与 Referer 的探测请求头
 */
const buildProbeHeaders = (): Record<string, string> => ({
  'user-agent': 'Dart/2.19 (dart:io)',
  Referer: 'https://bd-api.kuwo.cn/',
})

/**
 * 为请求地址追加签名
 * @param str 待签名地址
 * @returns 带 sign 参数的地址
 */
const generateSign = (str: string) => {
  const url = new URL(str)
  const currentTime = Date.now()
  str += `&timestamp=${currentTime}`
  const filteredChars = str
    .substring(str.indexOf('?') + 1)
    .replace(/[^a-zA-Z0-9]/g, '')
    .split('')
    .sort()
  const dataToEncrypt = `kuwotest${filteredChars.join('')}${url.pathname}`
  const md5hex = md5(dataToEncrypt)
  return `${str}&sign=${md5hex}`
}

/**
 * 发送免广告请求
 * @returns 请求结果，失败返回 null
 */
const sendAdFreeRequest = () => {
  try {
    const adurl =
      'http://bd-api.kuwo.cn/api/service/advert/watch?uid=-1&token=&timestamp=1724306124436&sign=15a676d66285117ad714e8c8371691da'
    const headers = {
      ...buildHeaders(),
      qimei36: '1e9970cbcdc20a031dee9f37100017e1840e',
      'content-type': 'application/json; charset=utf-8',
    }
    const data = JSON.stringify({
      type: 5,
      subType: 5,
      musicId: 0,
      adToken: '',
    })
    return requestStrict({ url: adurl, method: 'POST', headers, data })
  } catch (error) {
    unblockLog.error('❌ Get Bodian Ad Free Error:', error)
    return null
  }
}

/**
 * 判断传输层异常是否属于波点的上游侧故障
 *
 * 波点用 HTTP 4xx 表达「请求不被接受」（如 musicId 类型不对），
 * 这类响应体里同样带业务码，直接按通用规则会被误判成源故障，
 * 因此这里先按 HTTP 状态码判定：5xx 计入上游故障，4xx 属请求侧不计入；
 * 没有 HTTP 状态码时（连接异常 / 超时 / DNS 失败）回落到通用上游故障判定。
 * @param error 异常对象
 * @returns 是否为上游侧故障
 */
const isBodianTransportFault = (error: unknown): boolean => {
  const status = extractHttpStatus(error)
  if (status > 0) return status >= 500
  return isUpstreamFault(error)
}

/**
 * 读取波点取链响应里的业务码
 * @param data 响应体
 * @returns 业务码；响应体不是预期结构时返回 null
 */
const readBodianCode = (data: unknown): number | null => {
  if (!data || typeof data !== 'object') return null
  const raw = (data as { code?: unknown }).code
  const code = Number(raw)
  return Number.isFinite(code) ? code : null
}

/**
 * 判断波点的业务码是否属于上游侧故障
 *
 * 口径：
 * - 成功码（200）：不是故障；
 * - 逐曲拒绝码（歌曲已下线）：该曲在此源无资源，不计入；
 * - 请求侧码（参数错误、请求过期）：我方请求的问题，不计入；
 * - 其余业务码：上游没能给出可用资源，计入。
 * @param code 波点业务码
 * @returns 是否计入熔断故障计数
 */
const isBodianBusinessFault = (code: number): boolean => {
  if (code === SUCCESS_CODE) return false
  if (PER_SONG_REJECT_CODES.has(code)) return false
  if (REQUEST_SIDE_CODES.has(code)) return false
  return true
}

/**
 * 获取波点音乐歌曲直链
 * @param keyword 形如「歌名 - 歌手」的关键词
 * @param duration 期望时长（秒），可选；传入后参与时长校验。
 *                 兼容旧接线传入的字符串参数：非数字文本按「未提供时长」处理
 * @param breaker 熔断器；缺省使用模块级实例（测试可注入短熔断窗口的实例）
 * @returns 歌曲直链结果
 */
const getBodianSongUrl = async (
  keyword: string,
  duration?: number | string,
  breaker: CircuitBreaker = sourceBreaker,
): Promise<SongUrlResult> => {
  const durationSec = parseDurationParam(duration)
  try {
    if (!keyword) return { code: 404, url: null, reason: MISSING_TITLE_REASON }
    const target = buildTarget(keyword, durationSec)
    if (!target.title) return { code: 404, url: null, reason: MISSING_TITLE_REASON }
    if (!target.artist.trim()) return { code: 404, url: null, reason: MISSING_ARTIST_REASON }
    if (!breaker.canRequest()) {
      unblockLog.warn(
        `🔌 波点处于熔断状态，跳过本次换源（剩余 ${Math.ceil(
          breaker.remainingOpenMs() / 1000,
        )} 秒）`,
      )
      return { code: 404, url: null, reason: UPSTREAM_UNAVAILABLE_REASON }
    }
    const search = await searchKuwoCandidates(target.title, target.artist, (message) =>
      unblockLog.warn(`⚠️ ${message}`),
    )
    if (search.upstreamFailed) {
      breaker.recordFailure()
      logUnlockFailure(target, UPSTREAM_UNAVAILABLE_REASON)
      return { code: 404, url: null, reason: UPSTREAM_UNAVAILABLE_REASON }
    }
    if (!search.candidates.length) {
      breaker.recordSuccess()
      logUnlockFailure(target, NO_CANDIDATE_REASON)
      return { code: 404, url: null, reason: NO_CANDIDATE_REASON }
    }
    const ranked = rankCandidates(search.candidates, target).filter((detail) => detail.passed)
    if (!ranked.length) {
      breaker.recordSuccess()
      logUnlockFailure(target, MATCH_FAILED_REASON)
      return { code: 404, url: null, reason: MATCH_FAILED_REASON }
    }
    const headers = buildHeaders()
    await sendAdFreeRequest()
    let upstreamFault = false
    for (const detail of ranked.slice(0, MAX_CANDIDATE_TRY)) {
      let audioUrl = `http://bd-api.kuwo.cn/api/play/music/v2/audioUrl?&br=${'320kmp3'}&musicId=${detail.candidate.id}`
      audioUrl = generateSign(audioUrl)
      let responseData: unknown = null
      try {
        const response = await requestStrict({ url: audioUrl, headers, timeout: 10000 })
        responseData = response.data
      } catch (error) {
        upstreamFault = upstreamFault || isBodianTransportFault(error)
        unblockLog.warn(`⚠️ 波点取链失败（${detail.candidate.title}）：${String(error)}`)
        // 传输层故障说明源整体不可达，继续试其它候选只会白等超时，直接放弃本源
        if (upstreamFault) break
        continue
      }
      const code = readBodianCode(responseData)
      if (code === null) {
        // 响应体没有业务码：上游返回的不是预期结构，属上游侧异常
        upstreamFault = true
        unblockLog.warn(`⚠️ 波点取链响应异常（${detail.candidate.title}）：缺少业务码`)
        continue
      }
      if (isBodianBusinessFault(code)) {
        upstreamFault = true
        unblockLog.warn(
          `⚠️ 波点取链业务错误（${detail.candidate.title}）：code=${code} ${
            (responseData as { msg?: unknown })?.msg ?? ''
          }`,
        )
        continue
      }
      const audio = (responseData as { data?: { audioUrl?: string } })?.data
      if (!audio?.audioUrl) {
        // 业务码成功但没给直链：该曲在此源没有可用资源，属逐曲拒绝
        unblockLog.warn(`⚠️ 波点未取到直链（${detail.candidate.title}）：上游未返回地址`)
        continue
      }
      const url = audio.audioUrl as string
      const length = await probeContentLength(url, buildProbeHeaders())
      const check = isPlausibleAudioLength(
        length,
        detail.candidate.duration,
        BODIAN_BITRATE_KBPS,
        target.duration,
      )
      if (!check.ok) {
        unblockLog.warn(`⚠️ Bodian candidate rejected (${detail.candidate.title}): ${check.reason}`)
        continue
      }
      if (!check.verified) {
        unblockLog.warn(`⚠️ Bodian 直链体积未验证 (${detail.candidate.title}): ${check.reason}`)
      }
      unblockLog.log('🔗 BodianSong URL:', sanitizeUrl(url))
      breaker.recordSuccess()
      return {
        code: 200,
        url,
        lengthVerified: check.verified,
        matchedDuration: detail.candidate.duration,
      }
    }
    if (upstreamFault) breaker.recordFailure()
    else breaker.recordSuccess()
    logUnlockFailure(target, FETCH_FAILED_REASON)
    return { code: 404, url: null, reason: FETCH_FAILED_REASON }
  } catch (error) {
    unblockLog.error('❌ Get BodianSong URL Error:', error)
    if (isBodianTransportFault(error)) breaker.recordFailure()
    else breaker.recordSuccess()
    logUnlockFailure(buildTarget(keyword, durationSec), UPSTREAM_UNAVAILABLE_REASON)
    return { code: 404, url: null, reason: UPSTREAM_UNAVAILABLE_REASON }
  }
}

export default getBodianSongUrl
