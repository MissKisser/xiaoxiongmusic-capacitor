<template>
  <div class="player-lyric">
    <!-- 歌词内容 -->
    <div class="lyric-container" ref="lyricContainer">
      <AMLyric v-if="settingStore.useAMLyrics" :currentTime="playSeek" />
      <DefaultLyric v-else :currentTime="playSeek" />
    </div>

    <!-- 侧边快捷操作按钮 (移动端专用) -->
    <div class="lyric-quick-actions" v-if="isMobile">
      <div class="action-item" @click="adjustFontSize(2)">
        <SvgIcon name="TextSizeAdd" :size="18" />
      </div>
      <div class="action-item" @click="openCopyLyrics">
        <SvgIcon name="Copy" :size="18" />
      </div>
      <div class="action-item" @click="adjustFontSize(-2)">
        <SvgIcon name="TextSizeReduce" :size="18" />
      </div>
    </div>
    <!-- 歌词菜单 -->
    <n-flex :class="['lyric-menu', { show: statusStore.playerMetaShow }]" justify="center" vertical>
      <div class="menu-icon" @click="openCopyLyrics">
        <SvgIcon name="Copy" />
      </div>
      <div class="divider" />
      <div class="menu-icon" @click="changeOffset(-settingStore.lyricOffsetStep)">
        <SvgIcon name="Replay5" />
      </div>
      <n-popover class="player" trigger="click" placement="left" style="padding: 8px">
        <template #trigger>
          <span class="time">
            {{ currentTimeOffsetValue }}
          </span>
        </template>
        <n-flex class="offset-menu" :size="4" vertical>
          <span class="title"> 歌词偏移 </span>
          <span class="tip"> 正值为歌词提前，单位毫秒 </span>
          <n-input-number
            v-model:value="offsetMilliseconds"
            class="offset-input"
            :precision="0"
            :step="100"
            placeholder="0"
            size="small"
          >
            <template #suffix>ms</template>
          </n-input-number>
          <n-button
            :disabled="offsetMilliseconds == 0"
            class="player"
            size="small"
            secondary
            strong
            @click="resetOffset"
          >
            清零
          </n-button>
        </n-flex>
      </n-popover>
      <div class="menu-icon" @click="changeOffset(settingStore.lyricOffsetStep)">
        <SvgIcon name="Forward5" />
      </div>
      <div class="divider" />
      <div class="menu-icon" @click="openSetting('lyrics')">
        <SvgIcon name="Settings" />
      </div>
    </n-flex>
  </div>
</template>

<script setup lang="ts">
import { usePlayerController } from "@/core/player/PlayerController";
import { useMusicStore, useSettingStore, useStatusStore } from "@/stores";
import { openSetting, openCopyLyrics } from "@/utils/modal";
import { usePinch } from "@vueuse/gesture";
import { useMobile } from "@/composables/useMobile";

const musicStore = useMusicStore();
const settingStore = useSettingStore();
const statusStore = useStatusStore();
const player = usePlayerController();
const { isMobile } = useMobile();

/**
 * 当前歌曲 id
 */
const currentSongId = computed(() => musicStore.playSong?.id as number | undefined);

// 实时播放进度
const playSeek = ref<number>(player.getSeek() + statusStore.getSongOffset(musicStore.playSong?.id));

// 实时更新播放进度
const { pause: pauseSeek, resume: resumeSeek } = useRafFn(() => {
  const songId = musicStore.playSong?.id;
  const offsetTime = statusStore.getSongOffset(songId);
  playSeek.value = player.getSeek() + offsetTime;
});

/**
 * 当前进度偏移值
 */
const currentTimeOffsetValue = computed(() => {
  const currentTimeOffset = statusStore.getSongOffset(currentSongId.value);
  if (currentTimeOffset === 0) return "0";
  // 将毫秒转换为秒显示
  const offsetSeconds = parseFloat((currentTimeOffset / 1000).toFixed(2));
  return currentTimeOffset > 0 ? `+${offsetSeconds}` : `${offsetSeconds}`;
});

/**
 * 当前进度偏移值（毫秒）
 */
const offsetMilliseconds = computed({
  get: () => {
    return statusStore.getSongOffset(currentSongId.value);
  },
  set: (val: number | null) => {
    statusStore.setSongOffset(currentSongId.value, val || 0);
  },
});

/**
 * 改变进度偏移
 * @param delta 偏移量（单位：毫秒）
 */
const changeOffset = (delta: number) => {
  statusStore.incSongOffset(currentSongId.value, delta);
};

/**
 * 重置进度偏移
 */
const resetOffset = () => {
  statusStore.resetSongOffset(currentSongId.value);
};

/**
 * 获取当前显示的字号（处理移动端自适应初始值）
 */
const displayFontSize = computed(() => {
  if (isMobile.value && settingStore.lyricFontSize === 46) {
    return 32;
  }
  return settingStore.lyricFontSize;
});

