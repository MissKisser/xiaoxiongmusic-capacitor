<template>
  <div class="setting-type app-setting">
    <div class="set-list">
      <n-h3 prefix="bar"> 主题与背景 </n-h3>

      <!-- 主题模式 -->
      <n-card class="set-item">
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

      <!-- 全局背景 -->
      <n-card class="set-item background-item">
        <div class="label">
          <n-text class="name">全局背景</n-text>
          <n-text class="tip" :depth="3"> 设置自定义全局背景图片 </n-text>
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
              v-if="settingStore.globalBackgroundImage"
              size="small"
              type="error"
             
              @click="resetBackground"
            >
              <template #icon>
                <component :is="renderIcon('Delete')" />
              </template>
              移除背景
            </n-button>
          </n-flex>
          <input
            ref="fileInput"
            type="file"
            accept="image/*"
            style="display: none"
            @change="handleFileChange"
          />
          <div v-if="settingStore.globalBackgroundImage" class="preview-container">
            <img :src="settingStore.globalBackgroundImage" class="preview-img" />
          </div>
        </n-flex>
      </n-card>

      <!-- 背景参数 -->
      <n-card class="set-item" @click="openBackgroundSetting()">
        <div class="label">
          <n-text class="name">背景参数设置</n-text>
          <n-text class="tip" :depth="3"> 调整背景模糊、透明度等扩展参数 </n-text>
        </div>
        <n-text class="arrow" depth="3">›</n-text>
      </n-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { h } from "vue";
import { useSettingStore } from "@/stores";
import { renderIcon } from "@/utils/helper";
import { openBackgroundSetting } from "@/utils/modal";
import ImageCropModal from "@/components/Modal/Setting/ImageCropModal.vue";

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

// === 背景设置 ===
const triggerUpload = () => {
  fileInput.value?.click();
};

// 打开裁剪弹窗
const openCropModal = (imageSrc: string) => {
  const modal = window.$modal.create({
    preset: "card",
    transformOrigin: "center",
    autoFocus: false,
    maskClosable: false,
    closeOnEsc: false,
    closable: false,
    style: {
      width: "min(90vw, 600px)",
      maxWidth: "calc(100vw - 32px)",
      marginTop: "calc(env(safe-area-inset-top, 0px) + var(--nav-height, 70px))",
    },
    zIndex: 4000,
    title: "裁剪背景图片",
    content: () => {
      return h(ImageCropModal, {
        imageSrc,
        onCancel: () => modal.destroy(),
        onConfirm: () => modal.destroy(),
      });
    },
  });
};

const handleFileChange = (e: Event) => {
  const input = e.target as HTMLInputElement;
  if (!input.files?.length) return;
  const file = input.files[0];
  const reader = new FileReader();
  reader.onload = (ev) => {
    if (ev.target?.result) {
      openCropModal(ev.target.result as string);
    }
  };
  reader.readAsDataURL(file);
  input.value = "";
};

const resetBackground = () => {
  settingStore.globalBackgroundImage = null;
  window.$message.success("已移除背景");
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
      flex: 1;
      min-width: 80px;
    }
  }

  .background-item {
    :deep(.n-card__content) {
      flex-direction: column;
      align-items: flex-start;
    }
  }

  .preview-container {
    position: relative;
    width: 100%;
    min-height: 150px;
    max-height: 300px;
    border-radius: 8px;
    overflow: hidden;
    border: 1px solid rgba(128, 128, 128, 0.2);
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--n-color);

    .preview-img {
      max-width: 60%;
      max-height: 280px;
      display: block;
      object-fit: contain;
      border-radius: 4px;
    }
  }

  .arrow {
    font-size: 20px;
    opacity: 0.5;
  }
}
</style>
