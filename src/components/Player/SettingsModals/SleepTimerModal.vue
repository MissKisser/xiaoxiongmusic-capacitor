<template>
  <n-modal
    v-model:show="showModal"
    preset="card"
    title="定时器"
    :bordered="false"
    :segmented="{ content: true }"
    class="sleep-timer-modal"
    transform-origin="center"
  >
    <n-scrollbar style="max-height: 65vh">
      <n-flex vertical :size="20">
        <!-- 开关 -->
        <div class="timer-switch">
          <div class="switch-label">
            <SvgIcon name="TimeAuto" :size="20" />
            <span>{{ enabled ? '已开启' : '未开启' }}</span>
          </div>
          <n-switch v-model:value="enabled" @update:value="onToggleTimer" />
        </div>

        <!-- 预设时间按钮 -->
        <div class="preset-times">
          <n-button
            v-for="time in presetTimes"
            :key="time"
            :type="selectedTime === time && enabled ? 'primary' : 'default'"
            :disabled="!enabled"
            round
            @click="selectTime(time)"
          >
            {{ time }}min
          </n-button>
        </div>

        <!-- 自定义时间 -->
        <div class="custom-time">
          <n-button
            :type="isCustomTime && enabled ? 'primary' : 'default'"
            :disabled="!enabled"
            round
            @click="showCustomInput = !showCustomInput"
          >
            自定义时长
          </n-button>
          
          <n-input-number
            v-if="showCustomInput && enabled"
            v-model:value="customTime"
            :min="1"
            :max="999"
            :show-button="false"
            placeholder="输入分钟数"
            class="custom-input"
            @update:value="onCustomTimeChange"
          >
            <template #suffix>分钟</template>
          </n-input-number>
        </div>

        <!-- 等待歌曲播放完成 -->
        <div class="wait-song-end">
          <n-checkbox
            v-model:checked="waitSongEnd"
            :disabled="!enabled"
            @update:checked="onWaitSongEndChange"
          >
            等待整首歌曲播放完成再停止播放
          </n-checkbox>
        </div>

        <!-- 倒计时显示 -->
        <div v-if="enabled && statusStore.autoClose.remainTime > 0" class="countdown">
          <div class="countdown-title">剩余时间</div>
          <div class="countdown-time">{{ formatRemainTime }}</div>
        </div>
      </n-flex>
    </n-scrollbar>
  </n-modal>
</template>

<script setup lang="ts">
import { useStatusStore, useMusicStore } from "@/stores";
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
const musicStore = useMusicStore();
const player = usePlayerController();

const showModal = computed({
  get: () => props.show,
  set: (val) => emit("update:show", val),
});

const presetTimes = [10, 20, 30, 45, 60, 90, 120];
const enabled = ref(statusStore.autoClose.enable);
const selectedTime = ref(statusStore.autoClose.time);
const customTime = ref<number | null>(null);
const showCustomInput = ref(false);
const waitSongEnd = ref(statusStore.autoClose.waitSongEnd);

const isCustomTime = computed(() => {
  return !presetTimes.includes(selectedTime.value);
});

// 选择预设时间
const selectTime = (time: number) => {
  if (!enabled.value) return;
  selectedTime.value = time;
  showCustomInput.value = false;
  customTime.value = null;
  startTimer(time);
};

// 自定义时间变化
const onCustomTimeChange = (value: number | null) => {
  if (!enabled.value || !value) return;
  selectedTime.value = value;
  startTimer(value);
};

// 切换定时器开关
const onToggleTimer = (value: boolean) => {
  if (value) {
    // 开启定时器，使用当前选择的时间
    const time = customTime.value || selectedTime.value;
    startTimer(time);
  } else {
    // 关闭定时器
    stopTimer();
  }
};

// 等待歌曲结束选项变化
const onWaitSongEndChange = (value: boolean) => {
  statusStore.autoClose.waitSongEnd = value;
};

// 启动定时器
const startTimer = (minutes: number) => {
  const seconds = minutes * 60;
  const endTime = Date.now() + seconds * 1000;
  
  statusStore.autoClose = {
    enable: true,
    time: minutes,
    remainTime: seconds,
    endTime: endTime,
    waitSongEnd: waitSongEnd.value,
  };
  
  enabled.value = true;
  
  // 启动倒计时
  startCountdown();
};

// 停止定时器
const stopTimer = () => {
  statusStore.autoClose = {
    enable: false,
    time: statusStore.autoClose.time,
    remainTime: 0,
    endTime: 0,
    waitSongEnd: waitSongEnd.value,
  };
  
  enabled.value = false;
  
  if (countdownTimer.value) {
    clearInterval(countdownTimer.value);
    countdownTimer.value = null;
  }
};

