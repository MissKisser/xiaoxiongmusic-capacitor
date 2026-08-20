<template>
  <div class="layout-setting">
    <!-- 首页预览层：首次拖动大卡片滑块时懒加载挂载，之后仅切换显隐（避免进入设置页即触发首页网络请求） -->
    <div v-if="previewMounted" v-show="previewVisible" class="home-bg">
      <Home />
    </div>

    <!-- 设置项层：拖动滑块时隐藏其他元素，仅保留滑块可操作 -->
    <div class="settings-overlay" :class="{ previewing: previewVisible }">
      <div class="set-list">
        <!-- 布局模式 -->
        <n-h3 prefix="bar"> 布局模式 </n-h3>
        <n-card class="set-item">
          <div class="label">
            <n-text class="name">预设模式</n-text>
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
        <n-card class="set-item preview-card">
          <div class="label">
            <n-text class="name">大卡片比例</n-text>
            <n-text class="tip" :depth="3">
              问候语、每日推荐、我喜欢的音乐、私人FM 统一缩放，拖动时实时预览首页
            </n-text>
          </div>
          <div class="slider-row">
            <n-slider
              :value="settingStore.homeCardScale"
              :min="60"
              :max="100"
              :step="1"
              class="card-slider"
              :format-tooltip="(v: number) => v + '%'"
              @update:value="handleCardScaleChange"
              @dragstart="startPreview"
              @dragend="endPreview"
            />
            <span class="slider-value">{{ settingStore.homeCardScale }}%</span>
          </div>
        </n-card>

        <!-- 顶栏高度 -->
        <n-h3 prefix="bar"> 顶栏高度 </n-h3>
        <n-card class="set-item nav-card">
          <div class="label">
            <n-text class="name">菜单栏高度</n-text>
            <n-text class="tip" :depth="3">
              拖动滑块实时调整顶部导航栏高度（当前 {{ settingStore.navHeight }}px）
            </n-text>
          </div>
          <div class="slider-row">
            <n-slider
              :value="settingStore.navHeight"
              :min="50"
              :max="70"
              :step="1"
              class="nav-slider"
              :format-tooltip="(v: number) => v + 'px'"
              @update:value="handleNavHeightChange"
            />
            <span class="slider-value">{{ settingStore.navHeight }}px</span>
          </div>
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

// 首页预览显隐（仅拖动大卡片滑块时透出）
const previewVisible = ref(false);
// 首页预览是否已挂载（首次拖动时懒加载，之后保持挂载仅切换显隐，避免重复触发网络请求）
const previewMounted = ref(false);

// 开始拖动：懒加载首页并透出预览
const startPreview = () => {
  previewMounted.value = true;
  previewVisible.value = true;
};

// 结束拖动：恢复设置页
const endPreview = () => {
  previewVisible.value = false;
};

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

// 大卡片比例变化（手动调节 → 自定义模式）
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
  // 首页预览层：仅拖动滑块时显示，全屏铺底
  .home-bg {
    position: fixed;
    inset: 0;
    z-index: 0;
    overflow: hidden;
    pointer-events: none; // 不拦截滑块交互
  }
  // 设置项层（与其他设置页统一：透明背景）
  .settings-overlay {
    position: relative;
    z-index: 1;
    height: 100%;
    overflow-y: auto;
    padding: 16px;
    .set-list {
      max-width: 480px;
      margin: 0 auto;
      padding-bottom: 40px;
    }
    // 拖动预览中：其他卡片淡出，滑块卡片也透明只留滑块本身
    &.previewing {
      .set-list {
        > *:not(.preview-card) {
          opacity: 0;
          pointer-events: none;
        }
      }
      .preview-card {
        background-color: transparent !important;
        box-shadow: none !important;
        border-color: transparent !important;
        .label {
          opacity: 0;
        }
        .slider-value {
          opacity: 0;
        }
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
  // 滑块卡片：描述在上、滑块在下从左到右满宽（窄屏不被挤压，宽度恒定避免拖动跳转）
  .preview-card,
  .nav-card {
    :deep(.n-card__content) {
      flex-direction: column !important;
      align-items: stretch !important;
      gap: 12px;
    }
    .slider-row {
      display: flex;
      align-items: center;
      gap: 12px;
      width: 100%;
    }
    .card-slider,
    .nav-slider {
      flex: 1;
      min-width: 0;
    }
    .slider-value {
      flex-shrink: 0;
      font-size: 14px;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      min-width: 48px;
      text-align: right;
      transition: opacity 0.2s;
    }
  }
}
</style>
