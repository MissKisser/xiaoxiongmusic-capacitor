<!-- 播客列表 / 酷狗听书专辑详情 -->
<template>
  <div class="radio-list">
    <ListDetail
      :detail-data="detailData?.id === radioId ? detailData : null"
      :list-data="detailData?.id === radioId ? listData : []"
      :loading="showLoading"
      :list-scrolling="listScrolling"
      :search-value="searchValue"
      :config="listConfig"
      :play-button-text="playButtonText"
      :more-options="moreOptions"
      :hide-comment-tab="isKugou"
      @update:search-value="handleSearchUpdate"
      @play-all="playAllSongs"
      @tab-change="handleTabChange"
    >
      <template #action-buttons>
        <n-button
          v-if="!isKugou"
          :focusable="false"
          strong
          secondary
          round
          @click="toSubRadio(radioId, !isLikeRadio)"
        >
          <template #icon>
            <SvgIcon :name="isLikeRadio ? 'Favorite' : 'FavoriteBorder'" />
          </template>
          {{ isLikeRadio ? "取消订阅" : "订阅播客" }}
        </n-button>
      </template>
    </ListDetail>
    <Transition name="fade" mode="out-in">
      <!-- 歌曲列表 -->
      <template v-if="currentTab === 'songs'">
        <SongList
          v-if="!searchValue || searchData?.length"
          :data="detailData?.id === radioId ? displayData : []"
          :loading="loading"
          :height="songListHeight"
          :radioId="radioId"
          :doubleClickAction="searchData?.length ? 'add' : 'all'"
          :load-more="isKugou ? audiobookHasMore : undefined"
          type="radio"
          @scroll="handleListScroll"
          @load-more="loadMoreChapters"
        />
        <n-empty
          v-else
          :description="`搜不到关于 ${searchValue} 的任何歌曲呀`"
          style="margin-top: 60px"
          size="large"
        >
          <template #icon>
            <SvgIcon name="SearchOff" />
          </template>
        </n-empty>
      </template>
      <!-- 评论 -->
      <template v-else>
        <ListComment :id="radioId" :type="7" :height="songListHeight" />
      </template>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, onActivated, onDeactivated } from "vue";
import { useRouter, onBeforeRouteUpdate } from "vue-router";
import type { DropdownOption, MessageReactive } from "naive-ui";
import { formatCoverList, formatSongsList } from "@/utils/format";
import { renderIcon, copyData } from "@/utils/helper";
import { useDataStore, onPlatformChange, usePlatformStore } from "@/stores";
import { radioAllProgram, radioDetail } from "@/api/radio";
import { kgAudiobookDetail } from "@/api/platform/kugouAudiobook";
import { useListDetail } from "@/composables/List/useListDetail";
import { useListSearch } from "@/composables/List/useListSearch";
import { useListScroll } from "@/composables/List/useListScroll";
import { useListActions } from "@/composables/List/useListActions";
import { toSubRadio } from "@/utils/auth";
import { useListDataCache, type ListCacheData } from "@/composables/List/useListDataCache";
import { useDebounceFn } from "@vueuse/core";
import SvgIcon from "@/components/Global/SvgIcon.vue";
import ListDetail from "@/components/List/ListDetail.vue";
import SongList from "@/components/List/SongList.vue";
import ListComment from "@/components/List/ListComment.vue";

const router = useRouter();
const dataStore = useDataStore();
const platformStore = usePlatformStore();

// 当前平台是否为酷狗（酷狗下该入口是听书）
const isKugou = computed<boolean>(() => platformStore.currentPlatform === "kugou");

const {
  detailData,
  listData,
  loading,
  getSongListHeight,
  setDetailData,
  setListData,
  appendListData,
  setLoading,
} = useListDetail();
const { searchValue, searchData, displayData, clearSearch, performSearch } =
  useListSearch(listData);
const { listScrolling, handleListScroll } = useListScroll();
const { playAllSongs: playAllSongsAction } = useListActions();
const { saveCache, loadCache, checkNeedsUpdate } = useListDataCache();

// 电台 ID
const oldRadioId = ref<number>(0);
const radioId = computed<number>(() => Number(router.currentRoute.value.query.id as string));

// 当前正在请求的播客 ID，用于防止竞态条件
const currentRequestId = ref<number>(0);

