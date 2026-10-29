<template>
  <div class="setting-type app-setting">
    <div class="set-list">
      <n-h3 prefix="bar"> 主题与背景 </n-h3>

      <!-- 主题模式 -->
      <n-card class="set-item column theme-mode-item">
        <div class="label">
          <n-text class="name">主题模式</n-text>
          <n-text class="tip" :depth="3"> 选择应用的主题模式 </n-text>
        </div>
        <div class="theme-mode-group">
          <n-button
            v-for="mode in themeModes"
            :key="mode.value"
            size="small"
            :type="settingStore.themeMode === mode.value ? 'primary' : 'default'"
            :secondary="settingStore.themeMode !== mode.value"
            @click="setThemeMode(mode.value)"
          >
            {{ mode.label }}
          </n-button>
        </div>
      </n-card>

      <!-- 主题色 -->
      <n-card class="set-item column theme-color-item">
        <div class="label">
          <n-text class="name">主题色</n-text>
          <n-text class="tip" :depth="3"> 选择应用配色的来源 </n-text>
        </div>
        <n-flex vertical :size="12" class="theme-color-controls">
          <n-radio-group
            :value="settingStore.themeColorSource"
            size="small"
            @update:value="setThemeColorSource"
          >
            <n-radio-button
              v-for="option in themeColorSourceOptions"
              :key="option.value"
              :value="option.value"
              :disabled="isThemeColorSourceDisabled(option.value, sourceContext)"
            >
              {{ option.label }}
            </n-radio-button>
          </n-radio-group>
          <n-text v-if="isBackgroundSourceUnavailable" class="tip" :depth="3">
            背景取色需要先设置全局背景
          </n-text>

          <!-- 预设色板与自定义颜色 -->
          <template v-if="settingStore.themeColorSource === 'preset'">
            <div class="palette-group">
              <button
                v-for="swatch in paletteSwatches"
                :key="swatch.key"
                type="button"
                class="palette-swatch"
                :class="{ active: settingStore.themeColorType === swatch.key }"
                :title="swatch.name"
                @click="setThemeColorType(swatch.key)"
              >
                <span class="dot" :style="{ '--swatch-color': swatch.color }" />
                {{ swatch.name }}
              </button>
            </div>
            <div v-if="settingStore.themeColorType === 'custom'" class="custom-color-row">
              <n-text depth="3">自定义颜色</n-text>
              <n-color-picker
                :value="settingStore.themeCustomColor"
                :show-alpha="false"
                :modes="['hex']"
                class="custom-color-picker"
                @complete="setThemeCustomColor"
              />
            </div>
          </template>
        </n-flex>
      </n-card>

      <!-- 全局背景 -->
      <n-card class="set-item column background-item">
        <div class="label">
          <n-text class="name">全局背景</n-text>
          <n-text class="tip" :depth="3"> 设置应用全局背景图片 </n-text>
        </div>
        <n-flex vertical :size="10" class="background-controls">
          <n-flex :size="8">
            <n-button size="small" @click="triggerUpload">
              <template #icon>
                <component :is="renderIcon('Image')" />
              </template>
              选择图片
            </n-button>
            <n-button
              v-if="hasBackgroundImage"
              size="small"
              type="error"
              secondary
              @click="handleClearBackground"
            >
              <template #icon>
                <component :is="renderIcon('Delete')" />
              </template>
              清除背景
            </n-button>
          </n-flex>
          <input
            ref="fileInput"
            type="file"
            accept="image/*"
            style="display: none"
            @change="handleFileChange"
          />
          <div v-if="hasBackgroundImage" class="preview-container">
            <img :src="settingStore.globalBackgroundImage ?? ''" class="preview-img" />
          </div>
        </n-flex>
      </n-card>

      <!-- 背景模糊度 -->
      <n-card class="set-item column slider-item">
        <div class="label">
          <n-text class="name">背景模糊度</n-text>
          <n-text class="tip" :depth="3">
            {{ hasBackgroundImage ? `当前 ${settingStore.backgroundBlur}%` : '设置全局背景后可用' }}
          </n-text>
        </div>
        <n-slider
          :value="settingStore.backgroundBlur"
          :min="0"
          :max="100"
          :step="1"
          :disabled="tuningDisabled"
          :format-tooltip="(v: number) => v + '%'"
          class="tuning-slider"
          @update:value="setBackgroundBlur"
        />
      </n-card>

      <!-- 卡片透明度 -->
      <n-card class="set-item column slider-item">
        <div class="label">
          <n-text class="name">卡片透明度</n-text>
          <n-text class="tip" :depth="3">
            {{ hasBackgroundImage
              ? `当前 ${settingStore.cardTransparency}%，顶栏透明度将同步`
              : '设置全局背景后可用' }}
          </n-text>
        </div>
        <n-slider
          :value="settingStore.cardTransparency"
          :min="0"
          :max="100"
          :step="1"
          :disabled="tuningDisabled"
          :format-tooltip="(v: number) => v + '%'"
          class="tuning-slider"
          @update:value="setCardTransparency"
        />
      </n-card>

      <!-- 毛玻璃效果 -->
      <n-card class="set-item">
        <div class="label">
          <n-text class="name">毛玻璃效果</n-text>
          <n-text class="tip" :depth="3">
            {{ hasBackgroundImage
              ? (settingStore.enableBlurEffect
                ? '已开启：作用于顶栏、侧栏与卡片磨砂'
                : '已关闭：使用半透明纯色替代')
              : '设置全局背景后可用' }}
          </n-text>
        </div>
        <n-switch
          :value="settingStore.enableBlurEffect"
          class="set"
          :round="false"
          :disabled="tuningDisabled"
          @update:value="setBlurEffect"
        />
      </n-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useSettingStore } from "@/stores";
