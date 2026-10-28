<template>
  <div class="setting-type app-setting">
    <div class="set-list">
      <!-- 音频缓存（仅 Capacitor） -->
      <template v-if="isCapacitor">
        <n-h3 prefix="bar"> 音频缓存 </n-h3>
        <n-card class="set-item">
          <div class="label">
            <n-text class="name">启用音频缓存</n-text>
            <n-text class="tip" :depth="3">
              播放过的歌曲会缓存到本地，再次播放直接读取，不消耗流量
            </n-text>
          </div>
          <n-switch
            :value="settingStore.audioCacheEnabled"
            class="set"
            :round="false"
            @update:value="handleCacheToggle"
          />
        </n-card>
        <n-card class="set-item">
          <div class="label">
            <n-text class="name">缓存策略</n-text>
            <n-text class="tip" :depth="3">
              {{ settingStore.audioCacheStrategy === 'all'
                ? '播放时立即缓存，切歌后后台继续下载完整文件'
                : '仅完整播放完的歌曲才会缓存' }}
            </n-text>
          </div>
          <n-radio-group
            :value="settingStore.audioCacheStrategy"
            :disabled="!settingStore.audioCacheEnabled"
            size="small"
            @update:value="handleStrategyChange"
          >
            <n-radio-button value="all">全部</n-radio-button>
            <n-radio-button value="complete">仅完整播放</n-radio-button>
          </n-radio-group>
        </n-card>
        <n-card class="set-item">
          <div class="label">
            <n-text class="name">缓存上限</n-text>
            <n-text class="tip" :depth="3"> 当前 {{ settingStore.audioCacheMaxSize }} MB </n-text>
          </div>
          <n-slider
            :value="settingStore.audioCacheMaxSize"
            :min="100"
            :max="5000"
            :step="100"
            :disabled="!settingStore.audioCacheEnabled"
            :format-tooltip="(v: number) => v + ' MB'"
            class="cache-slider"
            @update:value="handleMaxSizeChange"
          />
        </n-card>
        <n-card class="set-item">
          <div class="label">
            <n-text class="name">缓存占用</n-text>
            <n-text class="tip" :depth="3"> 已用 {{ cacheSize }} MB · {{ cacheCount }} 首 </n-text>
          </div>
          <n-button
            size="small"
            type="warning"
            :disabled="cacheSize === '0'"
            @click="handleClearCache"
          >
            清除缓存
          </n-button>
        </n-card>
      </template>

      <!-- 更多设置（入口弹窗） -->
      <n-h3 prefix="bar"> 更多设置 </n-h3>
      <n-card class="set-item" @click="openSidebarHideManager()">
        <div class="label">
          <n-text class="name">侧边栏隐藏管理</n-text>
          <n-text class="tip" :depth="3"> 配置侧边栏各栏目是否显示 </n-text>
        </div>
        <n-text class="arrow" depth="3">›</n-text>
      </n-card>
      <n-card class="set-item" @click="openHomePageSectionManager()">
        <div class="label">
          <n-text class="name">首页栏目配置</n-text>
          <n-text class="tip" :depth="3"> 配置首页栏目排序与显隐 </n-text>
        </div>
        <n-text class="arrow" depth="3">›</n-text>
      </n-card>
      <n-card class="set-item" @click="handleCheckUpdate">
        <div class="label">
          <n-text class="name">检查更新</n-text>
          <n-text class="tip" :depth="3"> 当前版本 v{{ versionStore.currentVersion }} </n-text>
        </div>
        <n-spin v-if="isCheckingUpdate || versionStore.isChecking" size="small" />
        <n-text v-else class="arrow" depth="3">›</n-text>
      </n-card>
      <!-- 自定义代码注入（Electron 专属，Capacitor 端不显示）
      <n-card class="set-item" @click="openCustomCode()">
        <div class="label">
          <n-text class="name">自定义代码注入</n-text>
          <n-text class="tip" :depth="3"> 注入自定义 CSS / JS 代码 </n-text>
        </div>
        <n-text class="arrow" depth="3">›</n-text>
      </n-card>
      -->
    </div>
  </div>
</template>

<script setup lang="ts">
import { useSettingStore, useVersionStore } from "@/stores";
import { isCapacitor } from "@/utils/env";
import { registerPlugin } from "@capacitor/core";
import {
  // openCustomCode, // 自定义代码注入（Electron 专属，Capacitor 端已隐藏）
  openHomePageSectionManager,
  openSidebarHideManager,
} from "@/utils/modal";

const settingStore = useSettingStore();
const versionStore = useVersionStore();
const cacheSize = ref("0");
const cacheCount = ref(0);
const isCheckingUpdate = ref(false);

/**
 * 手动检查应用版本更新
 */
const handleCheckUpdate = async () => {
  if (isCheckingUpdate.value || versionStore.isChecking) return;
  isCheckingUpdate.value = true;
  try {
    const { performVersionCheck } = await import("@/utils/updateChecker");
    const hasUpdate = await performVersionCheck();
    if (!hasUpdate) {
      window.$message.info("已是最新版本");
    }
  } catch (error) {
    window.$message.error("检查更新失败，请稍后重试");
  } finally {
    isCheckingUpdate.value = false;
  }
};

// === 缓存设置 ===
interface AudioCachePlugin {
  getCacheSize(): Promise<{ size: number; count: number }>;
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
    cacheCount.value = result.count || 0;
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
    cacheCount.value = 0;
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
.app-setting {
  .cache-slider {
    flex: 1;
    min-width: 120px;
    width: auto;
  }

  .arrow {
    font-size: 20px;
    opacity: 0.5;
  }
}
</style>
