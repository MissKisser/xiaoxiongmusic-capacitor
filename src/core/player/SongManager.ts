import { diagLog } from "@/utils/diag";
import { personalFm, personalFmToTrash } from "@/api/rec";
import { songUrl, unlockSongUrl } from "@/api/song";
import {
  useDataStore,
  useMusicStore,
  useSettingStore,
  useStatusStore,
  useStreamingStore,
} from "@/stores";
import { QualityType, type SongType } from "@/types/main";
import { isLogin } from "@/utils/auth";
import { isElectron, isCapacitor, isIos } from "@/utils/env";
import { formatSongsList } from "@/utils/format";
import { handleSongQuality } from "@/utils/helper";
import { openUserLogin } from "@/utils/modal";

/**
 * 歌曲解锁服务器
 */
export enum SongUnlockServer {
  NETEASE = "netease",
  BODIAN = "bodian",
  KUWO = "kuwo",
  GEQUBAO = "gequbao",
}

/**
 * 歌曲解锁优先级常量（与 PC 端一致，硬编码）
 * 存储数组顺序不影响尝试序
 */
export const SONG_UNLOCK_PRIORITY: readonly SongUnlockServer[] = [
  SongUnlockServer.NETEASE,
  SongUnlockServer.BODIAN,
  SongUnlockServer.GEQUBAO,
  SongUnlockServer.KUWO,
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
};

