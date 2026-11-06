/**
 * 直链真实音频时长探测
 *
 * 目的：区分「整曲直链」与「试听片段 / 错版曲目」。
 *
 * 只看 Content-Length 不够：
 * 1. 同一首歌在不同通道可能是 64k / 128k / 320k，按假定码率换算会把高码率误判为整曲、
 *    低码率误判为片段；
 * 2. 公益聚合站返回的文件未必是请求的那一版（实测同一条 id 可返回时长明显不同的另一版），
 *    字节数完全可能落在「合理区间」内，只有真实时长能把它区分出来。
 *
 * 因此这里做两件事：
 * 1. Range 读文件头，同时从响应头取全量字节数；
 * 2. 解析文件头得出真实采样率与总帧数（FLAC 精确、M4A 精确、WAV 精确、MP3 由帧头估算）。
 *
 * 与服务端实现的差异仅在传输层：服务端用 axios stream 在读到上限后立即断开，
 * 本实现经 http 封装层取回响应体（fetch 路径无流式截断，原生层无中途 abort），
 * 上游支持 Range 时只传文件头分段；上游忽略 Range 时响应体会完整进入内存，
 * 时间由 readTimeout 兜住。文件头解析与判定结果（字节 → 时长 / 码率）与服务端逐字一致。
 */
import { getResponseHeader, unblockRequest } from './http'

/** 文件头读取上限（字节） */
const HEAD_BYTES = 131072

/** 探测请求超时（毫秒） */
const PROBE_TIMEOUT = 10000

/** 音频探测结论 */
export type AudioProbe = {
  /** 响应声明的总字节数；未知时为 null */
  bytes: number | null
  /** 解析出的真实音频时长（秒）；无法解析时为 null */
  durationSec: number | null
  /** 解析出的码率（kbps）；无法解析时为 null */
  bitrateKbps: number | null
  /** 识别出的容器格式 */
  format: string
}

/** MPEG1 Layer3 码率表（kbps） */
const MP3_BR_MPEG1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0]

/** MPEG2 / 2.5 Layer3 码率表（kbps） */
const MP3_BR_MPEG2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0]

/** MPEG 采样率表（按版本分组） */
const MP3_SAMPLE_RATES: Record<number, number[]> = {
  3: [44100, 48000, 32000],
  2: [22050, 24000, 16000],
  0: [11025, 12000, 8000],
}

/**
 * 按字节读出大端无符号 32 位整数
 * @param buffer 字节视图
 * @param offset 起始下标
 * @returns 整数值
 */
const readU32be = (buffer: Uint8Array, offset: number): number =>
  ((buffer[offset] << 24) | (buffer[offset + 1] << 16) | (buffer[offset + 2] << 8) |
    buffer[offset + 3]) >>>
  0

/**
 * 按字节读出小端无符号 32 位整数
 * @param buffer 字节视图
 * @param offset 起始下标
 * @returns 整数值
 */
const readU32le = (buffer: Uint8Array, offset: number): number =>
  (buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16) |
    (buffer[offset + 3] << 24)) >>>
  0

/**
 * 把字节区间读成 latin1 字符串
 *
 * 每字节一一对应一个字符，用于容器魔数（fLaC / ftyp / RIFF / mvhd）的比较与查找。
 * @param buffer 字节视图
 * @param start 起始下标（含）
 * @param end 结束下标（不含）
 * @returns latin1 字符串
 */
const toLatin1 = (buffer: Uint8Array, start: number, end: number): string => {
  let text = ''
  for (let i = start; i < end; i += 1) text += String.fromCharCode(buffer[i])
  return text
}

/**
 * 从响应头取出文件总字节数
 *
 * Range 命中时总长在 `Content-Range` 的尾部；服务端忽略 Range 时总长就是 `Content-Length`。
 * @param headers 响应头
 * @param status 响应状态码
 * @returns 字节数；无法确定时返回 null
 */
const readTotalBytes = (headers: Record<string, string>, status: number): number | null => {
  const range = getResponseHeader(headers, 'content-range')
  if (typeof range === 'string') {
    const total = Number(range.split('/')[1])
    if (Number.isFinite(total) && total > 0) return total
  }
  // 206 的 Content-Length 只是本次分段长度，不能当总长
  if (status !== 206) {
    const length = Number(getResponseHeader(headers, 'content-length'))
    if (Number.isFinite(length) && length > 0) return length
  }
  return null
}

