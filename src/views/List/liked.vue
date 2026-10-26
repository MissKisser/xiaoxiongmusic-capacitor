<!-- 歌单列表：我喜欢的音乐（支持网易云与第三方音源平台） -->
<template>
  <div class="liked-list">
    <ListDetail
      :detail-data="detailData"
      :list-data="listData"
      :loading="showLoading"
      :list-scrolling="listScrolling"
      :search-value="searchValue"
      :config="listConfig"
      :play-button-text="playButtonText"
      :more-options="moreOptions"
      title-text="我喜欢的音乐"
      hide-comment-tab
      @update:search-value="handleSearchUpdate"
      @play-all="playAllSongs"
    />
    <Transition name="fade" mode="out-in">
      <SongList
        v-if="!searchValue || searchData?.length"
        :data="displayData"
        :loading="loading"
        :height="songListHeight"
        :playListId="listPlayListId"
        :doubleClickAction="searchData?.length ? 'add' : 'all'"
        @scroll="handleListScroll"
        @removeSong="removeSong"
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
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, onActivated, onDeactivated } from "vue";
import { useRouter } from "vue-router";
import type { DropdownOption, MessageReactive } from "naive-ui";
import type { CoverType, SongType } from "@/types/main";
import type { ApiPlatform } from "@/types/shared";
import { songDetail } from "@/api/song";
import { playlistAllSongs } from "@/api/playlist";
import { dispatchLikedSongs, dispatchPlaylistDetail } from "@/api/platform/dispatch";
import { formatSongsList } from "@/utils/format";
import { renderIcon, copyData } from "@/utils/helper";
import { isObject, uniqBy } from "lodash-es";
import { useDataStore, usePlatformStore, onAccountChange, onPlatformChange } from "@/stores";
import { openBatchList, openUpdatePlaylist } from "@/utils/modal";
import { isLogin, updateUserLikePlaylist } from "@/utils/auth";
import { useLikedSongsSync } from "@/composables/useLikedSongsSync";
import type { LikedSongsChange } from "@/utils/likedEvents";
import { useListDetail } from "@/composables/List/useListDetail";
import { useListSearch } from "@/composables/List/useListSearch";
import { useListScroll } from "@/composables/List/useListScroll";
import { useListActions } from "@/composables/List/useListActions";
import { useDebounceFn } from "@vueuse/core";
import SvgIcon from "@/components/Global/SvgIcon.vue";
import ListDetail from "@/components/List/ListDetail.vue";
import SongList from "@/components/List/SongList.vue";

const router = useRouter();
const dataStore = useDataStore();
const platformStore = usePlatformStore();

// 是否激活
const isActivated = ref<boolean>(false);

const { detailData, listData, loading, getSongListHeight, setDetailData, setListData, setLoading } =
  useListDetail();
const { searchValue, searchData, displayData, clearSearch, performSearch } =
  useListSearch(listData);
const { listScrolling, handleListScroll, resetScroll } = useListScroll();
const { playAllSongs: playAllSongsAction } = useListActions();

// 歌单 ID
const playlistId = computed<number>(() => Number(dataStore.userLikeData.playlists?.[0]?.id) || 0);

// 是否为第三方平台（QQ 音乐 / 酷狗）
const isPlatformSource = computed<boolean>(() => platformStore.currentPlatform !== "netease");

// 播放列表标识（平台歌单不参与网易云歌单写操作）
const listPlayListId = computed<number>(() => (isPlatformSource.value ? 0 : playlistId.value));

// 当前正在请求的歌单 ID，用于防止竞态条件
const currentRequestId = ref<number>(0);

// 第三方平台列表的请求序号，用于防止竞态条件
const platformRequestId = ref<number>(0);

/** 当前列表所属的平台 */
const listPlatform = ref<ApiPlatform | null>(null);

/** 网易云「我喜欢的音乐」缓存是否属于当前账号 */
const isNeteaseCacheValid = computed<boolean>(() => {
  const userId = dataStore.userData.userId;
  if (!userId) return false;
  return platformStore.accountKeyOf("netease") === String(userId);
});

// 加载提示
const loadingMsg = ref<MessageReactive | null>(null);

