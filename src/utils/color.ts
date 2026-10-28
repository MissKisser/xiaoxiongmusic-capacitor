import type { CoverColors } from "@/types/main";
import type { ThemeColorSource } from "@/stores/setting";
import {
  themeFromSourceColor,
  QuantizerCelebi,
  Hct,
  Score,
} from "@material/material-color-utilities";
import { getMDColor, rgbToHex } from "@imsyy/color-utils";
import { useSettingStore, useStatusStore } from "@/stores";
import { argbToRgb } from "./helper";
import { chunk } from "lodash-es";

/**
 * 主色以 RGB 格式返回
 * @param {number} argb - 表示颜色的 ARGB 格式整数
 */
const getAccentColor = (argb: number) => {
  // 将 ARGB 转换为 RGB
  const [r, g, b] = [...argbToRgb(argb)];
  // 返回 rgb
  return { r, g, b };
};

// 修改全局颜色
export const setGlobalColor = (name: string, colorValue: string): void => {
  if (!name.startsWith("--")) {
    throw new Error("Variable name must start with '--'");
  }
  const root = document.body;
  root.style.setProperty(name, colorValue);
};

/**
 * 设置动态配色
 * @param color 颜色字符串（预设/自定义色）或取色得到的主题数据
 * @param mode 明暗模式
 * @param options tintSurfaces 为 true 时界面底色跟随取色结果（整体着色），
 *                否则底色回退为中性色，仅强调色取自该颜色
 * @returns 各颜色项的 RGB 字符串集合
 */
export const setColorSchemes = (
  color: string | CoverColors,
  mode: "dark" | "light",
  options: { tintSurfaces?: boolean } = {},
): { [key: string]: string } => {
  const colorData = typeof color === "string" ? getMDColor(color) : color;
  if (!colorData) throw new Error("Color data not found");
  // 指定模式颜色数据
  const colorModeData = colorData[mode];
  if (!colorModeData) throw new Error("Color data not found");
  // 未整体着色时使用的中性底色
  const neutralColors: Record<string, { r: number; g: number; b: number }> = {
    background:
      mode === "dark" ? { r: 16, g: 16, b: 20 } : { r: 246, g: 246, b: 246 },
    "surface-container":
      mode === "dark" ? { r: 24, g: 24, b: 28 } : { r: 255, g: 255, b: 255 },
  };
  const tintSurfaces = options.tintSurfaces === true;
  const modifiedColorModeData: { [key: string]: string } = {};
  // 遍历颜色并修改
  for (const key in colorModeData) {
    const colorValue = colorModeData[key];
    if (
      typeof colorValue === "object" &&
      colorValue !== null &&
      "r" in colorValue &&
      "g" in colorValue &&
      "b" in colorValue
    ) {
      // 不整体着色时底色回退中性色（不修改入参，避免污染取色缓存）
      const effective = !tintSurfaces && neutralColors[key] ? neutralColors[key] : colorValue;
      const hexValue = rgbToHex(effective.r, effective.g, effective.b);
      // 修改后的颜色值存储在新的对象中
      modifiedColorModeData[`${key}-hex`] = hexValue;
      modifiedColorModeData[key] = `${effective.r}, ${effective.g}, ${effective.b}`;
      // 设置样式
      setGlobalColor(`--${key}`, `${effective.r}, ${effective.g}, ${effective.b}`);
      setGlobalColor(`--${key}-hex`, hexValue);
    } else {
      console.error(`Invalid color data for key: ${key}`);
    }
  }
  return modifiedColorModeData;
};

// 获取封面主题
export const getCoverColorData = (dom: HTMLImageElement) => {
  if (!dom) return null;
  // canvas
  const canvas = document.createElement("canvas");
  canvas.width = 50;
  canvas.height = 50;
  // 获取 50x50 大小的图像颜色数据
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(dom, 0, 0, dom.naturalWidth, dom.naturalHeight, 0, 0, 50, 50);
  const pixels = chunk(ctx.getImageData(0, 0, 50, 50).data, 4).map((pixel) => {
    // 将颜色数据转换为整数表示
    return (
      (((pixel[3] << 24) >>> 0) | ((pixel[0] << 16) >>> 0) | ((pixel[1] << 8) >>> 0) | pixel[2]) >>>
      0
    );
  });
  // 使用 QuantizerCelebi 进行颜色量化
  const quantizedColors = QuantizerCelebi.quantize(pixels, 128);
  const sortedQuantizedColors = Array.from(quantizedColors).sort((a, b) => b[1] - a[1]);
  // 获取最频繁的颜色，并转换为 RGB 格式
  const mostFrequentColors = sortedQuantizedColors.slice(0, 5).map((x) => argbToRgb(x[0]));
  // 如果最频繁的颜色差异很小，使用灰色强调色
  if (mostFrequentColors.every((x) => Math.max(...x) - Math.min(...x) < 5)) {
    return {
      main: { r: 239, g: 239, b: 239 },
      light: {
        primary: { r: 10, g: 10, b: 10 },
        background: { r: 238, g: 238, b: 238 },
        "surface-container": { r: 212, g: 212, b: 212 },
      },
      dark: {
        primary: { r: 239, g: 239, b: 239 },
        background: { r: 31, g: 31, b: 31 },
        "surface-container": { r: 39, g: 39, b: 39 },
      },
    };
  }
  // 使用 Score 库对颜色进行评分
  const ranked = Score.score(new Map(sortedQuantizedColors.slice(0, 50)));
  const topColor = ranked[0];
  const theme = themeFromSourceColor(topColor);
  // 颜色主题
  const variant = "secondary";
  // 移除 canvas
  canvas.remove();
  // 返回主题
  return {
    main: getAccentColor(
      Hct.from(theme.palettes[variant].hue, theme.palettes[variant].chroma, 90).toInt(),
    ),
    light: {
      primary: getAccentColor(
        Hct.from(theme.palettes[variant].hue, theme.palettes[variant].chroma, 10).toInt(),
      ),
      background: getAccentColor(
        Hct.from(theme.palettes[variant].hue, theme.palettes[variant].chroma, 94).toInt(),
      ),
      "surface-container": getAccentColor(
        Hct.from(theme.palettes[variant].hue, theme.palettes[variant].chroma, 90).toInt(),
      ),
    },
    dark: {
      primary: getAccentColor(
        Hct.from(theme.palettes[variant].hue, theme.palettes[variant].chroma, 90).toInt(),
      ),
      background: getAccentColor(
        Hct.from(theme.palettes[variant].hue, theme.palettes[variant].chroma, 20).toInt(),
      ),
      "surface-container": getAccentColor(
        Hct.from(theme.palettes[variant].hue, theme.palettes[variant].chroma, 16).toInt(),
      ),
    },
  };
};

