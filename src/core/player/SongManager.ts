import { diagLog } from "@/utils/diag";
import { personalFm, personalFmToTrash } from "@/api/rec";
import { songUrl, unlockSongUrl } from "@/api/song";
import {
  resolvePlaybackFailureText,
  PLAYBACK_FAILED_TEXT,
  type PlatformFailure,
} from "@/api/platform/errorText";
import { kgSongUrl, normalizeKgHash } from "@/api/platform/kugou";
import { qqSongUrl } from "@/api/platform/qqmusic";
import { kgSongFM, qqSongFM } from "@/api/platform/songfm";
import { getPlatformLevel, mapPlatformQuality, type PlatformSongUrl } from "@/api/platform/types";
import { planPlayback, type PlaybackStep } from "@/core/player/playbackDecision";
import {
  useDataStore,
  useMusicStore,
  usePlatformStore,
  useSettingStore,
  useStatusStore,
  useStreamingStore,
} from "@/stores";
import { QualityType, type SongType } from "@/types/main";
import { SongUnlockServer, type ApiPlatform } from "@/types/shared";
import { isLogin } from "@/utils/auth";
import { isElectron, isCapacitor, isIos } from "@/utils/env";
import { formatSongsList } from "@/utils/format";
import { handleSongQuality } from "@/utils/helper";
import { isAudiobookSong, resolveSongPlatform } from "@/utils/songPlatform";
import { reportUnlockProbe } from "@/utils/probeReport";
import {
  classifyUnlockError,
  classifyUnlockFailure,
  type ProbeFailCategory,
  type ProbeSource,
} from "@/utils/probeSampling";
import { getPlatformLabel, getUnlockPriority } from "@/utils/unlockPriority";
import { UnlockUrlCache } from "@/utils/unlockUrlCache";

export { SongUnlockServer };

/**
 * 歌曲解锁优先级常量（网易云基线尝试序）
 */
export const SONG_UNLOCK_PRIORITY: readonly SongUnlockServer[] = [
  SongUnlockServer.XINGHAI,
  SongUnlockServer.FISH,
  SongUnlockServer.JIEXIANG,
  SongUnlockServer.NETEASE,
  SongUnlockServer.BODIAN,
  SongUnlockServer.KUWO,
  SongUnlockServer.GEQUBAO,
];

/**
 * 按优先级过滤出已启用的解锁渠道
 * @param channels 配置的渠道开关数组
 * @returns 按固定优先级排序的已启用渠道列表
 */
export const selectUnlockServers = (
  channels: readonly { key: SongUnlockServer; enabled: boolean }[] | undefined,
): SongUnlockServer[] => {
  if (!channels || channels.length === 0) return [];
  const enabled = new Set(channels.filter((c) => c.enabled).map((c) => c.key));
  return SONG_UNLOCK_PRIORITY.filter((server) => enabled.has(server));
};

/**
 * 获取解锁源的中文名称
 * @param server 解锁服务器标识
 * @returns 中文名称
 */
export const getUnlockSourceName = (server: SongUnlockServer): string => {
  const nameMap: Record<SongUnlockServer, string> = {
    [SongUnlockServer.NETEASE]: "网易云",
    [SongUnlockServer.BODIAN]: "波点音乐",
    [SongUnlockServer.GEQUBAO]: "歌曲宝",
    [SongUnlockServer.KUWO]: "酷我音乐",
    [SongUnlockServer.MIGU]: "咪咕音乐",
    [SongUnlockServer.CHANGQING]: "长青聚合",
    [SongUnlockServer.LXMUSIC]: "落雪音源",
    [SongUnlockServer.XINGHAI]: "星海音源",
    [SongUnlockServer.FISH]: "小鱼音源",
    [SongUnlockServer.JIEXIANG]: "吉祥音源",
  };
  return nameMap[server] || server;
};

/**
 * URL 日志脱敏：只保留协议、域名与路径，隐藏 query 中的签名/token 参数
 * 解析失败时回退为截断输出
 */
const sanitizeUrlForLog = (url: string): string => {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return url.length > 80 ? `${url.substring(0, 80)}...` : url;
  }
};

/** 歌曲播放地址信息 */
export type AudioSource = {
  /** 歌曲id */
  id: number;
  /** 歌曲播放地址 */
  url?: string;
  /** 是否解锁 */
  isUnlocked?: boolean;
  /** 是否为试听 */
  isTrial?: boolean;
  /** 音质 */
  quality?: QualityType;
  /** 解锁源名称（如果使用了解锁服务） */
  unlockSource?: string | null;
  /** 播放失败的用户可读原因（无源可用时给出） */
  failureReason?: string;
};

/** 推荐流单批曲目数 */
const SONG_FM_BATCH_SIZE = 20;

/** 第三方平台的歌曲缺歌手时的拒绝原因（用户可读） */
const MISSING_ARTIST_REASON = "缺少歌手信息，无法安全换源";

/** 歌曲缺少编号时的拒绝原因（用户可读） */
const MISSING_SONG_ID_REASON = "缺少编号信息，无法获取播放链接";

/** 歌曲缺少歌名时的拒绝原因（用户可读） */
const MISSING_SONG_NAME_REASON = "缺少歌名，无法检索播放链接";

/** 未开启任何换源服务时的拒绝原因（用户可读） */
const NO_UNLOCK_SERVER_REASON = "未开启换源功能，无法获取播放链接";

/**
 * 换源服务 → 可用性上报的源标识
 *
 * 上报只覆盖换源解锁链上的站外源；官方直链（各平台自身的播放地址）
 * 不上报 —— 它的成败属于平台侧状态，不代表音源可用性。
 *
 * 只登记上报接口已收录的源：未登记的源不产生上报请求，
 * 避免上报接口按无效源标识拒收。
 */
