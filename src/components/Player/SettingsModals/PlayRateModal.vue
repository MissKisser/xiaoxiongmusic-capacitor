<template>
  <n-modal
    v-model:show="showModal"
    preset="card"
    title="播放速度"
    :bordered="false"
    :segmented="{ content: true }"
    class="play-rate-modal"
    transform-origin="center"
  >
    <n-scrollbar style="max-height: 65vh">
      <n-flex vertical :size="20">
        <!-- 预设速度按钮 -->
        <div class="preset-rates">
          <n-button
            v-for="rate in presetRates"
            :key="rate"
            :type="Math.abs(playRate - rate) < 0.01 ? 'primary' : 'default'"
            round
            @click="setPlayRate(rate)"
          >
            {{ rate }}x
          </n-button>
        </div>

        <!-- 当前播放速度 -->
        <div class="current-rate">
          <div class="rate-label">当前播放速度：</div>
          <div class="rate-value">{{ playRate.toFixed(2) }}x</div>
        </div>

        <!-- 滑块 -->
        <div class="rate-slider-wrapper">
          <div class="slider-labels">
            <span>0.2x</span>
            <span>1x</span>
            <span>2x</span>
          </div>
          <n-slider
            v-model:value="playRate"
            :min="0.2"
            :max="2"
            :step="0.05"
            :marks="sliderMarks"
            :tooltip="false"
            @update:value="onRateChange"
          />
        </div>

        <!-- 重置按钮 -->
        <n-button
          v-if="Math.abs(playRate - 1) > 0.01"
          type="tertiary"
          block
          @click="resetPlayRate"
        >
          重置为正常速度
        </n-button>
      </n-flex>
    </n-scrollbar>
  </n-modal>
</template>

<script setup lang="ts">
import { useStatusStore } from "@/stores";
import { usePlayerController } from "@/core/player/PlayerController";

interface Props {
  show: boolean;
}

interface Emits {
  (e: "update:show", value: boolean): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();
const statusStore = useStatusStore();
const player = usePlayerController();

const showModal = computed({
  get: () => props.show,
  set: (val) => emit("update:show", val),
});

const presetRates = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const playRate = ref(statusStore.playRate);

// 滑块标记
const sliderMarks = {
  0.2: "",
  0.5: "",
  1: "",
  1.5: "",
  2: "",
};

// 设置播放速度
const setPlayRate = (rate: number) => {
  playRate.value = rate;
  applyPlayRate(rate);
};

// 速度变化
const onRateChange = (value: number) => {
  applyPlayRate(value);
};

// 应用播放速度
const applyPlayRate = (rate: number) => {
  statusStore.playRate = rate;
  player.setRate(rate);
};

// 重置播放速度
const resetPlayRate = () => {
  playRate.value = 1;
  applyPlayRate(1);
};

// 监听外部速度变化
watch(
  () => statusStore.playRate,
  (newRate) => {
    if (Math.abs(playRate.value - newRate) > 0.01) {
      playRate.value = newRate;
    }
  }
);
</script>

<style scoped lang="scss">
.play-rate-modal {
  :deep(.n-card) {
    width: min(90vw, 420px);
    max-width: calc(100vw - 32px);
    backdrop-filter: blur(20px);
    background-color: rgba(var(--n-color-rgb), 0.85);
  }

  :deep(.n-card__content) {
    padding: 20px;
  }

  .preset-rates {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 12px;

    .n-button {
      font-size: 15px;
    }
  }

  .current-rate {
    padding: 20px;
    background: linear-gradient(135deg, var(--primary-color-hover) 0%, var(--primary-color) 100%);
    border-radius: 12px;
    text-align: center;
    color: white;

    .rate-label {
      font-size: 14px;
      opacity: 0.9;
      margin-bottom: 8px;
    }

    .rate-value {
      font-size: 36px;
      font-weight: bold;
      font-variant-numeric: tabular-nums;
    }
  }

  .rate-slider-wrapper {
    padding: 20px;
    background-color: var(--n-color);
    border-radius: 12px;

    .slider-labels {
      display: flex;
      justify-content: space-between;
      margin-bottom: 12px;
      padding: 0 4px;
      font-size: 13px;
      opacity: 0.6;

      span {
        font-variant-numeric: tabular-nums;
      }
    }

    :deep(.n-slider) {
      .n-slider-marks {
        .n-slider-mark {
          width: 2px;
          height: 8px;
          background-color: currentColor;
          opacity: 0.3;
          transform: translateX(-50%);
        }
      }

      .n-slider-handle {
        width: 20px;
        height: 20px;
      }
    }
  }
}
</style>
