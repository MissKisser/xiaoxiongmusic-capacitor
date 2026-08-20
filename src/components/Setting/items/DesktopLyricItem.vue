<template>
  <n-flex vertical :size="12" class="desktop-lyric-settings">
    <div class="setting-row">
      <div class="label">
        <div class="title">开启桌面歌词</div>
        <div class="desc">在其他应用上层显示当前歌词</div>
      </div>
      <n-switch
        :value="statusStore.showDesktopLyric"
        :round="false"
        @update:value="player.setDesktopLyricShow"
      />
    </div>

    <div class="setting-row">
      <div class="label">
        <div class="title">锁定歌词</div>
        <div class="desc">锁定后不可拖动，点击歌词会显示解锁按钮</div>
      </div>
      <n-switch
        v-model:value="desktopLyricConfig.isLock"
        :round="false"
        @update:value="saveDesktopLyricConfig"
      />
    </div>

    <div class="setting-row">
      <div class="label">
        <div class="title">双行歌词</div>
        <div class="desc">显示翻译或下一句歌词</div>
      </div>
      <n-switch
        v-model:value="desktopLyricConfig.isDoubleLine"
        :round="false"
        @update:value="saveDesktopLyricConfig"
      />
    </div>

    <div class="setting-row">
      <div class="label">
        <div class="title">显示翻译</div>
        <div class="desc">当前歌词有翻译时优先显示翻译</div>
      </div>
      <n-switch
        v-model:value="desktopLyricConfig.showTran"
        :round="false"
        @update:value="saveDesktopLyricConfig"
      />
    </div>

    <div class="setting-row">
      <div class="label">
        <div class="title">限制边界</div>
        <div class="desc">拖动时保持在屏幕范围内</div>
      </div>
      <n-switch
        v-model:value="desktopLyricConfig.limitBounds"
        :round="false"
        @update:value="saveDesktopLyricConfig"
      />
    </div>

    <div class="setting-row">
      <div class="label">
        <div class="title">歌曲信息</div>
        <div class="desc">在歌词上方显示歌曲名和歌手</div>
      </div>
      <n-switch
        v-model:value="desktopLyricConfig.alwaysShowPlayInfo"
        :round="false"
        @update:value="saveDesktopLyricConfig"
      />
    </div>

    <div class="setting-row">
      <div class="label">
        <div class="title">对齐方式</div>
        <div class="desc">设置单行和双行歌词排版</div>
      </div>
      <n-select
        v-model:value="desktopLyricConfig.position"
        :options="positionOptions"
        class="control"
        @update:value="saveDesktopLyricConfig"
      />
    </div>

    <div class="setting-row">
      <div class="label">
        <div class="title">文字大小</div>
        <div class="desc">浮窗底部 A-/A+ 也会同步修改</div>
      </div>
      <n-input-number
        v-model:value="desktopLyricConfig.fontSize"
        :min="16"
        :max="72"
        :step="2"
        class="control"
        @update:value="saveDesktopLyricConfig"
      >
        <template #suffix>px</template>
      </n-input-number>
    </div>

    <div class="setting-row">
      <div class="label">
        <div class="title">文字字重</div>
        <div class="desc">影响主歌词和副歌词</div>
      </div>
      <n-input-number
        v-model:value="desktopLyricConfig.fontWeight"
        :min="100"
        :max="900"
        :step="100"
        class="control"
        @update:value="saveDesktopLyricConfig"
      />
    </div>

    <div class="setting-row vertical">
      <div class="label">
        <div class="title">预设颜色</div>
        <div class="desc">快速切换为常见桌面歌词配色</div>
      </div>
      <div class="preset-list">
        <button
          v-for="preset in colorPresets"
          :key="preset.name"
          class="preset"
          :style="{ '--preset-color': preset.playedColor }"
          @click="applyColorPreset(preset)"
        >
          <span class="dot" />
          {{ preset.name }}
        </button>
      </div>
    </div>

    <div class="setting-row">
      <div class="label">
        <div class="title">主歌词颜色</div>
        <div class="desc">当前行文字颜色</div>
      </div>
      <n-color-picker
        v-model:value="desktopLyricConfig.playedColor"
        :show-alpha="false"
        :modes="['hex']"
        class="control"
        @complete="saveDesktopLyricConfig"
      />
    </div>

    <div class="setting-row">
      <div class="label">
        <div class="title">副歌词颜色</div>
        <div class="desc">翻译或下一句文字颜色</div>
      </div>
      <n-color-picker
        v-model:value="desktopLyricConfig.unplayedColor"
        :show-alpha="false"
        :modes="['hex']"
        class="control"
        @complete="saveDesktopLyricConfig"
      />
    </div>

    <div class="setting-row">
      <div class="label">
        <div class="title">描边颜色</div>
        <div class="desc">提高浅色背景下的可读性</div>
      </div>
      <n-color-picker
        v-model:value="desktopLyricConfig.shadowColor"
        :modes="['rgb']"
        class="control"
        @complete="saveDesktopLyricConfig"
      />
    </div>

    <n-button type="primary" strong block @click="restoreDesktopLyricConfig">
      恢复默认
    </n-button>
  </n-flex>
</template>

<script setup lang="ts">
import defaultDesktopLyricConfig from "@/assets/data/lyricConfig";
import { usePlayerController } from "@/core/player/PlayerController";
import { DesktopLyric } from "@/plugins/DesktopLyricPlugin";
import { useSettingStore, useStatusStore } from "@/stores";
import type { LyricConfig } from "@/types/desktop-lyric";
import { isCapacitor, isElectron } from "@/utils/env";
import { cloneDeep, isEqual } from "lodash-es";

