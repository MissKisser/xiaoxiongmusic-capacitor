<template>
  <div class="full-player-mobile" ref="mobileStart">
    <!-- 顶部功能栏 -->
    <div class="top-bar">
      <!-- 收起按钮 -->
      <div class="btn" @click.stop="statusStore.showFullPlayer = false">
        <SvgIcon name="Down" :size="26" />
      </div>
    </div>

    <!-- 主内容 -->
    <div
      :class="['mobile-content', { swiping: isSwiping }]"
      :style="{ transform: contentTransform }"
      @click.stop
    >
      <!-- 歌曲信息页 -->
      <div class="page info-page">
        <div class="cover-section">
          <PlayerCover :no-lyric="true" />
        </div>

        <!-- 封面下微型歌词 -->
        <div class="mini-lyric-wrapper" v-if="hasLyric" @click.stop="goToLyricPage">
          <div class="mini-lyric-item left-line">
            <TextContainer :text="currentLineText" :speed="0.2" :delay="500" />
          </div>
          <div class="mini-lyric-item right-line">
            <TextContainer :text="nextLineText" :speed="0.2" :delay="500" />
          </div>
        </div>

        <!-- 歌曲信息区域 -->
        <div class="info-group">
          <!-- 歌曲信息与操作 -->
          <div class="song-info-bar">
            <div class="info-section">
              <PlayerData :center="false" :light="false" class="mobile-data" />
            </div>
            <div class="info-actions">
              <!-- 喜欢和设置按钮组 -->
              <div class="action-group">
                <!-- 喜欢 -->
                <div
                  v-if="musicStore.playSong.type !== 'radio'"
                  class="action-btn"
                  @click="
                    toLikeSong(musicStore.playSong, !dataStore.isLikeSong(musicStore.playSong.id))
                  "
                >
                  <SvgIcon
                    :name="
                      dataStore.isLikeSong(musicStore.playSong.id) ? 'Favorite' : 'FavoriteBorder'
                    "
                    :size="26"
                    :class="{ liked: dataStore.isLikeSong(musicStore.playSong.id) }"
                  />
                </div>
                <!-- 设置按钮 -->
                <div
                  class="action-btn"
                  @click.stop="showSettingsModal = true"
                >
                  <SvgIcon name="Settings" :size="26" />
                </div>
              </div>
              <!-- 添加到歌单和评论按钮组 -->
              <div class="action-group">
                <!-- 添加到歌单 -->
                <div
                  class="action-btn"
                  @click.stop="openPlaylistAdd([musicStore.playSong], !!musicStore.playSong.path)"
                >
                  <SvgIcon name="AddList" :size="26" />
                </div>
                <!-- 评论按钮 -->
                <div
                  v-if="musicStore.playSong.type !== 'radio' && !musicStore.playSong.path"
                  class="action-btn"
                  @click.stop="goToCommentPage"
                >
                  <SvgIcon name="Message" :size="26" />
                </div>
              </div>
            </div>
          </div>

          <!-- 进度条 -->
          <div class="progress-section">
            <span class="time" @click="toggleTimeFormat">{{ timeDisplay[0] }}</span>
            <PlayerSlider 
              class="player" 
              :show-tooltip="false"
              :draggable="false"
            />
            <span class="time" @click="toggleTimeFormat">{{ timeDisplay[1] }}</span>
          </div>

          <!-- 主控制按钮 -->
          <div class="control-section">
            <!-- 随机模式 -->
            <template v-if="musicStore.playSong.type !== 'radio' && !statusStore.personalFmMode">
              <div class="mode-btn" @click.stop="player.toggleShuffle()">
                <SvgIcon
                  :name="statusStore.shuffleIcon"
                  :size="24"
                  :depth="statusStore.shuffleMode === 'off' ? 3 : 1"
                />
              </div>
            </template>
            <div v-else class="placeholder"></div>

            <!-- 上一曲 -->
            <div class="ctrl-btn" @click.stop="player.nextOrPrev('prev')">
              <SvgIcon name="SkipPrev" :size="36" />
            </div>

            <!-- 播放/暂停 -->
            <n-button
              :loading="statusStore.playLoading"
              class="play-btn"
              type="primary"
              strong
              secondary
              circle
              @click.stop="player.playOrPause()"
            >
              <template #icon>
                <Transition name="fade" mode="out-in">
                  <SvgIcon
                    :key="statusStore.playStatus ? 'Pause' : 'Play'"
                    :name="statusStore.playStatus ? 'Pause' : 'Play'"
                    :size="40"
                  />
                </Transition>
              </template>
            </n-button>

            <!-- 下一曲 -->
            <div class="ctrl-btn" @click.stop="player.nextOrPrev('next')">
              <SvgIcon name="SkipNext" :size="36" />
            </div>

            <!-- 循环模式 -->
            <template v-if="musicStore.playSong.type !== 'radio' && !statusStore.personalFmMode">
              <div class="mode-btn" @click.stop="player.toggleRepeat()">
                <SvgIcon
                  :name="statusStore.repeatIcon"
                  :size="24"
                  :depth="statusStore.repeatMode === 'off' ? 3 : 1"
                />
              </div>
            </template>
            <div v-else class="placeholder"></div>
          </div>
        </div>
      </div>

      <!-- 歌词页 -->
      <div class="page lyric-page">
        <div class="lyric-header">
          <s-image :src="musicStore.getSongCover('s')" class="lyric-cover" />
          <div class="lyric-info">
            <div class="name text-hidden">{{ settingStore.hideLyricBrackets ? removeBrackets(musicStore.playSong.name) : musicStore.playSong.name }}</div>
            <div class="artist text-hidden">{{ artistName }}</div>
          </div>
          <!-- 喜欢按钮 -->
          <div
            v-if="musicStore.playSong.type !== 'radio'"
            class="action-btn"
            @click.stop="
              toLikeSong(musicStore.playSong, !dataStore.isLikeSong(musicStore.playSong.id))
            "
          >
            <SvgIcon
              :name="dataStore.isLikeSong(musicStore.playSong.id) ? 'Favorite' : 'FavoriteBorder'"
              :size="24"
              :class="{ liked: dataStore.isLikeSong(musicStore.playSong.id) }"
            />
          </div>
        </div>
        <div class="lyric-main">
          <PlayerLyric />
        </div>
      </div>

    </div>

    <!-- 页面指示器 -->
    <div class="pagination" v-if="hasPageIndicator">
      <div
        v-for="i in totalPages"
        :key="i"
        :class="['dot', { active: pageIndex === i - 1 }]"
        @click="pageIndex = i - 1"
      />
    </div>

    <!-- 设置弹窗 -->
    <PlayerSettingsModal v-model:show="showSettingsModal" />
  </div>