// 倒计时定时器
const countdownTimer = ref<number | null>(null);

const startCountdown = () => {
  // 清除旧的定时器
  if (countdownTimer.value) {
    clearInterval(countdownTimer.value);
  }
  
  // 每秒更新一次
  countdownTimer.value = window.setInterval(() => {
    if (!statusStore.autoClose.enable) {
      clearInterval(countdownTimer.value!);
      countdownTimer.value = null;
      return;
    }
    
    const now = Date.now();
    const remainMs = statusStore.autoClose.endTime - now;
    const remainSeconds = Math.max(0, Math.floor(remainMs / 1000));
    
    statusStore.autoClose.remainTime = remainSeconds;
    
    if (remainSeconds <= 0) {
      // 时间到，检查是否需要等待歌曲结束
      if (statusStore.autoClose.waitSongEnd && statusStore.playStatus) {
        // 等待歌曲结束
        const unwatch = watch(
          () => statusStore.playStatus,
          (playing) => {
            if (!playing) {
              // 歌曲停止播放，关闭应用
              closeApp();
              unwatch();
            }
          }
        );
      } else {
        // 立即关闭
        closeApp();
      }
      
      clearInterval(countdownTimer.value!);
      countdownTimer.value = null;
    }
  }, 1000);
};

// 关闭应用
const closeApp = () => {
  // 停止播放
  player.playOrPause(false);
  
  // 重置定时器状态
  stopTimer();
  
  // 尝试关闭应用（移动端）
  if (window.navigator && 'app' in window.navigator) {
    // Capacitor 环境
    try {
      (window.navigator as any).app.exitApp();
    } catch (err) {
      console.warn("无法关闭应用:", err);
    }
  }
  
  // Web环境下只能停止播放
  window.$message?.success("定时结束，已停止播放");
};

// 格式化剩余时间
const formatRemainTime = computed(() => {
  const remainSeconds = statusStore.autoClose.remainTime;
  if (remainSeconds <= 0) return "00:00";
  
  const minutes = Math.floor(remainSeconds / 60);
  const seconds = remainSeconds % 60;
  
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
});

// 监听store中的定时器状态变化
watch(
  () => statusStore.autoClose.enable,
  (newVal) => {
    enabled.value = newVal;
  }
);

// 组件挂载时，如果定时器已启动，继续倒计时
onMounted(() => {
  // 同步状态
  enabled.value = statusStore.autoClose.enable;
  selectedTime.value = statusStore.autoClose.time;
  waitSongEnd.value = statusStore.autoClose.waitSongEnd;
  
  if (statusStore.autoClose.enable && statusStore.autoClose.remainTime > 0) {
    startCountdown();
  }
});

// 组件卸载时清除定时器
onBeforeUnmount(() => {
  if (countdownTimer.value) {
    clearInterval(countdownTimer.value);
  }
});
</script>

<style scoped lang="scss">
.sleep-timer-modal {
  :deep(.n-card) {
    width: min(90vw, 420px);
    max-width: calc(100vw - 32px);
    backdrop-filter: blur(20px);
    background-color: rgba(var(--n-color-rgb), 0.85);
  }

  :deep(.n-card__content) {
    padding: 20px;
  }

  .timer-switch {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    background-color: var(--n-color);
    border-radius: 12px;

    .switch-label {
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 16px;
      font-weight: 500;

      .n-icon {
        opacity: 0.8;
      }
    }
  }

  .preset-times {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;

    .n-button {
      font-size: 15px;
    }
  }

  .custom-time {
    display: flex;
    flex-direction: column;
    gap: 12px;

    .custom-input {
      :deep(.n-input-number) {
        font-size: 15px;
      }
    }
  }

  .wait-song-end {
    padding: 16px 20px;
    background-color: var(--n-color);
    border-radius: 12px;

    :deep(.n-checkbox) {
      --n-label-line-height: 1.5;
      
      .n-checkbox__label {
        font-size: 14px;
        white-space: normal;
      }
    }
  }

  .countdown {
    padding: 20px;
    background: linear-gradient(135deg, var(--primary-color-hover) 0%, var(--primary-color) 100%);
    border-radius: 12px;
    text-align: center;
    color: white;

    .countdown-title {
      font-size: 14px;
      opacity: 0.9;
      margin-bottom: 8px;
    }

    .countdown-time {
      font-size: 36px;
      font-weight: bold;
      font-variant-numeric: tabular-nums;
    }
  }
}
</style>
