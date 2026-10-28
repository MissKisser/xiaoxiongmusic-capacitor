<!-- 全局配置 -->
<template>
  <n-config-provider
    :locale="zhCN"
    :date-locale="dateZhCN"
    :theme="theme"
    :theme-overrides="themeOverrides"
    abstract
    inline-theme-disabled
    preflight-style-disabled
  >
    <n-global-style />
    <n-loading-bar-provider>
      <n-dialog-provider>
        <n-notification-provider>
          <n-message-provider :max="1" placement="bottom">
            <n-modal-provider>
              <slot />
              <NaiveProviderContent />
            </n-modal-provider>
          </n-message-provider>
        </n-notification-provider>
      </n-dialog-provider>
    </n-loading-bar-provider>
  </n-config-provider>
</template>

<style lang="scss">
// 全局隐藏顶部加载进度条（Naive loading-bar），避免路由切换时顶部条干扰
.n-loading-bar-container {
  display: none !important;
}
</style>

<script setup lang="ts">
import {
  zhCN,
  dateZhCN,
  darkTheme,
  useOsTheme,
  useLoadingBar,
  useModal,
  useDialog,
  useMessage,
  useNotification,
  GlobalThemeOverrides,
} from "naive-ui";
import { useSettingStore, useStatusStore } from "@/stores";
import { getBackgroundTheme, resolveThemeColorRoute, setColorSchemes } from "@/utils/color";
import { isTintSurfacesRoute } from "@/utils/themeSetting";
import { useCustomCode } from "@/composables/useCustomCode";
import themeColor from "@/assets/data/themeColor.json";
import type { CoverColors } from "@/types/main";

const statusStore = useStatusStore();
const settingStore = useSettingStore();

// 检测是否为移动端（用于背景透明处理）
const isMobile = useMediaQuery('(max-width: 768px)');

// 操作系统主题
const osTheme = useOsTheme();

// 全局主题（使用 shallowRef 避免深层追踪开销）
const themeOverrides = shallowRef<GlobalThemeOverrides>({});
// 轻量的 rgba 构造器
const toRGBA = (rgb: string, alpha: number) => `rgba(${rgb}, ${alpha})`;
// 主题缓存键
let lastThemeCacheKey: string | null = null;

// 获取明暗模式
const theme = computed(() => {
  return settingStore.themeMode === "auto"
    ? // 跟随系统
      osTheme.value === "dark"
      ? darkTheme
      : null
    : // 自定义
      settingStore.themeMode === "dark"
      ? darkTheme
      : null;
});

// 解析主题色来源，得到生效配色与整体着色状态
// 取色来源（背景取色 / 封面取色）下界面整体跟随该色着色，预设与自定义色下保持中性底色
const resolveThemePalette = () => {
  const themeType = theme.value ? "dark" : "light";
  // 预设来源颜色值：预设主题色或自定义颜色
  const presetColor =
    settingStore.themeColorType !== "custom"
      ? themeColor[settingStore.themeColorType].color
      : settingStore.themeCustomColor;
  // 按主题色来源分流：cover 跟随封面 / background 背景图取色 / preset 预设与自定义色
  const route = resolveThemeColorRoute(settingStore.themeColorSource, {
    presetColor,
    backgroundTheme: backgroundTheme.value,
    coverTheme: statusStore.songCoverTheme || null,
  });
  // 是否整体着色：取色来源下界面底色跟随取色结果
  const tintSurfaces = isTintSurfacesRoute(route);
  if (!route) {
    return { schemes: setColorSchemes(presetColor, themeType), tintSurfaces };
  }
  if (route.kind === "preset") {
    return { schemes: setColorSchemes(route.presetColor, themeType), tintSurfaces };
  }
  return {
    schemes: setColorSchemes(route.theme as any, themeType, { tintSurfaces }),
    tintSurfaces,
  };
};
// 背景图取色主题（背景图变化时重取）
const backgroundTheme = shallowRef<CoverColors | null>(null);
// 背景图取色请求序号（避免旧图的异步取色结果覆盖新图）
let backgroundThemeRequestId = 0;