// 加载提示
const loadingMsg = ref<MessageReactive | null>(null);

// 列表高度：显式尺寸约束（A-11 防坍缩）
const songListHeight = computed(() => Math.max(300, getSongListHeight(listScrolling.value)));

// 当前 tab
const currentTab = ref<"songs" | "comments">("songs");

// 是否处于收藏播客
const isLikeRadio = computed(() => {
  return dataStore.userLikeData.djs.some((radio) => radio.id === detailData.value?.id);
});

// 是否处于播客页面
const isPlaylistPage = computed<boolean>(() => router.currentRoute.value.name === "radio");

// 是否为相同播客
const isSamePlaylist = computed<boolean>(() => oldRadioId.value === radioId.value);

// 列表配置
const listConfig = {
  titleType: "normal" as const,
  showCoverMask: false,
  showPlayCount: false,
  showArtist: false,
  showCreator: true,
  showCount: true,
  searchAlign: "center" as const,
};

// 是否显示加载状态
const showLoading = computed(() => listData.value.length === 0 && loading.value);

// 播放按钮文本
const playButtonText = computed(() => {
  if (showLoading.value) {
    if (isSamePlaylist.value) {
      return "更新中...";
    }
    const loaded =
      listData.value.length === (detailData.value?.count || 0) ? 0 : listData.value.length;
    return `加载中... (${loaded}/${detailData.value?.count || 0})`;
  }
  return "播放";
});

// 更多操作
const moreOptions = computed<DropdownOption[]>(() => {
  if (isKugou.value) {
    return [
      {
        label: "刷新听书专辑",
        key: "refresh",
        props: {
          onClick: () => getAudiobookDetail(radioId.value),
        },
        icon: renderIcon("Refresh"),
      },
    ];
  }
  return [
    {
      label: "刷新缓存",
      key: "refresh",
      props: {
        onClick: () => getRadioDetail(radioId.value, true),
      },
      icon: renderIcon("Refresh"),
    },
    {
      label: "复制分享链接",
      key: "copy",
      props: {
        onClick: () =>
          copyData(`https://music.163.com/#/djradio?id=${radioId.value}`, "已复制分享链接到剪贴板"),
      },
      icon: renderIcon("Share"),
    },
    {
      label: "打开源页面",
      key: "open",
      props: {
        onClick: () => {
          window.open(`https://music.163.com/#/djradio?id=${radioId.value}`);
        },
      },
      icon: renderIcon("Link"),
    },
  ];
});

// 酷狗听书：章节分页状态
const audiobookPage = ref<number>(1);
const audiobookHasMore = ref<boolean>(false);

// 酷狗听书每页章节数
const AUDIOBOOK_PAGE_SIZE = 30;

// 获取播客基础信息
const getRadioDetail = async (id: number, refresh: boolean = false) => {
  if (!id) return;
  if (isKugou.value) {
    await getAudiobookDetail(id);
    return;
  }
  currentRequestId.value = id;
  setLoading(true);
  clearSearch();

  // 1. 尝试读取缓存
  if (!refresh) {
    const cached = await loadCache("radio", id);
    if (cached) {
      setDetailData(cached.detail);
      setListData(cached.songs);
      setLoading(false);
      backgroundCheck(id, cached);
      return;
    }
  }

  // 获取播客详情
  if (detailData.value?.id !== id) {
    setDetailData(null);
  }
  try {
    const detail = await radioDetail(id);
    if (currentRequestId.value !== id) return;
    setDetailData(formatCoverList(detail.data)[0]);
    await getRadioAllProgram(id, detailData.value?.count as number);
  } catch (error) {
    console.error("Error getting radio detail:", error);
    window.$message.error("获取电台详情失败");
    loadingMsgShow(false);
  } finally {
    if (currentRequestId.value === id) setLoading(false);
  }
};

