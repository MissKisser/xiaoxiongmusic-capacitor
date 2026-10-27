<template>
  <div class="discover-toplists">
    <n-divider> 官方榜 </n-divider>
    <Transition name="fade" mode="out-in">
      <!-- 分组榜单（QQ 音乐 / 酷狗）：榜单清单 -->
      <div v-if="isGroupedSource" class="official-list">
        <n-grid v-if="boardGroups.length" cols="1 600:2 1000:3" x-gap="20" y-gap="20">
          <n-gi v-for="group in boardGroups" :key="group.groupId" span="1">
            <div class="board-group">
              <n-text class="group-name" depth="3">{{ group.groupName }}</n-text>
              <n-grid cols="1 600:2" x-gap="20" y-gap="20">
                <n-gi v-for="board in group.toplists" :key="board.topId">
                  <SongListCard
                    class="board-card"
                    :cover="board.cover"
                    :title="board.title || '排行榜'"
                    :height="160"
                    :description="board.subTitle || formatTimestamp(board.updateTime)"
                    size="normal"
                    @click="handleBoardClick(board)"
                  >
                    <template #info>
                      <div class="board-meta">
                        <!-- 曲目前览：与网易云榜单卡片同结构，清单源给出前几首时逐条显示 -->
                        <div
                          v-for="(song, songIndex) in board.tracks"
                          :key="songIndex"
                          class="song-item text-hidden"
                        >
                          <n-text class="name">{{ songIndex + 1 }}. {{ song.first }}</n-text>
                          <n-text class="desc" depth="3">{{ song.second }}</n-text>
                        </div>
                        <!-- 平台特有的曲目数与期数（附加项） -->
                        <n-flex class="meta-row" align="center" :size="12" gap="12">
                          <n-text class="desc" depth="3">{{ board.total }} 首</n-text>
                          <n-text v-if="board.period" class="desc" depth="3">
                            {{ board.period }} 期
                          </n-text>
                        </n-flex>
                      </div>
                    </template>
                  </SongListCard>
                </n-gi>
              </n-grid>
            </div>
          </n-gi>
        </n-grid>
        <n-grid v-else-if="groupsLoading" cols="1 600:2 1000:3" x-gap="20" y-gap="20">
          <n-gi v-for="item in 4" :key="item">
            <n-card class="loading">
              <n-skeleton class="cover" />
              <div class="desc">
                <n-skeleton text round :repeat="3" />
              </div>
            </n-card>
          </n-gi>
        </n-grid>
        <!-- 清单取数失败且无缓存可展示 -->
        <n-empty
          v-else
          description="排行榜加载失败，请重试"
          style="margin-top: 60px"
          size="large"
        >
          <template #icon>
            <SvgIcon name="SearchOff" />
          </template>
          <n-button type="primary" secondary strong round @click="loadBoardGroups">
            重新加载
          </n-button>
        </n-empty>
      </div>
      <!-- 网易云：官方榜 + 精选榜 -->
      <div v-else-if="topListData.official?.length > 0" class="official-list">
        <n-grid cols="1 600:2 1000:3" x-gap="20" y-gap="20">
          <n-gi v-for="(item, index) in topListData.official" :key="index">
            <SongListCard
              :cover="item.coverSize?.m || item.cover"
              :title="item.name"
              :height="160"
              :description="item.updateTip"
              size="normal"
              @click="router.push({ name: 'playlist', query: { id: item.id } })"
            >
              <template #info>
                <div
                  v-for="(song, songIndex) in item.tracks"
                  :key="songIndex"
                  class="song-item text-hidden"
                >
                  <n-text class="name">{{ songIndex + 1 }}. {{ song.first }}</n-text>
                  <n-text class="desc" depth="3">{{ song.second }}</n-text>
                </div>
              </template>
            </SongListCard>
          </n-gi>
        </n-grid>
      </div>
      <div v-else-if="loading" class="official-list">
        <n-grid cols="1 600:2 1000:3" x-gap="20" y-gap="20">
          <n-gi v-for="item in 4" :key="item">
            <n-card class="loading">
              <n-skeleton class="cover" />
              <div class="desc">
                <n-skeleton text round :repeat="3" />
              </div>
            </n-card>
          </n-gi>
        </n-grid>
      </div>
      <!-- 加载失败 -->
      <n-empty
        v-else
        description="排行榜加载失败，请重试"
        style="margin-top: 60px"
        size="large"
      >
        <template #icon>
          <SvgIcon name="SearchOff" />
        </template>
        <n-button type="primary" secondary strong round @click="getTopPlaylistData">
          重新加载
        </n-button>
      </n-empty>
    </Transition>
    <n-divider v-if="!isPlatformSource" style="margin-bottom: 0"> 精选榜 </n-divider>
    <CoverList
      v-if="!isPlatformSource"
      :data="topListData.selected"
      :loading="loading"
      type="playlist"
    />
  </div>
</template>

<script lang="ts">
import type { ApiPlatform } from "@/types/shared";
import type { PlatformLeaderboardBoard, PlatformLeaderboardGroup } from "@/api/platform/types";

/**
 * 榜单清单缓存
 *
 * 榜单详情是独立页面，清单页离开后组件会被销毁，
 * 这里按平台留住已取回的清单，返回清单页时直接复用。
 */
let boardGroupsCache: { platform: ApiPlatform; groups: PlatformLeaderboardGroup[] } | null = null;

/** 离开清单页时的滚动位置，返回清单页时恢复 */
let savedScrollTop = 0;
</script>

