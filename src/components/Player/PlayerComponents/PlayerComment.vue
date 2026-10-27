<!-- 播放器 - 评论 -->
<template>
  <div :class="['player-comment', { 'read-only': !canWrite }]">
    <n-flex :wrap="false" align="center" class="song-data">
      <n-image
        :src="musicStore.songCover"
        :alt="musicStore.songCover"
        class="cover-img"
        preview-disabled
        @load="coverLoaded"
      >
        <template #placeholder>
          <div class="cover-loading">
            <img src="/images/song.jpg?asset" class="loading-img" alt="loading-img" />
          </div>
        </template>
      </n-image>
      <n-flex :size="2" class="song-info" vertical>
        <span class="title text-hidden">{{ settingStore.hideLyricBrackets ? removeBrackets(musicStore.playSong.name) : musicStore.playSong.name }}</span>
        <span class="artist text-hidden">
          {{
            Array.isArray(musicStore.playSong.artists)
              ? musicStore.playSong.artists.map((item) => item.name).join(" / ")
              : String(musicStore.playSong.artists)
          }}
        </span>
      </n-flex>
      <n-flex
        class="close"
        align="center"
        justify="center"
        @click="statusStore.showPlayerComment = false"
      >
        <SvgIcon name="Music" :size="24" />
      </n-flex>
    </n-flex>
    <n-scrollbar ref="commentScroll" class="comment-scroll">
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
          :type="songType"
          transparent
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
        :type="songType"
        :loadMore="commentHasMore"
        transparent
        @loadMore="loadMoreComment"
      />
      <div class="placeholder" />
    </n-scrollbar>
  </div>
</template>

<script setup lang="ts">
import type { CommentType } from "@/types/main";
import type { ApiPlatform } from "@/types/shared";
import { useMusicStore, useStatusStore, useSettingStore, onPlatformChange } from "@/stores";
import { dispatchComments, dispatchHotComments } from "@/api/platform/dispatch";
import { isEmpty } from "lodash-es";
import { removeBrackets } from "@/utils/format";
import { NScrollbar } from "naive-ui";
import { coverLoaded } from "@/utils/helper";

const musicStore = useMusicStore();
const statusStore = useStatusStore();
const settingStore = useSettingStore();

const commentScroll = ref<InstanceType<typeof NScrollbar> | null>(null);

// 是否展示
const isShowComment = computed<boolean>(() => statusStore.showPlayerComment);

// 歌曲 id
const songId = computed<number>(() => musicStore.playSong.id);

// 音源平台
const songPlatform = computed<ApiPlatform>(() => musicStore.playSong.platform ?? "netease");

// 平台内字符串主键（QQ 音乐 mid；酷狗评论用数字 id，不取该字段）
const songPlatformId = computed<string | undefined>(() => musicStore.playSong.platformId);

// 第三方平台评论区只读（平台侧无评论点赞 / 回复写接口）
const canWrite = computed<boolean>(() => songPlatform.value === "netease");

// 歌曲类型
const songType = computed<0 | 1 | 7 | 2 | 3 | 4 | 5 | 6>(() =>
  musicStore.playSong.type === "radio" ? 4 : 0,
);

// 评论数据
const commentLoading = ref<boolean>(true);
const commentData = ref<CommentType[]>([]);
const commentHotData = ref<CommentType[] | null>([]);
const commentPage = ref<number>(1);
const commentHasMore = ref<boolean>(true);
// 评论游标（网易云为时间戳，平台为平台游标）
const commentCursor = ref<number | string | undefined>(undefined);

// 获取热门评论
const getHotCommentData = async () => {
  if (!songId.value) return;
  try {
    // 获取评论
    const result = await dispatchHotComments(songPlatform.value, {
      id: songId.value,
      platformId: songPlatformId.value,
      type: songType.value,
      pageSize: 20,
    });
    // 处理数据
    commentHotData.value = result.comments?.length > 0 ? result.comments : null;
    // 滚动到顶部
    commentScroll.value?.scrollTo({ top: 0, behavior: "smooth" });
  } catch (error) {
    console.error("获取热门评论失败", error);
    window.$message?.error("评论加载失败，请重试");
    // 失败时隐藏热门评论区域，避免空态展示骨架屏
    commentHotData.value = null;
  }
};

