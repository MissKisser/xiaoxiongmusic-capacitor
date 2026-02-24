<template>
  <n-layout-header class="nav">
    <!-- 页面导航 -->
    <n-flex class="page-control" align="center">
      <!-- 移动端 Logo 和标题 -->
      <template v-if="!isDesktop">
        <n-button
          class="mobile-menu-button"
          :focusable="false"
          tertiary
          circle
          @click="statusStore.showAside = !statusStore.showAside"
        >
          <template #icon>
            <SvgIcon name="Menu" :size="24" />
          </template>
        </n-button>
        <Logo :size="40" @click="router.push('/')" />
      </template>
      <!-- PC端导航按钮 -->
      <template v-if="!isSmallScreen">
        <n-button :focusable="false" tertiary circle @click="router.go(-1)">
          <template #icon>
            <SvgIcon name="NavigateBefore" :size="26" />
          </template>
        </n-button>
        <n-button :focusable="false" tertiary circle @click="router.go(1)">
          <template #icon>
            <SvgIcon name="NavigateNext" :size="26" />
          </template>
        </n-button>
      </template>
    </n-flex>
    <!-- 主内容 -->
    <n-flex :wrap="false" justify="center" align="center" class="nav-main">
      <!-- 左侧拖拽区域 -->
      <div v-if="isDesktop" class="nav-drag" />
      <!-- 搜索（居中，仅桌面端） -->
      <SearchInp v-if="isDesktop && settingStore.useOnlineService" />
      <!-- 右侧拖拽区域 -->
      <div v-if="isDesktop" class="nav-drag" />
      <n-flex align="center" class="nav-right">
        <!-- 搜索按钮（移动端，在最左边） -->
        <SearchInp v-if="!isDesktop && settingStore.useOnlineService" />
        <!-- 全局着色按钮（同时切换全局着色和跟随封面） -->
        <n-button
          class="global-color-btn"
          :class="{ 'global-color-enabled': isGlobalColorEnabled }"
          :focusable="false"
          :title="isGlobalColorEnabled ? '关闭全局着色' : '开启全局着色'"
          :type="isGlobalColorEnabled ? 'primary' : 'default'"
          tertiary
          circle
          @click="toggleGlobalColor"
        >
          <template #icon>
            <SvgIcon name="Palette" :class="{ 'icon-enabled': isGlobalColorEnabled }" />
          </template>
        </n-button>
        <!-- 用户 -->
        <User v-if="settingStore.useOnlineService" />
        <!-- 设置菜单 -->
        <!-- <n-dropdown :options="setOptions" trigger="click" show-arrow @select="setSelect">
          <n-button :focusable="false" title="设置" tertiary circle>
            <template #icon>
              <SvgIcon name="Settings" />
            </template>
          </n-button>
        </n-dropdown> -->
      </n-flex>
    </n-flex>
    <!-- 客户端控制 -->
    <n-flex
      v-if="isElectron && !isSmallScreen && useBorderless"
      align="center"
      class="client-control"
    >
      <n-divider class="divider" vertical />
      <div class="min-button-wrapper" @click="min" title="最小化">
        <n-button :focusable="false" title="最小化" tertiary circle @click.stop="min">
          <template #icon>
            <SvgIcon name="WindowMinimize" />
          </template>
        </n-button>
        <div class="min-expanded-area"></div>
      </div>
      <div class="max-button-wrapper" @click="maxOrRes" :title="isMax ? '还原' : '最大化'">
        <n-button
          :focusable="false"
          :title="isMax ? '还原' : '最大化'"
          tertiary
          circle
          @click.stop="maxOrRes"
        >
          <template #icon>
            <SvgIcon :name="isMax ? 'WindowRestore' : 'WindowMaximize'" />
          </template>
        </n-button>
        <div class="max-expanded-area"></div>
      </div>
      <div class="close-button-wrapper" @click="tryClose" title="关闭">
        <n-button :focusable="false" title="关闭" tertiary circle @click.stop="tryClose">
          <template #icon>
            <SvgIcon name="WindowClose" />
          </template>
        </n-button>
        <div class="close-expanded-area"></div>
      </div>
    </n-flex>
    <!-- 关闭弹窗 -->
    <n-modal
      v-model:show="showCloseModal"
      :auto-focus="false"
      title="关闭软件"
      style="width: 600px"
      preset="card"
      transform-origin="center"
      bordered
      @after-leave="rememberNotAsk = false"
    >
      <n-text class="tip">确认关闭软件吗？</n-text>
      <n-checkbox v-model:checked="rememberNotAsk" class="checkbox"> 记住且不再询问 </n-checkbox>
      <template #footer>
        <n-flex justify="end">
          <n-button strong secondary @click="hideOrClose('exit')">
            <template #icon>
              <SvgIcon name="ExitToApp" />
            </template>
            关闭
          </n-button>
          <n-button type="primary" strong secondary @click="hideOrClose('hide')">
            <template #icon>
              <SvgIcon name="WindowHide" />
            </template>
            隐藏到托盘
          </n-button>
        </n-flex>
      </template>
    </n-modal>
  </n-layout-header>
