<template>
  <n-modal
    v-model:show="showModal"
    preset="card"
    title="播放设置"
    :bordered="false"
    :segmented="{ content: true }"
    class="player-settings-modal"
    transform-origin="center"
  >
    <n-scrollbar style="max-height: 60vh">
      <n-flex vertical :size="12">
        <!-- 定时器 -->
        <div class="setting-item" @click="showSleepTimerModal = true">
          <div class="setting-icon">
            <SvgIcon name="TimeAuto" :size="24" />
          </div>
          <div class="setting-info">
            <div class="setting-title">定时器</div>
            <div class="setting-desc" v-if="statusStore.autoClose.enable">
              {{ formatRemainTime }}
            </div>
            <div class="setting-desc" v-else>未开启</div>
          </div>
          <SvgIcon name="Right" :size="20" />
        </div>

        <!-- 均衡器 -->
        <div class="setting-item" @click="showEqualizerModal = true">
          <div class="setting-icon">
            <SvgIcon name="Eq" :size="24" />
          </div>
          <div class="setting-info">
            <div class="setting-title">均衡器</div>
            <div class="setting-desc" v-if="statusStore.eqEnabled">
              {{ getPresetLabel(statusStore.eqPreset) }}
            </div>
            <div class="setting-desc" v-else>未开启</div>
          </div>
          <SvgIcon name="Right" :size="20" />
        </div>

        <!-- 播放速度 -->
        <div class="setting-item" @click="showPlayRateModal = true">
          <div class="setting-icon">
            <SvgIcon name="PlayRate" :size="24" />
          </div>
          <div class="setting-info">
            <div class="setting-title">播放速度</div>
            <div class="setting-desc">{{ statusStore.playRate }}x</div>
          </div>
          <SvgIcon name="Right" :size="20" />
        </div>

        <!-- 桌面歌词 -->
        <div v-if="desktopLyricAvailable" class="setting-item" @click="showDesktopLyricModal = true">
          <div class="setting-icon">
            <span class="lyric-word">词</span>
          </div>
          <div class="setting-info">
            <div class="setting-title">桌面歌词</div>
            <div class="setting-desc">
              {{ statusStore.showDesktopLyric ? "已开启" : "未开启" }}
              <span v-if="settingStore.desktopLyricConfig.isLock"> · 已锁定</span>
            </div>
          </div>
          <SvgIcon name="Right" :size="20" />
        </div>
      </n-flex>
    </n-scrollbar>
  </n-modal>

  <!-- 子弹窗 -->
  <SleepTimerModal v-model:show="showSleepTimerModal" />
  <EqualizerModal v-model:show="showEqualizerModal" />
  <PlayRateModal v-model:show="showPlayRateModal" />
  <DesktopLyricSettingsModal v-model:show="showDesktopLyricModal" />
</template>

<script setup lang="ts">
import { useSettingStore, useStatusStore } from "@/stores";
import { isCapacitor, isElectron } from "@/utils/env";
import SleepTimerModal from "./SettingsModals/SleepTimerModal.vue";
import EqualizerModal from "./SettingsModals/EqualizerModal.vue";
import PlayRateModal from "./SettingsModals/PlayRateModal.vue";
import DesktopLyricSettingsModal from "./SettingsModals/DesktopLyricSettingsModal.vue";

interface Props {
  show: boolean;
}

interface Emits {
  (e: "update:show", value: boolean): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();
const statusStore = useStatusStore();
const settingStore = useSettingStore();
const desktopLyricAvailable = isElectron || isCapacitor;

const showModal = computed({
  get: () => props.show,
  set: (val) => emit("update:show", val),
});

const showSleepTimerModal = ref(false);
const showEqualizerModal = ref(false);
const showPlayRateModal = ref(false);
const showDesktopLyricModal = ref(false);

// 均衡器预设
const presetList = {
  acoustic: "原声",
  pop: "流行",
  dance: "舞曲",
  rock: "摇滚",
  classical: "古典",
  jazz: "爵士",
  vocal: "人声",
  bass: "重低音",
  custom: "自定义",
};

const getPresetLabel = (key: string) => {
  return presetList[key as keyof typeof presetList] || "自定义";
};

// 格式化剩余时间
const formatRemainTime = computed(() => {
  const remainSeconds = statusStore.autoClose.remainTime;
  if (remainSeconds <= 0) return "未开启";
  
  const minutes = Math.floor(remainSeconds / 60);
  const seconds = remainSeconds % 60;
  
  if (minutes > 0) {
    return `${minutes}分钟${seconds > 0 ? seconds + "秒" : ""}`;
  }
  return `${seconds}秒`;
});
</script>

<style scoped lang="scss">
.player-settings-modal {
  :deep(.n-card) {
    width: min(90vw, 400px);
    max-width: calc(100vw - 32px);
    backdrop-filter: blur(20px);
    background-color: rgba(var(--n-color-rgb), 0.85);
  }

  :deep(.n-card__content) {
    padding: 16px;
  }

  .setting-item {
    display: flex;
    align-items: center;
    padding: 16px 20px;
    background-color: var(--n-color);
    border-radius: 12px;
    cursor: pointer;
    transition: all 0.2s;

    &:active {
      opacity: 0.7;
      transform: scale(0.98);
    }

    .setting-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 40px;
      height: 40px;
      border-radius: 8px;
      background-color: rgba(var(--primary-color), 0.1);
      margin-right: 16px;
      flex-shrink: 0;

      .n-icon {
        color: var(--primary-color);
      }

      .lyric-word {
        color: var(--primary-color);
        font-size: 17px;
        font-weight: 700;
      }
    }

    .setting-info {
      flex: 1;
      min-width: 0;

      .setting-title {
        font-size: 16px;
        font-weight: 500;
        margin-bottom: 4px;
      }

      .setting-desc {
        font-size: 13px;
        opacity: 0.6;
      }
    }

    .n-icon {
      opacity: 0.4;
      flex-shrink: 0;
    }
  }
}
</style>
