<!-- 列表评论 -->
<template>
  <div ref="commentListRef" :class="['list-comment', { 'read-only': !canWrite }]">
    <div
      :style="{ height: height === 'auto' ? 'auto' : `${height || commentListHeight}px` }"
      class="comment-container"
    >
      <n-scrollbar class="comment-scroll">
        <div class="comment-content">
          <template v-if="commentHotData">
            <div class="placeholder">
              <div class="title">
                <SvgIcon name="Fire" />
                <span>热门评论</span>
              </div>
            </div>
            <CommentList
              :data="commentHotData"
              :loading="commentHotData?.length === 0"
              :type="type"
            />
          </template>
          <div class="placeholder">
            <div class="title">
              <SvgIcon name="Message" />
              <span>全部评论</span>
            </div>
          </div>
          <CommentList
            :data="commentData"
            :loading="commentLoading"
            :type="type"
            :load-more="commentHasMore"
            @load-more="handleLoadMore"
          />
          <div class="placeholder" />
        </div>
      </n-scrollbar>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { CommentType } from "@/types/main";
import type { ApiPlatform } from "@/types/shared";
import CommentList from "@/components/List/CommentList.vue";
import { useElementSize } from "@vueuse/core";
import { dispatchComments, dispatchHotComments } from "@/api/platform/dispatch";
import { onPlatformChange } from "@/stores";
import { isEmpty } from "lodash-es";

const props = withDefaults(
  defineProps<{
    // 资源 ID
    id: number;
    // 评论类型 0: 歌曲, 1: mv, 2: 歌单, 3: 专辑, 4: 电台节目, 5: 视频, 6: 动态, 7: 电台
    type: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
    // 高度
    height?: number | "auto"; // px
    // 音源平台
    platform?: ApiPlatform;
    // 平台内字符串主键（QQ 音乐 mid；酷狗评论用数字 id，不取该字段）
    platformId?: string;
  }>(),
  {
    platform: "netease",
  },
);

const commentListRef = ref<HTMLElement | null>(null);

// 列表高度
const { height: commentListHeight, stop: stopCalcHeight } = useElementSize(commentListRef);

// 第三方平台评论区只读（平台侧无评论点赞 / 回复写接口）
const canWrite = computed<boolean>(() => props.platform === "netease");

// 评论数据
const commentLoading = ref<boolean>(false);
const commentData = ref<CommentType[]>([]);
const commentHotData = ref<CommentType[] | null>(null);
const commentPage = ref<number>(1);
const commentHasMore = ref<boolean>(true);
// 评论游标（网易云为时间戳，平台为平台游标）
const commentCursor = ref<number | string | undefined>(undefined);

// 获取热门评论
const getHotCommentData = async () => {
  if (!props.id) return;
  try {
    const result = await dispatchHotComments(props.platform, {
      id: props.id,
      platformId: props.platformId,
      type: props.type,
      pageSize: 20,
    });
    commentHotData.value = result.comments?.length > 0 ? result.comments : null;
  } catch (error) {
    console.error("Error getting hot comment data:", error);
    commentHotData.value = null;
  }
};

// 获取评论数据
const getCommentData = async (clean: boolean = true) => {
  if (!props.id) return;
  try {
    commentLoading.value = true;
    if (clean) {
      commentData.value = [];
      commentPage.value = 1;
      commentHasMore.value = true;
      commentCursor.value = undefined;
    }
    // 获取热门评论
    await getHotCommentData();
    // 获取评论
    const result = await dispatchComments(props.platform, {
      id: props.id,
      platformId: props.platformId,
      type: props.type,
      page: commentPage.value,
      pageSize: 20,
      sortType: 3,
      cursor: commentCursor.value,
    });
    if (isEmpty(result.comments)) {
      commentHasMore.value = false;
      commentLoading.value = false;
      return;
    }
    // 处理数据
    commentData.value = commentData.value.concat(result.comments);
    // 记录游标
    commentCursor.value = result.cursor;
    // 是否还有
    commentHasMore.value = result.hasMore;
    commentLoading.value = false;
  } catch (error) {
    console.error("Error getting comment data:", error);
    window.$message?.error("获取评论数据失败");
    commentLoading.value = false;
  }
};

// 加载更多评论
const handleLoadMore = () => {
  if (!commentHasMore.value || commentLoading.value) return;
  commentPage.value += 1;
  getCommentData(false);
};

// 重置评论数据并重新拉取
const resetAndReload = () => {
  commentData.value = [];
  commentHotData.value = null;
  commentPage.value = 1;
  commentHasMore.value = true;
  commentCursor.value = undefined;
  getCommentData();
};

// 监听 id 变化，重置评论数据
watch(
  () => props.id,
  (newId) => {
    if (newId) {
      resetAndReload();
    }
  },
  { immediate: true },
);

// 平台切换后重新拉取评论
const stopPlatformWatch = onPlatformChange(() => {
  resetAndReload();
});

// 如果高度是 auto，停止计算高度
watch(
  () => props.height,
  (newHeight) => {
    if (newHeight === "auto") stopCalcHeight();
  },
  { immediate: true },
);

// 组件卸载时停止高度计算与平台监听
onBeforeUnmount(() => {
  stopCalcHeight();
  stopPlatformWatch();
});
</script>

<style lang="scss" scoped>
.list-comment {
  height: 100%;
  .title {
    display: flex;
    align-items: center;
    font-size: 18px;
    font-weight: bold;
    margin-bottom: 12px;
    .n-icon {
      margin-right: 8px;
      font-size: 20px;
    }
  }
  // 第三方平台评论区只读：隐藏点赞等写操作入口
  &.read-only {
    :deep(.like) {
      display: none;
    }
  }
}
</style>