</template>
<script setup lang="ts">
import { useSettingStore, useStatusStore } from "@/stores";
// import { renderIcon } from "@/utils/helper";
// import { openSetting } from "@/utils/modal";
// import { isDev } from "@/utils/env";
import { isElectron } from "@/utils/env";
import { useMobile } from "@/composables/useMobile";

const router = useRouter();
const settingStore = useSettingStore();
const statusStore = useStatusStore();
const { isDesktop, isSmallScreen } = useMobile();

const showCloseModal = ref(false);
// 是否记住
const rememberNotAsk = ref(false);
// 是否启用无边框窗口
const useBorderless = ref(true);
// 当前窗口状态
const isMax = ref(false);

// 全局着色状态（同时考虑 themeGlobalColor 和 themeFollowCover）
const isGlobalColorEnabled = computed(() => {
  return settingStore.themeGlobalColor && settingStore.themeFollowCover;
});

// 切换全局着色（同时切换两个设置）
const toggleGlobalColor = () => {
  const newValue = !isGlobalColorEnabled.value;
  settingStore.themeGlobalColor = newValue;
  settingStore.themeFollowCover = newValue;
  // 显示 toast 提示
  window.$message.success(newValue ? "全局着色已开启" : "全局着色已关闭");
};

// 缩放相关（当前模板中设置菜单已注释隐藏，保留代码以便以后恢复）
/*
// 当前缩放系数
const currentZoomFactor = ref(1.0);

// 缩放系数选项
const zoomFactorList = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.75, 2];

// 缩放选项列表
const zoomOptions = computed<DropdownOption[]>(() =>
  zoomFactorList.map((factor) => {
    const isSelected = Math.abs(currentZoomFactor.value - factor) < 0.01;
    return {
      label: `${Math.round(factor * 100)}%`,
      key: `zoom-${factor}`,
      icon: isSelected ? renderIcon("Check") : undefined,
    };
  }),
);
*/

// 最小化
const min = () => window.electron.ipcRenderer.send("win-min");

// 最大化或还原
const maxOrRes = () => {
  if (window.electron.ipcRenderer.sendSync("win-state")) {
    window.electron.ipcRenderer.send("win-restore");
  } else {
    window.electron.ipcRenderer.send("win-max");
  }
};

// 隐藏或关闭
const hideOrClose = (action: "hide" | "exit") => {
  if (rememberNotAsk.value) {
    settingStore.showCloseAppTip = false;
    settingStore.closeAppMethod = action;
  }
  showCloseModal.value = false;
  window.electron.ipcRenderer.send(action === "hide" ? "win-hide" : "quit-app");
};

// 尝试关闭软件
const tryClose = () => {
  if (settingStore.showCloseAppTip) {
    showCloseModal.value = true;
  } else {
    hideOrClose(settingStore.closeAppMethod);
  }
};

// 设置菜单（当前模板中已注释隐藏，保留代码以便以后恢复）
/*
const setOptions = computed<DropdownOption[]>(() => [
  {
    label:
      settingStore.themeMode === "auto"
        ? "浅色模式"
        : settingStore.themeMode === "light"
          ? "深色模式"
          : "跟随系统",
    key: "themeMode",
    icon: renderIcon(
      settingStore.themeMode === "auto"
        ? "LightTheme"
        : settingStore.themeMode === "light"
          ? "DarkTheme"
          : "AutoTheme",
    ),
  },
  {
    key: "zoom",
    label: "界面缩放",
    icon: renderIcon("ZoomIn"),
    show: isElectron,
    children: zoomOptions.value,
  },
  {
    key: "divider-1",
    type: "divider",
  },
  {
    // 重启
    key: "restart",
    label: "软件热重载",
    show: isElectron,
    props: { onClick: () => window.electron.ipcRenderer.send("win-reload") },
    icon: renderIcon("Restart"),
  },
  {
    key: "dev-tools",
    label: "开启控制台",
    show: isDev,
    icon: renderIcon("Code"),
  },
  {
    key: "setting",
    label: "全局设置",
    icon: renderIcon("Settings"),
  },
]);

const setSelect = (key: string) => {
  switch (key) {
    case "themeMode":
      settingStore.setThemeMode();
      break;
    case "setting":
      openSetting();
      break;
    case "dev-tools":
      window.electron.ipcRenderer.send("open-dev-tools");
      break;
    default:
      // 处理缩放选项
      if (key.startsWith("zoom-")) {
        const factor = parseFloat(key.replace("zoom-", ""));
        if (!isNaN(factor)) {
          window.electron.ipcRenderer.invoke("set-zoom-factor", factor);
          currentZoomFactor.value = factor;
        }
      }
      break;
  }
};
*/

