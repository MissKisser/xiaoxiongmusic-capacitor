<template>
  <div class="other-settings-modal">
    <n-tabs type="line" animated>
      <!-- 背景设置标签页 -->
      <n-tab-pane name="background" tab="背景设置">
        <n-scrollbar class="tab-scrollbar">
          <n-space vertical size="large">
            <n-card :bordered="false" title="主题模式">
              <div class="theme-mode-group">
                <n-button 
                  v-for="mode in themeModes" 
                  :key="mode.value"
                  :type="settingStore.themeMode === mode.value ? 'primary' : 'default'"
                  :secondary="settingStore.themeMode !== mode.value"
                  @click="setThemeMode(mode.value)"
                >
                  {{ mode.label }}
                </n-button>
              </div>
            </n-card>

            <n-card :bordered="false" title="全局背景">
              <n-space vertical>
                <n-text depth="3">设置自定义全局背景图片</n-text>
                
                <n-space align="center">
                  <n-button @click="triggerUpload">
                    <template #icon>
                      <component :is="renderIcon('Image')" />
                    </template>
                    选择图片
                  </n-button>
                  <n-button v-if="settingStore.globalBackgroundImage" type="error" @click="resetBackground">
                    <template #icon>
                      <component :is="renderIcon('Delete')" />
                    </template>
                    移除背景
                  </n-button>
                </n-space>

                <input 
                  ref="fileInput"
                  type="file" 
                  accept="image/*" 
                  style="display: none"
                  @change="handleFileChange"
                />

                <!-- 预览区域 -->
                <div v-if="settingStore.globalBackgroundImage" class="preview-container">
                  <n-image 
                    :src="settingStore.globalBackgroundImage" 
                    object-fit="contain" 
                    class="preview-img"
                    preview-disabled
                  />
                </div>
              </n-space>
            </n-card>
          </n-space>
        </n-scrollbar>
      </n-tab-pane>

      <!-- 缓存设置标签页（仅 Capacitor） -->
      <n-tab-pane v-if="isCapacitor" name="cache" tab="缓存设置">
        <n-scrollbar class="tab-scrollbar">
          <n-space vertical size="large">
            <n-text depth="3">开启后播放过的歌曲会缓存到本地，再次播放时直接读取，不消耗流量</n-text>

            <div class="setting-row">
              <n-text>启用音频缓存</n-text>
              <n-switch 
                :value="settingStore.audioCacheEnabled" 
                @update:value="handleCacheToggle"
              />
            </div>

            <div class="setting-row">
              <n-text>缓存策略</n-text>
              <n-radio-group 
                :value="settingStore.audioCacheStrategy" 
                :disabled="!settingStore.audioCacheEnabled"
                @update:value="handleStrategyChange"
              >
                <n-space vertical size="small">
                  <n-radio value="all">
                    缓存所有播放的歌曲
                  </n-radio>
                  <n-radio value="complete">
                    只缓存播放完的歌曲
                  </n-radio>
                </n-space>
              </n-radio-group>
            </div>
            <n-text depth="3" style="font-size: 12px; margin-top: -8px;">
              {{ settingStore.audioCacheStrategy === 'all' 
                ? '播放歌曲时立即开始缓存，即使中途切歌也会在后台继续下载完整文件' 
                : '只有完整播放完的歌曲才会被缓存，中途切歌不会缓存' }}
            </n-text>

            <div class="setting-row">
              <n-text>缓存上限</n-text>
              <div class="slider-wrap">
                <n-slider 
                  :value="settingStore.audioCacheMaxSize" 
                  :min="100" 
                  :max="2000" 
                  :step="100"
                  :disabled="!settingStore.audioCacheEnabled"
                  :format-tooltip="(v: number) => v + ' MB'"
                  @update:value="handleMaxSizeChange"
                />
                <n-text depth="3" class="size-label">{{ settingStore.audioCacheMaxSize }} MB</n-text>
              </div>
            </div>

            <div class="setting-row">
              <n-text>已用空间</n-text>
              <n-text :depth="2">{{ cacheSize }} MB</n-text>
            </div>

            <n-button 
              type="warning" 
              block
              :disabled="cacheSize === '0'"
              @click="handleClearCache"
            >
              <template #icon>
                <component :is="renderIcon('Delete')" />
              </template>
              清除缓存
            </n-button>
          </n-space>
        </n-scrollbar>
      </n-tab-pane>

      <!-- 性能设置标签页 -->
      <n-tab-pane name="performance" tab="性能">
        <n-scrollbar class="tab-scrollbar">
          <n-space vertical size="large">
            <n-text depth="3">低性能设备建议关闭毛玻璃特效以获得流畅体验</n-text>

            <div class="setting-row">
              <n-text>毛玻璃特效</n-text>
              <n-switch 
                :value="settingStore.enableBlurEffect" 
                @update:value="handleBlurToggle"
              />
            </div>
            <n-text depth="3" style="font-size: 12px; margin-top: -8px;">
              {{ settingStore.enableBlurEffect 
                ? '已开启：界面使用高级毛玻璃模糊效果，对 GPU 要求较高' 
                : '已关闭：界面使用半透明纯色替代，流畅度更好' }}
            </n-text>
          </n-space>
        </n-scrollbar>
      </n-tab-pane>
    </n-tabs>
  </div>