const PROBE_SOURCE_BY_SERVER: Partial<Record<SongUnlockServer, ProbeSource>> = {
  [SongUnlockServer.NETEASE]: "netease",
  [SongUnlockServer.BODIAN]: "bodian",
  [SongUnlockServer.KUWO]: "kuwo",
  [SongUnlockServer.MIGU]: "migu",
  [SongUnlockServer.CHANGQING]: "changqing",
  [SongUnlockServer.LXMUSIC]: "lxmusic",
  [SongUnlockServer.XINGHAI]: "xinghai",
  [SongUnlockServer.FISH]: "fish",
  [SongUnlockServer.JIEXIANG]: "jiexiang",
  [SongUnlockServer.GEQUBAO]: "gequbao",
};

/**
 * 取歌曲的歌手名
 *
 * 多个歌手时全部取用（用 ` / ` 连接），便于站外检索源准确匹配。
 * @param song 歌曲
 * @returns 歌手名
 */
const resolveSongArtist = (song: SongType): string => {
  const artists = song.artists;
  if (Array.isArray(artists)) {
    return artists
      .map((artist) => artist?.name ?? "")
      .filter(Boolean)
      .join(" / ");
  }
  return artists ?? "";
};

/**
 * 生成歌曲的缓存键
 *
 * 平台歌曲用「平台-数字 ID」做键，避免与网易云同数字 ID 的歌曲互相覆盖缓存。
 * @param song 歌曲
 * @returns 缓存键
 */
const buildCacheKey = (song: SongType): string | number => {
  const platform = resolveSongPlatform(song);
  return platform === "netease" ? song.id : `${platform}-${song.id}`;
};

/**
 * 生成播放标识（平台 + 数字 ID），用于预载结果匹配
 * @param song 歌曲
 * @param songId 歌曲 ID
 * @returns 播放标识
 */
const buildPlayKey = (song: SongType, songId: number): string =>
  `${resolveSongPlatform(song)}:${songId}`;

/**
 * 判断是否为第三方平台音源歌曲
 * @param song 歌曲
 * @returns 是否为第三方平台音源
 */
const isPlatformSource = (song?: SongType | null): boolean =>
  resolveSongPlatform(song) !== "netease";

/** 换源成功直链的进程内缓存 */
const unlockedUrlCache = new UnlockUrlCache<QualityType>();

class SongManager {
  /** 预载下一首歌曲播放信息 */
  private nextPrefetch: AudioSource | undefined;
  /** 预载歌曲的播放标识（平台 + 数字 ID） */
  private nextPrefetchKey: string | undefined;
  /** 最近一次第三方平台的播放失败详情（用于最终失败时的用户提示） */
  private lastPlatformFailure: PlatformFailure | undefined;
  /** 最近一次换源链的用户可读失败原因（用于最终失败时的用户提示） */
  private lastUnlockFailure: string | undefined;

  /**
   * 预加载封面图片
   * @param song 歌曲信息
   */
  private prefetchCover(song: SongType): void {
    if (!song || song.path) return; // 本地歌曲跳过

    const coverUrls: string[] = [];

    // 收集需要预加载的封面 URL
    if (song.coverSize) {
      // 优先预加载大尺寸封面
      if (song.coverSize.xl) coverUrls.push(song.coverSize.xl);
      if (song.coverSize.l) coverUrls.push(song.coverSize.l);
    }
    if (song.cover && !coverUrls.includes(song.cover)) {
      coverUrls.push(song.cover);
    }
    // 预加载图片
    coverUrls.forEach((url) => {
      if (!url || !url.startsWith("http")) return;
      const img = new Image();
      // 清理
      const cleanup = () => {
        img.onload = null;
        img.onerror = null;
      };
      img.onload = cleanup;
      img.onerror = cleanup;
      img.src = url;
    });
  }

  /**
   * 检查本地缓存
   * @param id 缓存键（网易云为歌曲 ID，平台歌曲为「平台-歌曲 ID」）
   * @param quality 音质
   */
  private checkLocalCache = async (
    id: number | string,
    quality?: QualityType,
  ): Promise<string | null> => {
    const settingStore = useSettingStore();
    if (isElectron && settingStore.cacheEnabled && settingStore.songCacheEnabled) {
      try {
        const cachePath = await window.electron.ipcRenderer.invoke(
          "music-cache-check",
          id,
          quality,
        );
        if (cachePath) {
          console.log(`🚀 [${id}] 由本地音乐缓存提供`);
          return `file://${cachePath}`;
        }
      } catch (e) {
        console.error(`❌ [${id}] 检查缓存失败:`, e);
      }
    }
    return null;
  };

  /**
   * 触发缓存下载
   * @param id 缓存键（网易云为歌曲 ID，平台歌曲为「平台-歌曲 ID」）
   * @param url 下载地址
   * @param quality 音质
   */
  private triggerCacheDownload = (
    id: number | string,
    url: string,
    quality?: QualityType | string,
  ) => {
    const settingStore = useSettingStore();
    if (isElectron && settingStore.cacheEnabled && settingStore.songCacheEnabled && url) {
      window.electron.ipcRenderer.invoke("music-cache-download", id, url, quality || "standard");
    }
  };

  /**
   * 获取解锁源的中文名称
   * @param server 解锁服务器标识
   * @returns 中文名称
   */
  private getUnlockSourceName(server: SongUnlockServer): string {
    return getUnlockSourceName(server);
  }