// 列表高度：增加显式尺寸约束（A-11 防坍缩）
const songListHeight = computed(() => Math.max(300, getSongListHeight(listScrolling.value)));

// 是否处于我喜欢页面
const isLikedPage = computed(() => router.currentRoute.value.name === "like-songs");

// 列表配置
const listConfig = {
  titleType: "normal" as const,
  showCoverMask: true,
  showPlayCount: true,
  showArtist: false,
  showCreator: true,
  showCount: false,
  searchAlign: "center" as const,
};

// 是否显示加载状态
const showLoading = computed(() => listData.value.length === 0 && loading.value);

// 播放按钮文本
const playButtonText = computed(() => {
  if (showLoading.value) {
    const loaded =
      listData.value.length === (detailData.value?.count || 0) ? 0 : listData.value.length;
    return `正在更新... (${loaded}/${detailData.value?.count || 0})`;
  }
  return "播放";
});

// 更多操作
const moreOptions = computed<DropdownOption[]>(() => {
  // 第三方平台：仅保留刷新与批量操作，其余为网易云专有写操作
  if (isPlatformSource.value) {
    return [
      {
        label: "刷新缓存",
        key: "refresh",
        props: {
          onClick: () => getPlatformLikedSongs(true),
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
    ];
  }
  return [
    {
      label: "刷新缓存",
      key: "refresh",
      props: {
        onClick: () => getPlaylistDetail(playlistId.value, { getList: true, refresh: true }),
      },
      icon: renderIcon("Refresh"),
    },
    {
      label: "编辑歌单",
      key: "edit",
      props: {
        onClick: () => {
          if (!detailData.value || !playlistId.value) return;
          openUpdatePlaylist(playlistId.value, detailData.value, () =>
            getPlaylistDetail(playlistId.value, { getList: false, refresh: false }),
          );
        },
      },
      icon: renderIcon("EditNote"),
    },
    {
      label: "批量操作",
      key: "batch",
      props: {
        onClick: () => openBatchList(displayData.value, false, playlistId.value),
      },
      icon: renderIcon("Batch"),
    },
    {
      label: "复制分享链接",
      key: "copy",
      props: {
        onClick: () =>
          copyData(
            `https://music.163.com/#/playlist?id=${playlistId.value}`,
            "已复制分享链接到剪贴板",
          ),
      },
      icon: renderIcon("Share"),
    },
    {
      label: "打开源页面",
      key: "open",
      props: {
        onClick: () => {
          window.open(`https://music.163.com/#/playlist?id=${playlistId.value}`);
        },
      },
      icon: renderIcon("Link"),
    },
  ];
});

// 获取歌单基础信息
const getPlaylistDetail = async (
  id: number,
  options: {
    getList: boolean;
    refresh: boolean;
  } = {
    getList: true,
    refresh: false,
  },
) => {
  if (!id) return;
  currentRequestId.value = id;
  setLoading(true);
  const { getList, refresh } = options;
  clearSearch();
  if (!refresh) resetPlaylistData(getList);
  await getPlaylistData(id, getList, refresh);
};

// 重置歌单数据
const resetPlaylistData = (getList: boolean) => {
  setDetailData(null);
  if (getList) {
    setListData([]);
    resetScroll();
  }
};

// 获取歌单
const getPlaylistData = async (id: number, getList: boolean, refresh: boolean) => {
  loadLikedCache();
  try {
    const { detail: cover, privileges } = await dispatchPlaylistDetail("netease", {
      id,
      withTracks: false,
    });
    if (currentRequestId.value !== id) return;
    setDetailData(cover);
    if (!getList || detailData.value?.count === 0) {
      setLoading(false);
      return;
    }
    if (isLogin() === 1 && (detailData.value?.count as number) < 800) {
      const ids: number[] = privileges ?? [];
      const result = await songDetail(ids);
      if (currentRequestId.value !== id) return;
      setListData(uniqBy(formatSongsList(result.songs), "id"));
    } else {
      await getPlaylistAllSongs(id, detailData.value?.count || 0, refresh);
    }
    if (currentRequestId.value !== id) return;
    if (detailData.value) {
      dataStore.setLikeSongsList(detailData.value, listData.value);
    }
    listPlatform.value = "netease";
    setLoading(false);
  } catch (error) {
    console.error("获取我喜欢的音乐失败：", error);
    setLoading(false);
    window.$message.error("获取我喜欢的音乐失败，请重试");
  }
};

/**
 * 获取第三方平台的「我喜欢的音乐」
 * @param refresh 是否为刷新
 */
const getPlatformLikedSongs = async (refresh = false) => {
  const platform = platformStore.currentPlatform;
  const requestId = ++platformRequestId.value;
  const pageSize = 300;
  const tracks: SongType[] = [];
  let detail: CoverType | null = null;
  let count = 0;
  let page = 1;
  setLoading(true);
  clearSearch();
  if (!refresh) resetPlaylistData(true);
  const isStale = () =>
    platformRequestId.value !== requestId || platformStore.currentPlatform !== platform;
  try {
    do {
      const result = await dispatchLikedSongs(platform, { page, pageSize });
      if (isStale()) return;
      detail = result.detail;
      count = result.count;
      if (result.tracks.length) {
        tracks.push(...result.tracks);
        setListData(uniqBy(tracks, "id"));
      }
      page += 1;
      if (result.tracks.length === 0 || tracks.length >= count) break;
    } while (page <= 50);
    setDetailData(detail);
    setListData(uniqBy(tracks, "id"));
    listPlatform.value = platform;
    syncLikedState(platform, tracks);
    setLoading(false);
  } catch (error) {
    if (isStale()) return;
    console.error("获取平台喜欢歌曲失败：", error);
    setLoading(false);
    window.$message.error("获取我喜欢的音乐失败，请重试");
  }
};

/**
 * 同步第三方平台的红心状态到全局喜欢集合
 */
const syncLikedState = (platform: ApiPlatform, tracks: SongType[]) => {
  if (platformStore.currentPlatform !== platform) return;
  platformStore.setLikedSongs(platform, tracks);
};

/**
 * 把一次红心变更应用到本地列表（乐观更新）
 */
const applyLikedChange = (change: LikedSongsChange) => {
  const id = Number(change.song.id);
  if (!Number.isFinite(id)) return;
  const current = listData.value;
  const exists = current.some((track) => Number(track.id) === id);
  if (change.liked) {
    if (exists) return;
    setListData([change.song, ...current]);
  } else {
    if (!exists) return;
    setListData(current.filter((track) => Number(track.id) !== id));
  }
  const detail = detailData.value;
  if (detail) {
    setDetailData({
      ...detail,
      count: Math.max(0, (detail.count ?? 0) + (change.liked ? 1 : -1)),
    });
  }
  if (change.platform !== "netease") {
    platformStore.patchLikedSong(change.platform, id, change.liked);
  }
  if (change.platform === "netease" && detailData.value) {
    void dataStore.setLikeSongsList(detailData.value, listData.value);
  }
};

/**
 * 红心变更后实时更新「我喜欢的音乐」
 */
const stopLikedSync = useLikedSongsSync({
  platform: () => platformStore.currentPlatform,
  applyChange: applyLikedChange,
  currentTracks: () => listData.value,
  reload: async () => {
    if (isPlatformSource.value) {
      await getPlatformLikedSongs(true);
    } else {
      await getPlaylistDetail(playlistId.value, { getList: true, refresh: true });
    }
  },
});

// 加载缓存
const loadLikedCache = () => {
  if (!isNeteaseCacheValid.value) return;
  if (isObject(dataStore.likeSongsList.detail)) {
    setDetailData(dataStore.likeSongsList.detail);
  }
  if (dataStore.likeSongsList.data.length) {
    setListData(uniqBy(dataStore.likeSongsList.data, "id"));
  }
};

/** 检查网易云缓存是否需要更新 */
const checkNeedsUpdate = (): boolean => {
  if (!isNeteaseCacheValid.value) return true;
  const likedIds = dataStore.userLikeData.songs;
  const cachedIds = dataStore.likeSongsList.data.map((s) => s.id);
  if (likedIds.length !== cachedIds.length) return true;
  const likedSet = new Set(likedIds);
  return !cachedIds.every((id) => likedSet.has(id));
};

// 获取网易云歌单全部歌曲
const getPlaylistAllSongs = async (
  id: number,
  count: number,
  refresh: boolean = false,
) => {
  setLoading(true);
  loadingMsgShow(!refresh);
  let offset: number = 0;
  const limit: number = 500;
  const listDataArray: SongType[] = [];
  do {
    if (currentRequestId.value !== id) {
      loadingMsgShow(false);
      return;
    }
    const result = await playlistAllSongs(id, limit, offset);
    if (currentRequestId.value !== id) {
      loadingMsgShow(false);
      return;
    }
    const songData = formatSongsList(result.songs);
    listDataArray.push(...songData);
    if (!refresh) {
      const currentList = listData.value;
      setListData(uniqBy([...currentList, ...songData], "id"));
    }
    offset += limit;
  } while (offset < count && isLikedPage.value && currentRequestId.value === id);
  if (currentRequestId.value !== id) {
    loadingMsgShow(false);
    return;
  }
  if (refresh) setListData(uniqBy(listDataArray, "id"));
  loadingMsgShow(false);
};

// 处理搜索更新
const handleSearchUpdate = (val: string) => {
  searchValue.value = val;
  performSearch(val);
};

// 播放全部歌曲
const playAllSongs = useDebounceFn(() => {
  if (!detailData.value || !listData.value?.length) return;
  playAllSongsAction(listData.value, listPlayListId.value);
}, 300);

// 加载提示
const loadingMsgShow = (show: boolean = true) => {
  if (show) {
    loadingMsg.value?.destroy();
    loadingMsg.value = window.$message.loading("该歌单歌曲数量过多，请稍等", {
      duration: 0,
      closable: true,
    });
  } else {
    setLoading(false);
    loadingMsg.value?.destroy();
    loadingMsg.value = null;
  }
};

// 删除指定索引歌曲
const removeSong = (ids: number[]) => {
  if (!listData.value) return;
  setListData(listData.value.filter((song) => !ids.includes(song.id)));
};

/** 加载当前平台的「我喜欢的音乐」 */
const loadData = async (refresh = false) => {
  if (isPlatformSource.value) {
    await getPlatformLikedSongs(refresh);
    return;
  }
  if (!dataStore.userLikeData.playlists?.length) {
    try {
      await updateUserLikePlaylist();
    } catch (error) {
      console.error("Failed to update user playlist data:", error);
      setLoading(false);
      return;
    }
  }
  const likedPlaylistId = dataStore.userLikeData.playlists?.[0]?.id;
  if (likedPlaylistId) {
    await getPlaylistDetail(Number(likedPlaylistId), { getList: true, refresh });
  } else {
    const data: any = await dataStore.getUserLikePlaylist();
    const id = data?.detail?.id;
    if (id) {
      await getPlaylistDetail(id, { getList: true, refresh });
    } else {
      setLoading(false);
      window.$message.error("无法获取我喜欢的音乐歌单");
    }
  }
};

onActivated(async () => {
  if (!isActivated.value) {
    isActivated.value = true;
    return;
  }
  if (isPlatformSource.value) {
    if (listPlatform.value !== platformStore.currentPlatform) {
      await loadData(false);
    }
    return;
  }
  const needsUpdate = checkNeedsUpdate();
  if (needsUpdate) {
    getPlaylistDetail(playlistId.value, { getList: true, refresh: true });
  }
});

onDeactivated(() => loadingMsgShow(false));

// 平台切换：清空旧列表并重新加载目标平台我喜欢
const stopPlatformWatch = onPlatformChange(() => {
  listData.value = [];
  detailData.value = null;
  loadData(false);
});

// 账号变更：清空旧列表并重新加载
const stopAccountWatch = onAccountChange(({ platform }) => {
  if (platform !== platformStore.currentPlatform) return;
  listData.value = [];
  detailData.value = null;
  loadData(false);
});

onUnmounted(() => {
  stopLikedSync();
  stopPlatformWatch();
  stopAccountWatch();
  loadingMsgShow(false);
});

onMounted(() => {
  loadData(false);
});
</script>
