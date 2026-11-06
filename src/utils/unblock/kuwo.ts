/**
 * 酷我音乐换源
 *
 * 修复点：
 * 1. 关键词切分统一走公共解析（trim 后再比对，不再出现尾随空格导致恒 404）；
 * 2. 候选列表取两套索引并集后按「歌名 + 歌手 + 时长」三重校验排序，不再盲取 rank0；
 * 3. 直链先按「声明时长 × 码率」校验文件体积，拦截与歌曲无关的固定占位文件；
 * 4. 取链层识别上游的「只有试听资源」结论，不再把占位直链当成功直链交付。
 *
 * 取链层的上游结论（实测）：
 * 酷我取链端点对**受限曲目**（站内会员曲）不再返回完整音频，而是回一个固定的
 * 「登录后畅听」占位资源 —— 码率 1 kbps、时长 11 秒、体积 185,336 B
 * （md5 86e42315600b9137e26ad17d54f3d622），且应答回传的 rid 与请求的 rid 不一致。
 * 该结论与 source 包名、接口形态（加密 f=kuwo / 明文 f=web）、音质档位
 * （128k / 320k / aac / flac）都无关，属上游授权限制，参数层面无解。
 * 因此取链层必须把这类应答识别为「该曲在此源无完整资源」的逐曲拒绝：
 * 既不把它当成功直链（白费一次体积探测），也不把它当上游故障
 * （会误触熔断，把整源停摆连带其它歌曲一起拖下水）。
 *
 * 健壮性：整条换源挂熔断器（检索层与取链层共用），
 * 连续出现上游侧故障达到阈值即熔断，熔断期内零上游请求、直接快速拒绝。
 * 酷我取链端点返回的是纯文本键值对，没有业务错误码载体：
 * 传输层故障（5xx / 超时 / 连接异常）计入熔断，
 * 请求侧错误（4xx）与「该曲在此源没有正版权质」属逐曲拒绝，不计入。
 */
import { encryptQuery } from './kwDES'
import type { SongUrlResult } from './types'
import { unblockLog } from './http'
import {
  FETCH_FAILED_REASON,
  MATCH_FAILED_REASON,
  MISSING_ARTIST_REASON,
  MISSING_TITLE_REASON,
  NO_CANDIDATE_REASON,
  TRIAL_ONLY_REASON,
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

/** 酷我直链码率（kbps）：上游未声明码率时的兜底值 */
const KUWO_BITRATE_KBPS = 128

/** 低于该码率说明上游只给了占位 / 试听资源，不是完整音频 */
const KUWO_MIN_PLAUSIBLE_BITRATE_KBPS = 32

/** 单次解锁最多尝试的候选数 */
const MAX_CANDIDATE_TRY = 3

/** 单次取链请求超时（毫秒） */
const REQUEST_TIMEOUT_MS = 10000

/** 整条换源连续失败多少次后熔断 */
const FAILURE_THRESHOLD = 3

/** 熔断持续时长（毫秒）：期间该源直接跳过，不发起任何请求 */
const BREAK_DURATION_MS = 10 * 60 * 1000

/** 同源同曲的失败日志节流窗口（毫秒） */
const FAIL_LOG_THROTTLE_MS = 10 * 1000

/** 失败日志节流表的最大条目数：超出后清理过期条目，避免长期运行内存无界增长 */
const FAIL_LOG_THROTTLE_MAX_ENTRIES = 64

/** 酷我源熔断器：检索层与取链层共用 */
const sourceBreaker = new CircuitBreaker({
  name: '酷我',
  failureThreshold: FAILURE_THRESHOLD,
  openDurationMs: BREAK_DURATION_MS,
  onStateChange: (message) => unblockLog.warn(`🔌 ${message}`),
})

/** 酷我客户端包名（决定可用音质档位） */
const PACKAGE_NAME = 'kwplayer_ar_5.1.0.0_B_jiakong_vh.apk'

/** 酷我直链请求 UA */
const KUWO_UA = 'okhttp/3.10.0'

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
  const key = `kuwo|${target.title}|${target.artist}`
  const now = Date.now()
  const last = failureLogAt.get(key) ?? 0
  if (now - last < FAIL_LOG_THROTTLE_MS) return
  if (failureLogAt.size >= FAIL_LOG_THROTTLE_MAX_ENTRIES) {
    for (const [itemKey, loggedAt] of failureLogAt) {
      if (now - loggedAt >= FAIL_LOG_THROTTLE_MS) failureLogAt.delete(itemKey)
    }
  }
  failureLogAt.set(key, now)
  unblockLog.warn(`⚠️ 酷我 换源失败（${target.title} / ${target.artist}）：${reason}`)
}

/**
 * 判断传输层异常是否属于酷我的上游侧故障
 *
 * HTTP 5xx 计入上游故障，HTTP 4xx 属请求侧不计入；
 * 没有 HTTP 状态码时（连接异常 / 超时 / DNS 失败）回落到通用上游故障判定。
 * @param error 异常对象
 * @returns 是否为上游侧故障
 */
const isKuwoTransportFault = (error: unknown): boolean => {
  const status = extractHttpStatus(error)
  if (status > 0) return status >= 500
  return isUpstreamFault(error)
}

/** 单次取链的结论 */
type KuwoTrackOutcome = {
  /** 取到的直链；失败时为 null */
  url: string | null
  /** 上游声明的直链码率（kbps）；上游未声明时为 null */
  bitrateKbps: number | null
  /** 本次失败是否属于上游故障（计入熔断计数） */
  fault: boolean
  /** 该曲在此源是否只有试听 / 占位资源（逐曲拒绝，不计熔断） */
  trialOnly: boolean
  /** 失败原因描述 */
  note: string
}

