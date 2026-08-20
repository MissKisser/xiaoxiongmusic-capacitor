<template>
  <n-flex vertical :size="20">
    <!-- 说明 -->
    <div class="ab-desc">
      设置 A、B 两个时间点，播放到 B 时自动跳回 A 循环。
      <br />
      建议先在进度条拖动到目标位置，再点「设为 A / 设为 B」。
    </div>

    <!-- A / B 点设置 -->
    <div class="points-row">
      <div class="point-card">
        <div class="point-label">A 点</div>
        <div class="point-value">{{ formatTime(abLoop.pointA) }}</div>
        <n-button size="small" type="primary" block @click="setA">
          设为当前时间 A
        </n-button>
        <n-button size="tiny" block :disabled="abLoop.pointA === null" @click="clearA">
          清除 A
        </n-button>
      </div>
      <div class="point-card">
        <div class="point-label">B 点</div>
        <div class="point-value">{{ formatTime(abLoop.pointB) }}</div>
        <n-button size="small" type="primary" block @click="setB">
          设为当前时间 B
        </n-button>
        <n-button size="tiny" block :disabled="abLoop.pointB === null" @click="clearB">
          清除 B
        </n-button>
      </div>
    </div>

    <!-- 启用开关 -->
    <div class="enable-row">
      <div class="enable-info">
        <div class="enable-title">启用 AB 循环</div>
        <div class="enable-desc">
          <template v-if="abLoop.pointA !== null && abLoop.pointB !== null && abLoop.pointB > abLoop.pointA">
            循环区间 {{ formatTime(abLoop.pointA) }} → {{ formatTime(abLoop.pointB) }}
          </template>
          <template v-else>请先设置有效的 A、B 点（B 需大于 A）</template>
        </div>
      </div>
      <n-switch :value="abLoop.enable" :disabled="!canEnable" @update:value="setEnabled" />
    </div>

    <!-- 清空 -->
    <n-button type="error" block :disabled="!hasAnyPoint" @click="clearAll">
      清空 AB 循环
    </n-button>
  </n-flex>
</template>

<script setup lang="ts">
import { useStatusStore } from "@/stores";
import {
  clearABPointA,
  clearABPointB,
  resetABLoop,
  setABEnabled,
  setABPointA,
  setABPointB,
} from "@/core/player/AbLoopManager";

const statusStore = useStatusStore();

const abLoop = computed(() => statusStore.abLoop);

const hasAnyPoint = computed(() => abLoop.value.pointA !== null || abLoop.value.pointB !== null);
const canEnable = computed(
  () =>
    abLoop.value.pointA !== null &&
    abLoop.value.pointB !== null &&
    abLoop.value.pointB > abLoop.value.pointA,
);

// 当前播放进度（毫秒）
const currentPosition = () => statusStore.currentTime;

const setA = () => setABPointA(currentPosition());
const setB = () => setABPointB(currentPosition());
const clearA = () => clearABPointA();
const clearB = () => clearABPointB();
const setEnabled = (on: boolean) => setABEnabled(on);
const clearAll = () => resetABLoop();

// 格式化时间 mm:ss
const formatTime = (ms: number | null): string => {
  if (ms === null) return "--:--";
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
};
</script>

<style scoped lang="scss">
.ab-desc {
  font-size: 13px;
  opacity: 0.7;
  line-height: 1.6;
}

.points-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;

  .point-card {
    padding: 16px;
    background-color: color-mix(in srgb, var(--surface-container-hex), rgb(0 0 0 / 5%));
    border-radius: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;

    .point-label {
      font-size: 14px;
      font-weight: 600;
    }

    .point-value {
      font-size: 28px;
      font-weight: bold;
      font-variant-numeric: tabular-nums;
    }
  }
}

.enable-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  background-color: color-mix(in srgb, var(--surface-container-hex), rgb(0 0 0 / 5%));
  border-radius: 12px;

  .enable-title {
    font-size: 15px;
    font-weight: 600;
  }

  .enable-desc {
    font-size: 12px;
    opacity: 0.6;
    margin-top: 4px;
  }
}
</style>
