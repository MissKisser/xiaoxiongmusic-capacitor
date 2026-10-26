/**
 * 歌曲的平台维度判据
 *
 * 网易云 / QQ 音乐 / 酷狗三个平台的歌曲编号各占独立空间：
 * 同一串数字在两个平台上指向完全不同的两首歌。因此凡是「按 id 判定同一首」
 * 或「按 id 记忆状态」的地方都必须带平台维度，否则会出现跨平台串显。
 *
 * 本模块只放纯函数，不依赖任何 store，可被界面层与播放器核心共同引用。
 *
 * @author Hackerdallas
 */

import type { SongType } from "@/types/main";
import type { ApiPlatform } from "@/types/shared";

/**
 * 取歌曲所属的音源平台
 *
 * 网易云歌曲不带平台标记，按网易云处理。
 * @param song 歌曲
 * @returns 所属音源平台
 */
export const resolveSongPlatform = (song?: SongType | null): ApiPlatform => {
  if (!song) return "netease";
  return song.platform ?? "netease";
};

/**
 * 生成平台维度唯一标识（platform:id）
 *
 * 跨平台歌曲数字 ID 可能重叠，使用 platform:id 确保全局唯一。
 * @param song 歌曲
 * @returns 平台维度唯一键，如 "qqmusic:12345" 或 "netease:67890"
 */
export const toPlatformSongKey = (song?: SongType | null): string => {
  if (!song) return "";
  return `${resolveSongPlatform(song)}:${song.id}`;
};

/**
 * 判断两首歌是否同一首
 *
 * 跨平台同号歌曲不是同一首，比对必须带平台维度。
 * @param a 歌曲
 * @param b 歌曲
 * @returns 是否同一首
 */
export const isSameSong = (a?: SongType | null, b?: SongType | null): boolean => {
  if (!a || !b) return false;
  if (a.id !== b.id) return false;
  return resolveSongPlatform(a) === resolveSongPlatform(b);
};

/**
 * 判断歌曲是否属于指定平台
 *
 * 本地歌曲（带本地路径）全局可用，不参与平台归属判定。
 * @param song 歌曲
 * @param platform 音源平台
 * @returns 是否属于该平台
 */
export const isSongOfPlatform = (
  song: SongType | undefined | null,
  platform: ApiPlatform,
): boolean => {
  if (!song) return false;
  if (song.path) return true;
  return resolveSongPlatform(song) === platform;
};

/** 听书内容在界面上的文案 */
export const AUDIOBOOK_TEXT = "听书";

/**
 * 判断歌曲是否为听书章节
 *
 * 酷狗听书章节按普通歌曲形态参与播放（平台、hash、专辑号都取酷狗口径），
 * 额外用 `mediaKind` 标记出「这是听书」，界面据此显示「听书」文案。
 * @param song 歌曲
 * @returns 是否为听书章节
 */
export const isAudiobookSong = (song?: SongType | null): boolean =>
  Boolean(song?.mediaKind === "audiobook");
