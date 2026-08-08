/**
 * 歌词海报生成（Canvas 2D）
 *
 * Based on SPlayer-Next
 * Copyright (C) 2024 SPlayer-Dev
 * Licensed under AGPL-3.0
 *
 * 上游实现：src/utils/lyric/poster.ts（纯 Canvas 绘制，无需 html2canvas）
 * 移动端改动：
 *  - 封面通过 CapacitorHttp 原生请求取回 base64，规避 WebView 跨域导致的画布污染
 *  - 画布宽度与缩放按设备像素做上限保护，避免低端机 OOM
 */

import { isCapacitor } from "@/utils/env";
import { CapacitorHttp } from "@capacitor/core";

/** 海报中的一行歌词 */
export interface LyricPosterLine {
  /** 主歌词 */
  text: string;
  /** 翻译 */
  translation?: string;
  /** 音译 */
  romaji?: string;
  /** 对唱行（右对齐） */
  duet?: boolean;
}

/** 生成海报所需参数 */
export interface LyricPosterOptions {
  /** 歌曲名 */
  title: string;
  /** 歌手名 */
  artist: string;
  /** 封面地址（http/https 或 dataURL），可空 */
  cover?: string | null;
  /** 歌词行 */
  lines: LyricPosterLine[];
  /** 无封面时的底色，支持 `#RRGGBB` 或 `r, g, b` */
  fallbackColor?: string | null;
  /** 底部水印文案 */
  watermark?: string;
}

/** 最大缩放倍率（3x 适配高分屏） */
const SCALE = 3;
/** 画布单边像素上限，超出后降采样 */
const MAX_CANVAS_PX = 12000;
/** 逻辑宽度 */
const WIDTH = 720;
const PAD_X = 56;
const PAD_TOP = 64;
const PAD_BOTTOM = 30;

const FONT_STACK = '-apple-system, "Segoe UI", "Microsoft YaHei", system-ui, sans-serif';
const LYRIC_FONT = `bold 34px ${FONT_STACK}`;
const TRANS_FONT = `24px ${FONT_STACK}`;
const ROMAJI_FONT = `italic 22px ${FONT_STACK}`;
const TITLE_FONT = `bold 28px ${FONT_STACK}`;
const ARTIST_FONT = `22px ${FONT_STACK}`;
const MARK_FONT = `600 15px ${FONT_STACK}`;

/** 各类文本行高与间距 */
const LYRIC_LH = 48;
const TRANS_LH = 34;
const ROMAJI_LH = 32;
const SUBLINE_GAP = 8;
const BLOCK_GAP = 30;
const THUMB = 72;
const THUMB_RADIUS = 16;
const THUMB_TEXT_GAP = 18;
const HEADER_GAP = 44;
const WATERMARK_GAP = 26;
const WATERMARK_H = 16;

/** 内容区宽度 */
const CONTENT_WIDTH = WIDTH - PAD_X * 2;

/** 默认底色 */
const DEFAULT_BG = "#14141c";

/**
 * 颜色转 `rgb(r, g, b)`
 * 兼容 `#RGB` / `#RRGGBB` / `r, g, b` 三种写法
 */