/**
 * 解析酷我取链应答的键值对文本
 * @param body 应答正文
 * @returns 键值对
 */
const parseKeyValueResponse = (body: string): Record<string, string> => {
  const fields: Record<string, string> = {}
  for (const line of body.split(/\r?\n/)) {
    const index = line.indexOf('=')
    if (index <= 0) continue
    fields[line.slice(0, index).trim()] = line.slice(index + 1).trim()
  }
  return fields
}

/**
 * 获取酷我歌曲直链
 *
 * 应答为纯文本键值对：`format` / `bitrate` / `url` / `sig` / `rid` / `type`。
 * 受限曲目回的是占位资源（码率 1 kbps、时长 11 秒、回传 rid 与请求不一致），
 * 这里识别出来并判为逐曲拒绝，不把它当成功直链，也不当上游故障。
 * @param rid 酷我歌曲 rid
 * @returns 取链结论
 */
const getKuwoTrackUrl = async (rid: string): Promise<KuwoTrackOutcome> => {
  const url =
    'http://mobi.kuwo.cn/mobi.s?f=kuwo&q=' +
    encryptQuery(
      `corp=kuwo&source=${PACKAGE_NAME}&p2p=1&type=convert_url2&sig=0&format=mp3` + '&rid=' + rid,
    )
  try {
    const result = await requestStrict({
      url,
      headers: { 'User-Agent': KUWO_UA },
      timeout: REQUEST_TIMEOUT_MS,
    })
    if (typeof result.data !== 'string') {
      return { url: null, bitrateKbps: null, fault: false, trialOnly: false, note: '上游应答不是文本' }
    }
    const fields = parseKeyValueResponse(result.data)
    const direct = fields.url ?? ''
    if (!direct) {
      return { url: null, bitrateKbps: null, fault: false, trialOnly: false, note: '上游未返回直链' }
    }
    const bitrate = Number(fields.bitrate)
    const bitrateKbps = Number.isFinite(bitrate) && bitrate > 0 ? bitrate : null
    const respondedRid = fields.rid ?? ''
    const lowBitrate = bitrateKbps !== null && bitrateKbps < KUWO_MIN_PLAUSIBLE_BITRATE_KBPS
    const ridMismatch = !!respondedRid && respondedRid !== rid
    if (lowBitrate || ridMismatch) {
      return {
        url: null,
        bitrateKbps: null,
        fault: false,
        trialOnly: true,
        note: `上游只提供试听资源（bitrate=${fields.bitrate} type=${fields.type} rid=${respondedRid || '空'}）`,
      }
    }
    if (fields.type && fields.type !== '0') {
      return {
        url: null,
        bitrateKbps: null,
        fault: false,
        trialOnly: false,
        note: `上游业务类型 type=${fields.type}`,
      }
    }
    return { url: direct, bitrateKbps, fault: false, trialOnly: false, note: '' }
  } catch (error) {
    return {
      url: null,
      bitrateKbps: null,
      fault: isKuwoTransportFault(error),
      trialOnly: false,
      note: String(error),
    }
  }
}

/**
 * 获取酷我音乐歌曲直链
 * @param keyword 形如「歌名 - 歌手」的关键词
 * @param duration 期望时长（秒），可选；传入后参与时长校验。
 *                 兼容旧接线传入的字符串参数：非数字文本按「未提供时长」处理
 * @param breaker 熔断器；缺省使用模块级实例（测试可注入短熔断窗口的实例）
 * @returns 歌曲直链结果
 */
const getKuwoSongUrl = async (
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
        `🔌 酷我处于熔断状态，跳过本次换源（剩余 ${Math.ceil(
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
    let upstreamFault = false
    let trialOnly = false
    for (const detail of ranked.slice(0, MAX_CANDIDATE_TRY)) {
      const outcome = await getKuwoTrackUrl(detail.candidate.id)
      upstreamFault = upstreamFault || outcome.fault
      if (!outcome.url) {
        trialOnly = trialOnly || outcome.trialOnly
        unblockLog.warn(`⚠️ 酷我取链失败（${detail.candidate.title}）：${outcome.note}`)
        // 传输层故障说明源整体不可达，继续试其它候选只会白等超时，直接放弃本源
        if (upstreamFault) break
        continue
      }
      const length = await probeContentLength(outcome.url, { 'User-Agent': KUWO_UA })
      const check = isPlausibleAudioLength(
        length,
        detail.candidate.duration,
        outcome.bitrateKbps ?? KUWO_BITRATE_KBPS,
        target.duration,
      )
      if (!check.ok) {
        unblockLog.warn(`⚠️ Kuwo candidate rejected (${detail.candidate.title}): ${check.reason}`)
        continue
      }
      unblockLog.log('🔗 KuwoSong URL:', sanitizeUrl(outcome.url))
      breaker.recordSuccess()
      return {
        code: 200,
        url: outcome.url,
        lengthVerified: check.verified,
      }
    }
    if (upstreamFault) breaker.recordFailure()
    else breaker.recordSuccess()
    const reason = trialOnly ? TRIAL_ONLY_REASON : FETCH_FAILED_REASON
    logUnlockFailure(target, reason)
    return { code: 404, url: null, reason }
  } catch (error) {
    unblockLog.error('❌ Get KuwoSong URL Error:', error)
    if (isKuwoTransportFault(error)) breaker.recordFailure()
    else breaker.recordSuccess()
    logUnlockFailure(buildTarget(keyword, durationSec), UPSTREAM_UNAVAILABLE_REASON)
    return { code: 404, url: null, reason: UPSTREAM_UNAVAILABLE_REASON }
  }
}

export default getKuwoSongUrl