</template>

<script setup lang="ts">
import { useSettingStore } from "@/stores";
import { renderIcon } from "@/utils/helper";
import { isCapacitor } from "@/utils/env";
import { registerPlugin } from "@capacitor/core";

const settingStore = useSettingStore();
const fileInput = ref<HTMLInputElement | null>(null);
const cacheSize = ref("0");

// === 主题模式 ===
const themeModes = [
  { value: "auto", label: "跟随系统" },
  { value: "light", label: "浅色模式" },
  { value: "dark", label: "深色模式" },
];

const setThemeMode = (mode: string) => {
  settingStore.setThemeMode(mode as "auto" | "light" | "dark");
};

// === 背景设置 ===
const triggerUpload = () => {
  fileInput.value?.click();
};

const handleFileChange = (e: Event) => {
  const input = e.target as HTMLInputElement;
  if (!input.files?.length) return;
  const file = input.files[0];
  
  const reader = new FileReader();
  reader.onload = (e) => {
    const result = e.target?.result as string;
    if (result) {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const maxSize = 1920;
        let width = img.width;
        let height = img.height;
        if (width > maxSize || height > maxSize) {
          if (width > height) {
            height = (height / width) * maxSize;
            width = maxSize;
          } else {
            width = (width / height) * maxSize;
            height = maxSize;
          }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx?.drawImage(img, 0, 0, width, height);
        const compressed = canvas.toDataURL("image/jpeg", 0.85);
        settingStore.globalBackgroundImage = compressed;
        window.$message.success("背景设置成功");
      };
      img.src = result;
    }
  };
  reader.readAsDataURL(file);
  input.value = "";
};

const resetBackground = () => {
  settingStore.globalBackgroundImage = null;
  window.$message.success("已移除背景");
};

// === 性能设置 ===
const handleBlurToggle = (enabled: boolean) => {
  settingStore.enableBlurEffect = enabled;
  window.$message.success(enabled ? "毛玻璃特效已开启" : "毛玻璃特效已关闭");
};

// === 缓存设置 ===
interface AudioCachePlugin {
  getCacheSize(): Promise<{ size: number }>;
  clearCache(): Promise<{ success: boolean }>;
  setCacheConfig(options: { enabled: boolean; maxSize: number; strategy: string }): Promise<{ success: boolean }>;
  getCacheStatus(): Promise<{ enabled: boolean; maxSize: number; currentSize: number; strategy: string }>;
}

let audioCachePlugin: AudioCachePlugin | null = null;

if (isCapacitor) {
  try {
    audioCachePlugin = registerPlugin<AudioCachePlugin>("AudioCache");
  } catch (e) {
    console.warn("AudioCache plugin not available", e);
  }
}

const syncCacheConfig = async () => {
  if (!audioCachePlugin) return;
  try {
    await audioCachePlugin.setCacheConfig({
      enabled: settingStore.audioCacheEnabled,
      maxSize: settingStore.audioCacheMaxSize,
      strategy: settingStore.audioCacheStrategy,
    });
  } catch (e) {
    console.warn("Failed to sync cache config", e);
  }
};

const refreshCacheSize = async () => {
  if (!audioCachePlugin) return;
  try {
    const result = await audioCachePlugin.getCacheSize();
    cacheSize.value = String(result.size);
  } catch (e) {
    console.warn("Failed to get cache size", e);
  }
};

const handleCacheToggle = async (enabled: boolean) => {
  settingStore.audioCacheEnabled = enabled;
  await syncCacheConfig();
};

const handleStrategyChange = async (value: "all" | "complete") => {
  settingStore.audioCacheStrategy = value;
  await syncCacheConfig();
};

const handleMaxSizeChange = async (value: number) => {
  settingStore.audioCacheMaxSize = value;
  await syncCacheConfig();
};

const handleClearCache = async () => {
  if (!audioCachePlugin) return;
  try {
    await audioCachePlugin.clearCache();
    cacheSize.value = "0";
    window.$message.success("缓存已清除");
  } catch (e) {
    window.$message.error("清除缓存失败");
  }
};

onMounted(async () => {
  if (audioCachePlugin) {
    await refreshCacheSize();
    await syncCacheConfig();
  }
});
</script>

<style lang="scss" scoped>
.other-settings-modal {
  :deep(.tab-scrollbar) {
    max-height: calc(55vh - env(safe-area-inset-top, 0px));
    .n-scrollbar-content {
      overflow: hidden;
      padding-right: 12px;
    }
  }
}

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
    max-width: 100%;
    max-height: 100%;
    display: block;
    object-fit: contain;
  }
}

.setting-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 4px 0;

  .slider-wrap {
    display: flex;
    align-items: center;
    gap: 12px;
    flex: 1;
    max-width: 250px;

    .n-slider {
      flex: 1;
    }

    .size-label {
      white-space: nowrap;
      min-width: 60px;
      text-align: right;
      font-size: 13px;
    }
  }
}
</style>