// 从全局背景图提取主题色，并在取色完成后刷新全局主题
const refreshBackgroundTheme = async () => {
  const backgroundImage = settingStore.globalBackgroundImage;
  const requestId = ++backgroundThemeRequestId;
  if (!backgroundImage) {
    backgroundTheme.value = null;
    changeGlobalTheme();
    return;
  }
  const themeData = await getBackgroundTheme(backgroundImage);
  if (requestId === backgroundThemeRequestId) {
    backgroundTheme.value = themeData;
    changeGlobalTheme();
  }
};

// 更改全局主题
const changeGlobalTheme = () => {
  try {
    // 获取配色方案与整体着色状态
    const { schemes: colorSchemes, tintSurfaces } = resolveThemePalette();
    if (!colorSchemes || Object.keys(colorSchemes).length === 0) {
      themeOverrides.value = {};
      return;
    }
    // 构造主题缓存 Key
    const themeModeLabel = theme.value ? "dark" : "light";
    const themeCacheKey = `${themeModeLabel}|${tintSurfaces ? 1 : 0}|${settingStore.globalFont}|${colorSchemes.primary}|${colorSchemes.background}|${colorSchemes["surface-container"]}|${isMobile.value ? 1 : 0}`;
    if (lastThemeCacheKey === themeCacheKey) return;
    lastThemeCacheKey = themeCacheKey;

    // 关键颜色
    const primaryRGB = colorSchemes.primary as string;
    const surfaceContainerRGB = colorSchemes["surface-container"] as string;

    // 全局字体
    const fontFamily = `${settingStore.globalFont === "default" ? "v-sans" : settingStore.globalFont}, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol"`;

    // 预计算颜色值
    const colors = {
      primary: `rgb(${primaryRGB})`,
      primary78: toRGBA(primaryRGB, 0.78),
      primary58: toRGBA(primaryRGB, 0.58),
      primary52: toRGBA(primaryRGB, 0.52),
      primary20: toRGBA(primaryRGB, 0.2),
      primary12: toRGBA(primaryRGB, 0.12),
      primary09: toRGBA(primaryRGB, 0.09),
      primary08: toRGBA(primaryRGB, 0.08),
      surface: `rgb(${surfaceContainerRGB})`,
    };

    // 通用样式基座
    const commonBase = {
      fontFamily,
      primaryColor: colors.primary,
      primaryColorHover: colors.primary78,
      primaryColorPressed: toRGBA(primaryRGB, 0.26),
      primaryColorSuppl: colors.primary12,
    } as GlobalThemeOverrides["common"];

    /**
     * 获取组件样式
     * @param isGlobal 是否全局着色
     */
    const getComponentStyles = (isGlobal: boolean) => ({
      Slider: {
        handleColor: colors.primary,
        fillColor: colors.primary,
        fillColorHover: colors.primary,
        railColor: colors.primary20,
        railColorHover: toRGBA(primaryRGB, 0.3),
        indicatorColor: colors.surface,
        indicatorTextColor: colors.primary,
      },
      Icon: {
        color: colors.primary,
      },
      Tooltip: {
        color: colors.surface,
      },
      Tabs: {
        colorSegment: colors.surface,
        tabColorSegment: colors.primary12,
      },
      ...(isGlobal
        ? {
            Card: { borderColor: colors.primary09 },
            Button: {
              textColorHover: colors.primary78,
              textColorFocus: colors.primary58,
              colorPrimary: toRGBA(primaryRGB, 0.9),
              colorHoverPrimary: colors.primary,
              colorPressedPrimary: toRGBA(primaryRGB, 0.8),
              colorFocusPrimary: colors.primary,
            },
            Switch: { railColorActive: toRGBA(primaryRGB, 0.8) },
            Input: {
              color: toRGBA(primaryRGB, 0.1),
              colorFocus: colors.surface,
              placeholderColor: colors.primary58,
              border: `1px solid ${toRGBA(primaryRGB, 0.1)}`,
              clearColor: toRGBA(primaryRGB, 0.38),
              clearColorHover: toRGBA(primaryRGB, 0.48),
              clearColorPressed: toRGBA(primaryRGB, 0.3),
            },
            Empty: { textColor: toRGBA(primaryRGB, 0.38) },
            Divider: { color: colors.primary09 },
            Dropdown: { dividerColor: colors.primary09 },
            Layout: { siderBorderColor: colors.primary09 },
            Tabs: {
              colorSegment: colors.primary08,
              tabColorSegment: colors.primary12,
            },
            Drawer: {
              headerBorderBottom: `1px solid ${colors.primary09}`,
              footerBorderTop: `1px solid ${colors.primary09}`,
            },
            Menu: { dividerColor: colors.primary09 },
            Progress: { railColor: toRGBA(primaryRGB, 0.16) },
            Popover: {
              color: colors.surface,
            },
          }
        : {}),
    });

    // 获取组件样式（整体着色时追加取色相关组件样式）
    const specificStyles = getComponentStyles(tintSurfaces);

    // 页面底色：移动端设置了全局背景图时透明，便于透出背景图
    const bodyColor =
      isMobile.value && settingStore.globalBackgroundImage
        ? "transparent"
        : `rgb(${colorSchemes.background})`;

    if (tintSurfaces) {
      themeOverrides.value = {
        common: {
          ...commonBase,
          textColorBase: primaryRGB,
          textColor1: colors.primary,
          textColor2: toRGBA(primaryRGB, 0.82),
          textColor3: colors.primary52,
          bodyColor,
          cardColor: colors.surface,
          tagColor: colors.surface,
          modalColor: colors.surface,
          popoverColor: colors.surface,
          buttonColor2: colors.primary08,
          buttonColor2Hover: colors.primary12,
          buttonColor2Pressed: colors.primary08,
          iconColor: colors.primary,
          iconColorHover: toRGBA(primaryRGB, 0.475),
          closeIconColor: colors.primary58,
          hoverColor: colors.primary09,
          borderColor: colors.primary09,
          textColorDisabled: toRGBA(primaryRGB, 0.3),
          placeholderColorDisabled: toRGBA(primaryRGB, 0.3),
          iconColorDisabled: toRGBA(primaryRGB, 0.3),
        },
        ...specificStyles,
      };
    } else {
      themeOverrides.value = {
        common: {
          ...commonBase,
          bodyColor,
        },
        ...specificStyles,
      };
    }

    // 整体着色状态同步到 body，供菜单等对比度样式消费
    document.body.classList.toggle("global-color-enabled", tintSurfaces);
  } catch (error) {
    themeOverrides.value = {};
    console.error("切换主题色出现错误：", error);
    window.$message.error("切换主题色出现错误，已使用默认配置");
  }
};

