<!-- 榜单详情 -->
<template>
  <div class="toplist-detail">
    <!-- 榜单信息 -->
    <div ref="headerRef" class="header">
      <div class="bar">
        <n-button class="back" :focusable="false" quaternary @click="handleBack">
          <template #icon>
            <SvgIcon name="NavigateBefore" :size="20" />
          </template>
          返回
        </n-button>
        <n-text v-if="groupName" class="group" depth="3">{{ groupName }}</n-text>
      </div>
      <div class="main">
        <!-- 封面 -->
        <div class="cover">
          <n-image
            :src="cover"
            :preview-src="cover"
            :previewed-img-props="{ style: { borderRadius: '12px' } }"
          >
            <template #placeholder>
              <div class="cover-loading">
                <img src="/images/album.jpg?asset" class="loading-img" alt="loading-img" />
              </div>
            </template>
          </n-image>
        </div>
        <!-- 标题 -->
        <div class="info">
          <div class="name text-hidden">{{ title }}</div>
          <n-text v-if="subTitle" class="sub-title text-hidden">{{ subTitle }}</n-text>
          <n-flex class="meta" align="center" :size="12">
            <n-text depth="3">{{ total }} 首</n-text>
            <n-text v-if="period" depth="3">{{ period }} 期</n-text>
            <n-text v-if="updateTime" depth="3">{{ updateTime }}</n-text>
          </n-flex>
          <div class="menu">
            <n-flex class="left" align="center" :size="12">
              <n-button
                class="play"
                :focusable="false"
                :disabled="!songs.length"
                type="primary"
                strong
                secondary
                round
                @click="playAll"
              >
                <template #icon>
                  <SvgIcon name="Play" />
                </template>
                播放全部
              </n-button>
              <!-- 更多操作 -->
              <n-dropdown
                v-if="moreOptions.length"
                :options="moreOptions"
                trigger="click"
                placement="bottom-start"
              >
                <n-button :focusable="false" class="more" circle strong secondary>
                  <template #icon>
                    <SvgIcon name="List" />
                  </template>
                </n-button>
              </n-dropdown>
            </n-flex>
            <!-- 模糊搜索 -->
            <n-input
              v-if="songs.length"
              :value="searchValue"
              :input-props="{ autocomplete: 'off' }"
              class="search"
              placeholder="模糊搜索"
              clearable
              round
              @update:value="handleSearch"
            >
              <template #prefix>
                <SvgIcon name="Search" />
              </template>
            </n-input>
          </div>
        </div>
      </div>
    </div>
    <!-- 榜单曲目 -->
    <SongList
      v-if="!searchValue || displayData.length"
      :data="displayData"
      :loading="loading"
      :loadMore="hasMore"
      :height="listHeight"
      @reachBottom="loadMoreSongs"
      disabledSort
    />
    <n-empty
      v-else
      :description="`搜不到关于 ${searchValue} 的任何歌曲呀`"
      class="empty"
      size="large"
    >
      <template #icon>
        <SvgIcon name="SearchOff" />
      </template>
    </n-empty>
  </div>
</template>

<script setup lang="ts">
import SvgIcon from "@/components/Global/SvgIcon.vue";
import SongList from "@/components/List/SongList.vue";
import { usePlayerController } from "@/core/player/PlayerController";
import type { SongType } from "@/types/main";
import type { ApiPlatform } from "@/types/shared";
import type { DropdownOption } from "naive-ui";
import type { PlatformLeaderboardBoard } from "@/api/platform/types";
import {
  dispatchLeaderboardDetail,
  dispatchLeaderboardGroups,
} from "@/api/platform/dispatch";
import { useListActions } from "@/composables/List/useListActions";
import { useListSearch } from "@/composables/List/useListSearch";
import { renderIcon } from "@/utils/helper";
import { openBatchList } from "@/utils/modal";
import { formatTimestamp } from "@/utils/time";
import { onPlatformChange, usePlatformStore, useStatusStore } from "@/stores";
import { useDebounceFn, useElementSize } from "@vueuse/core";
import { onBeforeRouteUpdate } from "vue-router";

const route = useRoute();
const router = useRouter();
const statusStore = useStatusStore();
const platformStore = usePlatformStore();
const player = usePlayerController();
const { playAllSongs: playAllSongsAction } = useListActions();

/** 榜单详情每页曲目数 */
const PAGE_SIZE = 100;

/** 头部高度兜底值（头部实测高度就绪前用于估算列表高度） */
const DEFAULT_HEADER_HEIGHT = 220;

/** 榜单号 */
const boardId = computed<number>(() => Number(route.query.id) || 0);

/**
 * 榜单所属平台
 *
 * 链接参数优先，缺省取当前音源平台；
 * 网易云没有分组榜单，此时页面无可取的数据源。
 */
const boardPlatform = computed<ApiPlatform>(() => {
  const platform = route.query.platform as string | undefined;
  if (platform === "qqmusic" || platform === "kugou") return platform;
  return platformStore.currentPlatform;
});

/** 是否为提供分组榜单的平台（QQ 音乐 / 酷狗） */
const isBoardPlatform = computed<boolean>(() => boardPlatform.value !== null);

