<template>
  <div class="comment-view">
    <div class="comment-header">
      <!-- 返回按钮 -->
      <div class="back-btn" @click="goBack">
        <SvgIcon name="Left" :size="24" />
      </div>
      <s-image v-if="songId" :src="musicStore.getSongCover('s')" class="comment-cover" />
      <div class="comment-info">
        <div class="name text-hidden">{{ songName }}</div>
        <div class="artist text-hidden">{{ artistName }}</div>
      </div>
    </div>
    <div class="comment-main">
      <ListComment v-if="songId" :id="songId" :type="songType" height="auto" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRouter, useRoute } from "vue-router";
import { useMusicStore, useSettingStore } from "@/stores";
import { computed } from "vue";
import ListComment from "@/components/List/ListComment.vue";
import { removeBrackets } from "@/utils/format";

const router = useRouter();
const route = useRoute();
const musicStore = useMusicStore();
const settingStore = useSettingStore();

// 从路由参数获取歌曲信息
const songId = computed(() => {
  const id = route.params.id;
  if (typeof id === 'string') {
    return parseInt(id);
  }
  return id as number;
});

const songType = computed<0 | 1 | 7 | 2 | 3 | 4 | 5 | 6>(() => {
  const type = route.query.type;
  if (typeof type === 'string') {
    return parseInt(type) as 0 | 1 | 7 | 2 | 3 | 4 | 5 | 6;
  }
  return 0; // 默认歌曲类型
});

const songName = computed(() => {
  const name = route.query.name as string;
  if (settingStore.hideLyricBrackets && name) {
    return removeBrackets(name);
  }
  return name || "未知歌曲";
});

const artistName = computed(() => {
  return (route.query.artist as string) || "未知艺术家";
});

// 返回
const goBack = () => {
  router.back();
};
</script>

<style lang="scss" scoped>
.comment-view {
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100%;
  padding-top: env(safe-area-inset-top, 0px);
  background-color: var(--n-color);
  .comment-header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px 24px;
    flex-shrink: 0;
    width: 100%;
    border-bottom: 1px solid var(--n-border-color);
    .back-btn {
      width: 40px;
      height: 40px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      cursor: pointer;
      transition: background-color 0.2s;
      flex-shrink: 0;
      &:active {
        background-color: var(--n-border-color);
      }
      .n-icon {
        color: var(--n-text-color);
      }
    }
    .comment-cover {
      width: 50px;
      height: 50px;
      flex-shrink: 0;
      :deep(img) {
        border-radius: 8px;
        width: 100%;
        height: 100%;
      }
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    }
    .comment-info {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      justify-content: center;
      .name {
        font-size: 16px;
        font-weight: bold;
        margin-bottom: 4px;
        color: var(--n-text-color);
      }
      .artist {
        font-size: 12px;
        color: var(--n-text-color-2);
      }
    }
  }
  .comment-main {
    flex: 1;
    min-height: 0;
    width: 100%;
    overflow: hidden;
    position: relative;
    display: flex;
    flex-direction: column;
    // 评论颜色与时间戳一致，使用 var(--n-text-color-3)
    :deep(.list-comment) {
      height: 100%;
      width: 100%;
      .comment-container {
        height: 100% !important;
      }
      // 标题使用主文本颜色
      .title {
        color: var(--n-text-color) !important;
        span {
          color: var(--n-text-color) !important;
        }
        .n-icon {
          color: var(--n-text-color) !important;
        }
      }
    }
    // 评论列表颜色设置
    :deep(.comment-list) {
      .comments {
        .data {
          .content {
            // 用户名和评论内容使用与时间戳一致的颜色
            .name {
              color: var(--n-text-color-3) !important;
            }
            .text {
              color: var(--n-text-color-3) !important;
            }
          }
          .reply {
            .name {
              color: var(--n-text-color-3) !important;
            }
            .text {
              color: var(--n-text-color-3) !important;
            }
          }
          .meta {
            .n-text {
              color: var(--n-text-color-3) !important;
            }
            .n-icon {
              color: var(--n-text-color-3) !important;
            }
          }
        }
      }
      // 加载更多按钮
      .load-more {
        .n-button {
          color: var(--n-text-color) !important;
          :deep(.n-button__content) {
            color: var(--n-text-color) !important;
          }
        }
      }
      // 空状态
      .n-empty {
        .n-empty__description {
          color: var(--n-text-color-2) !important;
        }
      }
      // 骨架屏
      .n-skeleton {
        background-color: var(--n-color-fill) !important;
      }
    }
  }
}
</style>
