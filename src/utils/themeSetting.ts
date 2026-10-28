import type { ThemeColorSource } from "@/stores/setting";
import type { ThemeColorRoute } from "@/utils/color";

/** 主题色来源选项 */
export interface ThemeColorSourceOption {
  /** 选项值 */
  value: ThemeColorSource;
  /** 展示名称 */
  label: string;
  /** 说明文案 */
  tip: string;
}

/** 主题色来源选项列表（顺序即 UI 展示顺序） */
export const THEME_COLOR_SOURCE_OPTIONS: ThemeColorSourceOption[] = [
  { value: "preset", label: "预设色", tip: "使用预设主题色或自定义颜色" },
  { value: "background", label: "背景取色", tip: "从全局背景图提取主题色" },
  { value: "cover", label: "封面取色", tip: "跟随当前歌曲封面配色" },
];

/** 主题色来源的合法值集合 */
const THEME_COLOR_SOURCE_VALUES: readonly ThemeColorSource[] = [
  "preset",
  "background",
  "cover",
];

/**
 * 归一化主题色来源值
 * 非法或缺失值回退为默认的封面取色
 * @param value 任意来源值
 * @returns 合法的主题色来源
 */
export const normalizeThemeColorSource = (value: unknown): ThemeColorSource =>
  THEME_COLOR_SOURCE_VALUES.includes(value as ThemeColorSource)
    ? (value as ThemeColorSource)
    : "cover";

/** 主题色来源可用性判定输入 */
export interface ThemeColorSourceContext {
  /** 是否已设置全局背景图 */
  hasBackgroundImage: boolean;
}

/**
 * 判断主题色来源选项是否禁用
 * 背景取色在未设置全局背景图时不可用，其余来源恒可用
 * @param value 主题色来源
 * @param context 可用性判定输入
 * @returns 是否禁用
 */
export const isThemeColorSourceDisabled = (
  value: ThemeColorSource,
  context: ThemeColorSourceContext,
): boolean => value === "background" && !context.hasBackgroundImage;

/**
 * 判断背景相关调节项（背景模糊度、卡片透明度、毛玻璃效果）是否禁用
 * 未设置全局背景图时统一禁用
 * @param hasBackgroundImage 是否已设置全局背景图
 * @returns 是否禁用
 */
export const isBackgroundTuningDisabled = (hasBackgroundImage: boolean): boolean =>
  !hasBackgroundImage;

/**
 * 将滑杆输入收敛为 0-100 的整数
 * 非法输入按 0 处理
 * @param value 滑杆输入值
 * @returns 0-100 区间内的整数
 */
export const clampPercent = (value: number): number => {
  const numeric = Number.isFinite(value) ? value : 0;
  return Math.min(100, Math.max(0, Math.round(numeric)));
};

/**
 * 判断配色来源是否触发整体着色
 * 取色来源（背景取色 / 封面取色）下界面底色跟随取色结果，
 * 预设与自定义色下保持中性底色
 * @param route 主题色来源分流结果
 * @returns 是否整体着色
 */
export const isTintSurfacesRoute = (route: ThemeColorRoute | null): boolean =>
  route !== null && route.kind !== "preset";

/** 背景模糊度（0-100）映射到的最大像素值 */
export const BACKGROUND_BLUR_MAX_PX = 30;

/**
 * 计算背景模糊度对应的像素值
 * 未设置全局背景图时恒为 0
 * @param blur 背景模糊度（0-100）
 * @param hasBackgroundImage 是否已设置全局背景图
 * @returns 模糊像素值
 */
export const resolveBackgroundBlurPx = (
  blur: number,
  hasBackgroundImage: boolean,
): number => {
  if (!hasBackgroundImage) return 0;
  return Math.round((clampPercent(blur) / 100) * BACKGROUND_BLUR_MAX_PX);
};

/**
 * 计算卡片背景透明度
 * 未设置全局背景图时恒为 1（不透明）
 * @param transparency 卡片透明度（0-100）
 * @param hasBackgroundImage 是否已设置全局背景图
 * @returns 0-1 区间内的透明度
 */
export const resolveCardBgAlpha = (
  transparency: number,
  hasBackgroundImage: boolean,
): number => {
  if (!hasBackgroundImage) return 1;
  return Number((clampPercent(transparency) / 100).toFixed(2));
};