/** 榜单条目（清单数据，带期数、更新时间等元信息） */
const board = ref<PlatformLeaderboardBoard | null>(null);

/** 榜单曲目 */
const songs = ref<SongType[]>([]);

/** 榜单曲目的模糊搜索 */
const { searchValue, displayData, clearSearch, performSearch } = useListSearch(songs);

/** 当前已加载到第几页 */
const boardPage = ref<number>(1);

/**
 * 是否还有下一页
 *
 * 平台一次给全量榜单曲目（无翻页概念）时为 undefined，
 * 列表据此不显示「没有更多」页脚。
 */
const hasMore = ref<boolean | undefined>(undefined);

/** 加载状态 */
const loading = ref<boolean>(false);

/** 详情返回的榜单信息（榜单清单找不到时以它兜底） */
const detailTitle = ref<string>("");
const detailSubTitle = ref<string>("");
const detailCover = ref<string>("");
const detailTotal = ref<number>(0);

/** 头部元素 */
const headerRef = ref<HTMLElement | null>(null);
const { height: headerHeight } = useElementSize(headerRef);

/**
 * 榜单曲目表高度
 *
 * 曲目表是虚拟列表，必须有确定高度才能渲染出内容，
 * 这里跟随主内容区高度自适应，给头部信息留出空间。
 */
const listHeight = computed<number>(() => {
  const contentHeight = statusStore.mainContentHeight || 720;
  return Math.max(240, contentHeight - (headerHeight.value || DEFAULT_HEADER_HEIGHT));
});

/** 榜单标题 */
const title = computed<string>(() => detailTitle.value || board.value?.title || "排行榜");

/** 榜单副标题 */
const subTitle = computed<string>(() => detailSubTitle.value || board.value?.subTitle || "");

/** 榜单封面 */
const cover = computed<string>(() => board.value?.cover || detailCover.value || "");

/** 榜单曲目总数 */
const total = computed<number>(() => detailTotal.value || board.value?.total || 0);

/** 榜单期数 */
const period = computed<string>(() => board.value?.period || "");

/** 榜单更新时间 */
const updateTime = computed<string>(() => formatTimestamp(board.value?.updateTime));

/** 榜单所属分组名 */
const groupName = computed<string>(() => board.value?.groupName || "");

/** 当前榜单标识（平台 + 榜单号） */
const boardKey = computed<string>(() => `${boardPlatform.value}:${boardId.value}`);

/** 已载入的榜单标识 */
const loadedKey = ref<string>("");

/**
 * 榜单详情请求序号
 *
 * 只有最后一次请求的结果会被采纳，避免连点时标题与曲目错位。
 */
let requestId = 0;

/**
 * 读取榜单详情
 *
 * 请求带序号守卫：先发后到的旧结果会被丢弃，
 * 列表内容始终与当前打开的榜单一致。
 * @param page 页码（从 1 开始）
 */
const loadDetail = async (page: number = 1) => {
  if (!boardId.value || !isBoardPlatform.value) return;
  const current = ++requestId;
  loading.value = true;
  try {
    const detail = await dispatchLeaderboardDetail(boardPlatform.value, {
      boardId: boardId.value,
      page,
      limit: PAGE_SIZE,
    });
    // 已有更新的请求，本次结果作废
    if (current !== requestId) return;
    songs.value = page === 1 ? detail.songs : [...songs.value, ...detail.songs];
    boardPage.value = page;
    hasMore.value = detail.hasMore;
    detailTitle.value = detail.title;
    detailSubTitle.value = detail.subTitle;
    detailCover.value = detail.cover;
    detailTotal.value = detail.total;
  } catch (error) {
    if (current !== requestId) return;
    console.error("获取榜单详情失败：", error);
    if (page === 1) {
      songs.value = [];
      hasMore.value = undefined;
      window.$message.error("加载失败，请重试");
    }
  } finally {
    if (current === requestId) loading.value = false;
  }
};

/**
 * 读取榜单元信息
 *
 * 清单按榜单号反查，用于补齐期数、更新时间与分组名；
 * 清单里查不到时以详情接口自带的标题与封面兜底。
 */
const loadBoardMeta = async () => {
  if (!isBoardPlatform.value) return;
  try {
    const groups = await dispatchLeaderboardGroups(boardPlatform.value);
    const found = groups
      .flatMap((group) => group.toplists)
      .find((item) => item.topId === boardId.value);
    if (found) board.value = found;
  } catch (error) {
    console.error("获取榜单清单失败：", error);
  }
};

/**
 * 加载当前榜单的下一页曲目
 *
 * 仅支持翻页的平台会给出「还有下一页」标记，触底时追加到当前列表。
 */
const loadMoreSongs = async () => {
  if (!hasMore.value || loading.value) return;
  await loadDetail(boardPage.value + 1);
};

/**
 * 返回上一页
 *
 * 从榜单清单页点进来时回到清单页，
 * 直接打开链接（刷新直达）时回到发现页排行榜。
 */
