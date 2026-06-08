import type { LyricLine } from "@applemusic-like-lyrics/lyric";
import type { LyricConfig, LyricData } from "../types/desktop-lyric";

export interface AndroidDesktopLyricPayload {
  title: string;
  artist: string;
  primaryText: string;
  secondaryText: string;
  isPlaying: boolean;
  lyricLoading: boolean;
}

type AndroidDesktopLyricConfig = Pick<
  LyricConfig,
  "showTran" | "isDoubleLine"
>;

const DEFAULT_CONFIG: AndroidDesktopLyricConfig = {
  showTran: true,
  isDoubleLine: true,
};

const PLACEHOLDER_TEXT = "小熊音乐桌面歌词";
const LOADING_TEXT = "歌词加载中...";
const PURE_MUSIC_TEXT = "纯音乐，请欣赏";

const getLineText = (line?: LyricLine): string => {
  if (!line?.words?.length) return "";
  return line.words
    .map((word) => word.word)
    .join("")
    .trim();
};

const emptyPayloadBase = (data: LyricData, title: string, artist: string) => ({
  title,
  artist,
  isPlaying: Boolean(data.playStatus),
  lyricLoading: Boolean(data.lyricLoading),
});

const resolveLyricIndex = (data: LyricData, lyrics: LyricLine[]): number => {
  const index = Number(data.lyricIndex);
  if (Number.isInteger(index) && index >= 0) return index;

  const currentTime = Number(data.currentTime ?? 0) + Number(data.songOffset ?? 0);
  if (!Number.isFinite(currentTime) || currentTime <= 0) return -1;

  return lyrics.findIndex((line) => {
    const startTime = Number(line.startTime ?? 0);
    const endTime = Number(line.endTime ?? 0);
    return currentTime >= startTime && currentTime < endTime;
  });
};

/**
 * 将播放器歌词状态转换为 Android 原生浮窗的最小渲染负载。
 */
export const buildAndroidDesktopLyricPayload = (
  data: LyricData,
  config: Partial<AndroidDesktopLyricConfig> = {},
): AndroidDesktopLyricPayload => {
  const resolvedConfig = { ...DEFAULT_CONFIG, ...config };
  const lrcData = data.lrcData ?? [];
  const yrcData = data.yrcData ?? [];
  const lyrics = lrcData.length ? lrcData : yrcData;
  const title = (data.playName ?? "").trim();
  const artist = (data.artistName ?? "").trim();

  if (!title && !lyrics.length) {
    return {
      ...emptyPayloadBase(data, title, artist),
      primaryText: PLACEHOLDER_TEXT,
      secondaryText: "",
    };
  }

  if (data.lyricLoading) {
    return {
      ...emptyPayloadBase(data, title, artist),
      primaryText: LOADING_TEXT,
      secondaryText: "",
      lyricLoading: true,
    };
  }

  if (!lyrics.length) {
    return {
      ...emptyPayloadBase(data, title, artist),
      primaryText: PURE_MUSIC_TEXT,
      secondaryText: "",
      lyricLoading: false,
    };
  }

  const currentIndex = resolveLyricIndex(data, lyrics);
  if (currentIndex < 0) {
    return {
      ...emptyPayloadBase(data, title, artist),
      primaryText: [title, artist].filter(Boolean).join(" - "),
      secondaryText: "",
      lyricLoading: false,
    };
  }

  const current = lyrics[currentIndex];
  const next = lyrics[currentIndex + 1];
  const primaryText = getLineText(current);
  const translatedText = (current?.translatedLyric ?? "").trim();
  const secondaryText =
    resolvedConfig.showTran && translatedText
      ? translatedText
      : resolvedConfig.isDoubleLine
        ? getLineText(next)
        : "";

  return {
    ...emptyPayloadBase(data, title, artist),
    primaryText: primaryText || [title, artist].filter(Boolean).join(" - ") || PLACEHOLDER_TEXT,
    secondaryText,
    lyricLoading: false,
  };
};