// 获取歌曲评论
const getAllComment = async () => {
  if (!songId.value) return;
  commentLoading.value = true;
  try {
    // 获取评论
    const result = await dispatchComments(songPlatform.value, {
      id: songId.value,
      platformId: songPlatformId.value,
      type: songType.value,
      page: commentPage.value,
      pageSize: 20,
      sortType: 3,
      cursor: commentCursor.value,
    });
    if (isEmpty(result.comments)) {
      commentHasMore.value = false;
      return;
    }
    // 处理数据
    commentData.value = commentData.value.concat(result.comments);
    // 记录游标
    commentCursor.value = result.cursor;
    // 是否还有
    commentHasMore.value = result.hasMore;
  } catch (error) {
    console.error("获取评论失败", error);
    window.$message?.error("评论加载失败，请重试");
  } finally {
    // 复位加载状态，避免失败后永久加载
    commentLoading.value = false;
  }
};

// 加载更多
const loadMoreComment = () => {
  commentPage.value += 1;
  getAllComment();
};

// 重置评论数据
const resetCommentData = () => {
  commentData.value = [];
  commentHotData.value = [];
  commentPage.value = 1;
  commentHasMore.value = true;
  commentCursor.value = undefined;
};

// 歌曲id变化
watch(
  () => songId.value,
  () => {
    resetCommentData();
    if (!isShowComment.value) return;
    getHotCommentData();
    getAllComment();
  },
);

// 平台切换后重新拉取评论
const stopPlatformWatch = onPlatformChange(() => {
  resetCommentData();
  if (!isShowComment.value) return;
  getHotCommentData();
  getAllComment();
});

// 是否展示
watch(
  () => isShowComment.value,
  (newVal) => {
    if (!newVal) return;
    // 若不存在数据，重新获取
    if (!commentData.value?.length) {
      getHotCommentData();
      getAllComment();
    }
  },
);

onMounted(() => {
  if (!isShowComment.value) return;
  getHotCommentData();
  getAllComment();
});

onBeforeUnmount(() => {
  stopPlatformWatch();
});
</script>

<style lang="scss" scoped>
.player-comment {
  position: absolute;
  right: 0;
  width: 60%;
  flex: 1;
  width: 100%;
  height: calc(100vh - 160px);
  overflow: hidden;
  // 第三方平台评论区只读：隐藏点赞等写操作入口
  &.read-only {
    :deep(.like) {
      display: none;
    }
  }
  :deep(.n-text),
  :deep(.n-icon),
  :deep(.n-button) {
    color: rgb(var(--main-cover-color)) !important;
  }
  .song-data {
    height: 90px;
    margin: 0 60px 12px;
    padding: 0 16px;
    border-radius: 12px;
    background-color: rgba(var(--main-cover-color), 0.08);
    .cover-img {
      width: 60px;
      height: 60px;
      border-radius: 12px;
      margin-right: 4px;
    }
    .title {
      font-size: 20px;
      font-weight: bold;
    }
    .artist {
      opacity: 0.8;
    }
    .close {
      width: 40px;
      height: 40px;
      margin-left: auto;
      background-color: rgba(var(--main-cover-color), 0.08);
      border-radius: 8px;
      transition: background-color 0.3s;
      cursor: pointer;
      &:hover {
        background-color: rgba(var(--main-cover-color), 0.29);
      }
    }
  }
  :deep(.comment-scroll) {
    height: calc(100vh - 262px);
    filter: drop-shadow(0px 4px 6px rgba(0, 0, 0, 0.2));
    mask: linear-gradient(
      180deg,
      hsla(0, 0%, 100%, 0) 0,
      hsla(0, 0%, 100%, 0.6) 2%,
      #fff 5%,
      #fff 90%,
      hsla(0, 0%, 100%, 0.6) 95%,
      hsla(0, 0%, 100%, 0)
    );
    .n-scrollbar-content {
      padding: 0 60px;
    }
    .n-skeleton {
      background-color: rgba(var(--main-cover-color), 0.08);
    }
  }
  .comment-list {
    margin: 0 auto;
    :deep(.comments) {
      .text {
        &::selection {
          color: rgb(var(--main-cover-color));
          background-color: rgba(var(--main-cover-color), 0.2);
        }
      }
    }
  }
  .placeholder {
    width: 100%;
    height: 100px;
    padding-bottom: 20px;
    display: flex;
    align-items: flex-end;
    &:last-child {
      height: 0;
      padding-top: 50%;
    }
    .title {
      display: flex;
      align-items: center;
      font-size: 22px;
      font-weight: bold;
      .n-icon {
        margin-right: 6px;
      }
    }
  }
}
</style>