/**
 * 获取歌曲封面颜色数据
 * @param coverUrl 歌曲封面地址
 */
export const getCoverColor = async (coverUrl: string) => {
  if (!coverUrl) return;
  const statusStore = useStatusStore();
  const settingStore = useSettingStore();
  // 创建图像元素
  const image = new Image();
  image.crossOrigin = "Anonymous";
  image.src = coverUrl;
  // 图像加载完成
  image.onload = () => {
    // 获取图片数据
    const coverColorData = getCoverColorData(image);
    if (coverColorData) statusStore.songCoverTheme = coverColorData;
    if (!settingStore.playerFollowCoverColor) {
      statusStore.songCoverTheme.main = { r: 239, g: 239, b: 239 };
    }
    // 移除元素
    image.remove();
  };
};

/**
 * 加载图片元素
 * @param src 图片地址（data URL 或网络地址）
 * @returns 加载完成的图像元素
 */
const loadImageElement = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "Anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("image load failed"));
    image.src = src;
  });

/**
 * 从全局背景图提取主题色数据
 * 复用封面取色的 QuantizerCelebi 量化与 Score 评分流程，输出与其同构
 * @param backgroundImage 背景图 data URL 或图片地址
 * @returns 与封面取色同格式的主题色数据；图片缺失或加载失败返回 null
 */
export const getBackgroundTheme = async (
  backgroundImage: string,
): Promise<CoverColors | null> => {
  if (!backgroundImage) return null;
  try {
    const image = await loadImageElement(backgroundImage);
    const backgroundTheme = getCoverColorData(image);
    image.remove();
    return backgroundTheme;
  } catch {
    return null;
  }
};

/** 主题色来源分流结果：preset 携带颜色字符串，其余携带与封面取色同构的主题数据 */
export type ThemeColorRoute =
  | { kind: "preset"; presetColor: string }
  | { kind: "cover"; theme: CoverColors }
  | { kind: "background"; theme: CoverColors };

/** 主题色来源分流所需的各来源输入 */
export interface ThemeColorRouteInputs {
  /** 预设来源的颜色值（预设主题色或自定义颜色字符串） */
  presetColor?: string | null;
  /** 背景图取色结果（未设置背景图或尚未取色时为 null） */
  backgroundTheme?: CoverColors | null;
  /** 封面取色结果（无封面主题时为 null） */
  coverTheme?: CoverColors | null;
}

/**
 * 判定取色主题数据是否可用
 * 仅当明暗两套配色都带有主色时才视为可用，避免空数据导致配色整体失效
 * @param theme 取色主题数据
 * @returns 是否可用
 */
const isUsableTheme = (theme: CoverColors | null | undefined): theme is CoverColors =>
  Boolean(theme && theme.light?.primary && theme.dark?.primary);

/**
 * 按主题色来源分流取色输入
 * 选定来源不可用时回退 preset；preset 亦不可用返回 null（由调用方保持现状）
 * @param source 主题色来源
 * @param inputs 各来源的取色输入
 * @returns 分流结果
 */
export const resolveThemeColorRoute = (
  source: ThemeColorSource,
  inputs: ThemeColorRouteInputs,
): ThemeColorRoute | null => {
  if (source === "cover" && isUsableTheme(inputs.coverTheme)) {
    return { kind: "cover", theme: inputs.coverTheme };
  }
  if (source === "background" && isUsableTheme(inputs.backgroundTheme)) {
    return { kind: "background", theme: inputs.backgroundTheme };
  }
  if (inputs.presetColor) {
    return { kind: "preset", presetColor: inputs.presetColor };
  }
  return null;
};