</template>

<script setup lang="ts">
import { useRouter } from "vue-router";
import { useSwipe } from "@vueuse/core";
import { useMusicStore, useStatusStore, useDataStore, useSettingStore } from "@/stores";
import { usePlayerController } from "@/core/player/PlayerController";
import { useTimeFormat } from "@/composables/useTimeFormat";
import { toLikeSong } from "@/utils/auth";
import { openPlaylistAdd } from "@/utils/modal";
import { removeBrackets } from "@/utils/format";
import TextContainer from "@/components/Global/TextContainer.vue";
import PlayerSettingsModal from "./PlayerSettingsModal.vue";

const router = useRouter();
const musicStore = useMusicStore();
const statusStore = useStatusStore();
const settingStore = useSettingStore();
const dataStore = useDataStore();
const player = usePlayerController();
const { timeDisplay, toggleTimeFormat } = useTimeFormat();

// 实时播放进度和歌词索引
const playSeek = ref(0);
useRafFn(() => {
  const songId = musicStore.playSong?.id;
  const offsetTime = statusStore.getSongOffset(songId);
  playSeek.value = player.getSeek() + offsetTime;
});

const currentLineIndex = computed(() => {
  const lrc = musicStore.songLyric.lrcData;
  if (!lrc || lrc.length === 0) return -1;
  const index = lrc.findIndex((line, i) => {
    const nextStart = lrc[i + 1]?.startTime || Infinity;
    return playSeek.value >= line.startTime && playSeek.value < nextStart;
  });
  return index;
});

const getLineText = (line: any) => {
  if (!line) return "";
  if (line.words) {
    return line.words.map((w: any) => w.word).join("");
  }
  return "";
};

const currentLineText = computed(() => {
  const index = currentLineIndex.value;
  if (index === -1) return "";
  return getLineText(musicStore.songLyric.lrcData[index]);
});

const nextLineText = computed(() => {
  const index = currentLineIndex.value;
  const lrc = musicStore.songLyric.lrcData;
  if (index === -1 || !lrc || index >= lrc.length - 1) return "";
  return getLineText(lrc[index + 1]);
});

const mobileStart = ref<HTMLElement | null>(null);
const pageIndex = ref(0);
const showSettingsModal = ref(false);

