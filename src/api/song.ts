import { isElectron } from "@/utils/env";
import { defaultAMLLDbServer, songLevelData } from "@/utils/meta";
import { SongUnlockServer } from "@/core/player/SongManager";
import { useSettingStore } from "@/stores";
import request from "@/utils/request";
import { localUnlockSongUrl, type SongUrlResult, type UnlockRequestContext } from "@/utils/unblock";

// 获取歌曲详情
export const songDetail = (ids: number | number[]) => {
  return request({
    url: "/song/detail",
    method: "post",
    params: { timestamp: Date.now() },
    data: { ids: Array.isArray(ids) ? ids.join(",") : ids.toString() },
  });
};

/**
 * 歌曲音质详情
 * @param id 歌曲 id
 */
export const songQuality = (id: number) => {
  return request({
    url: "/song/music/detail",
    params: { id },
  });
};

// 获取歌曲 URL
export const songUrl = (
  id: number,
  level:
    | "standard"
    | "higher"
    | "exhigh"
    | "lossless"
    | "hires"
    | "jyeffect"
    | "sky"
    | "jymaster" = "exhigh",
) => {
  return request({
    url: "/song/url/v1",
    params: {
      id,
      level,
      timestamp: Date.now(),
    },
  });
};

type UnlockSongUrlHandler = (
  id: number,
  songName: string,
  artist: string,
  server: SongUnlockServer,
  context?: UnlockRequestContext,
) => Promise<SongUrlResult>;

let customUnlockHandler: UnlockSongUrlHandler | null = null;

export const setCustomUnlockHandler = (handler: UnlockSongUrlHandler | null): void => {
  customUnlockHandler = handler;
};

/**
 * 获取解锁歌曲 URL（全部音源端侧本地解锁）
 * @param id 歌曲 ID（网易云使用）
 * @param songName 歌曲名
 * @param artist 歌手名
 * @param server 解锁源
 * @param context 换源寻址上下文（时长 / 平台 / 平台内 id）
 * @returns 解锁结果，成功时携带 lengthVerified 直链体积校验标记
 */
export const unlockSongUrl = (
  id: number,
  songName: string,
  artist: string,
  server: SongUnlockServer,
  context?: UnlockRequestContext,
): Promise<SongUrlResult> => {
  if (customUnlockHandler) {
    return customUnlockHandler(id, songName, artist, server, context);
  }

  console.log(`🔓 使用本地解锁: server=${server}`);
  return localUnlockSongUrl(id, songName, artist, server, context);
};

// 获取歌曲歌词
export const songLyric = (id: number) => {
  return request({
    url: "/lyric",
    params: {
      id,
    },
  });
};

/**
 * 获取歌曲 TTML 歌词
 * @param id 音乐 id
 * @returns TTML 格式歌词
 */
export const songLyricTTML = async (id: number) => {
  if (isElectron) {
    return request({ url: "/lyric/ttml", params: { id, noCookie: true } });
  } else {
    const settingStore = useSettingStore();
    const server = settingStore.amllDbServer || defaultAMLLDbServer;
    const url = server.replace("%s", String(id));
    try {
      const response = await fetch(url);
      if (response === null || response.status !== 200) {
        return null;
      }
      const data = await response.text();
      return data;
    } catch {
      return null;
    }
  }
};

/**
 * 获取歌曲下载链接
 * @param id 音乐 id
 * @param level 播放音质等级, 分为 standard => 标准,higher => 较高, exhigh=>极高, lossless=>无损, hires=>Hi-Res, jyeffect => 高清环绕声, sky => 沉浸环绕声, `dolby` => `杜比全景声`, jymaster => 超清母带
 * @returns
 */
export const songDownloadUrl = (id: number, level: keyof typeof songLevelData = "h") => {
  // 获取对应音质
  const levelName = songLevelData[level].level;
  return request({
    url: "/song/download/url/v1",
    params: { id, level: levelName, timestamp: Date.now() },
  });
};

// 喜欢歌曲
export const likeSong = (id: number, like: boolean = true) => {
  return request({
    url: "/like",
    params: { id, like, timestamp: Date.now() },
  });
};

/**
 * 本地歌曲文件匹配
 * @param {string} title - 文件的标题信息，是文件属性里的标题属性，并非文件名
 * @param {string} album - 文件的专辑信息
 * @param {string} artist - 文件的艺术家信息
 * @param {number} duration - 文件的时长，单位为秒
 * @param {string} md5 - 文件的 md5
 */

export const matchSong = (
  title: string,
  artist: string,
  album: string,
  duration: number,
  md5: string,
) => {
  return request({
    url: "/search/match",
    params: { title, artist, album, duration, md5 },
  });
};

/**
 * 歌曲动态封面
 * @param {number} id - 歌曲 id
 */
export const songDynamicCover = (id: number) => {
  return request({
    url: "/song/dynamic/cover",
    params: { id },
  });
};

/**
 * 副歌时间
 * @param {number} id - 歌曲 id
 */
export const songChorus = (id: number) => {
  return request({
    url: "/song/chorus",
    params: { id },
  });
};

// ========== SongWiki 音乐百科 API ==========

/**
 * 获取歌曲百科摘要
 * @param id 歌曲 ID
 */
export const songWikiSummary = (id: number) => {
  return request({
    url: "/song/wiki/summary",
    params: { id },
  });
};

/**
 * 获取歌曲首次收听信息
 * @param id 歌曲 ID
 */
export const songFirstListenInfo = (id: number) => {
  return request({
    url: "/song/first/listen/info",
    params: { id },
  });
};

/**
 * 获取歌曲乐谱列表
 * @param id 歌曲 ID
 */
export const songSheetList = (id: number) => {
  return request({
    url: "/sheet/list",
    params: { id },
  });
};

/**
 * 获取乐谱预览图片
 * @param id 乐谱 ID
 */
export const songSheetPreview = (id: number) => {
  return request({
    url: "/sheet/preview",
    params: { id },
  });
};