  /**
   * 匿名上报换源结果
   *
   * 只上报「源 / 成败 / 耗时 / 失败类别」四个字段，不含歌名与任何身份信息；
   * 用户关闭「匿名上报音源可用性」后完全不上报；
   * 上报接口未收录的源不发请求。
   * @param server 换源服务标识
   * @param success 本次取链是否成功
   * @param durationMs 本次取链耗时（毫秒）
   * @param failCategory 失败类别（成功时忽略）
   */
  private reportSourceProbe = (
    server: SongUnlockServer,
    success: boolean,
    durationMs: number,
    failCategory: ProbeFailCategory = "none",
  ): void => {
    const settingStore = useSettingStore();
    if (!settingStore.anonymousProbeReport) return;
    const source = PROBE_SOURCE_BY_SERVER[server];
    if (!source) return;
    reportUnlockProbe({
      source,
      success,
      durationMs,
      failCategory: success ? "none" : failCategory,
    });
  };

  /**
   * Web 端 URL 统一处理：通过代理转发
   * Electron 端：直接返回原始 URL
   * @param url 原始 URL
   * @param cacheKey 缓存 Key (如歌曲 ID 或平台复合键)
   * @param referer 可选的防盗链 Referer
   * @returns 处理后的 URL
   */
  private processUrlForWeb(
    url: string | null | undefined,
    cacheKey?: string | number,
    referer?: string,
  ): string | null | undefined {
    if (!url) return url;

    // 空字符串或无效 URL，返回 undefined
    if (url.trim() === "") {
      console.warn("⚠️ processUrlForWeb: 收到空字符串 URL");
      return undefined;
    }

    // 对 music.126.net 域的 http:// 直链在送入代理前统一提升为 https://
    let targetUrl = url.trim();
    try {
      const parsed = new URL(targetUrl);
      if (
        parsed.protocol === "http:" &&
        (parsed.hostname === "music.126.net" || parsed.hostname.endsWith(".music.126.net"))
      ) {
        parsed.protocol = "https:";
        targetUrl = parsed.toString();
      }
    } catch {
      // 若 URL 解析异常保持原样
    }

    // 已经是代理 URL 或本地文件，直接返回
    if (targetUrl.startsWith("/api/proxy/audio") || targetUrl.startsWith("file://")) {
      return targetUrl;
    }

    // Capacitor 环境：通过本地代理转发（NanoHTTPD 在手机本地运行，添加 CORS 头）
    // 不消耗远程服务器带宽，同时保证 Web Audio API（均衡器、频谱）正常工作
    if (isCapacitor) {
      let proxyUrl = isIos
        ? `capacitor-audio://proxy/audio?url=${encodeURIComponent(targetUrl)}`
        : `http://localhost:18520/proxy/audio?url=${encodeURIComponent(targetUrl)}`;
      // 传递稳定的缓存 key（歌曲 ID 或平台复合键），避免 URL 中的时间戳/token 变化导致缓存失效
      if (cacheKey) {
        proxyUrl += `&key=${encodeURIComponent(String(cacheKey))}`;
      }
      if (isIos && referer) {
        proxyUrl += `&referer=${encodeURIComponent(referer)}`;
      }
      let diagHost = "?";
      try { diagHost = new URL(targetUrl).host; } catch { /* 解析失败保持占位 */ }
      diagLog(`代理URL构建 host=${diagHost}`);
      console.log(`🌐 [Capacitor] 使用本地代理转发音频`);
      return proxyUrl;
    }

    // Web 端：通过代理转发，解决 CORS 问题
    try {
      const urlObj = new URL(targetUrl);
      // 只对 HTTP/HTTPS URL 进行代理
      if (urlObj.protocol === "http:" || urlObj.protocol === "https:") {
        // Web 环境：使用相对路径（通过 Vite 代理或 nginx 转发）
        const proxyUrl = `/api/proxy/audio?url=${encodeURIComponent(targetUrl)}`;
        console.log(`🌐 [Web] 使用代理转发音频`);
        return proxyUrl;
      }
    } catch (e) {
      console.error("⚠️ processUrlForWeb: URL 格式错误", e);
      return undefined;
    }

    return targetUrl;
  }

  /**
   * 获取官方播放链接
   *
   * 按歌曲来源平台分派：网易云走既有链路，QQ 音乐与酷狗走各自的平台模块。
   * @param songOrId 歌曲对象或歌曲 ID
   * @param songIdOrIsPc 歌曲 ID（当首参为歌曲时）或是否为云盘歌曲（当首参为 ID 时）
   * @param isPcArg 是否为云盘歌曲
   * @returns 在线播放信息
   */
  public getOnlineUrl = async (
    songOrId: SongType | number,
    songIdOrIsPc: number | boolean = false,
    isPcArg: boolean = false,
  ): Promise<AudioSource> => {
    let song: SongType | undefined;
    let songId: number;
    let isPc: boolean;

    if (typeof songOrId === "number") {
      songId = songOrId;
      isPc = typeof songIdOrIsPc === "boolean" ? songIdOrIsPc : false;
    } else {
      song = songOrId;
      songId = typeof songIdOrIsPc === "number" ? songIdOrIsPc : song.id;
      isPc = isPcArg;
    }

    if (song && isPlatformSource(song)) {
      const platform = resolveSongPlatform(song);
      if (platform === "qqmusic") return this.getQqOnlineUrl(song);
      if (platform === "kugou") return this.getKgOnlineUrl(song);
    }
    return this.getNeteaseOnlineUrl(songId, isPc);
  };