// 获取酷狗听书专辑详情与首屏章节
const getAudiobookDetail = async (id: number) => {
  if (!id) return;
  currentRequestId.value = id;
  setLoading(true);
  clearSearch();
  if (detailData.value?.id !== id) {
    setDetailData(null);
  }
  setListData([]);
  audiobookPage.value = 1;
  audiobookHasMore.value = false;
  try {
    const result = await kgAudiobookDetail(id, 1, AUDIOBOOK_PAGE_SIZE);
    if (currentRequestId.value !== id) return;
    setDetailData(result.detail);
    setListData(result.chapters);
    audiobookPage.value = 1;
    audiobookHasMore.value = result.hasMore;
  } catch (error) {
    console.error("Error getting kugou audiobook detail:", error);
    window.$message.error("获取听书专辑详情失败，请重试");
  } finally {
    if (currentRequestId.value === id) setLoading(false);
  }
};

// 加载更多酷狗听书章节
const loadMoreChapters = async () => {
  if (loading.value || !audiobookHasMore.value) return;
  const id = radioId.value;
  if (!id || currentRequestId.value !== id) return;
  const page = audiobookPage.value + 1;
  try {
    const result = await kgAudiobookDetail(id, page, AUDIOBOOK_PAGE_SIZE);
    if (currentRequestId.value !== id) return;
    audiobookPage.value = page;
    audiobookHasMore.value = result.hasMore;
    appendListData(result.chapters);
  } catch (error) {
    console.error("Error loading kugou audiobook chapters:", error);
  }
};

// 后台检查更新
const backgroundCheck = async (id: number, cached: ListCacheData) => {
  try {
    const detail = await radioDetail(id);
    if (currentRequestId.value !== id) return;

    const latestDetail = formatCoverList(detail.data)[0];

    if (checkNeedsUpdate(cached, latestDetail)) {
      console.log("Radio cache expired, refreshing...");
      getRadioDetail(id, true);
    }
  } catch (e) {
    console.error("Background check failed", e);
  }
};

// 获取播客全部节目
const getRadioAllProgram = async (id: number, count: number) => {
  setLoading(true);
  loadingMsgShow(true, count);
  let offset: number = 0;
  const limit: number = 500;
  const listDataArray: any[] = [];
  do {
    if (currentRequestId.value !== id) {
      loadingMsgShow(false);
      return;
    }
    const result = await radioAllProgram(id, limit, offset);
    if (currentRequestId.value !== id) {
      loadingMsgShow(false);
      return;
    }
    const songData = formatSongsList(result.programs);
    listDataArray.push(...songData);
    appendListData(songData);
    offset += limit;
  } while (offset < count && isPlaylistPage.value && currentRequestId.value === id);
  if (currentRequestId.value !== id) {
    loadingMsgShow(false);
    return;
  }
  setListData(listDataArray);
  if (detailData.value && listDataArray.length > 0) {
    saveCache("radio", id, detailData.value, listDataArray);
  }
  loadingMsgShow(false);
};

// 处理搜索更新
const handleSearchUpdate = (val: string) => {
  searchValue.value = val;
  performSearch(val);
};

// 处理 tab 切换
const handleTabChange = (value: "songs" | "comments") => {
  currentTab.value = value;
};

// 播放全部歌曲
const playAllSongs = useDebounceFn(() => {
  if (!detailData.value || !listData.value?.length) return;
  playAllSongsAction(listData.value, radioId.value);
}, 300);

// 加载提示
const loadingMsgShow = (show: boolean = true, count?: number) => {
  if (show) {
    if (count && count <= 800) return;
    loadingMsg.value?.destroy();
    loadingMsg.value = window.$message.loading("该播客节目数量过多，请稍等", {
      duration: 0,
      closable: true,
    });
  } else {
    loadingMsg.value?.destroy();
    loadingMsg.value = null;
  }
};

onBeforeRouteUpdate((to) => {
  const id = Number(to.query.id as string);
  if (id) {
    oldRadioId.value = id;
    getRadioDetail(id);
  }
});

onActivated(() => {
  if (oldRadioId.value === 0) {
    oldRadioId.value = radioId.value;
  } else {
    oldRadioId.value = radioId.value;
    getRadioDetail(radioId.value);
  }
});

onDeactivated(() => loadingMsgShow(false));

// 平台切换处理
const stopPlatformWatch = onPlatformChange(() => {
  if (router.currentRoute.value.name !== "radio") return;
  detailData.value = null;
  listData.value = [];
  getRadioDetail(radioId.value);
});

onUnmounted(() => {
  stopPlatformWatch();
  loadingMsgShow(false);
});

onMounted(() => getRadioDetail(radioId.value));
</script>