/**
 * 调整歌词字体大小
 */
const adjustFontSize = (delta: number) => {
  const newSize = Math.max(12, Math.min(100, displayFontSize.value + delta));
  settingStore.lyricFontSize = newSize;
};

// 手势缩放处理
const lyricContainer = ref<HTMLElement | null>(null);
const lastScaleFontSize = ref(0);

usePinch(
  (state) => {
    if (state.first) {
      lastScaleFontSize.value = displayFontSize.value;
    }
    // 根据缩放比例调整大小
    const delta = (state.offset[0] - 1) * 20;
    const newSize = Math.max(12, Math.min(100, lastScaleFontSize.value + delta));
    settingStore.lyricFontSize = Math.round(newSize);
  },
  {
    domTarget: lyricContainer,
    eventOptions: { passive: false },
  },
);

onMounted(() => {
  resumeSeek();
});

onBeforeUnmount(() => {
  pauseSeek();
});
</script>

<style lang="scss" scoped>
.player-lyric {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;

  .lyric-container {
    flex: 1;
    width: 100%;
    height: 100%;
    min-height: 0;
    touch-action: none;
  }
  filter: drop-shadow(0px 4px 6px rgba(0, 0, 0, 0.2));
  mask: linear-gradient(
    180deg,
    hsla(0, 0%, 100%, 0) 0,
    hsla(0, 0%, 100%, 0.6) 5%,
    #fff 10%,
    #fff 75%,
    hsla(0, 0%, 100%, 0.6) 85%,
    hsla(0, 0%, 100%, 0)
  );
  @media (hover: hover) and (pointer: fine) {
    &:hover {
      .lyric-menu {
        pointer-events: auto;
        &.show {
          opacity: 0.6;
        }
      }
    }
  }
}

.lyric-quick-actions {
  position: absolute;
  right: 2px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  flex-direction: column;
  gap: 16px;
  z-index: 100;
  padding: 10px 4px;
  background-color: rgba(var(--main-cover-color), 0.08);
  backdrop-filter: blur(8px);
  border-radius: 16px;
  border: 1px solid rgba(var(--main-cover-color), 0.1);
  opacity: 0.3;
  transition: opacity 0.3s;

  &:active,
  &:hover {
    opacity: 1;
  }

  .action-item {
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    color: rgb(var(--main-cover-color));
    background-color: rgba(var(--main-cover-color), 0.1);
    cursor: pointer;

    &:active {
      transform: scale(0.9);
      background-color: rgba(var(--main-cover-color), 0.2);
    }
  }
}
.lyric-menu {
  position: absolute;
  pointer-events: none;
  top: 0;
  right: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: space-between;
  height: 100%;
  width: 80px;
  padding: 20% 0;
  opacity: 0;
  transition: opacity 0.3s;
  .divider {
    height: 2px;
    width: 40px;
    background-color: rgba(var(--main-cover-color), 0.12);
  }
  .time {
    width: 40px;
    margin: 8px 0;
    padding: 4px 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    background-color: rgba(var(--main-cover-color), 0.14);
    backdrop-filter: blur(10px);
    border-radius: 8px;
    border: 1px solid rgba(var(--main-cover-color), 0.12);
    transition: background-color 0.3s;
    cursor: pointer;
    &::after {
      content: "s";
      margin-left: 2px;
    }
    &:hover {
      background-color: rgba(var(--main-cover-color), 0.28);
    }
  }
  .menu-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 6px;
    border-radius: 8px;
    transition:
      background-color 0.3s,
      transform 0.3s;
    cursor: pointer;
    .n-icon {
      font-size: 30px;
      color: rgb(var(--main-cover-color));
    }
    &:hover {
      transform: scale(1.1);
      background-color: rgba(var(--main-cover-color), 0.14);
    }
    &:active {
      transform: scale(1);
    }
  }
}
.offset-menu {
  width: 180px;
  .title {
    font-size: 14px;
    line-height: normal;
  }
  .tip {
    font-size: 12px;
    opacity: 0.6;
  }
  :deep(.n-input) {
    --n-caret-color: rgb(var(--main-cover-color));
    --n-color: rgba(var(--main-cover-color), 0.1);
    --n-color-focus: rgba(var(--main-cover-color), 0.1);
    --n-text-color: rgb(var(--main-cover-color));
    --n-border-hover: 1px solid rgba(var(--main-cover-color), 0.28);
    --n-border-focus: 1px solid rgba(var(--main-cover-color), 0.28);
    --n-suffix-text-color: rgb(var(--main-cover-color));
    --n-box-shadow-focus: 0 0 8px 0 rgba(var(--main-cover-color), 0.3);
    // 文本选中颜色
    input {
      &::selection {
        background-color: rgba(var(--main-cover-color));
      }
    }
    .n-button {
      --n-text-color: rgb(var(--main-cover-color));
    }
  }
}
</style>