  /**
   * 获取网易云官方播放链接（保持网易云既有函数体与行为零变化）
   * @param id 歌曲id
   * @param isPc 是否为云盘歌曲
   * @returns 在线播放信息
   */
  private getNeteaseOnlineUrl = async (id: number, isPc: boolean = false): Promise<AudioSource> => {
    const settingStore = useSettingStore();
    const level = isPc ? "exhigh" : settingStore.songLevel;
    const res = await songUrl(id, level);
    console.log(`🌐 [Debug] ${id} songUrl 原始响应:`, JSON.stringify(res).substring(0, 500));
    const songData = res.data?.[0];
    // 是否有播放地址
    if (!songData || !songData?.url) {
      console.warn(`⚠️ [${id}] 官方链接获取失败：无播放地址`);
      return { id, url: undefined };
    }
    // 是否仅能试听
    const isTrial = songData?.freeTrialInfo !== null;
    // 统一使用原始 URL（与 Electron 端一致，不再进行 URL 转换）
    const originalUrl = songData.url;
    // 检查原始 URL 是否有效
    if (!originalUrl || originalUrl.trim() === "") {
      console.warn(`⚠️ [${id}] 官方链接无效：空 URL`);
      return { id, url: undefined, isTrial, quality: undefined };
    }
    // 获取音质
    const quality = handleSongQuality(songData, "online");
    // 检查本地缓存（仅 Electron 端且非试听时）
    if (originalUrl && quality && isElectron && !isTrial) {
      const cachedUrl = await this.checkLocalCache(id, quality);
      if (cachedUrl) {
        console.log(`✅ [${id}] 使用本地缓存播放`);
        return { id, url: cachedUrl, isTrial: false, quality, unlockSource: "cache" };
      }
    }
    // Web 端：统一通过代理转发（与 Electron 端逻辑对齐）
    let processedUrl: string | null | undefined = originalUrl;
    if (!isElectron && originalUrl) {
      processedUrl = this.processUrlForWeb(originalUrl, id);
      if (!processedUrl) {
        console.error(`❌ [${id}] Web 端 URL 处理失败，原始 URL:`, originalUrl);
        return { id, url: undefined, isTrial, quality };
      }
      console.log(`🌐 [${id}] Web 端使用代理接口，原始 URL:`, originalUrl, "代理 URL:", processedUrl);
    }
    // 缓存对应音质音乐（仅 Electron 端且非试听完整歌曲才缓存）
    if (originalUrl && isElectron && !isTrial) {
      this.triggerCacheDownload(id, originalUrl, quality);
    }
    // 确保 null/undefined 转换为 undefined，保持与 AudioSource 类型一致
    const finalProcessedUrl = processedUrl || undefined;
    console.log(`📦 [${id}] getOnlineUrl 最终返回:`, { url: finalProcessedUrl, isTrial, quality });
    return { id, url: finalProcessedUrl, isTrial, quality, unlockSource: "official" };
  };

  /**
   * 获取 QQ 音乐官方播放链接
   * @param song 歌曲
   * @returns 在线播放信息
   */
  private getQqOnlineUrl = async (song: SongType): Promise<AudioSource> => {
    const settingStore = useSettingStore();
    const mid = song.platformId ?? String(song.id);
    const level = getPlatformLevel("qqmusic", settingStore.songLevel);
    let res: PlatformSongUrl;
    try {
      res = await qqSongUrl(mid, level);
    } catch (error) {
      console.error(`❌ [${song.id}] QQ 音乐播放地址获取失败:`, error);
      return { id: song.id, url: undefined, isTrial: false, unlockSource: "official" };
    }
    console.log(`🌐 [${song.id}] QQ 音乐播放地址:`, {
      available: res.available,
      isTrial: res.isTrial,
      level: res.level,
      reason: res.reason,
    });
    // 失败原因留给最终失败提示用（付费 / 无授权 / 凭证异常）
    if (!res.available) {
      this.lastPlatformFailure = { platform: "qqmusic", reason: res.reason };
    }
    return this.buildPlatformAudioSource(song, res);
  };

  /**
   * 获取酷狗官方播放链接
   * @param song 歌曲
   * @returns 在线播放信息
   */
  private getKgOnlineUrl = async (song: SongType): Promise<AudioSource> => {
    const settingStore = useSettingStore();
    const hash = normalizeKgHash(song.platformId ?? song.id);
    const level = getPlatformLevel("kugou", settingStore.songLevel);
    const isAudiobook = isAudiobookSong(song);
    const album = typeof song.album === "object" && song.album ? song.album : null;
    const albumId = isAudiobook ? Number(album?.platformId ?? album?.id ?? 0) : 0;
    const albumAudioId = isAudiobook ? Number(song.id) : 0;
    let res: PlatformSongUrl;
    try {
      res = await kgSongUrl(hash, level, { albumId, albumAudioId });
    } catch (error) {
      console.error(`❌ [${song.id}] 酷狗播放地址获取失败:`, error);
      return { id: song.id, url: undefined, isTrial: false, unlockSource: "official" };
    }
    console.log(`🌐 [${song.id}] 酷狗播放地址:`, {
      available: res.available,
      isTrial: res.isTrial,
      status: res.status,
      privilege: res.privilege,
      level: res.level,
    });
    if (!res.available) {
      this.lastPlatformFailure = {
        platform: "kugou",
        reason: res.reason,
        status: res.status,
        privilege: res.privilege,
      };
    }
    return this.buildPlatformAudioSource(song, res);
  };