type ColorPreset = Pick<LyricConfig, "playedColor" | "unplayedColor" | "shadowColor"> & {
  name: string;
};

const player = usePlayerController();
const statusStore = useStatusStore();
const settingStore = useSettingStore();
const desktopLyricConfig = reactive<LyricConfig>({ ...defaultDesktopLyricConfig });

const nativeWindow = window as Window & {
  electron?: any;
};

const positionOptions = [
  { label: "左对齐", value: "left" },
  { label: "居中对齐", value: "center" },
  { label: "右对齐", value: "right" },
  { label: "左右分离", value: "both" },
];

const colorPresets: ColorPreset[] = [
  {
    name: "红",
    playedColor: "#fe7971",
    unplayedColor: "#f2f2f2",
    shadowColor: "rgba(0, 0, 0, 0.65)",
  },
  {
    name: "蓝",
    playedColor: "#4fc3ff",
    unplayedColor: "#f2f2f2",
    shadowColor: "rgba(0, 0, 0, 0.65)",
  },
  {
    name: "金",
    playedColor: "#ffd166",
    unplayedColor: "#f2f2f2",
    shadowColor: "rgba(0, 0, 0, 0.65)",
  },
  {
    name: "白",
    playedColor: "#ffffff",
    unplayedColor: "#dddddd",
    shadowColor: "rgba(0, 0, 0, 0.75)",
  },
];

const getDesktopLyricConfig = async () => {
  if (isElectron && nativeWindow.electron) {
    const config = (await nativeWindow.electron.ipcRenderer.invoke(
      "get-desktop-lyric-config",
    )) as LyricConfig;
    if (config) Object.assign(desktopLyricConfig, config);
    return;
  }
  Object.assign(desktopLyricConfig, settingStore.desktopLyricConfig);
};

const saveDesktopLyricConfig = () => {
  if (isElectron && nativeWindow.electron) {
    nativeWindow.electron.ipcRenderer.send(
      "update-desktop-lyric-config",
      cloneDeep(desktopLyricConfig),
    );
    return;
  }
  if (!isCapacitor) return;
  settingStore.desktopLyricConfig = cloneDeep(desktopLyricConfig);
  void DesktopLyric.updateConfig(cloneDeep(desktopLyricConfig));
  void DesktopLyric.setLocked({ locked: desktopLyricConfig.isLock });
};

const applyColorPreset = (preset: ColorPreset) => {
  Object.assign(desktopLyricConfig, {
    playedColor: preset.playedColor,
    unplayedColor: preset.unplayedColor,
    shadowColor: preset.shadowColor,
  });
  saveDesktopLyricConfig();
};

const restoreDesktopLyricConfig = () => {
  Object.assign(desktopLyricConfig, defaultDesktopLyricConfig);
  saveDesktopLyricConfig();
};

// 挂载时加载配置（设置页内嵌场景）
onMounted(() => {
  void getDesktopLyricConfig();
});

watch(
  () => settingStore.desktopLyricConfig,
  (config) => {
    if (isCapacitor && config && !isEqual(config, desktopLyricConfig)) {
      Object.assign(desktopLyricConfig, config);
    }
  },
  { deep: true },
);
</script>

<style scoped lang="scss">
.setting-row {
  display: flex;
  align-items: center;
  gap: 16px;
  min-height: 58px;
  padding: 12px 14px;
  border-radius: 10px;
  background-color: color-mix(in srgb, var(--surface-container-hex), rgb(0 0 0 / 5%));

  &.vertical {
    align-items: stretch;
    flex-direction: column;
    gap: 10px;
  }

  .label {
    flex: 1;
    min-width: 0;
    .title {
      font-size: 15px;
      font-weight: 600;
      line-height: 1.4;
    }
    .desc {
      margin-top: 2px;
      font-size: 12px;
      opacity: 0.58;
      line-height: 1.35;
    }
  }

  .control {
    width: min(42vw, 168px);
    flex-shrink: 0;
  }
}

.preset-list {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}

.preset {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 34px;
  border: none;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  color: inherit;
  cursor: pointer;
  background-color: color-mix(in srgb, var(--surface-container-hex), rgb(0 0 0 / 10%));
  transition: background-color 0.2s;

  &:active {
    background-color: color-mix(in srgb, var(--surface-container-hex), rgb(0 0 0 / 18%));
  }

  .dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background-color: var(--preset-color);
    box-shadow: inset 0 0 0 1px rgb(0 0 0 / 10%);
  }
}
</style>

<style lang="scss">
.desktop-lyric-settings {
  // 按钮统一纯色背景（与设置页歌词设置一致，跟随主题），
  // 排除 primary/error 等彩色类型与 secondary/tertiary 半透明模式
  .n-button:not(.n-button--primary-type):not(.n-button--error-type):not(.n-button--warning-type):not(.n-button--info-type):not(.n-button--success-type):not(.n-button--secondary):not(.n-button--tertiary) {
    --n-color: color-mix(in srgb, var(--surface-container-hex), rgb(0 0 0 / 10%));
    --n-color-hover: color-mix(in srgb, var(--surface-container-hex), rgb(0 0 0 / 16%));
    --n-color-pressed: color-mix(in srgb, var(--surface-container-hex), rgb(0 0 0 / 22%));
    --n-color-focus: color-mix(in srgb, var(--surface-container-hex), rgb(0 0 0 / 16%));
  }
}
</style>