class SongManager {
  /** 预载下一首歌曲播放信息 */
  private nextPrefetch: AudioSource | undefined;

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
   * @param id 歌曲id
   * @param quality 音质
   */
  private checkLocalCache = async (id: number, quality?: QualityType): Promise<string | null> => {
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
   * @param id 歌曲id
   * @param url 下载地址
   * @param quality 音质
   */
  private triggerCacheDownload = (id: number, url: string, quality?: QualityType | string) => {
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
   * Web 端 URL 统一处理：通过代理转发
   * Electron 端：直接返回原始 URL
   * @param url 原始 URL
   * @param cacheKey 缓存 Key (如歌曲 ID)
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
      // 传递稳定的缓存 key（歌曲 ID），避免 URL 中的时间戳/token 变化导致缓存失效
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
   * 获取在线播放链接
   * @param id 歌曲id
   * @param isPc 是否为云盘歌曲
   * @returns 在线播放信息
   */
  public getOnlineUrl = async (id: number, isPc: boolean = false): Promise<AudioSource> => {
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
   * 获取解锁播放链接
   * @param song 歌曲数据
   * @returns 音频源
   */
  public getUnlockSongUrl = async (song: SongType): Promise<AudioSource> => {
    const settingStore = useSettingStore();
    const songId = song.id;
    // 优先检查本地缓存
    const cachedUrl = await this.checkLocalCache(songId);
    if (cachedUrl) {
      return { id: songId, url: cachedUrl };
    }
    // 提取歌手名
    const artist = Array.isArray(song.artists) ? song.artists[0].name : song.artists;
    const songName = song.name;
    if (!songId || !songName) {
      return { id: songId, url: undefined };
    }

    // 按硬编码优先级获取已启用的解锁服务列表，保证尝试顺序严格对齐 PC 端
    const sortedServers = selectUnlockServers(settingStore.songUnlockServer);

    if (sortedServers.length === 0) {
      return { id: songId, url: undefined };
    }

    // 按顺序请求，一旦成功就返回
    console.log(`[UNLOCK] [${songId}] 开始按优先级尝试解锁服务`);
    console.log(`[UNLOCK] [${songId}] 启用的服务: ${sortedServers.map(s => this.getUnlockSourceName(s)).join(', ')}`);
    console.log(`[UNLOCK] [${songId}] 优先级顺序: ${sortedServers.map(s => this.getUnlockSourceName(s)).join(' -> ')}`);

    // 检查是否有服务未启用
    const skippedServers = SONG_UNLOCK_PRIORITY.filter((server) => !sortedServers.includes(server));
    if (skippedServers.length > 0) {
      console.log(`[UNLOCK] [${songId}] 跳过的服务（未启用）: ${skippedServers.map(s => this.getUnlockSourceName(s)).join(', ')}`);
    }

    for (const server of sortedServers) {
      // 提前获取服务名称，避免在作用域内重复定义
      const sourceName = this.getUnlockSourceName(server);
      try {
        console.log(`[UNLOCK] [${songId}] 正在尝试解锁服务: ${sourceName} (${server})...`);
        const result = await unlockSongUrl(songId, songName, artist, server);
        console.log(`[UNLOCK] [${songId}] ${sourceName} 返回结果:`, result);

        // 检查是否成功
        if (result.code === 200 && result.url && result.url.trim() !== "") {
          const originalUrl = result.url.trim();
          console.log(`[UNLOCK] [${songId}] ${sourceName} 返回的原始 URL 长度: ${originalUrl.length}`);
          console.log(`[UNLOCK] [${songId}] ${sourceName} 返回的原始 URL 类型检查:`, typeof originalUrl);

          // Web 端：统一通过代理转发（与 Electron 端逻辑对齐）
          // Electron 端：直接使用原始 URL（MPV 不受浏览器限制）
          diagLog(`解锁尝试 源=${server} 歌曲id=${songId}`);
          // 歌曲宝源需传入防盗链 Referer
          const referer = server === SongUnlockServer.GEQUBAO ? "https://gequbao.com/" : undefined;
          const unlockUrl = this.processUrlForWeb(originalUrl, songId, referer);
          if (!isElectron) {
            console.log(`[UNLOCK] [${songId}] Web 端处理后的 URL:`, unlockUrl ? sanitizeUrlForLog(unlockUrl) : "null/undefined");
          }

          const finalUnlockUrl = unlockUrl || undefined;

          // 验证最终 URL 是否有效
          if (!finalUnlockUrl || finalUnlockUrl.trim() === "") {
            console.error(`[UNLOCK] [${songId}] ${sourceName} 处理后的 URL 无效，跳过此服务`);
            continue;
          }

          // 推断音质
          let quality = QualityType.HQ;
          if (originalUrl.includes(".flac") || originalUrl.includes(".wav")) {
            quality = QualityType.SQ;
          }

          // 调试信息：显示使用的解锁源（URL 脱敏，只保留域名与路径，隐藏签名参数）
          console.log(`[UNLOCK] [${songId}] 解锁成功！`);
          console.log(`[UNLOCK] [${songId}] 解锁源: ${sourceName} (${server})`);
          console.log(`[UNLOCK] [${songId}] 音质: ${quality}`);
          console.log(`[UNLOCK] [${songId}] 原始 URL: ${sanitizeUrlForLog(originalUrl)}`);
          console.log(`[UNLOCK] [${songId}] 最终返回 URL: ${sanitizeUrlForLog(finalUnlockUrl || "")}`);
          console.log(`[UNLOCK] [${songId}] 最终返回 URL 长度: ${finalUnlockUrl ? finalUnlockUrl.length : 0}`);

          // 验证 URL 格式
          try {
            new URL(finalUnlockUrl);
            console.log(`[UNLOCK] [${songId}] URL 格式验证通过`);
          } catch (e) {
            console.error(`[UNLOCK] [${songId}] URL 格式验证失败:`, e);
          }

          // 解锁成功后，触发下载（使用原始 URL，仅 Electron 端）
          this.triggerCacheDownload(songId, originalUrl);

          return {
            id: songId,
            url: finalUnlockUrl,
            isUnlocked: true,
            quality,
            unlockSource: server,
          };
        } else {
          console.warn(`[UNLOCK] [${songId}] ${sourceName} 返回失败，继续尝试下一个服务...`);
        }
      } catch (error) {
        console.error(`[UNLOCK] [${songId}] ${sourceName} 请求失败:`, error);
        // 继续尝试下一个服务
      }
    }

    console.warn(`[UNLOCK] [${songId}] 所有解锁服务均失败`);
    return { id: songId, url: undefined };
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
        };
        return this.nextPrefetch;
      }

      // 在线歌曲：优先官方，其次解灰
      const songId = nextSong.type === "radio" ? nextSong.dj?.id : nextSong.id;
      if (!songId) return;

      // 是否可解锁（非电台且开启解锁）
      const canUnlock = nextSong.type !== "radio" && settingStore.useSongUnlock;

      // 1. 优先尝试获取官方链接
      const officialResult = await this.getOnlineUrl(songId, !!nextSong.pc);
      if (officialResult.url && !officialResult.isTrial) {
        this.nextPrefetch = officialResult;
        return this.nextPrefetch;
      }

      // 暂存试听源
      let trialSource: AudioSource | null = null;
      if (officialResult.url && officialResult.isTrial) {
        trialSource = officialResult;
      }

      // 2. 官方未果后尝试解锁兜底
      if (canUnlock) {
        console.log(`🔓 [${songId}] 预加载：官方无完整链接（${trialSource ? "仅可试听" : "无链接"}），尝试解锁兜底...`);
        const unlockResult = await this.getUnlockSongUrl(nextSong);
        if (unlockResult.url) {
          console.log(`✅ [${songId}] 预加载：解锁成功，使用解锁链接`);
          this.nextPrefetch = unlockResult;
          return this.nextPrefetch;
        }
      }

      // 3. 解锁全部失败后，若暂存了官方试听且允许试听，保留官方试听地址
      if (trialSource?.url && settingStore.playSongDemo) {
        this.nextPrefetch = trialSource;
        return this.nextPrefetch;
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

    // 检查缓存并返回
    if (this.nextPrefetch && this.nextPrefetch.id === songId && settingStore.useNextPrefetch) {
      const cachedSource = this.nextPrefetch;
      // 验证缓存的 URL 是否有效
      if (cachedSource.url && cachedSource.url.trim() !== "") {
        console.log(`🚀 [${songId}] 使用预加载缓存播放`);
        this.nextPrefetch = undefined;
        return cachedSource;
      } else {
        console.warn(`⚠️ [${songId}] 预加载缓存 URL 无效，重新获取`);
        this.nextPrefetch = undefined;
      }
    }

    // 在线获取
    try {
      // 是否可解锁（电台类型不解锁）
      const canUnlock = song.type !== "radio" && settingStore.useSongUnlock;

      // 1. 所有在线歌曲一律先尝试官方链接（云盘歌曲 song.pc 为真）
      const officialResult = await this.getOnlineUrl(songId, !!song.pc);
      diagLog(`官方链接 id=${songId} 结果=${officialResult.url ? "有" : "无"} 试听=${officialResult.isTrial}`);
      console.log(`[SONG] [${songId}] 官方链接获取结果:`, officialResult);

      // 返回完整非试听链接，直接以 official 源返回
      if (officialResult.url && !officialResult.isTrial) {
        return officialResult;
      }

      // 拿到试听链接，先暂存不直接返回，继续尝试解锁
      let trialSource: AudioSource | null = null;
      if (officialResult.url && officialResult.isTrial) {
        trialSource = officialResult;
      }

      // 2. 官方未果后（且 useSongUnlock 开启、非电台类型）走解锁链
      if (canUnlock) {
        console.log(`[UNLOCK] [${songId}] 官方无完整链接（${trialSource ? "仅可试听" : "无链接"}），尝试解锁服务...`);
        const unlockResult = await this.getUnlockSongUrl(song);
        if (unlockResult.url && unlockResult.url.trim() !== "") {
          console.log(`[UNLOCK] [${songId}] 解锁成功，使用解锁链接播放`);
          return unlockResult;
        }
        console.warn(`[UNLOCK] [${songId}] 所有解锁服务均失败`);
      }

      // 3. 解锁全部失败后：若暂存了官方试听链接且 settingStore.playSongDemo 开启，返回试听
      if (trialSource?.url && settingStore.playSongDemo) {
        window.$message.warning("当前歌曲仅可试听");
        return trialSource;
      }

      // 4. 本地缓存兜底（检查是否有之前缓存的文件，不区分音质）
      const fallbackUrl = await this.checkLocalCache(songId);
      if (fallbackUrl) {
        console.log(`🚀 [${songId}] 网络请求失败，使用本地缓存兜底`);
        return { id: songId, url: fallbackUrl, isUnlocked: true, unlockSource: "cache" };
      }

      // 5. 无可用源
      console.error(`❌ [${songId}] 所有音频源获取失败，无可用链接`);
      return { id: songId, url: undefined, quality: undefined, isUnlocked: false, unlockSource: null };
    } catch (e) {
      console.error(`❌ [${songId}] 获取音频源异常:`, e);
      // 异常时的兜底：检查本地是否有缓存
      const fallbackUrl = await this.checkLocalCache(songId);
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
      };
    }
  };

  /**
   * 初始化/播放私人 FM
   * @param playNext 是否播放下一首
   * @returns 是否成功
   */
  public async initPersonalFM(playNext: boolean = false) {
    const musicStore = useMusicStore();
    const statusStore = useStatusStore();

    try {
      const fetchFM = async () => {
        const res = await personalFm();
        musicStore.personalFM.list = formatSongsList(res.data);
        musicStore.personalFM.playIndex = 0;
      };

      // 若列表为空或已播放到最后，获取新列表
      if (musicStore.personalFM.list.length === 0) await fetchFM();
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
      console.error("❌ 私人 FM 初始化失败", error);
    }
  }

  /**
   * 私人 FM 垃圾桶
   */
  public async personalFMTrash(id: number) {
    if (!isLogin()) {
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
   * 刷新私人 FM
   */
  public async refreshPersonalFM() {
    const musicStore = useMusicStore();
    if (!isLogin()) {
      window.$message.error("请先登录");
      return;
    }
    try {
      const res = await personalFm();
      const newList = formatSongsList(res.data);
      if (!newList || newList.length === 0) {
        throw new Error("加载私人漫游列表失败");
      }
      musicStore.personalFM.list = newList;
      musicStore.personalFM.playIndex = 0;
      window.$message.success("刷新成功");
    } catch (error) {
      console.error("❌ 刷新私人 FM 失败", error);
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