  /**
   * 整理平台播放地址为音频源
   *
   * 试听判据：QQ 音乐取 `isTrial`；酷狗取 `status === 2`（付费墙）或 `isTrial`。
   * 试听片段只记录不落缓存 —— 缓存里放的是整曲文件，片段会污染缓存键。
   * @param song 歌曲
   * @param res 平台播放地址
   * @returns 在线播放信息
   */
  private buildPlatformAudioSource = async (
    song: SongType,
    res: PlatformSongUrl,
  ): Promise<AudioSource> => {
    const id = song.id;
    const isTrial = res.isTrial === true || res.status === 2;
    const quality = mapPlatformQuality(res.level);
    const rawUrl = res.url?.trim() ? res.url.trim() : undefined;
    if (!rawUrl) {
      console.warn(`⚠️ [${id}] 官方链接获取失败：无播放地址`);
      return { id, url: undefined, isTrial, quality, unlockSource: "official" };
    }
    const cacheKey = buildCacheKey(song);
    if (!isTrial && quality && isElectron) {
      const cachedUrl = await this.checkLocalCache(cacheKey, quality);
      if (cachedUrl) {
        console.log(`✅ [${id}] 使用本地缓存播放`);
        return { id, url: cachedUrl, isTrial, quality, unlockSource: "cache" };
      }
    }
    let processedUrl: string | null | undefined = rawUrl;
    if (!isElectron && rawUrl) {
      processedUrl = this.processUrlForWeb(rawUrl, cacheKey);
      if (!processedUrl) {
        console.error(`❌ [${id}] 播放 URL 处理失败，原始 URL:`, rawUrl);
        return { id, url: undefined, isTrial, quality, unlockSource: "official" };
      }
      console.log(
        `🌐 [${id}] 播放使用代理接口，原始 URL:`,
        rawUrl,
        "代理 URL:",
        processedUrl,
      );
    }
    if (!isTrial && isElectron) {
      this.triggerCacheDownload(cacheKey, rawUrl, quality);
    }
    const finalProcessedUrl = processedUrl || undefined;
    console.log(`📦 [${id}] getOnlineUrl 最终返回:`, {
      url: finalProcessedUrl,
      isTrial,
      quality,
    });
    return { id, url: finalProcessedUrl, isTrial, quality, unlockSource: "official" };
  };

  /**
   * 获取解锁播放链接
   * @param song 歌曲数据
   * @returns 音频源
   */
  public getUnlockSongUrl = async (song: SongType): Promise<AudioSource> => {
    const settingStore = useSettingStore();
    const songId = song.id;
    const platform = resolveSongPlatform(song);
    const isNeteaseSong = platform === "netease";
    const cacheKey = buildCacheKey(song);

    // 优先检查本地缓存
    const cachedUrl = await this.checkLocalCache(cacheKey);
    if (cachedUrl) {
      return { id: songId, url: cachedUrl, isUnlocked: true, unlockSource: "cache" };
    }

    // 提取歌手名：平台歌曲使用 resolveSongArtist 提取全量合作歌手
    const artist = isNeteaseSong
      ? (Array.isArray(song.artists) ? song.artists[0]?.name : song.artists) ?? ""
      : resolveSongArtist(song);
    const songName = song.name;
    if (!songId || !songName) {
      return {
        id: songId,
        url: undefined,
        failureReason: !songId ? MISSING_SONG_ID_REASON : MISSING_SONG_NAME_REASON,
      };
    }

    // 第三方平台歌曲进行关键词换源时必须有歌手信息，防范跨平台同名曲目张冠李戴
    if (!isNeteaseSong && !artist) {
      console.warn(`⚠️ [${songId}] ${MISSING_ARTIST_REASON}：${songName}`);
      return { id: songId, url: undefined, failureReason: MISSING_ARTIST_REASON };
    }

    // 按平台分派换源优先级
    const priorityOrder = getUnlockPriority(platform);

    // 获取启用的音源列表，并按优先级排序
    const enabledServers = settingStore.songUnlockServer
      ? settingStore.songUnlockServer.filter((s) => s.enabled).map((s) => s.key)
      : [];

    if (enabledServers.length === 0) {
      return { id: songId, url: undefined, failureReason: NO_UNLOCK_SERVER_REASON };
    }

    // 按优先级顺序排序启用的服务器
    let sortedServers = priorityOrder.filter((server) => enabledServers.includes(server));

    // A-05 铁律防御：非网易云歌曲绝不允许拿平台 ID 查网易云
    if (!isNeteaseSong) {
      sortedServers = sortedServers.filter((server) => server !== SongUnlockServer.NETEASE);
    }

    if (sortedServers.length === 0) {
      return { id: songId, url: undefined, failureReason: NO_UNLOCK_SERVER_REASON };
    }

    // 检查换源直链内存缓存
    const cachedUnlocked = unlockedUrlCache.get(String(cacheKey));
    if (cachedUnlocked) {
      const cachedUrl = this.processUrlForWeb(cachedUnlocked.url, cacheKey);
      console.log(`♻️ [${songId}] 命中换源直链缓存（${cachedUnlocked.unlockSource}）`);
      return {
        id: songId,
        url: cachedUrl || undefined,
        isUnlocked: true,
        quality: cachedUnlocked.quality,
        unlockSource: cachedUnlocked.unlockSource,
      };
    }

    console.log(`[UNLOCK] [${songId}] 开始按优先级尝试解锁服务（平台：${getPlatformLabel(platform)}）`);
    console.log(
      `[UNLOCK] [${songId}] 启用的服务: ${sortedServers.map((s) => this.getUnlockSourceName(s)).join(", ")}`,
    );
    console.log(
      `[UNLOCK] [${songId}] 优先级顺序: ${sortedServers.map((s) => this.getUnlockSourceName(s)).join(" -> ")}`,
    );

    const failures: string[] = [];
    for (const server of sortedServers) {
      const sourceName = this.getUnlockSourceName(server);
      const startedAt = Date.now();
      try {
        console.log(`[UNLOCK] [${songId}] 正在尝试解锁服务: ${sourceName} (${server})...`);
        const platformId =
          song.platformId || (isNeteaseSong ? String(songId) : undefined);
        const duration =
          typeof song.duration === "number" && song.duration > 0
            ? Math.round(song.duration / 1000)
            : undefined;
        const result = await unlockSongUrl(songId, songName, artist, server, {
          duration,
          platform,
          platformId,
        });
        const durationMs = Date.now() - startedAt;
        console.log(`[UNLOCK] [${songId}] ${sourceName} 返回结果:`, result);

        if (result.code === 200 && result.url && result.url.trim() !== "") {
          const originalUrl = result.url.trim();
          diagLog(`解锁尝试 源=${server} 歌曲id=${songId}`);
          this.reportSourceProbe(server, true, durationMs);
          const referer = server === SongUnlockServer.GEQUBAO ? "https://gequbao.com/" : undefined;
          const unlockUrl = this.processUrlForWeb(originalUrl, cacheKey, referer);
          const finalUnlockUrl = unlockUrl || undefined;

          if (!finalUnlockUrl || finalUnlockUrl.trim() === "") {
            console.error(`[UNLOCK] [${songId}] ${sourceName} 处理后的 URL 无效，跳过此服务`);
            continue;
          }

          let quality = QualityType.HQ;
          if (originalUrl.includes(".flac") || originalUrl.includes(".wav")) {
            quality = QualityType.SQ;
          }

          console.log(`[UNLOCK] [${songId}] 解锁成功！`);
          console.log(`   📍 解锁源: ${sourceName} (${server})`);
          console.log(`   🎵 音质: ${quality}`);

          this.triggerCacheDownload(cacheKey, originalUrl);

          unlockedUrlCache.set(String(cacheKey), {
            url: originalUrl,
            quality,
            unlockSource: server,
          });

          return {
            id: songId,
            url: finalUnlockUrl,
            isUnlocked: true,
            quality,
            unlockSource: server,
          };
        } else {
          failures.push(`${sourceName}：未找到可用链接`);
          this.reportSourceProbe(
            server,
            false,
            durationMs,
            classifyUnlockFailure(result.reason),
          );
          console.warn(`[UNLOCK] [${songId}] ${sourceName} 返回失败，继续尝试下一个服务...`);
        }
      } catch (error) {
        const durationMs = Date.now() - startedAt;
        failures.push(`${sourceName}：请求失败`);
        this.reportSourceProbe(server, false, durationMs, classifyUnlockError(error));
        console.error(`[UNLOCK] [${songId}] ${sourceName} 请求失败:`, error);
      }
    }

    console.warn(`[UNLOCK] [${songId}] 所有解锁服务均失败：${failures.join("；")}`);
    return { id: songId, url: undefined, failureReason: PLAYBACK_FAILED_TEXT };
  };

