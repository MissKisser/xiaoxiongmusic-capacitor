<template>
  <div class="setting-type app-setting">
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
          <n-text class="name">卡片列数（手机端）</n-text>
          <n-text class="tip" :depth="3">
            歌单、专辑等卡片网格在手机上每行显示 2 列或 3 列，桌面端自动适配
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

      <!-- 首页大卡片比例 -->
      <n-h3 prefix="bar"> 首页大卡片 </n-h3>
      <n-card class="set-item">
        <div class="label">
          <n-text class="name">大卡片比例（问候语/每日推荐/我喜欢/私人FM）</n-text>
          <n-text class="tip" :depth="3">
            拖动滑块实时预览首页布局（当前 {{ settingStore.homeCardScale }}%），三个大卡片与问候语统一缩放
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
          @dragstart="previewVisible = true"
          @dragend="hidePreview"
        />
      </n-card>

      <!-- 顶栏高度 -->
      <n-h3 prefix="bar"> 顶栏高度 </n-h3>
      <n-card class="set-item">
        <div class="label">
          <n-text class="name">菜单栏高度</n-text>
          <n-text class="tip" :depth="3">
            拖动滑块实时调整顶部导航栏高度（当前 {{ settingStore.navHeight }}px），让内容区显示更多内容
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

    <!-- 首页实时预览（调节大卡片比例时半透明叠加真实首页） -->
    <Teleport to="body">
      <Transition name="fade">
        <div v-if="previewVisible" class="home-preview-overlay" @click="previewVisible = false">
          <div class="home-preview-content" @click.stop>
            <Home />
          </div>
        </div>
      </Transition>
    </Teleport>
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

// 首页预览显隐
const previewVisible = ref(false);
let previewTimer: ReturnType<typeof setTimeout> | null = null;

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

// 大卡片比例变化（手动调节 → 自定义模式，实时预览）
const handleCardScaleChange = (value: number) => {
  settingStore.homeCardScale = value;
  settingStore.layoutMode = "custom";
};

// 顶栏高度变化（手动调节 → 自定义模式）
const handleNavHeightChange = (value: number) => {
  settingStore.navHeight = value;
  settingStore.layoutMode = "custom";
};

// 预览延迟隐藏（松手后停留片刻）
const hidePreview = () => {
  if (previewTimer) clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    previewVisible.value = false;
  }, 600);
};
</script>

<style scoped lang="scss">
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
.home-preview-overlay {
  position: fixed;
  inset: 0;
  z-index: 3000;
  background-color: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  .home-preview-content {
    width: min(92vw, 452px);
    height: 86vh;
    overflow-y: auto;
    border-radius: 16px;
    background-color: var(--background-hex);
    padding: 12px;
    box-shadow: 0 8px 40px rgba(0, 0, 0, 0.4);
  }
}
</style>