/**
 * 读取直链的文件头
 *
 * 经 http 封装层发起 Range 请求：上游支持 Range 时只传文件头分段；
 * 忽略 Range 时响应体完整进入内存（原生层无中途 abort，时间由 readTimeout 兜住）。
 * @param url 音频直链
 * @param headers 请求头
 * @returns 文件头字节与总字节数；读取失败返回 null
 */
const fetchHead = async (
  url: string,
  headers: Record<string, string>,
): Promise<{ buffer: Uint8Array; totalBytes: number | null } | null> => {
  let response
  try {
    response = await unblockRequest({
      url,
      headers: { ...headers, Range: `bytes=0-${HEAD_BYTES - 1}` },
      responseType: 'arraybuffer',
      timeout: PROBE_TIMEOUT,
    })
  } catch {
    return null
  }
  const status = response.status
  if (status < 200 || status >= 300) {
    return null
  }
  const totalBytes = readTotalBytes(response.headers, status)
  const buffer = response.data instanceof Uint8Array ? response.data : new Uint8Array(0)
  if (!buffer.length) return null
  return { buffer, totalBytes }
}

/**
 * 解析 FLAC 头，得到精确时长
 * @param buffer 文件头
 * @returns 时长（秒）与码率（kbps）；非 FLAC 或解析失败返回 null
 */
const parseFlac = (buffer: Uint8Array): { durationSec: number; bitrateKbps: number } | null => {
  if (buffer.length < 42 || toLatin1(buffer, 0, 4) !== 'fLaC') return null
  // STREAMINFO 紧跟 4 字节块头：20bit 采样率 + 36bit 总采样数
  const info = buffer.subarray(8, 42)
  const sampleRate = (info[10] << 12) | (info[11] << 4) | (info[12] >> 4)
  const totalSamples =
    (info[13] & 0x0f) * 2 ** 32 + (info[14] << 24) + (info[15] << 16) + (info[16] << 8) + info[17]
  if (!sampleRate || !totalSamples) return null
  const durationSec = totalSamples / sampleRate
  return { durationSec, bitrateKbps: 0 }
}

/**
 * 解析 MP4 / M4A 容器，取 mvhd 的时长
 * @param buffer 文件头
 * @returns 时长（秒）与码率（kbps）；非 MP4 或解析失败返回 null
 */
const parseMp4 = (buffer: Uint8Array): { durationSec: number; bitrateKbps: number } | null => {
  if (buffer.length < 16 || toLatin1(buffer, 4, 8) !== 'ftyp') return null
  let offset = 0
  while (offset + 8 <= buffer.length) {
    let size = readU32be(buffer, offset)
    const type = toLatin1(buffer, offset + 4, offset + 8)
    if (size === 1) {
      if (offset + 16 > buffer.length) break
      size = readU32be(buffer, offset + 8) * 2 ** 32 + readU32be(buffer, offset + 12)
    }
    if (!size || size < 8) break
    if (type === 'moov') {
      const moov = buffer.subarray(offset + 8, Math.min(offset + 8 + size, buffer.length))
      const index = toLatin1(moov, 0, moov.length).indexOf('mvhd')
      if (index >= 0 && index + 24 <= moov.length) {
        const version = moov[index + 4]
        const base = index + 8
        const timescale =
          version === 1 ? readU32be(moov, base + 16) : readU32be(moov, base + 8)
        const duration =
          version === 1
            ? readU32be(moov, base + 20) * 2 ** 32 + readU32be(moov, base + 24)
            : readU32be(moov, base + 12)
        if (timescale && duration) return { durationSec: duration / timescale, bitrateKbps: 0 }
      }
    }
    if (type === 'mdat') break
    offset += size
  }
  return null
}

/**
 * 解析 WAV 头，取 data 块时长
 * @param buffer 文件头
 * @returns 时长（秒）与码率（kbps）；非 WAV 或解析失败返回 null
 */