  /**
   * 执行播放决策树的单一步骤
   * @param step 决策步骤
   * @param song 歌曲
   * @param songId 歌曲 ID
   * @param official 官方直链信息
   * @param notify 是否弹出提示
   * @returns 命中的音频源
   */
  private resolvePlaybackStep = async (
    step: PlaybackStep,
    song: SongType,
    songId: number,
    official: AudioSource,
    notify: boolean,
  ): Promise<AudioSource | undefined> => {
    switch (step) {
      case "official": {
        if (!official.url) return undefined;
        return { ...official, id: songId };
      }
      case "unlock": {
        console.log(`🔓 [${songId}] 官方链接无效或仅可试听，尝试解锁兜底...`);
        const unlockResult = await this.getUnlockSongUrl(song);
        if (unlockResult.url && unlockResult.url.trim() !== "") {
          console.log(`✅ [${songId}] 解锁成功，使用解锁链接播放`);
          return unlockResult;
        }
        if (notify) this.lastUnlockFailure = unlockResult.failureReason;
        return undefined;
      }
      case "trial": {
        if (!official.url) return undefined;
        console.warn(`⚠️ [${songId}] 解锁失败，回落官方试听片段`);
        if (notify) {
          try {
            window.$message?.warning("当前歌曲仅可试听");
          } catch {
            // 单测或无组件环境忽略
          }
        }
        return {
          id: songId,
          url: official.url,
          quality: official.quality,
          isUnlocked: false,
          isTrial: true,
          unlockSource: "official",
        };
      }
      case "cache": {
        const fallbackUrl = await this.checkLocalCache(buildCacheKey(song));
        if (!fallbackUrl) return undefined;
        console.log(`🚀 [${songId}] 网络请求失败，使用本地缓存兜底`);
        return { id: songId, url: fallbackUrl, isUnlocked: true, unlockSource: "cache" };
      }
      default:
        return undefined;
    }
  };

  /**
   * 汇总播放最终失败的用户可读原因
   * @returns 用户可读原因
   */
  private takePlaybackFailureReason = (): string => {
    const failure = this.lastPlatformFailure;
    this.lastPlatformFailure = undefined;
    const localReason = this.lastUnlockFailure;
    this.lastUnlockFailure = undefined;
    return resolvePlaybackFailureText(failure, localReason);
  };