const handleBack = () => {
  const back = (router.options.history.state as { back?: string } | null)?.back;
  if (back) {
    router.back();
    return;
  }
  router.push({ name: "discover-toplists" });
};

/** 播放榜单全部曲目 */
const playAll = useDebounceFn(() => {
  if (!songs.value.length) return;
  playAllSongsAction(songs.value);
}, 300);

/**
 * 更多操作
 *
 * 与歌单详情页同形态：刷新缓存与批量操作。
 * @returns 更多操作菜单项
 */
const moreOptions = computed<DropdownOption[]>(() => [
  {
    label: "刷新缓存",
    key: "refresh",
    props: {
      onClick: () => loadBoard(),
    },
    icon: renderIcon("Refresh"),
  },
  {
    label: "批量操作",
    key: "batch",
    props: {
      onClick: () => openBatchList(displayData.value, false),
    },
    icon: renderIcon("Batch"),
  },
]);

/**
 * 处理模糊搜索
 * @param val 搜索关键词
 */
const handleSearch = (val: string) => {
  if ((!val || !val.trim()) && !searchValue.value) return;
  searchValue.value = val;
  performSearch(val);
};

/** 载入当前榜单 */
const loadBoard = () => {
  loadedKey.value = boardKey.value;
  requestId++;
  loading.value = false;
  songs.value = [];
  board.value = null;
  boardPage.value = 1;
  hasMore.value = undefined;
  detailTitle.value = "";
  detailSubTitle.value = "";
  detailCover.value = "";
  detailTotal.value = 0;
  clearSearch();
  void loadDetail(1);
  void loadBoardMeta();
};

// 链接参数变化：重新载入榜单
onBeforeRouteUpdate(() => {
  loadBoard();
});

// 从缓存恢复：链接指向的榜单变了就重新取数
// 页面被 KeepAlive 缓存时再次进入不会触发 onBeforeRouteUpdate，
// 只靠它会出现「标题与上一条榜单不一致」的问题。
onActivated(() => {
  if (loadedKey.value !== boardKey.value) loadBoard();
});

/**
 * 平台切换后按新平台处理榜单页
 *
 * 榜单号是平台内主键：路由钉住平台的榜单在切到别的平台后，
 * 那个榜单号在新平台下指向完全不同的榜单，留在原处显示的就不是当前平台的数据；
 * 未钉平台的榜单随当前平台走，重取即可。
 */
const stopPlatformWatch = onPlatformChange(({ platform }) => {
  // 页面被 KeepAlive 缓存：离开本页后仍会收到平台变更通知。
  // 此时按当前路由的平台参数判断，会把用户从别的页面弹走，故只在本页在前台时处理。
  if (router.currentRoute.value.name !== "toplist") return;
  const pinned = route.query.platform as string | undefined;
  if (pinned === "qqmusic" || pinned === "kugou") {
    if (pinned !== platform) {
      // 钉在别的平台的榜单：回到当前平台的排行榜列表
      router.push({ name: "discover-toplists" });
      return;
    }
    // 钉在当前平台的榜单：重取该榜单
    loadBoard();
    return;
  }
  // 未钉平台：榜单随当前平台走，按新平台重取
  loadBoard();
});

onMounted(() => {
  loadBoard();
});

onUnmounted(() => {
  stopPlatformWatch();
});
</script>

<style lang="scss" scoped>
.toplist-detail {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  .header {
    flex-shrink: 0;
    padding: 8px 0 16px;
    .bar {
      display: flex;
      align-items: center;
      gap: 12px;
      height: 34px;
      margin-bottom: 12px;
      .back {
        font-size: 13px;
        padding: 0 8px;
      }
      .group {
        font-size: 13px;
      }
    }
    .main {
      display: flex;
      align-items: center;
      .cover {
        width: 140px;
        height: 140px;
        margin-right: 16px;
        border-radius: 12px;
        overflow: hidden;
        flex-shrink: 0;
        @media (max-width: 600px) {
          width: 100px;
          height: 100px;
          margin-right: 12px;
        }
      }
      .info {
        flex: 1;
        min-width: 0;
        .name {
          font-size: 24px;
          font-weight: bold;
          line-height: 1.2;
          margin-bottom: 8px;
          @media (max-width: 600px) {
            font-size: 20px;
          }
        }
        .sub-title {
          display: block;
          font-size: 13px;
          margin-bottom: 8px;
        }
        .meta {
          font-size: 12px;
          margin-bottom: 12px;
        }
        // 操作区：播放与更多操作在左，模糊搜索在右
        .menu {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          .left {
            display: flex;
            align-items: center;
            gap: 8px;
          }
          .more {
            width: 40px;
            height: 40px;
          }
          .search {
            height: 40px;
            width: 110px;
            display: flex;
            align-items: center;
            border-radius: 25px;
            transition: all 0.3s var(--n-bezier);
            &.n-input--focus {
              width: 160px;
            }
          }
        }
      }
    }
  }
  // 曲目表占据头部以下的剩余空间
  :deep(.song-list) {
    flex: 1;
    min-height: 0;
  }
  .empty {
    margin-top: 60px;
  }
}
</style>
