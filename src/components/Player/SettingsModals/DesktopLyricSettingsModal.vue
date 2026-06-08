<template>
  <n-modal
    v-model:show="showModal"
    preset="card"
    title="桌面歌词"
    :bordered="false"
    :segmented="{ content: true }"
    class="desktop-lyric-settings-modal"
    transform-origin="center"
  >
    <n-scrollbar style="max-height: 66vh">
      <n-flex vertical :size="12">
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
            <div class="title">锁定穿透</div>
            <div class="desc">锁定后不可拖动，点击会穿透到底层应用</div>
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

        <n-button type="primary" secondary strong block @click="restoreDesktopLyricConfig">
          恢复默认
        </n-button>
      </n-flex>
    </n-scrollbar>
  </n-modal>
</template>

<script setup lang="ts">
import defaultDesktopLyricConfig from "@/assets/data/lyricConfig";
import { usePlayerController } from "@/core/player/PlayerController";
import { DesktopLyric } from "@/plugins/DesktopLyricPlugin";
import { useSettingStore, useStatusStore } from "@/stores";
import type { LyricConfig } from "@/types/desktop-lyric";
import { isCapacitor, isElectron } from "@/utils/env";
import { cloneDeep, isEqual } from "lodash-es";

interface Props {
  show: boolean;
}

interface Emits {
  (e: "update:show", value: boolean): void;
}

type ColorPreset = Pick<LyricConfig, "playedColor" | "unplayedColor" | "shadowColor"> & {
  name: string;
};

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

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

const showModal = computed({
  get: () => props.show,
  set: (val) => emit("update:show", val),
});

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

watch(
  () => props.show,
  (show) => {
    if (show) void getDesktopLyricConfig();
  },
  { immediate: true },
);

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
.desktop-lyric-settings-modal {
  :deep(.n-card) {
    width: min(92vw, 460px);
    max-width: calc(100vw - 24px);
    backdrop-filter: blur(20px);
    background-color: rgba(var(--n-color-rgb), 0.88);
  }

  :deep(.n-card__content) {
    padding: 16px;
  }

  .setting-row {
    display: flex;
    align-items: center;
    gap: 16px;
    min-height: 58px;
    padding: 12px 14px;
    border-radius: 10px;
    background-color: rgba(var(--primary), 0.06);

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
    height: 34px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 8px;
    color: var(--color);
    background:
      linear-gradient(90deg, var(--preset-color), rgba(255, 255, 255, 0.18)),
      rgba(var(--primary), 0.08);
    font-size: 13px;
    font-weight: 600;
  }
}
</style>