  /**
   * 预载下一首歌曲播放地址
   * @returns 预载数据
   */
  public getNextSongUrl = async (): Promise<AudioSource | undefined> => {
    try {
      const dataStore = useDataStore();
      const statusStore = useStatusStore();
      const settingStore = useSettingStore();

      // 无列表或私人FM模式直接跳过
      const playList = dataStore.playList;
      if (!playList?.length || statusStore.personalFmMode) {
        return;
      }

      // 计算下一首（循环到首）
      let nextIndex = statusStore.playIndex + 1;
      if (nextIndex >= playList.length) nextIndex = 0;
      const nextSong = playList[nextIndex];
      if (!nextSong) return;

      // 预加载封面图片
      this.prefetchCover(nextSong);

      // 本地歌曲跳过
      if (nextSong.path) return;

      // 流媒体歌曲
      if (nextSong.type === "streaming" && nextSong.streamUrl) {
        this.nextPrefetch = {
          id: nextSong.id,
          url: nextSong.streamUrl,
          isUnlocked: false,
          quality: QualityType.SQ,
          unlockSource: "streaming",
        };
        this.nextPrefetchKey = buildPlayKey(nextSong, nextSong.id);
        return this.nextPrefetch;
      }

      // 在线歌曲：优先官方，其次解灰
      const songId = nextSong.type === "radio" ? nextSong.dj?.id : nextSong.id;
      if (!songId) return;

      // 是否可解锁（非电台、非听书且开启解锁）
      const canUnlock =
        nextSong.type !== "radio" && !isAudiobookSong(nextSong) && settingStore.useSongUnlock;

      // 官方链接（按平台分派）
      const official = await this.getOnlineUrl(nextSong, songId, !!nextSong.pc);
      const steps = planPlayback({
        hasOfficialUrl: Boolean(official.url),
        isTrial: Boolean(official.isTrial),
        canUnlock,
        playSongDemo: settingStore.playSongDemo,
      });

      for (const step of steps) {
        const source = await this.resolvePlaybackStep(step, nextSong, songId, official, false);
        if (source) {
          this.nextPrefetch = source;
          this.nextPrefetchKey = buildPlayKey(nextSong, songId);
          return this.nextPrefetch;
        }
      }

      return;
    } catch (error) {
      console.error("❌ 预加载下一首歌曲地址失败", error);
      return;
    }
  };

  /**
   * 清除预加载缓存
   */
  public clearPrefetch() {
    this.nextPrefetch = undefined;
    this.nextPrefetchKey = undefined;
    console.log("🧹 已清除歌曲 URL 缓存");
  }