const parseWav = (buffer: Uint8Array): { durationSec: number; bitrateKbps: number } | null => {
  if (buffer.length < 44 || toLatin1(buffer, 0, 4) !== 'RIFF') return null
  const byteRate = readU32le(buffer, 28)
  if (!byteRate) return null
  let offset = 12
  while (offset + 8 <= buffer.length) {
    const id = toLatin1(buffer, offset, offset + 4)
    const size = readU32le(buffer, offset + 4)
    if (id === 'data') {
      return { durationSec: size / byteRate, bitrateKbps: (byteRate * 8) / 1000 }
    }
    offset += 8 + size + (size % 2)
  }
  return null
}

/**
 * 解析 MP3 帧头并估算真实时长
 *
 * MP3 无总帧数字段，只能按「帧头码率 + 音频字节数」估算：CBR 文件准确，VBR 会有偏差。
 * @param buffer 文件头
 * @param totalBytes 总字节数
 * @returns 时长（秒）与码率（kbps）；非 MP3 或解析失败返回 null
 */
const parseMp3 = (
  buffer: Uint8Array,
  totalBytes: number,
): { durationSec: number; bitrateKbps: number } | null => {
  let offset = 0
  if (buffer.length > 10 && toLatin1(buffer, 0, 3) === 'ID3') {
    const size =
      ((buffer[6] & 0x7f) << 21) |
      ((buffer[7] & 0x7f) << 14) |
      ((buffer[8] & 0x7f) << 7) |
      (buffer[9] & 0x7f)
    offset = 10 + size
  }
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] === 0xff && (buffer[offset + 1] & 0xe0) === 0xe0) {
      const versionBits = (buffer[offset + 1] >> 3) & 0x03
      const layerBits = (buffer[offset + 1] >> 1) & 0x03
      const bitrateIndex = (buffer[offset + 2] >> 4) & 0x0f
      const sampleRateIndex = (buffer[offset + 2] >> 2) & 0x03
      if (
        versionBits === 1 ||
        layerBits !== 1 ||
        bitrateIndex === 0 ||
        bitrateIndex === 15 ||
        sampleRateIndex === 3
      ) {
        break
      }
      const bitrateTable = versionBits === 3 ? MP3_BR_MPEG1 : MP3_BR_MPEG2
      const bitrateKbps = bitrateTable[bitrateIndex]
      const sampleRate = MP3_SAMPLE_RATES[versionBits]?.[sampleRateIndex]
      if (!bitrateKbps || !sampleRate) break
      const audioBytes = Math.max(0, totalBytes - offset)
      return { durationSec: (audioBytes * 8) / (bitrateKbps * 1000), bitrateKbps }
    }
    offset += 1
  }
  return null
}

/**
 * 探测音频直链的真实时长与体积
 *
 * @param url 音频直链
 * @param headers 取链请求头
 * @returns 探测结论
 */
export const probeAudio = async (
  url: string,
  headers: Record<string, string> = {},
): Promise<AudioProbe> => {
  const head = await fetchHead(url, headers)
  if (!head) {
    return { bytes: null, durationSec: null, bitrateKbps: null, format: 'unknown' }
  }
  const { buffer, totalBytes } = head
  const flac = parseFlac(buffer)
  if (flac) {
    return {
      bytes: totalBytes,
      durationSec: flac.durationSec,
      bitrateKbps:
        totalBytes && flac.durationSec
          ? Math.round((totalBytes * 8) / flac.durationSec / 1000)
          : null,
      format: 'flac',
    }
  }
  const mp4 = parseMp4(buffer)
  if (mp4) {
    return {
      bytes: totalBytes,
      durationSec: mp4.durationSec,
      bitrateKbps:
        totalBytes && mp4.durationSec
          ? Math.round((totalBytes * 8) / mp4.durationSec / 1000)
          : null,
      format: 'm4a',
    }
  }
  const wav = parseWav(buffer)
  if (wav) {
    return {
      bytes: totalBytes,
      durationSec: wav.durationSec,
      bitrateKbps: wav.bitrateKbps,
      format: 'wav',
    }
  }
  if (totalBytes) {
    const mp3 = parseMp3(buffer, totalBytes)
    if (mp3) {
      return {
        bytes: totalBytes,
        durationSec: mp3.durationSec,
        bitrateKbps: mp3.bitrateKbps,
        format: 'mp3',
      }
    }
  }
  return { bytes: totalBytes, durationSec: null, bitrateKbps: null, format: 'unknown' }
}
