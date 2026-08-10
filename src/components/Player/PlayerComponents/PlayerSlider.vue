<template>
  <n-slider
    v-model:value="sliderProgress"
    :step="0.01"
    :min="0"
    :max="statusStore.duration"
    :keyboard="false"
    :format-tooltip="formatTooltip"
    :tooltip="settingStore.progressTooltipShow && showTooltip"
    :disabled="disabled"
    :class="['player-slider', { drag: isDragging, disabled, 'no-drag': !draggable }]"
    @pointerdown.capture="handlePointerDown"
  />
</template>

<script setup lang="ts">
import { useMusicStore, useSettingStore, useStatusStore } from "@/stores";
import { msToTime } from "@/utils/time";
import { usePlayerController } from "@/core/player/PlayerController";
import { LyricLine } from "@applemusic-like-lyrics/lyric";

const props = withDefaults(defineProps<{ showTooltip?: boolean; disabled?: boolean; draggable?: boolean }>(), { 
  showTooltip: true,
  disabled: false,
  draggable: true
});

const emit = defineEmits<{
  'drag-start': [];
  'drag-end': [];
}>();

const musicStore = useMusicStore();
const statusStore = useStatusStore();
const settingStore = useSettingStore();

const player = usePlayerController();

// 拖动时的临时值
const dragValue = ref(0);
// 是否拖动
const isDragging = ref(false);
// 是否显示提示
// const showSliderTooltip = ref(false);

// 实时进度
const sliderProgress = computed({
  // 获取进度
  get: () => (isDragging.value ? dragValue.value : statusStore.currentTime),
  // 设置进度
  set: (value) => {
    // 若为拖动中，仅更新拖动预览值（不触发 seek，松手时才跳转）
    if (isDragging.value) {
      dragValue.value = value;
      return;
    }
    // 非拖动场景（点击 / 键盘等），直接跳转进度
    setSeek(value);
  },
});

// 拖动期间屏蔽页面滚动（touchmove 阻止默认）
const preventScroll = (e: TouchEvent) => e.preventDefault();
const lockPageScroll = () => {
  document.addEventListener("touchmove", preventScroll, { passive: false });
};
const unlockPageScroll = () => {
  document.removeEventListener("touchmove", preventScroll);
};

// 开始拖动（按下进度条，捕获阶段先于 naive-ui 内部事件，确保 isDragging 先置位）
const handlePointerDown = (e: PointerEvent) => {
  // 不允许拖动（点击模式）或禁用时不处理
  if (!props.draggable || props.disabled) {
    return;
  }
  // 忽略鼠标非左键
  if (e.pointerType === "mouse" && e.button !== 0) {
    return;
  }
  isDragging.value = true;
  // 立即赋值当前时间
  dragValue.value = statusStore.currentTime;
  // 屏蔽页面滚动
  lockPageScroll();
  // 注册全局结束监听（手指可能移出进度条区域）
  window.addEventListener("pointerup", handlePointerUp);
  window.addEventListener("pointercancel", handlePointerUp);
  emit('drag-start');
};

// 结束拖动（松手）：立即跳转到目标进度
const handlePointerUp = () => {
  if (!isDragging.value) {
    return;
  }
  isDragging.value = false;
  // 解除页面滚动屏蔽
  unlockPageScroll();
  // 移除全局监听
  window.removeEventListener("pointerup", handlePointerUp);
  window.removeEventListener("pointercancel", handlePointerUp);
  // 跳转到目标进度（拖动过程中不 seek，松手一次性跳转，避免逐个播放中间内容）
  setSeek(dragValue.value);
  emit('drag-end');
};

// 组件销毁时解除滚动屏蔽与全局监听，避免残留
onBeforeUnmount(() => {
  unlockPageScroll();
  window.removeEventListener("pointerup", handlePointerUp);
  window.removeEventListener("pointercancel", handlePointerUp);
});

/**
 * 获取当前时间最近一句歌词
 * @param value 当前时间
 * @returns 最近一句歌词的开始时间和内容
 */
const getCurrentLyric = (value: number) => {
  const lyric = toRaw(musicStore.songLyric.lrcData);
  if (!lyric?.length) return null;
  //  查找最近一句歌词
  let nearestLyric: LyricLine | null = null;
  for (let i = lyric.length - 1; i >= 0; i--) {
    if (value >= lyric[i].startTime) {
      nearestLyric = lyric[i];
      break;
    }
  }
  return {
    time: nearestLyric?.startTime,
    text: nearestLyric?.words?.[0]?.word || "",
  };
};

// 调节进度
const setSeek = (value: number) => {
  if (settingStore.progressAdjustLyric) {
    const nearestLyric = getCurrentLyric(value);
    player.setSeek(nearestLyric?.time ?? value);
    return;
  }
  player.setSeek(value);
};

// 格式化提示
const formatTooltip = (value: number) => {
  const nearestLyric = settingStore.progressLyricShow ? getCurrentLyric(value) : null;
  return nearestLyric?.text?.length
    ? `${msToTime(value)} / ${nearestLyric.text.length > 30 ? nearestLyric.text.slice(0, 30) + "..." : nearestLyric.text}`
    : msToTime(value);
};
</script>

<style scoped lang="scss">
.player-slider {
  width: 100%;
  // 屏蔽触摸拖动引发的页面滚动（与 JS 锁滚动双保险）
  touch-action: none;
  &:not(.drag) {
    :deep(.n-slider-rail) {
      .n-slider-rail__fill {
        transition: width 0.3s;
      }
      .n-slider-handle-wrapper {
        will-change: left;
        transition: left 0.3s;
      }
    }
  }
  :deep(.n-slider-handles) {
    .n-slider-handle {
      opacity: 1; // 始终显示圆纽
      transform: scale(1);
      width: 16px;
      height: 16px;
      border: 2px solid var(--n-handle-color);
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
    }
  }
  &.drag {
    :deep(.n-slider-handles) {
      .n-slider-handle {
        transform: scale(1.2);
      }
    }
  }
  // 禁用状态：隐藏圆点
  &.disabled {
    :deep(.n-slider-handles) {
      .n-slider-handle {
        display: none;
      }
    }
    :deep(.n-slider-rail) {
      cursor: default;
    }
  }
  // 禁用拖动模式：只允许点击
  &.no-drag {
    :deep(.n-slider-handles) {
      .n-slider-handle {
        pointer-events: none; // 禁用圆纽的拖动
      }
    }
    :deep(.n-slider-rail) {
      cursor: pointer; // 显示点击光标
      // 禁用拖动
      touch-action: none;
      user-select: none;
    }
  }
  &.player {
    --n-rail-color: rgba(var(--main-cover-color), 0.14);
    --n-rail-color-hover: rgba(var(--main-cover-color), 0.3);
    --n-fill-color: rgb(var(--main-cover-color));
    --n-handle-color: rgb(var(--main-cover-color));
    --n-fill-color-hover: rgb(var(--main-cover-color));
  }
}
</style>