  /**
   * 获取音频源
   * 始终从此方法获取对应歌曲播放信息
   * @param song 歌曲
   * @returns 音频源
   */
  public getAudioSource = async (song: SongType): Promise<AudioSource> => {
    const settingStore = useSettingStore();
    const songId = song.type === "radio" ? song.dj?.id : song.id;
    this.lastUnlockFailure = undefined;
    this.lastPlatformFailure = undefined;
    console.log(`🎵 [${songId || song.id}] 开始获取音频源，类型: ${song.type}`, { isElectron, song });

    // 本地文件直接返回（仅 Electron 端）
    if (song.path && song.type !== "streaming") {
      if (!isElectron) {
        console.warn(`⚠️ [${song.id}] Web 端不支持本地文件播放`);
        return { id: song.id, url: undefined };
      }
      // 检查本地文件是否存在
      const result = await window.electron.ipcRenderer.invoke("file-exists", song.path);
      if (!result) {
        this.nextPrefetch = undefined;
        this.nextPrefetchKey = undefined;
        console.error("❌ 本地文件不存在");
        return { id: song.id, url: undefined };
      }
      const encodedPath = song.path.replace(/#/g, "%23").replace(/\?/g, "%3F");
      console.log(`✅ [${song.id}] 使用本地文件播放`);
      return { id: song.id, url: `file://${encodedPath}`, unlockSource: "local" };
    }

    // Stream songs (Subsonic / Jellyfin)
    if (song.type === "streaming" && song.streamUrl) {
      const streamingStore = useStreamingStore();
      const finalUrl = streamingStore.getSongUrl(song);
      console.log(`🔄 [${song.id}] Stream URL:`, finalUrl);
      // 验证流媒体 URL 是否有效
      if (!finalUrl || finalUrl.trim() === "") {
        console.warn(`⚠️ [${song.id}] 流媒体 URL 无效`);
        return { id: song.id, url: undefined, isUnlocked: false, quality: song.quality };
      }
      return {
        id: song.id,
        url: finalUrl,
        isUnlocked: false,
        quality: song.quality || QualityType.SQ,
        unlockSource: "streaming",
      };
    }

    // 在线歌曲
    if (!songId) return { id: 0, url: undefined, quality: undefined, isUnlocked: false };

    // 检查预加载缓存：使用平台维度复合键
    const playKey = buildPlayKey(song, songId);
    if (
      this.nextPrefetch &&
      (this.nextPrefetchKey === playKey || (!this.nextPrefetchKey && this.nextPrefetch.id === songId)) &&
      settingStore.useNextPrefetch
    ) {
      const cachedSource = this.nextPrefetch;
      // 验证缓存的 URL 是否有效
      if (cachedSource.url && cachedSource.url.trim() !== "") {
        console.log(`🚀 [${songId}] 使用预加载缓存播放`);
        this.nextPrefetch = undefined;
        this.nextPrefetchKey = undefined;
        return cachedSource;
      } else {
        console.warn(`⚠️ [${songId}] 预加载缓存 URL 无效，重新获取`);
        this.nextPrefetch = undefined;
        this.nextPrefetchKey = undefined;
      }
    }

    // 在线获取
    try {
      // 是否可解锁（非电台、非听书且开启解锁）
      const canUnlock =
        song.type !== "radio" && !isAudiobookSong(song) && settingStore.useSongUnlock;

      // 官方链接（按来源平台分派：网易云 / QQ 音乐 / 酷狗音乐）
      const official = await this.getOnlineUrl(song, songId, !!song.pc);
      diagLog(`官方链接 id=${songId} 结果=${official.url ? "有" : "无"} 试听=${official.isTrial}`);
      console.log(`[SONG] [${songId}] 官方链接获取结果:`, official);

      // 播放决策树：官方完整可播 → 解锁换源 → 官方试听 → 本地缓存
      const steps = planPlayback({
        hasOfficialUrl: Boolean(official.url),
        isTrial: Boolean(official.isTrial),
        canUnlock,
        playSongDemo: settingStore.playSongDemo,
      });

      for (const step of steps) {
        const source = await this.resolvePlaybackStep(step, song, songId, official, true);
        if (source) return source;
      }

      // 无可用源
      console.error(`❌ [${songId}] 所有音频源获取失败，无可用链接`);
      const failureReason = this.takePlaybackFailureReason();
      return {
        id: songId,
        url: undefined,
        quality: undefined,
        isUnlocked: false,
        unlockSource: null,
        failureReason,
      };
    } catch (e) {
      console.error(`❌ [${songId}] 获取音频源异常:`, e);
      // 异常时的兜底：检查本地是否有缓存
      const fallbackUrl = await this.checkLocalCache(buildCacheKey(song));
      if (fallbackUrl) {
        console.log(`🚀 [${songId}] 获取异常，使用本地缓存兜底`);
        return { id: songId, url: fallbackUrl, isUnlocked: true, unlockSource: "cache" };
      }
      return {
        id: songId,
        url: undefined,
        quality: undefined,
        isUnlocked: false,
        unlockSource: null,
        failureReason: PLAYBACK_FAILED_TEXT,
      };
    }
  };

  /**
   * 读取当前平台的推荐流曲目
   *
   * 网易云走 `/personal_fm`（私人 FM，一次 3 首）；
   * QQ 音乐与酷狗音乐没有等价端点，改由平台推荐流模块给出个性化推荐（一次一批）。
   * 第三方平台的推荐流取数失败时直接失败，不得回落网易云 `/personal_fm`。
   * @param platform 目标平台
   * @returns 推荐流曲目
   */
  private fetchSongFMList = async (platform: ApiPlatform): Promise<SongType[]> => {
    if (platform === "qqmusic") {
      return qqSongFM(SONG_FM_BATCH_SIZE);
    }
    if (platform === "kugou") {
      return kgSongFM(SONG_FM_BATCH_SIZE);
    }
    const res = await personalFm();
    return formatSongsList(res.data);
  };

  /**
   * 判断缓存的推荐流是否属于当前平台
   */
  private isPersonalFMPlaformMatched = (): boolean => {
    const musicStore = useMusicStore();
    if (!musicStore.personalFM.list.length) return false;
    return musicStore.personalFMPlaform === usePlatformStore().currentPlatform;
  };

  /**
   * 初始化/播放推荐流（网易云私人 FM / QQ 音乐刷歌 / 酷狗音乐刷歌）
   * @param playNext 是否播放下一首
   * @returns 是否成功
   */
  public async initPersonalFM(playNext: boolean = false) {
    const musicStore = useMusicStore();
    const statusStore = useStatusStore();

    try {
      const fetchFM = async () => {
        const platform = usePlatformStore().currentPlatform;
        musicStore.personalFM.list = await this.fetchSongFMList(platform);
        musicStore.personalFM.platform = platform;
        musicStore.personalFM.playIndex = 0;
      };

      // 列表为空或列表不属于当前平台时重新取数
      if (!this.isPersonalFMPlaformMatched()) {
        musicStore.personalFM.list = [];
        musicStore.personalFM.playIndex = 0;
        await fetchFM();
      }
      // 如果需要播放下一首
      if (playNext) {
        statusStore.personalFmMode = true;
        // 如果当前列表还没播完
        if (musicStore.personalFM.playIndex < musicStore.personalFM.list.length - 1) {
          musicStore.personalFM.playIndex++;
        } else {
          // 列表播完了，获取新的
          await fetchFM();
        }
      }
    } catch (error) {
      console.error("❌ 推荐流初始化失败", error);
    }
  }

  /**
   * 私人 FM 垃圾桶（仅网易云支持）
   */
  public async personalFMTrash(id: number) {
    if (!isLogin()) {
      const { openUserLogin } = await import("@/utils/modal");
      openUserLogin(true);
      return;
    }
    const statusStore = useStatusStore();
    statusStore.personalFmMode = true;
    try {
      await personalFmToTrash(id);
      window.$message.success("已移至垃圾桶");
    } catch (error) {
      window.$message.error("移至垃圾桶失败，请重试");
      console.error("❌ 私人 FM 垃圾桶失败", error);
    }
  }

  /**
   * 刷新推荐流（网易云私人 FM / QQ 音乐刷歌 / 酷狗音乐刷歌）
   */
  public async refreshPersonalFM() {
    const musicStore = useMusicStore();
    const platform = usePlatformStore().currentPlatform;
    if (platform === "netease" && !isLogin()) {
      window.$message.error("请先登录");
      return;
    }
    try {
      const newList = await this.fetchSongFMList(platform);
      if (!newList || newList.length === 0) {
        throw new Error("加载推荐流列表失败");
      }
      musicStore.personalFM.list = newList;
      musicStore.personalFM.platform = platform;
      musicStore.personalFM.playIndex = 0;
      window.$message.success("刷新成功");
    } catch (error) {
      console.error("❌ 刷新推荐流失败", error);
      window.$message.error("刷新失败，请重试");
    }
  }
}

let instance: SongManager | null = null;

/**
 * 获取 SongManager 实例
 * @returns SongManager
 */
export const useSongManager = (): SongManager => {
  if (!instance) instance = new SongManager();
  return instance;
};
