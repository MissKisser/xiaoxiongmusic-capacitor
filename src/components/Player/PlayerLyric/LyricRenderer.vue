<template>
  <div ref="containerRef" class="lyric-renderer">
    <Teleport v-if="bottomLineEl" :to="bottomLineEl">
      <slot name="bottom" />
    </Teleport>
  </div>
</template>

<script setup lang="ts">
/**
 * 逐字卡拉OK歌词渲染器（基于 SPlayer-Next 自研引擎）
 *
 * Based on SPlayer-Next
 * Copyright (C) 2024 SPlayer-Dev
 * Licensed under AGPL-3.0
 *
 * 包装上游 `Lyrics/engine`（LyricRenderer：CSS mask 逐字高亮 + 弹簧滚动 + 触控回弹），
 * 输入为渲染层通用的 AMLL LyricLine[]，内部经 convert.ts 转成引擎所需的 upstream 行。
 */
import type { LyricLine as AmllLyricLine } from "@applemusic-like-lyrics/lyric";
import type { LyricLine } from "@/types/lyrics";
import { LyricRenderer as Renderer } from "./engine";
import type { SpringParams } from "./engine/spring";
import { DEFAULTS } from "./engine/constants";
import { applyScrollPreroll } from "./utils/scroll-preroll";
import { toUpstreamLines } from "@/utils/lyric/convert";
import "./renderer.css";

const props = withDefaults(
  defineProps<{
    /** 歌词行数据（AMLL LyricLine[]，与现有 lrcData/yrcData 一致） */
    lyricLines: AmllLyricLine[];
    /** 是否正在播放 */
    playing?: boolean;
    /** 当前播放时间（毫秒） */
    currentTime?: number;
    alignPosition?: number;
    wordFadeWidth?: number;
    springConfig?: Partial<SpringParams>;
    scrollResetDelay?: number;
    minInterludeGap?: number;
    breatheCycleTarget?: number;
    alphaAttackSpeed?: number;
    alphaReleaseSpeed?: number;
    inactiveAlpha?: number;
    hidePassedLines?: boolean;
    enableBlur?: boolean;
    enableWordHighlight?: boolean;
    enableFloatAnimation?: boolean;
    enableEmphasizeEffect?: boolean;
    showTranslation?: boolean;
    showRomanization?: boolean;
  }>(),
  {
    playing: false,
    currentTime: 0,
    alignPosition: DEFAULTS.alignPosition,
    wordFadeWidth: DEFAULTS.wordFadeWidth,
    scrollResetDelay: DEFAULTS.scrollResetDelay,
    minInterludeGap: DEFAULTS.minInterludeGap,
    breatheCycleTarget: DEFAULTS.breatheCycleTarget,
    alphaAttackSpeed: DEFAULTS.alphaAttackSpeed,
    alphaReleaseSpeed: DEFAULTS.alphaReleaseSpeed,
    inactiveAlpha: DEFAULTS.inactiveAlpha,
    hidePassedLines: DEFAULTS.hidePassedLines,
    enableBlur: DEFAULTS.enableBlur,
    enableWordHighlight: DEFAULTS.enableWordHighlight,
    enableFloatAnimation: DEFAULTS.enableFloatAnimation,
    enableEmphasizeEffect: DEFAULTS.enableEmphasizeEffect,
    showTranslation: true,
    showRomanization: true,
  },
);

interface Emits {
  /** 用户点击歌词行时触发，参数为该行起始时间（毫秒），用于跳转播放进度 */
  (e: "seek", timeMs: number): void;
}

const emit = defineEmits<Emits>();

const containerRef = ref<HTMLElement>();
const bottomLineEl = ref<HTMLElement>();
let renderer: Renderer | null = null;
let isFrozen = false;
let pendingLyrics: LyricLine[] | null = null;

// 转成引擎所需的 upstream 行
const toUpstream = (lines: AmllLyricLine[]): LyricLine[] => toUpstreamLines(lines);

