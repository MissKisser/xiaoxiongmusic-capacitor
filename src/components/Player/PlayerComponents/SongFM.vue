<!-- 平台刷歌卡片（QQ 音乐 / 酷狗音乐推荐流） -->
<template>
  <n-card class="song-fm" hoverable @click="handleEnter">
    <!-- 封面 -->
    <Transition name="fade" mode="out-in">
      <n-image
        :key="fmSong?.id"
        :src="fmSong?.coverSize?.m || fmSong?.cover"
        class="cover"
        preview-disabled
        lazy
        @load="coverLoaded"
      >
        <template #placeholder>
          <div class="cover-loading">
            <img src="/images/song.jpg?asset" class="loading-img" alt="loading-img" />
          </div>
        </template>
      </n-image>
    </Transition>
    <!-- 信息 -->
    <Transition name="fade" mode="out-in">
      <div :key="fmSong?.id" class="info">
        <div class="title-line">
          <n-text class="name text-hidden">
            {{ fmSong?.name || "暂无曲目" }}
          </n-text>
          <div v-if="fmArtists.length" class="artists text-hidden">
            <SvgIcon name="Artist" :depth="3" />
            <n-text v-for="ar in fmArtists" :key="ar.id" class="ar">
              {{ ar.name }}
            </n-text>
          </div>
        </div>
        <div v-if="fmAlbumName" class="album text-hidden">
          <SvgIcon name="Album" :depth="3" />
          <n-text class="album-text">{{ fmAlbumName }}</n-text>
        </div>
        <!-- 功能 -->
        <n-flex :wrap="false" class="menu" align="center">
          <!-- 播放暂停 -->
          <n-button
            :loading="statusStore.personalFmMode && statusStore.playLoading"
            :focusable="false"
            class="play"
            strong
            secondary
            circle
            @click.stop="fmPlayOrPause"
          >
            <template #icon>
              <Transition name="fade" mode="out-in">
                <SvgIcon :key="playIcon" :name="playIcon" :size="32" />
              </Transition>
            </template>
          </n-button>
          <!-- 下一曲 -->
          <div class="menu-icon" @click.stop="fmPlayNext">
            <SvgIcon size="26" name="SkipNext" />
          </div>
          <!-- 换一批 -->
          <n-tooltip trigger="hover">
            <template #trigger>
              <div class="menu-icon" @click.stop="fmRefresh">
                <SvgIcon class="icon" size="18" name="Refresh" />
              </div>
            </template>
            换一批推荐流（平台推荐流为只读接口，不支持「不喜欢」反馈）
          </n-tooltip>
        </n-flex>
        <!-- 图标 -->
        <div class="radio">
          <SvgIcon :depth="3" name="Radio" />
          <n-text :depth="3">刷歌</n-text>
        </div>
      </div>
    </Transition>
  </n-card>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { MetaData } from "@/types/main";
import { useStatusStore } from "@/stores";
import { useSongFM } from "@/composables/useSongFM";
import { coverLoaded } from "@/utils/helper";
import SvgIcon from "@/components/Global/SvgIcon.vue";

const statusStore = useStatusStore();

const { fmSong, playIcon, enterSongFM, fmPlayOrPause, fmPlayNext, fmRefresh } = useSongFM();

/** 当前曲目的歌手列表 */
const fmArtists = computed<MetaData[]>(() => {
  const artists = fmSong.value?.artists;
  return Array.isArray(artists) ? artists : [];
});

/** 当前曲目的专辑名 */
const fmAlbumName = computed<string>(() => {
  const album = fmSong.value?.album;
  if (!album) return "";
  return typeof album === "string" ? album : (album.name ?? "");
});

/**
 * 卡片点击：进入刷歌并打开全屏播放器
 *
 * 刷歌没有独立页面，入口形态与网易云「私人漫游」一致：开全屏播放器。
 */
const handleEnter = async () => {
  if (!(await enterSongFM())) {
    window.$message.error("开启刷歌出错，请重试");
  }
};
</script>

