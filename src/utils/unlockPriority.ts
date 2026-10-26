/**
 * 换源链的优先级分派
 *
 * 同一批换源服务对三个平台的寻址能力并不相同，最优链位因此按「歌曲来自哪个平台」分派：
 * - 酷狗歌曲：走关键词寻址（波点 → 酷我 → 歌曲宝），排除网易云数字 ID 直查；
 * - QQ 歌曲：走关键词寻址（波点 → 酷我 → 歌曲宝），排除网易云数字 ID 直查；
 * - 网易云歌曲：网易云按自身歌曲 id 直查，排在首位；波点 / 歌曲宝 / 酷我依次兜底。
 *
 * 铁律 A-05：第三方平台歌曲严禁拿平台数字 ID 直查网易云源。
 *
 * 本模块只放纯函数，不依赖任何 store，可被播放链与下载链共同引用。
 *
 * @author Hackerdallas
 */

import { SongUnlockServer, type ApiPlatform } from "@/types/shared";

/** 各平台的换源优先级（数组顺序即尝试顺序） */
const UNLOCK_PRIORITY: Record<ApiPlatform, readonly SongUnlockServer[]> = {
  netease: [
    SongUnlockServer.NETEASE,
    SongUnlockServer.BODIAN,
    SongUnlockServer.GEQUBAO,
    SongUnlockServer.KUWO,
    SongUnlockServer.MIGU,
    SongUnlockServer.CHANGQING,
    SongUnlockServer.LXMUSIC,
  ],
  qqmusic: [
    SongUnlockServer.BODIAN,
    SongUnlockServer.CHANGQING,
    SongUnlockServer.MIGU,
    SongUnlockServer.LXMUSIC,
    SongUnlockServer.KUWO,
    SongUnlockServer.GEQUBAO,
  ],
  kugou: [
    SongUnlockServer.BODIAN,
    SongUnlockServer.CHANGQING,
    SongUnlockServer.MIGU,
    SongUnlockServer.LXMUSIC,
    SongUnlockServer.KUWO,
    SongUnlockServer.GEQUBAO,
  ],
};

/** 各平台的中文名（只用于日志与说明文案） */
const PLATFORM_LABEL: Record<ApiPlatform, string> = {
  netease: "网易云",
  qqmusic: "QQ 音乐",
  kugou: "酷狗音乐",
};

/**
 * 取指定平台的换源优先级
 * @param platform 歌曲所属平台
 * @returns 换源优先级（按尝试顺序）
 */
export const getUnlockPriority = (platform: ApiPlatform): SongUnlockServer[] => [
  ...(UNLOCK_PRIORITY[platform] ?? UNLOCK_PRIORITY.netease),
];

/**
 * 取平台的中文名
 * @param platform 歌曲所属平台
 * @returns 平台中文名
 */
export const getPlatformLabel = (platform: ApiPlatform): string =>
  PLATFORM_LABEL[platform] ?? platform;