import type { ThemeColorSource } from "@/stores/setting";
import { renderIcon } from "@/utils/helper";
import { openBackgroundCropModal } from "@/utils/modal";
import { clearGlobalBackground } from "@/utils/backgroundStore";
import {
  THEME_COLOR_SOURCE_OPTIONS,
  clampPercent,
  isBackgroundTuningDisabled,
  isThemeColorSourceDisabled,
} from "@/utils/themeSetting";
import themeColor from "@/assets/data/themeColor.json";

const settingStore = useSettingStore();
const fileInput = ref<HTMLInputElement | null>(null);

// === 主题模式 ===
const themeModes = [
  { value: "auto", label: "跟随系统" },
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
];

const setThemeMode = (mode: string) => {
  settingStore.setThemeMode(mode as "auto" | "light" | "dark");
};

// === 主题色来源 ===
const themeColorSourceOptions = THEME_COLOR_SOURCE_OPTIONS;
const hasBackgroundImage = computed(() => Boolean(settingStore.globalBackgroundImage));
const sourceContext = computed(() => ({ hasBackgroundImage: hasBackgroundImage.value }));
const tuningDisabled = computed(() => isBackgroundTuningDisabled(hasBackgroundImage.value));
const isBackgroundSourceUnavailable = computed(
  () =>
    settingStore.themeColorSource === "background" &&
    isThemeColorSourceDisabled("background", sourceContext.value),
);

const setThemeColorSource = (value: ThemeColorSource) => {
  settingStore.themeColorSource = value;
};

// === 预设色板 ===
type ThemeColorType = keyof typeof themeColor;

const paletteSwatches = (Object.entries(themeColor) as [ThemeColorType, { name: string; color: string }][]).map(
  ([key, value]) => ({ key, name: value.name, color: value.color }),
);

const setThemeColorType = (key: ThemeColorType) => {
  settingStore.themeColorType = key;
};

const setThemeCustomColor = (color: string) => {
  settingStore.themeCustomColor = color;
};

// === 全局背景 ===
const triggerUpload = () => {
  fileInput.value?.click();
};

const handleFileChange = (e: Event) => {
  const input = e.target as HTMLInputElement;
  if (!input.files?.length) return;
  const file = input.files[0];
  if (file.size > 5 * 1024 * 1024) {
    window.$message.warning("图片大小不能超过 5MB");
    input.value = "";
    return;
  }
  const reader = new FileReader();
  reader.onload = (ev) => {
    if (ev.target?.result) {
      openBackgroundCropModal(ev.target.result as string);
    }
  };
  reader.readAsDataURL(file);
  input.value = "";
};

const handleClearBackground = async () => {
  await clearGlobalBackground();
  window.$message.success("已清除全局背景");
};

// === 背景调节 ===
const setBackgroundBlur = (value: number) => {
  settingStore.backgroundBlur = clampPercent(value);
};

const setCardTransparency = (value: number) => {
  settingStore.cardTransparency = clampPercent(value);
};

const setBlurEffect = (enabled: boolean) => {
  settingStore.enableBlurEffect = enabled;
};
</script>

<style lang="scss" scoped>
.app-setting {
  .theme-mode-group {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    width: 100%;

    .n-button {
      // 均分卡片宽度，但不压缩到内容宽度以下（按钮文字不换行，压缩会导致文字重叠）
      flex: 1 1 auto;
      min-width: fit-content;
    }
  }

  .theme-color-controls {
    width: 100%;
  }

  .palette-group {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    width: 100%;

    .palette-swatch {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 6px;
      border: 1px solid rgba(128, 128, 128, 0.25);
      background: transparent;
      font-size: 12px;
      cursor: pointer;
      transition:
        border-color 0.2s,
        box-shadow 0.2s;

      .dot {
        width: 14px;
        height: 14px;
        border-radius: 50%;
        background: var(--swatch-color);
        border: 1px solid rgba(128, 128, 128, 0.3);
        flex-shrink: 0;
      }

      &.active {
        border-color: var(--primary-hex);
        box-shadow: 0 0 0 1px var(--primary-hex);
      }
    }
  }

  .custom-color-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
    width: 100%;

    .custom-color-picker {
      flex: 1;
      min-width: 120px;
      max-width: 100%;
    }
  }

  .preview-container {
    position: relative;
    width: 100%;
    min-height: 120px;
    max-height: 240px;
    border-radius: 8px;
    overflow: hidden;
    border: 1px solid rgba(128, 128, 128, 0.2);
    display: flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, var(--surface-container-hex), rgb(0 0 0 / 5%));

    .preview-img {
      max-width: 100%;
      max-height: 220px;
      display: block;
      object-fit: contain;
      border-radius: 4px;
    }
  }

  .tuning-slider {
    width: 100%;
  }
}
</style>