<style lang="scss" scoped>
.song-fm {
  position: relative;
  width: 100%;
  height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 16px;
  overflow: hidden;
  cursor: pointer;
  :deep(.n-card-content) {
    display: flex;
    align-items: center;
    padding: 20px;
    width: 100%;
  }
  .cover {
    width: 160px;
    height: 160px;
    min-width: 160px;
    border-radius: 8px;
    margin-right: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    box-shadow: 0 0 10px 6px #00000008;
    :deep(img) {
      width: 100%;
      height: 100%;
      opacity: 0;
      transition: opacity 0.35s ease-in-out;
    }
  }
  .cover-loading {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    .loading-img {
      width: 60%;
      height: 60%;
      object-fit: cover;
    }
  }
  .info {
    height: 100%;
    display: flex;
    flex-direction: column;
    .title-line {
      .name {
        display: block;
      }
    }
    .n-text {
      line-height: normal;
    }
    .name {
      font-size: 22px;
      font-weight: bold;
    }
    .artists {
      margin-top: 2px;
      font-size: 14px;
      display: flex;
      .n-icon {
        font-size: 18px;
        margin-right: 4px;
        transform: translateY(3px);
      }
      .ar {
        display: inline-flex;
        transition: opacity 0.3s;
        opacity: 0.6;
        &::after {
          content: "/";
          margin: 0 4px;
        }
        &:last-child {
          &::after {
            display: none;
          }
        }
      }
    }
    .album {
      font-size: 14px;
      .n-icon {
        font-size: 18px;
        margin-right: 4px;
        transform: translateY(3px);
      }
      .album-text {
        transition: opacity 0.3s;
        opacity: 0.6;
      }
    }
    .menu {
      margin-top: auto;
      .play {
        width: 46px;
        height: 46px;
        .n-icon {
          color: var(--primary-hex);
          transition: opacity 0.1s ease-in-out;
        }
      }
      .menu-icon {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 38px;
        height: 38px;
        border-radius: 50%;
        color: var(--primary-hex);
        transition:
          background-color 0.3s,
          transform 0.3s;
        cursor: pointer;
        &:hover {
          transform: scale(1.1);
          background-color: rgba(var(--primary), 0.08);
        }
        &:active {
          transform: scale(1);
        }
      }
    }
  }
  .radio {
    position: absolute;
    right: 20px;
    bottom: 14px;
    display: flex;
    align-items: center;
    .n-icon {
      margin-right: 4px;
      transform: translateY(-1px);
    }
  }
  &:hover {
    border-color: rgba(var(--primary), 0.6);
  }
  @media (max-width: 1200px) and (min-width: 769px) {
    .radio {
      display: none;
    }
  }
  @media (max-width: 768px) {
    --s: var(--home-card-scale, 1);
    height: max(100px, calc(120px * var(--s)));
    :deep(.n-card-content) {
      padding: max(10px, calc(20px * var(--s)));
      align-items: flex-start;
    }
    .cover {
      min-width: max(48px, calc(80px * var(--s)));
      height: max(48px, calc(80px * var(--s)));
      width: max(48px, calc(80px * var(--s)));
      margin-right: max(8px, calc(20px * var(--s)));
    }
    .info {
      .title-line {
        display: flex;
        align-items: center;
        min-width: 0;
        .name {
          flex-shrink: 0;
        }
      }
      .name {
        font-size: max(12px, calc(16px * var(--s)));
      }
      .artists {
        margin-top: 0;
        margin-left: max(4px, calc(8px * var(--s)));
        flex: 1;
        min-width: 0;
        overflow: hidden;
        font-size: max(10px, calc(14px * var(--s)));
      }
      .album {
        display: none;
      }
      .menu {
        margin-top: 8px;
        .play {
          width: 36px;
          height: 36px;
          .n-icon {
            font-size: 28px !important;
          }
        }
        .menu-icon {
          width: 26px;
          height: 26px;
        }
      }
    }
    .radio {
      font-size: max(10px, calc(12px * var(--s)));
    }
  }
}
</style>