<script setup lang="ts">
import SvgIcon from "@/components/Global/SvgIcon.vue";
import SongListCard from "@/components/Card/SongListCard.vue";
import CoverList from "@/components/List/CoverList.vue";
import { topPlaylist } from "@/api/playlist";
import type { CoverType } from "@/types/main";
import { onPlatformChange, usePlatformStore } from "@/stores";
import { dispatchLeaderboardGroups } from "@/api/platform/dispatch";
import { formatCoverList } from "@/utils/format";
import { formatTimestamp } from "@/utils/time";

const router = useRouter();
const platformStore = usePlatformStore();

/** 提供分组榜单的平台（QQ 音乐 / 酷狗） */
const GROUPED_BOARD_PLATFORMS: ApiPlatform[] = ["qqmusic", "kugou"];

/** 滚动位置恢复的重试时长（毫秒） */
const RESTORE_RETRY_MS = 2000;

// 是否为第三方平台（QQ 音乐 / 酷狗）
const isPlatformSource = computed<boolean>(() => platformStore.currentPlatform !== "netease");

// 是否为提供分组榜单的平台（QQ 音乐 / 酷狗）
const isGroupedSource = computed<boolean>(() =>
  GROUPED_BOARD_PLATFORMS.includes(platformStore.currentPlatform),
);

// 排行榜数据
const topListData = ref<{
  official: CoverType[];
  selected: CoverType[];
}>({
  official: [],
  selected: [],
});

// 榜单清单（按分组）
const boardGroups = ref<PlatformLeaderboardGroup[]>([]);

// 榜单清单加载状态
const loading = ref<boolean>(true);
const groupsLoading = ref<boolean>(true);

/**
 * 获取主内容区的滚动容器
 *
 * 榜单清单页由主内容区滚动，滚动位置需要跨页面保留。
 * @returns 滚动容器
 */
const getScrollContainer = (): HTMLElement | null => {
  const mainContent = document.getElementById("main-content");
  return mainContent?.querySelector(".n-scrollbar-container") ?? null;
};

/**
 * 恢复离开清单页时的滚动位置
 *
 * 清单内容是异步加载的，内容高度就绪前设置滚动位置会被浏览器忽略，
 * 因此这里在短时间内持续重试，直到位置真正生效。
 */
const restoreScroll = () => {
  const target = savedScrollTop;
  if (!target) return;
  const deadline = Date.now() + RESTORE_RETRY_MS;
  const apply = () => {
    const container = getScrollContainer();
    if (container) container.scrollTop = target;
    if (Date.now() < deadline) requestAnimationFrame(apply);
  };
  apply();
};

/**
 * 点击榜单卡片：进入该榜单的独立详情页
 * @param board 榜单条目
 */
const handleBoardClick = (board: PlatformLeaderboardBoard) => {
  router.push({
    name: "toplist",
    query: { id: board.topId, platform: platformStore.currentPlatform },
  });
};

/**
 * 读取第三方平台的榜单清单
 */
const loadBoardGroups = async () => {
  const platform = platformStore.currentPlatform;
  groupsLoading.value = true;
  // 命中缓存时先渲染，避免返回清单页出现空白
  if (boardGroupsCache?.platform === platform) {
    boardGroups.value = boardGroupsCache.groups;
  }
  try {
    const groups = await dispatchLeaderboardGroups(platform);
    boardGroups.value = groups;
    boardGroupsCache = { platform, groups };
  } catch (error) {
    console.error("获取平台榜单清单失败：", error);
    window.$message.error("加载失败，请重试");
    if (!boardGroupsCache) boardGroups.value = [];
  } finally {
    groupsLoading.value = false;
  }
  await nextTick();
  restoreScroll();
};

/**
 * 读取网易云的官方榜与精选榜
 */
const getNeteaseTopPlaylist = async () => {
  loading.value = true;
  try {
    const result = await topPlaylist();
    // 区分榜单
    const official = formatCoverList(result.list?.filter((v: any) => v.ToplistType !== undefined));
    const selected = formatCoverList(result.list?.filter((v: any) => v.ToplistType === undefined));
    topListData.value = { official, selected };
  } catch (error) {
    console.error("获取排行榜数据失败", error);
    window.$message.error("加载失败，请重试");
  } finally {
    // 复位加载状态，避免失败后永久加载
    loading.value = false;
  }
};

// 获取排行榜数据
const getTopPlaylistData = async () => {
  // QQ 音乐 / 酷狗：只取榜单清单，榜单详情在独立页面展示
  if (isGroupedSource.value) {
    await loadBoardGroups();
    return;
  }
  await getNeteaseTopPlaylist();
};

// 平台切换：重新拉取榜单
const stopPlatformWatch = onPlatformChange(() => {
  getTopPlaylistData();
});

// 离开清单页：记住滚动位置
onBeforeRouteLeave(() => {
  savedScrollTop = getScrollContainer()?.scrollTop ?? 0;
});

onMounted(getTopPlaylistData);

onUnmounted(() => {
  stopPlatformWatch();
});
</script>

<style lang="scss" scoped>
.discover-toplists {
  .song-item {
    .desc {
      &::before {
        content: "-";
        margin: 0 4px;
      }
    }
  }
  .board-group {
    .group-name {
      display: block;
      font-size: 14px;
      margin-bottom: 12px;
    }
  }
  .board-meta {
    display: flex;
    flex-direction: column;
    gap: 4px;
    .meta-row {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .desc {
      font-size: 13px;
    }
  }
  .loading {
    height: 160px;
    border-radius: 12px;
    cursor: pointer;
    :deep(.n-card-content) {
      display: flex;
      height: 100%;
      padding: 16px;
    }
    .cover {
      height: 100%;
      width: auto;
      border-radius: 8px;
      aspect-ratio: 1/1;
      margin-right: 20px;
    }
    .desc {
      display: flex;
      flex-direction: column;
      justify-content: space-evenly;
      width: 100%;
      :deep(.n-skeleton) {
        height: 20px;
      }
    }
  }
}
</style>