const hasLyric = computed(() => {
  return musicStore.isHasLrc && musicStore.playSong.type !== "radio";
});

// 打开评论页（跳转到独立页面）
const goToCommentPage = () => {
  // 自动缩小全屏播放器
  statusStore.showFullPlayer = false;
  const song = musicStore.playSong;
  router.push({
    name: "comment",
    params: {
      id: song.id,
    },
    query: {
      name: settingStore.hideLyricBrackets ? removeBrackets(song.name) : song.name,
      artist: artistName.value,
      type: songType.value.toString(),
    },
  });
};

// 切换到歌词页
const goToLyricPage = () => {
  if (hasLyric.value && totalPages.value > 1) {
    pageIndex.value = 1;
  }
};

// 歌曲类型（用于评论）
const songType = computed<0 | 1 | 7 | 2 | 3 | 4 | 5 | 6>(() =>
  musicStore.playSong.type === "radio" ? 4 : 0,
);

const artistName = computed(() => {
  const artists = musicStore.playSong.artists;
  if (Array.isArray(artists)) {
    return artists.map((ar) => ar.name).join(" / ");
  }
  return (artists as string) || "未知艺术家";
});

const totalPages = computed(() => {
  return hasLyric.value ? 2 : 1; // 信息页 + 歌词页（如果有）
});

const hasPageIndicator = computed(() => {
  return totalPages.value > 1;
});

// 没有歌词强制回到第一页
watch(hasLyric, (val) => {
  if (!val && pageIndex.value === 1) pageIndex.value = 0;
});

// 监听页面索引，确保不超出范围
watch(pageIndex, (newIndex) => {
  if (newIndex >= totalPages.value) {
    pageIndex.value = totalPages.value - 1;
  }
});

// 滑动偏移量
const swipeOffset = ref(0);

const { direction, isSwiping, lengthX } = useSwipe(mobileStart, {
  threshold: 5,
  onSwipe: (event) => {
    // 检查是否在进度条区域，如果是则不处理页面滑动（让进度条自己处理）
    const target = event?.target as HTMLElement;
    if (target?.closest('.n-slider') || target?.closest('.player-slider') || target?.closest('.progress-section')) {
      // 在进度条区域，不处理页面滑动
      return;
    }
    // 如果有多个页面（歌词页或评论页），允许滑动
    if (totalPages.value <= 1) return;
    // 为正表示向左滑，为负表示向右滑
    swipeOffset.value = lengthX.value;
  },
  onSwipeEnd: (event) => {
    // 检查是否在进度条区域
    const target = event?.target as HTMLElement;
    if (target?.closest('.n-slider') || target?.closest('.player-slider') || target?.closest('.progress-section')) {
      // 在进度条区域，不处理页面滑动
      swipeOffset.value = 0;
      return;
    }
    // 左滑切换到下一页，右滑切换到上一页
    if (direction.value === "left" && lengthX.value > 50) {
      // 左滑：下一页
      if (pageIndex.value < totalPages.value - 1) {
        pageIndex.value++;
      }
    } else if (direction.value === "right" && lengthX.value < -50) {
      // 右滑：上一页
      if (pageIndex.value > 0) {
        pageIndex.value--;
      }
    }
    swipeOffset.value = 0;
  },
});

// 计算实时的变换位置
const contentTransform = computed(() => {
  const baseOffset = pageIndex.value * (100 / totalPages.value); // 百分比
  if (!isSwiping.value || totalPages.value <= 1) {
    return `translateX(-${baseOffset}%)`;
  }
  let pixelOffset = lengthX.value;
  // 限制滑动范围
  if (pageIndex.value === 0) {
    // 在信息页：左滑允许切换到歌词页，右滑只显示偏移（负值）
    if (pixelOffset < 0) {
      // 右滑：显示偏移，但不切换页面
      pixelOffset = pixelOffset * 0.3;
    } else {
      // 左滑：允许切换到歌词页
      // 不限制，让滑动自然进行
    }
  }
  if (pageIndex.value === 1 && pixelOffset > 0) {
    // 在歌词页：右滑回到信息页
    pixelOffset = pixelOffset * 0.3;
  }
  return `translateX(calc(-${baseOffset}% - ${pixelOffset}px))`;
});
</script>