onMounted(async () => {
  // 获取窗口状态并监听主进程的状态变更
  if (isElectron) {
    // 获取无边框窗口配置
    const windowConfig = await window.api.store.get("window");
    useBorderless.value = windowConfig?.useBorderless ?? true;
    // 获取当前缩放系数（设置菜单已注释隐藏，缩放功能暂不需要）
    // currentZoomFactor.value = await window.electron.ipcRenderer.invoke("get-zoom-factor");
    // 获取窗口状态
    isMax.value = window.electron.ipcRenderer.sendSync("win-state");
    window.electron.ipcRenderer.on("win-state-change", (_event, value: boolean) => {
      isMax.value = value;
    });
  }
});
</script>

<style lang="scss" scoped>
.nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: calc(70px + env(safe-area-inset-top, 0px));
  padding: 0 1rem;
  padding-top: env(safe-area-inset-top, 0px); // 适配系统状态栏高度
  -webkit-app-region: drag;
  position: relative;
  // 移动端毛玻璃效果（与播放器一致）
  // 注意：不要把 backdrop-filter 直接加在 .nav 上
  // 否则在部分移动端 WebView/Safari 下会影响子元素 position: fixed（搜索遮罩），导致遮罩只在顶栏区域生效
  @media (max-width: 768px) {
    background-color: rgba(var(--surface-container), 0.5) !important;
    z-index: 2005;
    // 使用阴影向上延伸背景颜色，确保状态栏区域底色一致
    box-shadow: 0 -100px 0 0 rgba(var(--surface-container), 0.5);
    
    &::before {
      content: "";
      position: absolute;
      inset: -100px 0 0 0; // 向上延伸背景层
      backdrop-filter: blur(20px) saturate(180%);
      -webkit-backdrop-filter: blur(20px) saturate(180%);
      background-color: transparent;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      pointer-events: none;
      z-index: 0;
    }
    > * {
      position: relative;
      z-index: 1;
    }
  }
  .n-button {
    width: clamp(36px, 8vw, 40px);
    height: clamp(36px, 8vw, 40px);
    -webkit-app-region: no-drag;
  }
  .nav-main {
    position: relative;
    flex: 1;
    height: 100%;
    margin-left: 12px;
    gap: 12px;
    .nav-drag {
      flex: 1;
      height: 100%;
    }
    .nav-right {
      gap: 8px;
      flex-shrink: 0;
    }
    // 移动端布局调整
    @media (max-width: 768px) {
      flex: 1; // 恢复弹性增长
      margin-left: 0; // 移除推到右侧的逻辑
      .nav-right {
        display: flex;
        flex-direction: row;
        align-items: center;
        margin-left: auto; // 将右侧操作区推到最后
        gap: 8px; // 移动端按钮固定间距
        .n-button {
          margin: 0; // 确保按钮没有额外外边距
        }
      }
    }
  }
  .mobile-menu-button {
    margin-right: 8px;
    z-index: 10;
  }
  .client-control {
    .divider {
      margin: 0 0 0 12px;
    }
    .min-button-wrapper,
    .max-button-wrapper,
    .close-button-wrapper {
      position: relative;
      cursor: pointer;
    }
    .min-expanded-area,
    .max-expanded-area,
    .close-expanded-area {
      position: fixed;
      top: 0;
      width: 50px;
      height: 70px;
      background-color: transparent;
      cursor: pointer;
      -webkit-app-region: no-drag;
      z-index: 1000;
    }
    .close-expanded-area {
      right: 0;
    }
    .max-expanded-area {
      right: 50px;
    }
    .min-expanded-area {
      right: 100px;
    }
  }
}
.tip {
  font-size: 16px;
}
.mobile-title {
  font-size: 18px;
  font-family: "logo";
  margin-left: 8px;
  cursor: pointer;
  -webkit-app-region: no-drag;
}
.aside-logo {
  .n-text {
    width: 90px;
    font-size: 22px;
    font-family: "logo";
    margin-top: 2px;
    line-height: 40px;
  }
}
.checkbox {
  display: flex;
  flex-direction: row;
  align-items: center;
  width: max-content;
  margin-top: 12px;
  :deep(.n-checkbox__label) {
    line-height: 0;
  }
}
// 全局着色按钮样式
.global-color-btn {
  transition: all 0.3s ease;
  &.global-color-enabled {
    // 开启状态：使用主题色
    background-color: rgba(var(--primary), 0.15) !important;
    border-color: rgba(var(--primary), 0.3) !important;
    :deep(.n-icon) {
      color: rgb(var(--primary)) !important;
    }
    &:hover {
      background-color: rgba(var(--primary), 0.25) !important;
      border-color: rgba(var(--primary), 0.5) !important;
    }
  }
  // 关闭状态：使用默认灰色
  &:not(.global-color-enabled) {
    :deep(.n-icon) {
      color: var(--n-text-color-3) !important;
    }
    &:hover {
      background-color: var(--n-color-hover) !important;
      :deep(.n-icon) {
        color: var(--n-text-color-2) !important;
      }
    }
  }
}
</style>