const setCurrentTime = (time: number) => {
  renderer?.setCurrentTime(time);
};
const freeze = () => {
  isFrozen = true;
  renderer?.freeze();
};
const resume = () => {
  isFrozen = false;
  if (pendingLyrics) {
    renderer?.setLyrics(pendingLyrics);
    pendingLyrics = null;
  }
  renderer?.resume();
};

defineExpose({ setCurrentTime, freeze, resume });

const handleLineClick = (timeMs: number) => {
  emit("seek", timeMs);
};

const rebuildLyrics = () => {
  const prepared = applyScrollPreroll(toUpstream(props.lyricLines));
  if (isFrozen) {
    pendingLyrics = prepared;
  } else {
    renderer?.setLyrics(prepared);
  }
};

onMounted(() => {
  if (!containerRef.value) return;
  const {
    lyricLines: _lyricLines,
    currentTime: _currentTime,
    ...config
  } = props;
  renderer = new Renderer(containerRef.value, {
    ...config,
    springConfig: props.springConfig ?? {},
    onLineClick: handleLineClick,
  });
  if (props.currentTime > 0) {
    renderer.setCurrentTime(props.currentTime);
  }
  if (props.lyricLines.length > 0) {
    renderer.setLyrics(applyScrollPreroll(toUpstream(props.lyricLines)));
  }
  bottomLineEl.value = renderer.getBottomLineElement();
});

onUnmounted(() => {
  renderer?.dispose();
  renderer = null;
});

watch(() => props.lyricLines, rebuildLyrics, { deep: true });
watch(
  () => props.playing,
  (v) => renderer?.setPlaying(v),
);
watch(
  () => props.currentTime,
  (v) => renderer?.setCurrentTime(v),
);
watch(
  () => props.alignPosition,
  (v) => renderer?.setConfig({ alignPosition: v }),
);
watch(
  () => props.wordFadeWidth,
  (v) => renderer?.setConfig({ wordFadeWidth: v }),
);
watch(
  () => props.scrollResetDelay,
  (v) => renderer?.setConfig({ scrollResetDelay: v }),
);
watch(
  () => props.minInterludeGap,
  (v) => renderer?.setConfig({ minInterludeGap: v }),
);
watch(
  () => props.breatheCycleTarget,
  (v) => renderer?.setConfig({ breatheCycleTarget: v }),
);
watch(
  () => props.alphaAttackSpeed,
  (v) => renderer?.setConfig({ alphaAttackSpeed: v }),
);
watch(
  () => props.alphaReleaseSpeed,
  (v) => renderer?.setConfig({ alphaReleaseSpeed: v }),
);
watch(
  () => props.inactiveAlpha,
  (v) => renderer?.setConfig({ inactiveAlpha: v }),
);
watch(
  () => props.hidePassedLines,
  (v) => renderer?.setConfig({ hidePassedLines: v }),
);
watch(
  () => props.enableBlur,
  (v) => renderer?.setConfig({ enableBlur: v }),
);
watch(
  () => props.enableWordHighlight,
  (v) => renderer?.setConfig({ enableWordHighlight: v }),
);
watch(
  () => props.enableFloatAnimation,
  (v) => {
    renderer?.setConfig({ enableFloatAnimation: v });
    rebuildLyrics();
  },
);
watch(
  () => props.enableEmphasizeEffect,
  (v) => {
    renderer?.setConfig({ enableEmphasizeEffect: v });
    rebuildLyrics();
  },
);
watch(
  () => props.showTranslation,
  (v) => {
    renderer?.setConfig({ showTranslation: v });
    rebuildLyrics();
  },
);
watch(
  () => props.showRomanization,
  (v) => {
    renderer?.setConfig({ showRomanization: v });
    rebuildLyrics();
  },
);
</script>

<style scoped lang="scss">
.lyric-renderer {
  width: 100%;
  height: 100%;
  min-height: 0;
}
</style>