// 挂载 naive 组件
const setupNaiveTools = () => {
  // 进度条
  window.$loadingBar = useLoadingBar();
  // 通知
  window.$notification = useNotification();
  // 信息
  window.$message = useMessage();
  // 对话框
  window.$dialog = useDialog();
  // 模态框
  window.$modal = useModal();
};

// 挂载工具
const NaiveProviderContent = defineComponent({
  setup() {
    setupNaiveTools();
  },
  render() {
    return h("div", { className: "main-tools" });
  },
});

// 监听设置更改
watch(
  () => [
    settingStore.themeColorType,
    settingStore.themeColorSource,
    settingStore.globalFont,
    statusStore.songCoverTheme?.main,
    theme.value,
    isMobile.value, // 监听移动端变化以更新背景色
  ],
  () => changeGlobalTheme(),
);

// 监听背景图变化，重取背景图主题色
watch(
  () => settingStore.globalBackgroundImage,
  () => refreshBackgroundTheme(),
);

// 自定义颜色更改
watchDebounced(
  () => settingStore.themeCustomColor,
  () => {
    changeGlobalTheme();
  },
  { debounce: 500, maxWait: 1000 },
);

onMounted(() => {
  changeGlobalTheme();
  // 已设置全局背景图时启动取色（来源为背景图或后续切换来源时已有数据可用）
  if (settingStore.globalBackgroundImage) {
    refreshBackgroundTheme();
  }
  // 自定义代码注入
  useCustomCode();
});
</script>
