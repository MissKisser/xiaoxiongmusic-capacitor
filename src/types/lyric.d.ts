import { type LyricLine } from "@applemusic-like-lyrics/lyric";

/**
 * 歌词数据类型
 */
export interface SongLyric {
  lrcData: LyricLine[];
  yrcData: LyricLine[];
  /** 歌词作者/来源信息（LRC [by:]/[au:] 或 TTML amll:meta author） */
  lyricAuthors?: string[];
}
