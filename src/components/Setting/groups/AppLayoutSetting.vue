<template>
  <div class="layout-setting">
    <!-- 背景：真实首页（实时反映布局调节） -->
    <div class="home-bg">
      <Home />
    </div>

    <!-- 前景：设置项（半透明，悬浮于首页之上） -->
    <div class="settings-overlay">
      <div class="set-list">
        <!-- 布局模式 -->
        <n-h3 prefix="bar"> 布局模式 </n-h3>
        <n-card class="set-item">
          <div class="label">
            <n-text class="name">预设模式</n-text>
            <n-text class="tip" :depth="3">
              大比例使用原有布局，小比例整体紧凑；手动调节下方任意滑块将自动切换为自定义
            </n-text>
          </div>
          <div class="mode-group">
            <n-button
              v-for="mode in layoutModes"
              :key="mode.value"
              size="small"
              :type="settingStore.layoutMode === mode.value ? 'primary' : 'default'"
              :secondary="settingStore.layoutMode !== mode.value"
              @click="handleModeChange(mode.value)"
            >
              {{ mode.label }}
            </n-button>
          </div>
        </n-card>

        <!-- 卡片列数 -->
        <n-h3 prefix="bar"> 卡片布局 </n-h3>
        <n-card class="set-item">
          <div class="label">
            <n-text class="name">卡片列数</n-text>
            <n-text class="tip" :depth="3">
              歌单、专辑等卡片网格每行显示 2 列或 3 列
            </n-text>
          </div>
          <n-radio-group
            :value="settingStore.mobileCardColumns"
            size="small"
            @update:value="handleColumnChange"
          >
            <n-radio-button :value="2">2 列</n-radio-button>
            <n-radio-button :value="3">3 列</n-radio-button>
          </n-radio-group>
        </n-card>

        <!-- 首页比例 -->
        <n-h3 prefix="bar"> 首页比例 </n-h3>
        <n-card class="set-item">
          <div class="label">
            <n-text class="name">大卡片比例</n-text>
            <n-text class="tip" :depth="3">
              问候语、每日推荐、我喜欢的音乐、私人FM 统一缩放，拖动滑块实时预览下方首页
            </n-text>
          </div>
          <n-slider
            :value="settingStore.homeCardScale"
            :min="60"
            :max="100"
            :step="5"
            class="card-slider"
            :format-tooltip="(v: number) => v + '%'"
            @update:value="handleCardScaleChange"
          />
        </n-card>

        <!-- 顶栏高度 -->
        <n-h3 prefix="bar"> 顶栏高度 </n-h3>
        <n-card class="set-item">
          <div class="label">
            <n-text class="name">菜单栏高度</n-text>
            <n-text class="tip" :depth="3">
              拖动滑块实时调整顶部导航栏高度（当前 {{ settingStore.navHeight }}px）
            </n-text>
          </div>
          <n-slider
            :value="settingStore.navHeight"
            :min="50"
            :max="70"
            :step="1"
            class="nav-slider"
            :format-tooltip="(v: number) => v + 'px'"
            @update:value="handleNavHeightChange"
          />
        </n-card>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useSettingStore } from "@/stores";
import Home from "@/views/Home/index.vue";

const settingStore = useSettingStore();

// 布局模式选项
const layoutModes = [
  { value: "large", label: "大比例" },
  { value: "small", label: "小比例" },
  { value: "custom", label: "自定义" },
] as const;

// 切换布局模式（应用预设值）
const handleModeChange = (mode: "large" | "small" | "custom") => {
  settingStore.applyLayoutMode(mode);
  window.$message.success(
    mode === "large" ? "已切换为大比例布局" : mode === "small" ? "已切换为小比例布局" : "已切换为自定义布局",
  );
};

// 卡片列数变化（手动调节 → 自定义模式）
const handleColumnChange = (value: 2 | 3) => {
  settingStore.mobileCardColumns = value;
  settingStore.layoutMode = "custom";
};

// 大卡片比例变化（手动调节 → 自定义模式，首页背景实时预览）
const handleCardScaleChange = (value: number) => {
  settingStore.homeCardScale = value;
  settingStore.layoutMode = "custom";
};

// 顶栏高度变化（手动调节 → 自定义模式）
const handleNavHeightChange = (value: number) => {
  settingStore.navHeight = value;
  settingStore.layoutMode = "custom";
};
</script>

<style scoped lang="scss">
.layout-setting {
  position: relative;
  height: 100%;
  // 背景首页：全屏铺底，实时反映布局调节
  .home-bg {
    position: fixed;
    inset: 0;
    z-index: 0;
    overflow: hidden;
    pointer-events: none; // 背景不拦截交互，避免遮挡滑块
  }
  // 前景设置项：半透明悬浮层，可滚动
  .settings-overlay {
    position: relative;
    z-index: 1;
    height: 100%;
    overflow-y: auto;
    padding: 16px;
    background-color: color-mix(in srgb, var(--background-hex, #fff) 72%, transparent);
    .set-list {
      max-width: 480px;
      margin: 0 auto;
      padding-bottom: 40px;
      .n-card {
        --n-color: color-mix(in srgb, var(--surface-container-hex, #fff) 88%, transparent);
      }
    }
  }
  .mode-group {
    display: flex;
    gap: 8px;
    .n-button {
      min-width: 64px;
    }
  }
  .card-slider,
  .nav-slider {
    width: min(50vw, 260px);
  }
}
</style>