const toRgbString = (color?: string | null): string => {
  const value = (color || "").trim();
  if (!value) return toRgbString(DEFAULT_BG);
  // 已是 `r, g, b` 形式
  if (/^\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}$/.test(value)) return `rgb(${value})`;
  // rgb() / rgba() 直接返回
  if (/^rgba?\(/i.test(value)) return value;
  const hex = value.replace(/^#/, "");
  const full =
    hex.length === 3
      ? hex
          .split("")
          .map((char) => char + char)
          .join("")
      : hex;
  if (!/^[\da-f]{6}$/i.test(full)) return toRgbString(DEFAULT_BG);
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgb(${r}, ${g}, ${b})`;
};

/** Blob 转 dataURL */
const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

/**
 * 将封面地址解析为 dataURL
 * Capacitor 下用原生 HTTP 拉字节，避免 canvas 被跨域污染导致 toBlob 抛错
 */
const resolveCoverDataUrl = async (cover?: string | null): Promise<string | null> => {
  if (!cover) return null;
  // 已是 dataURL 直接用
  if (cover.startsWith("data:")) return cover;
  // 应用内静态资源（/images/song.jpg 等）同源，可直接绘制
  if (!/^https?:\/\//i.test(cover)) return cover;
  try {
    if (isCapacitor) {
      const res = await CapacitorHttp.get({
        url: cover,
        responseType: "blob",
        readTimeout: 10000,
        connectTimeout: 10000,
      });
      if (res.status < 200 || res.status >= 300 || !res.data) return null;
      // 原生层返回 base64 字符串
      const base64 = String(res.data).replace(/^data:[^;]+;base64,/, "");
      if (!base64) return null;
      const mime =
        (res.headers?.["Content-Type"] || res.headers?.["content-type"] || "image/jpeg").split(
          ";",
        )[0] || "image/jpeg";
      return `data:${mime};base64,${base64}`;
    }
    const response = await fetch(cover, { mode: "cors" });
    if (!response.ok) return null;
    return await blobToDataUrl(await response.blob());
  } catch (error) {
    console.warn("[LyricPoster] 封面获取失败，使用纯色背景", error);
    return null;
  }
};

/** 按宽度折行，英文按词、CJK 按字回退 */
const wrapText = (ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] => {
  if (!text) return [];
  const lines: string[] = [];
  let line = "";
  const breakByChar = (token: string): void => {
    for (const char of token) {
      if (line && ctx.measureText(line + char).width > maxWidth) {
        lines.push(line);
        line = "";
      }
      line += char;
    }
  };
  for (const word of text.split(/(\s+)/)) {
    if (!word) continue;
    if (ctx.measureText(line + word).width <= maxWidth) {
      line += word;
    } else if (ctx.measureText(word).width > maxWidth) {
      breakByChar(word);
    } else {
      if (line.trim()) lines.push(line.replace(/\s+$/, ""));
      line = word.replace(/^\s+/, "");
    }
  }
  if (line.trim()) lines.push(line.replace(/\s+$/, ""));
  return lines;
};

/** 加载图片，失败回 null */
const loadImage = (src: string): Promise<HTMLImageElement | null> =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });

/** object-fit: cover 方式绘制图片 */
const drawCovered = (
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
): void => {
  const imgRatio = img.width / img.height;
  const boxRatio = dw / dh;
  let sx = 0;
  let sy = 0;
  let sw = img.width;
  let sh = img.height;
  if (imgRatio > boxRatio) {
    sw = img.height * boxRatio;
    sx = (img.width - sw) / 2;
  } else {
    sh = img.width / boxRatio;
    sy = (img.height - sh) / 2;
  }
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
};

/** 圆角矩形路径（部分低版本 WebView 无 roundRect） */
const roundRectPath = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void => {
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  const radius = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
};

/**
 * 把选中歌词绘制成一张海报 PNG
 * @param options 曲目信息、歌词行、底色
 * @returns PNG Blob
 */
export const createLyricPoster = async (options: LyricPosterOptions): Promise<Blob> => {
  const { title, artist, cover, lines, fallbackColor, watermark = "Made by 小熊音乐" } = options;
  if (!lines.length) throw new Error("没有可导出的歌词");

  const coverDataUrl = await resolveCoverDataUrl(cover);
  const coverImg = coverDataUrl ? await loadImage(coverDataUrl) : null;

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建画布上下文");

  // 预折行并量算高度
  const layout = lines.map((line) => {
    ctx.font = LYRIC_FONT;
    const main = wrapText(ctx, line.text || " ", CONTENT_WIDTH);
    ctx.font = TRANS_FONT;
    const translation = line.translation ? wrapText(ctx, line.translation, CONTENT_WIDTH) : [];
    ctx.font = ROMAJI_FONT;
    const romaji = line.romaji ? wrapText(ctx, line.romaji, CONTENT_WIDTH) : [];
    return { main, translation, romaji, duet: !!line.duet };
  });

  let lyricsHeight = 0;
  layout.forEach((block, index) => {
    if (index > 0) lyricsHeight += BLOCK_GAP;
    lyricsHeight += Math.max(1, block.main.length) * LYRIC_LH;
    if (block.translation.length) lyricsHeight += SUBLINE_GAP + block.translation.length * TRANS_LH;
    if (block.romaji.length) lyricsHeight += SUBLINE_GAP + block.romaji.length * ROMAJI_LH;
  });

  const totalHeight =
    PAD_TOP + THUMB + HEADER_GAP + lyricsHeight + WATERMARK_GAP + WATERMARK_H + PAD_BOTTOM;

  // 超长海报降采样，避免超出画布像素上限导致导出空白
  const scale = Math.max(1, Math.min(SCALE, MAX_CANVAS_PX / totalHeight));
  canvas.width = Math.round(WIDTH * scale);
  canvas.height = Math.round(totalHeight * scale);
  ctx.scale(scale, scale);

  // 底色铺满
  ctx.fillStyle = toRgbString(fallbackColor);
  ctx.fillRect(0, 0, WIDTH, totalHeight);

  if (coverImg) {
    const margin = 80;
    ctx.filter = "blur(70px) saturate(1.2)";
    drawCovered(ctx, coverImg, -margin, -margin, WIDTH + margin * 2, totalHeight + margin * 2);
    ctx.filter = "none";
    ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
    ctx.fillRect(0, 0, WIDTH, totalHeight);
  }

  // 顶部歌曲信息
  ctx.textBaseline = "top";
  let titleX = PAD_X;
  if (coverImg) {
    ctx.save();
    ctx.beginPath();
    roundRectPath(ctx, PAD_X, PAD_TOP, THUMB, THUMB, THUMB_RADIUS);
    ctx.clip();
    drawCovered(ctx, coverImg, PAD_X, PAD_TOP, THUMB, THUMB);
    ctx.restore();
    titleX = PAD_X + THUMB + THUMB_TEXT_GAP;
  }
  ctx.textAlign = "left";
  ctx.fillStyle = "#ffffff";
  ctx.font = TITLE_FONT;
  ctx.fillText(title, titleX, PAD_TOP + 10, WIDTH - titleX - PAD_X);
  ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
  ctx.font = ARTIST_FONT;
  ctx.fillText(artist, titleX, PAD_TOP + 44, WIDTH - titleX - PAD_X);

  // 歌词
  let y = PAD_TOP + THUMB + HEADER_GAP;
  layout.forEach((block, index) => {
    if (index > 0) y += BLOCK_GAP;
    // 对唱行右对齐，其余左对齐
    const textX = block.duet ? WIDTH - PAD_X : PAD_X;
    ctx.textAlign = block.duet ? "right" : "left";
    ctx.fillStyle = "#ffffff";
    ctx.font = LYRIC_FONT;
    for (const text of block.main) {
      ctx.fillText(text, textX, y);
      y += LYRIC_LH;
    }
    if (block.translation.length) {
      y += SUBLINE_GAP;
      ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
      ctx.font = TRANS_FONT;
      for (const text of block.translation) {
        ctx.fillText(text, textX, y);
        y += TRANS_LH;
      }
    }
    if (block.romaji.length) {
      y += SUBLINE_GAP;
      ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
      ctx.font = ROMAJI_FONT;
      for (const text of block.romaji) {
        ctx.fillText(text, textX, y);
        y += ROMAJI_LH;
      }
    }
  });

  // 底部水印（居中）
  ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
  ctx.font = MARK_FONT;
  ctx.textAlign = "center";
  ctx.fillText(watermark, WIDTH / 2, totalHeight - PAD_BOTTOM - WATERMARK_H);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("导出图片失败"))),
      "image/png",
    );
  });
};

/** 生成海报并返回预览用 dataURL */
export const createLyricPosterDataUrl = async (options: LyricPosterOptions): Promise<string> => {
  const blob = await createLyricPoster(options);
  return await blobToDataUrl(blob);
};