<style lang="scss" scoped>
.full-player-mobile {
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  touch-action: pan-x; // 只允许水平滑动，禁止垂直拖动
  .top-bar {
    position: absolute;
    width: 100%;
    height: clamp(50px, 12vw, 60px);
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    padding: 0 clamp(16px, 4vw, 24px);
    padding-top: env(safe-area-inset-top, 0px);
    margin-top: clamp(8px, 2vw, 10px);
    z-index: 10;
    .btn {
      width: clamp(36px, 8vw, 40px);
      height: clamp(36px, 8vw, 40px);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: background-color 0.2s;
      flex-shrink: 0;
      &:active {
        background-color: rgba(255, 255, 255, 0.1);
      }
      .n-icon {
        color: rgb(var(--main-cover-color));
        opacity: 0.8;
      }
    }
  }
  .mobile-content {
    flex: 1;
    display: flex;
    width: calc(100% * v-bind(totalPages));
    height: 100%;
    transition: transform 0.3s cubic-bezier(0.25, 1, 0.5, 1);
    &.swiping {
      transition: none;
    }
    .page {
      width: calc(100% / v-bind(totalPages));
      height: 100%;
      flex-shrink: 0;
      position: relative;
    }
      .info-page {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 0 clamp(16px, 4vw, 24px) clamp(30px, 6vw, 40px) clamp(16px, 4vw, 24px);
      overflow: hidden; // 禁止滚动，固定所有元素
      .cover-section {
        flex: 1;
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        margin-top: clamp(50px, 12vw, 60px);
        margin-bottom: clamp(16px, 4vw, 20px);
        :deep(.player-cover) {
          width: min(100%, 45vh);
          // height: min(85vw, 45vh);
          &.record {
            width: 40vh;
            .cover-img {
              width: 40vh;
              height: 40vh;
              min-width: 40vh;
            }
            .pointer {
              width: 10vh;
              top: -9.5vh;
            }
            @media (max-width: 512px) {
              width: 36vh;
              .cover-img {
                width: 36vh;
                height: 36vh;
                min-width: 36vh;
              }
            }
          }
        }
      }
      .mini-lyric-wrapper {
        width: 100%;
        margin-top: -10px;
        margin-bottom: -3px; // 减少与下方组件的间距，让组件更接近小歌词
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 0 4px;
        cursor: pointer;
        transition: opacity 0.2s;
        &:active {
          opacity: 0.7;
        }
        .mini-lyric-item {
          font-size: 18px; // 调整歌词大小 (原 14px)
          opacity: 0.8;
          color: rgb(var(--main-cover-color));
          height: 18px; // 同步调整高度
          line-height: 20px;
          transition: all 0.3s ease;
          &.left-line {
            text-align: left;
            padding-right: 20%;
          }
          &.right-line {
            text-align: right;
            padding-left: 20%;
            opacity: 0.5;
          }
          // TextContainer 样式覆盖
          :deep(.text-container) {
            width: 100%;
            .empty {
              font-size: 18px;
              line-height: 20px;
            }
            .scroll-wrapper {
              .text {
                font-size: 18px;
                line-height: 20px;
                color: inherit;
              }
            }
          }
          // 右对齐的第二行歌词
          &.right-line {
            :deep(.text-container) {
              .scroll-wrapper {
                left: auto;
                right: 0;
                justify-content: flex-end;
              }
            }
          }
        }
      }
      .info-group {
        width: 100%;
        display: flex;
        flex-direction: column;
        .song-info-bar {
          width: 100%;
          display: flex;
          justify-content: space-between;
          margin-bottom: 24px;
          .info-section {
            flex: 1;
            min-width: 0;
            margin-right: 16px;
            :deep(.mobile-data) {
              width: 100%;
              max-width: 100%;
              .name {
                margin-left: 0;
              }
            }
          }
          .info-actions {
            display: flex;
            padding-top: 24px;
            gap: 16px;
            flex-shrink: 0;
            align-items: flex-start;
            .action-group {
              display: flex;
              flex-direction: column;
              gap: 5px;
              align-items: center;
            }
            .action-btn {
              display: flex;
              align-items: center;
              justify-content: center;
              width: clamp(36px, 8vw, 40px);
              height: clamp(36px, 8vw, 40px);
              border-radius: 50%;
              cursor: pointer;
              transition: background-color 0.2s;
              &:active {
                background-color: rgba(255, 255, 255, 0.1);
              }
              .n-icon {
                color: rgb(var(--main-cover-color));
                opacity: 0.6;
                transition:
                  opacity 0.2s,
                  transform 0.2s;
                &.liked {
                  fill: rgb(var(--main-cover-color));
                  opacity: 1;
                }
              }
            }
          }
        }
        .progress-section {
          display: flex;
          align-items: center;
          margin: 0 4px 30px;
          // 禁用拖动，只允许点击
          touch-action: none;
          .time {
            font-size: 12px;
            opacity: 0.6;
            width: 40px;
            text-align: center;
            color: rgb(var(--main-cover-color));
            font-variant-numeric: tabular-nums;
          }
          .n-slider {
            margin: 0 12px;
            // 禁用拖动，只允许点击
            touch-action: none;
            // 确保圆纽始终显示
            :deep(.n-slider-handles) {
              .n-slider-handle {
                opacity: 1;
                transform: scale(1);
                width: 16px;
                height: 16px;
                border: 2px solid var(--n-handle-color);
                box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
                pointer-events: none; // 禁用圆纽的拖动
              }
            }
            :deep(.n-slider.drag) {
              .n-slider-handles {
                .n-slider-handle {
                  transform: scale(1.2);
                }
              }
            }
            :deep(.n-slider-rail) {
              touch-action: none; // 禁用拖动
              cursor: pointer; // 显示点击光标
            }
          }
        }
        .control-section {
          width: 100%;
          max-width: min(400px, 90vw);
          margin: 0 auto clamp(20px, 5vw, 30px);
          margin-top: 0px; // 减少与上方小歌词的间距，让组件更接近小歌词
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 clamp(8px, 2vw, 10px);
          .placeholder {
            width: clamp(20px, 5vw, 24px);
          }
          .mode-btn {
            opacity: 0.8;
            cursor: pointer;
            width: clamp(36px, 8vw, 40px);
            height: clamp(36px, 8vw, 40px);
            display: flex;
            align-items: center;
            justify-content: center;
            .n-icon {
              color: rgb(var(--main-cover-color));
            }
          }
          .ctrl-btn {
            cursor: pointer;
            width: clamp(45px, 10vw, 50px);
            height: clamp(45px, 10vw, 50px);
            display: flex;
            align-items: center;
            justify-content: center;
            .n-icon {
              color: rgb(var(--main-cover-color));
            }
          }
          .play-btn {
            width: clamp(54px, 12vw, 60px);
            height: clamp(54px, 12vw, 60px);
            font-size: clamp(22px, 5vw, 26px);
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: transform 0.2s;
            background-color: rgba(var(--main-cover-color), 0.2);
            color: rgb(var(--main-cover-color));
            &.n-button--primary-type {
              --n-color: rgba(var(--main-cover-color), 0.14);
              --n-color-hover: rgba(var(--main-cover-color), 0.2);
              --n-color-focus: rgba(var(--main-cover-color), 0.2);
              --n-color-pressed: rgba(var(--main-cover-color), 0.12);
            }
            &:active {
              transform: scale(0.95);
            }
          }
        }
      }
    }
    .lyric-page {
      padding: 0 24px;
      padding-top: 60px;
      display: flex;
      flex-direction: column;
      overflow: hidden; // 防止整个页面被拖动
      .lyric-header {
        display: flex;
        align-items: center;
        gap: 16px;
        margin-bottom: 20px;
        flex-shrink: 0;
        padding: 10px 20px 0;
        .lyric-cover {
          width: 50px;
          height: 50px;
          flex-shrink: 0;
          :deep(img) {
            border-radius: 6px;
            width: 100%;
            height: 100%;
          }
          border-radius: 6px;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
        }
        .lyric-info {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          justify-content: center;
          .name {
            font-size: 18px;
            font-weight: bold;
            margin-bottom: 2px;
          }
          .artist {
            font-size: 13px;
            opacity: 0.6;
          }
        }
        .action-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 40px;
          height: 40px;
          border-radius: 50%;
          cursor: pointer;
          transition: background-color 0.2s;
          margin-left: 4px;
          &:active {
            background-color: rgba(255, 255, 255, 0.1);
          }
          .n-icon {
            color: rgb(var(--main-cover-color));
            opacity: 0.6;
            transition: all 0.2s;
            &.liked {
              fill: rgb(var(--main-cover-color));
              opacity: 1;
            }
          }
        }
      }
      .lyric-main {
        flex: 1;
        min-height: 0;
        position: relative;
      }
    }
  }
  .pagination {
    position: absolute;
    bottom: 24px;
    left: 0;
    width: 100%;
    display: flex;
    justify-content: center;
    gap: 8px;
    pointer-events: none;
    .dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background-color: rgba(255, 255, 255, 0.2);
      transition: all 0.3s;
      &.active {
        background-color: rgb(var(--main-cover-color));
        width: 16px;
        border-radius: 4px;
        opacity: 0.8;
      }
    }
  }
}
</style>
