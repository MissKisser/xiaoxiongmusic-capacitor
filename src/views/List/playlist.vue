<!-- 歌单列表：歌单详情（支持网易云、本地与第三方音源平台） -->
<template>
  <div class="playlist-list">
    <ListDetail
      :detail-data="isCurrentPlaylist ? detailData : null"
      :list-data="isCurrentPlaylist ? listData : []"
      :loading="showLoading"
      :list-scrolling="listScrolling"
      :search-value="searchValue"
      :config="listConfig"
      :play-button-text="playButtonText"
      :more-options="moreOptions"
      :hide-comment-tab="isLocalPlaylist || detailData?.privacy === 10 || isPlatformSource"
      @update:search-value="handleSearchUpdate"
      @play-all="playAllSongs"
      @tab-change="handleTabChange"
    >
      <template #action-buttons>
        <n-button
          v-if="isUserPlaylist && !isPlatformSource"
          :focusable="false"
          strong
          secondary
          round
          @click="updatePlaylist"
        >
          <template #icon>
            <SvgIcon name="EditNote" />
          </template>
          编辑歌单
        </n-button>
        <n-button
          v-else-if="!isPlatformSource"
          :focusable="false"
          strong
          secondary
          round
          @click="toLikePlaylist(playlistId, !isLikePlaylist)"
        >
          <template #icon>
            <SvgIcon :name="isLikePlaylist ? 'Favorite' : 'FavoriteBorder'" />
          </template>
          {{ isLikePlaylist ? "取消收藏" : "收藏歌单" }}
        </n-button>
        <!-- 第三方平台歌单：自建歌单可编辑，他人歌单可收藏 -->
        <n-button
          v-else-if="isPlatformOwnedPlaylist"
          :focusable="false"
          strong
          secondary
          round
          @click="updatePlaylist"
        >
          <template #icon>
            <SvgIcon name="EditNote" />
          </template>
          编辑歌单
        </n-button>
        <n-button
          v-else-if="!isPlatformLikedPlaylist"
          :focusable="false"
          strong
          secondary
          round
          @click="togglePlatformSubscribe"
        >
          <template #icon>
            <SvgIcon :name="isPlatformSubscribed ? 'Favorite' : 'FavoriteBorder'" />
          </template>
          {{ isPlatformSubscribed ? "取消收藏" : "收藏歌单" }}
        </n-button>
      </template>
    </ListDetail>
    <Transition name="fade" mode="out-in">
      <!-- 歌曲列表 -->
      <template v-if="currentTab === 'songs'">
        <!-- 平台歌单曲目不可读 -->
        <n-empty
          v-if="isUnsupportedPlaylist"
          :description="
            collectedSourceUnreadable
              ? '源歌单当前不可读（已删除或未公开）'
              : '该歌单类型暂不支持读取曲目'
          "
          style="margin-top: 60px"
          size="large"
        >
          <template #icon>
            <SvgIcon name="Music" />
          </template>
        </n-empty>
        <SongList
          v-else-if="!searchValue || searchData?.length"
          :data="isCurrentPlaylist ? displayData : []"
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
      </template>
      <!-- 评论 -->
      <template v-else>
        <ListComment :id="playlistId" :type="2" :height="songListHeight" />
      </template>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, onActivated, onDeactivated } from "vue";
import { useRouter, onBeforeRouteUpdate } from "vue-router";
import type { DropdownOption, MessageReactive } from "naive-ui";
import type { CoverType, SongType } from "@/types/main";
import type { ApiPlatform } from "@/types/shared";
import { songDetail } from "@/api/song";
import { playlistAllSongs, deletePlaylist, updatePlaylistPrivacy } from "@/api/playlist";
import { dispatchPlaylistDetail } from "@/api/platform/dispatch";
import {
  deletePlaylist as manageDeletePlaylist,
  isPlaylistSubscribed,
  subscribePlaylist,
} from "@/api/platform/manage";
import { formatSongsList } from "@/utils/format";
import { renderIcon, copyData } from "@/utils/helper";
import { isLogin, toLikePlaylist, updateUserLikePlaylist } from "@/utils/auth";
import { useDataStore, useLocalStore, usePlatformStore, onPlatformChange } from "@/stores";
import { openBatchList, openUpdatePlaylist } from "@/utils/modal";
import { uniqBy } from "lodash-es";
import { useLikedSongsSync } from "@/composables/useLikedSongsSync";
import type { LikedSongsChange } from "@/utils/likedEvents";
import { useListDetail } from "@/composables/List/useListDetail";
import { useListSearch } from "@/composables/List/useListSearch";
import { useListScroll } from "@/composables/List/useListScroll";
import { useListActions } from "@/composables/List/useListActions";
import { useListDataCache, type ListCacheData } from "@/composables/List/useListDataCache";
import { useDebounceFn } from "@vueuse/core";
import SvgIcon from "@/components/Global/SvgIcon.vue";
import ListDetail from "@/components/List/ListDetail.vue";
import SongList from "@/components/List/SongList.vue";
import ListComment from "@/components/List/ListComment.vue";

const router = useRouter();
const dataStore = useDataStore();
const localStore = useLocalStore();
const platformStore = usePlatformStore();

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
const { listScrolling, handleListScroll, resetScroll } = useListScroll();
const { playAllSongs: playAllSongsAction } = useListActions();
const { saveCache, loadCache, checkNeedsUpdate } = useListDataCache();

// 歌单 ID
const oldPlaylistId = ref<number>(0);
const playlistId = computed<number>(() => Number(router.currentRoute.value.query.id as string));

// 路由指定的音源平台（第三方平台歌单带 platform 参数，网易云原路径不带）
const routePlatform = computed<ApiPlatform | null>(() => {
  const platform = router.currentRoute.value.query.platform as string | undefined;
  return platform === "qqmusic" || platform === "kugou" ? platform : null;
});

// 是否为第三方平台歌单
const isPlatformSource = computed<boolean>(() => routePlatform.value !== null);

// 平台歌单标识
const platformPlaylistId = computed<string>(() => String(router.currentRoute.value.query.id ?? ""));

// 平台自建歌单目录号
const platformDirId = computed<number | undefined>(
  () => Number(router.currentRoute.value.query.dirId ?? 0) || undefined,
);

// 播放列表标识（平台歌单不参与网易云歌单写操作）
const listPlayListId = computed<number>(() => (isPlatformSource.value ? 0 : playlistId.value));

// 当前详情是否属于路由上的歌单
const isCurrentPlaylist = computed<boolean>(
  () => !!detailData.value && String(detailData.value.id) === String(playlistId.value),
);

// 平台歌单曲目不可读
const isUnsupportedPlaylist = computed<boolean>(
  () =>
    isPlatformSource.value &&
    !loading.value &&
    (detailData.value?.count ?? 0) > 0 &&
    listData.value.length === 0,
);

// 收藏歌单的源歌单不可读
const collectedSourceUnreadable = computed<boolean>(
  () => detailData.value?.sourceReadable === false,
);

// 当前正在请求的歌单 ID，用于防止竞态条件
const currentRequestId = ref<number>(0);

// 加载提示
const loadingMsg = ref<MessageReactive | null>(null);

// 列表高度：显式最小高度约束，防止 A-11 坍缩
const songListHeight = computed(() => Math.max(300, getSongListHeight(listScrolling.value)));

// 当前 tab
const currentTab = ref<"songs" | "comments">("songs");

// 是否为本地歌单
const isLocalPlaylist = computed(() => {
  return playlistId.value.toString().length === 16;
});

// 是否为用户歌单
const isUserPlaylist = computed(() => {
  if (isLocalPlaylist.value) return true;
  return detailData.value?.creator?.id === dataStore.userData?.userId;
});

// 是否处于收藏歌单
const isLikePlaylist = computed(() => {
  if (platformStore.currentPlatform !== "netease") return false;
  return dataStore.userLikeData.playlists.some((playlist) => playlist.id === detailData.value?.id);
});

// 平台歌单是否为自己创建（可写）
const isPlatformOwnedPlaylist = computed<boolean>(() => {
  if (!isPlatformSource.value || !routePlatform.value) return false;
  const id = platformPlaylistId.value;
  return platformStore.playlists.owned.some(
    (playlist) => String(playlist.platformId ?? playlist.id) === id && playlist.isLiked !== true,
  );
});

// 平台歌单是否为系统「我喜欢的音乐」（只读，不可编辑删除）
const isPlatformLikedPlaylist = computed<boolean>(() => {
  if (!isPlatformSource.value || !routePlatform.value) return false;
  const id = platformPlaylistId.value;
  return platformStore.playlists.owned.some(
    (playlist) => String(playlist.platformId ?? playlist.id) === id && playlist.isLiked === true,
  );
});

// 平台歌单的收藏（订阅）状态
const isPlatformSubscribed = ref<boolean>(false);

// 是否处于歌单页面
const isPlaylistPage = computed<boolean>(() => router.currentRoute.value.name === "playlist");

// 是否为相同歌单
const isSamePlaylist = computed<boolean>(() => oldPlaylistId.value === playlistId.value);

// 列表配置
const listConfig = computed(() => ({
  titleType: "normal" as const,
  showCoverMask: true,
  showPlayCount: !isLocalPlaylist.value,
  showArtist: false,
  showCreator: !isLocalPlaylist.value,
  showCount: false,
  searchAlign: "center" as const,
}));

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
  if (isPlatformSource.value) {
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
        label: "删除歌单",
        key: "delete",
        show: isPlatformOwnedPlaylist.value,
        props: {
          onClick: () => {
            toDeletePlaylist();
          },
        },
        icon: renderIcon("Delete"),
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
      show: !isLocalPlaylist.value,
      props: {
        onClick: () => getPlaylistDetail(playlistId.value, { getList: true, refresh: true }),
      },
      icon: renderIcon("Refresh"),
    },
    {
      label: "公开隐私歌单",
      key: "privacy",
      show: !isLocalPlaylist.value && detailData.value?.privacy === 10,
      props: { onClick: openPrivacy },
      icon: renderIcon("ListLockOpen"),
    },
    {
      label: "删除歌单",
      key: "delete",
      show: isUserPlaylist.value,
      props: {
        onClick: () => toDeletePlaylist(),
      },
      icon: renderIcon("Delete"),
    },
    {
      label: "批量操作",
      key: "batch",
      props: {
        onClick: () =>
          openBatchList(
            displayData.value,
            isLocalPlaylist.value,
            isUserPlaylist.value ? playlistId.value : undefined,
          ),
      },
      icon: renderIcon("Batch"),
    },
    {
      label: "复制分享链接",
      key: "copy",
      show: !isLocalPlaylist.value,
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
      show: !isLocalPlaylist.value,
      props: {
        onClick: () => {
          window.open(`https://music.163.com/#/playlist?id=${playlistId.value}`);
        },
      },
      icon: renderIcon("Link"),
    },
  ];
});

// 平台歌单定位信息
interface PlatformPlaylistTarget {
  id?: string;
  dirId?: number;
}

// 获取歌单基础信息
const getPlaylistDetail = async (
  id: number,
  options: { getList: boolean; refresh: boolean } = { getList: true, refresh: false },
  platform: ApiPlatform | null = routePlatform.value,
  target: PlatformPlaylistTarget = {},
) => {
  if (!id) return;
  currentRequestId.value = id;
  setLoading(true);
  const { getList, refresh } = options;
  clearSearch();
  if (!refresh && detailData.value?.id !== id) resetPlaylistData(getList);
  const isLocal = id.toString().length === 16;
  if (isLocal) handleLocalPlaylist(id);
  else if (platform) await handlePlatformPlaylist(platform, getList, target);
  else await handleOnlinePlaylist(id, getList, refresh);
};

// 重置歌单数据
const resetPlaylistData = (getList: boolean) => {
  setDetailData(null);
  if (getList) {
    setListData([]);
    resetScroll();
  }
};

// 获取本地歌单
const handleLocalPlaylist = (id: number) => {
  const result = localStore.getLocalPlaylistDetail(id);
  if (!result) {
    window.$message.error("本地歌单不存在");
    setLoading(false);
    return;
  }
  const { playlist, songs } = result;
  let cover = playlist.cover;
  if (!cover && songs.length > 0) {
    cover = songs[0].cover;
  }
  setDetailData({
    id: playlist.id,
    name: playlist.name,
    cover: cover || "/images/album.jpg?asset",
    description: playlist.description,
    count: playlist.songs.length,
    createTime: playlist.createTime,
    updateTime: playlist.updateTime,
  });
  setListData(songs);
  setLoading(false);
};

/**
 * 获取第三方平台歌单
 */
const handlePlatformPlaylist = async (
  platform: ApiPlatform,
  getList: boolean,
  target: PlatformPlaylistTarget = {},
) => {
  const pageSize = 300;
  const tracks: SongType[] = [];
  let detail: CoverType | null = null;
  let count = 0;
  let page = 1;
  const targetId = target.id ?? platformPlaylistId.value;
  const targetDirId = target.dirId ?? platformDirId.value;
  let tipChecked = false;
  let detailSet = false;
  let tipMessage: MessageReactive | null = null;

  const closeTip = () => {
    if (loadingMsg.value === tipMessage) loadingMsgShow(false);
  };
  try {
    do {
      const result = await dispatchPlaylistDetail(platform, {
        id: targetId,
        dirId: targetDirId,
        withTracks: getList,
        page,
        pageSize,
      });
      if (currentRequestId.value !== playlistId.value) {
        closeTip();
        return;
      }
      detail = result.detail;
      count = result.count;
      if (detail && !detailSet) {
        detailSet = true;
        setDetailData(detail);
      }
      if (getList && !tipChecked && count > 0) {
        tipChecked = true;
        loadingMsgShow(true, count);
        tipMessage = loadingMsg.value;
      }
      if (getList && result.tracks.length) {
        tracks.push(...result.tracks);
        appendListData(result.tracks);
      }
      page += 1;
      if (!getList || result.tracks.length === 0 || tracks.length >= count) break;
    } while (page <= 50);
    setLoading(false);
  } catch (error) {
    console.error("获取平台歌单失败：", error);
    setLoading(false);
    window.$message.error("获取歌单失败，请重试");
  } finally {
    closeTip();
  }
};

/**
 * 重新读取平台「我喜欢的音乐」歌单的曲目
 */
const reloadPlatformLikedTracks = async (platform: ApiPlatform) => {
  const pageSize = 300;
  const tracks: SongType[] = [];
  let detail: CoverType | null = null;
  let count = 0;
  let page = 1;
  do {
    const result = await dispatchPlaylistDetail(platform, {
      id: platformPlaylistId.value,
      dirId: platformDirId.value,
      withTracks: true,
      page,
      pageSize,
    });
    detail = result.detail;
    count = result.count;
    tracks.push(...result.tracks);
    page += 1;
    if (result.tracks.length === 0 || tracks.length >= count) break;
  } while (page <= 50);
  setListData(uniqBy(tracks, "id"));
  setDetailData(detail);
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
};

/**
 * 红心变更后实时更新平台「我喜欢的音乐」歌单
 */
const stopLikedSync = useLikedSongsSync({
  platform: () => routePlatform.value ?? "netease",
  shouldHandle: () => isPlatformLikedPlaylist.value,
  applyChange: applyLikedChange,
  currentTracks: () => listData.value,
  reload: async () => {
    if (!routePlatform.value || !isPlatformLikedPlaylist.value) return;
    await reloadPlatformLikedTracks(routePlatform.value);
  },
});

// 获取在线歌单
const handleOnlinePlaylist = async (id: number, getList: boolean, refresh: boolean) => {
  if (!refresh && getList) {
    const cached = await loadCache("playlist", id);
    if (cached) {
      setDetailData(cached.detail);
      setListData(cached.songs);
      setLoading(false);
      backgroundCheck(id, cached);
      return;
    }
  }

  const { detail: cover, privileges } = await dispatchPlaylistDetail("netease", {
    id,
    withTracks: false,
  });
  if (currentRequestId.value !== id) return;
  setDetailData(cover);
  const count = detailData.value?.count || 0;
  if (!getList || count === 0) {
    setLoading(false);
    return;
  }
  if (isLogin() === 1 && count === privileges?.length && count < 800) {
    const ids = privileges as number[];
    const result = await songDetail(ids);
    if (currentRequestId.value !== id) return;
    const songs = formatSongsList(result.songs);
    setListData(songs);
    saveCache("playlist", id, detailData.value!, songs);
  } else {
    await getPlaylistAllSongs(id, count, refresh);
  }
  if (currentRequestId.value !== id) return;
  setLoading(false);
};

// 后台检查更新
const backgroundCheck = async (id: number, cached: ListCacheData) => {
  try {
    const { detail: latestDetail } = await dispatchPlaylistDetail("netease", {
      id,
      withTracks: false,
    });
    if (currentRequestId.value !== id) return;

    if (checkNeedsUpdate(cached, latestDetail)) {
      console.log("Cache expired, refreshing...");
      handleOnlinePlaylist(id, true, true);
    }
  } catch (e) {
    console.error("Background check failed", e);
  }
};

// 获取网易云歌单全部歌曲
const getPlaylistAllSongs = async (
  id: number,
  count: number,
  refresh: boolean = false,
) => {
  setLoading(true);
  loadingMsgShow(!refresh, count);
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
      appendListData(songData);
    }
    offset += limit;
  } while (offset < count && isPlaylistPage.value && currentRequestId.value === id);
  if (currentRequestId.value !== id) {
    loadingMsgShow(false);
    return;
  }
  if (refresh) setListData(listDataArray);
  if (detailData.value && listDataArray.length > 0) {
    saveCache("playlist", id, detailData.value, listDataArray);
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
  playAllSongsAction(listData.value, isPlatformSource.value ? undefined : playlistId.value);
}, 300);

// 加载提示
const loadingMsgShow = (show: boolean = true, count?: number) => {
  if (show) {
    if (count && count <= 800) return;
    loadingMsg.value?.destroy();
    loadingMsg.value = window.$message.loading("该歌单歌曲数量过多，请稍等", {
      duration: 0,
      closable: true,
    });
  } else {
    loadingMsg.value?.destroy();
    loadingMsg.value = null;
  }
};

// 删除歌单
const toDeletePlaylist = async () => {
  if (!detailData.value || !playlistId.value) return;
  window.$dialog.warning({
    title: "删除歌单",
    content: "确认删除这个歌单？该操作无法撤销！",
    positiveText: "删除",
    negativeText: "取消",
    onPositiveClick: async () => {
      if (isLocalPlaylist.value) {
        const success = await localStore.deleteLocalPlaylist(playlistId.value);
        if (success) {
          window.$message.success("本地歌单删除成功");
          router.back();
        } else {
          window.$message.error("删除失败");
        }
        return;
      }
      if (isPlatformSource.value && routePlatform.value) {
        const result = await manageDeletePlaylist(routePlatform.value, platformPlaylistId.value);
        if (!result.ok) {
          window.$message.error(result.message || "歌单删除失败，请重试");
          return;
        }
        window.$message.success("歌单删除成功");
        router.back();
        return;
      }
      const result = await deletePlaylist(playlistId.value);
      if (result.code === 200) {
        window.$message.success("歌单删除成功");
        if (dataStore.userData.createdPlaylistCount) {
          dataStore.userData.createdPlaylistCount -= 1;
          await updateUserLikePlaylist();
        }
      }
    },
  });
};

// 收藏 / 取消收藏平台歌单
const togglePlatformSubscribe = async () => {
  if (!isPlatformSource.value || !routePlatform.value) return;
  const subscribed = !isPlatformSubscribed.value;
  const result = await subscribePlaylist(routePlatform.value, platformPlaylistId.value, subscribed);
  if (!result.ok) {
    window.$message.error(result.message || "收藏歌单失败，请重试");
    return;
  }
  isPlatformSubscribed.value = subscribed;
  window.$message.success(subscribed ? "收藏歌单成功" : "取消收藏歌单成功");
};

// 读取平台歌单的收藏状态
const loadPlatformSubscribeState = async (
  platform: ApiPlatform | null = routePlatform.value,
  id: string = platformPlaylistId.value,
) => {
  if (!platform) return;
  isPlatformSubscribed.value = await isPlaylistSubscribed(platform, id);
};

// 删除指定索引歌曲
const removeSong = async (ids: number[]) => {
  if (!listData.value) return;
  if (isLocalPlaylist.value) {
    const songIds = ids.map((id) => id.toString());
    const success = await localStore.removeSongsFromLocalPlaylist(playlistId.value, songIds);
    if (!success) {
      window.$message.error("删除失败");
      return;
    }
  }
  setListData(listData.value.filter((song) => !ids.includes(song.id)));
};

// 编辑歌单
const updatePlaylist = () => {
  if (!detailData.value || !playlistId.value) return;
  if (isPlatformSource.value && routePlatform.value) {
    openUpdatePlaylist(
      platformPlaylistId.value,
      detailData.value,
      () => getPlaylistDetail(playlistId.value, { getList: false, refresh: false }),
      routePlatform.value,
    );
    return;
  }
  openUpdatePlaylist(playlistId.value, detailData.value, () =>
    getPlaylistDetail(playlistId.value, { getList: false, refresh: false }),
  );
};

// 公开隐私歌单
const openPrivacy = async () => {
  if (detailData.value?.privacy !== 10) return;
  window.$dialog.warning({
    title: "公开隐私歌单",
    content: "确认公开这个歌单？该操作无法撤销！",
    positiveText: "公开",
    negativeText: "取消",
    onPositiveClick: async () => {
      const result = await updatePlaylistPrivacy(playlistId.value);
      if (result.code !== 200) return;
      if (detailData.value) detailData.value.privacy = 0;
      window.$message.success("歌单公开成功");
    },
  });
};

onBeforeRouteUpdate((to) => {
  const id = Number(to.query.id as string);
  if (id) {
    oldPlaylistId.value = id;
    const platform = to.query.platform as ApiPlatform | undefined;
    const source = platform === "qqmusic" || platform === "kugou" ? platform : null;
    getPlaylistDetail(id, { getList: true, refresh: false }, source, {
      id: to.query.id ? String(to.query.id) : undefined,
      dirId: Number(to.query.dirId ?? 0) || undefined,
    });
    void loadPlatformSubscribeState(source, to.query.id ? String(to.query.id) : undefined);
  }
});

onActivated(() => {
  if (oldPlaylistId.value === 0) {
    oldPlaylistId.value = playlistId.value;
  } else {
    oldPlaylistId.value = playlistId.value;
    getPlaylistDetail(playlistId.value, { getList: true, refresh: false });
  }
  void loadPlatformSubscribeState();
});

onDeactivated(() => loadingMsgShow(false));

// 平台切换后离开旧平台的歌单
const offPlatformChange = onPlatformChange(({ platform }) => {
  if (router.currentRoute.value.name !== "playlist") return;
  if (isLocalPlaylist.value) return;
  const shown = routePlatform.value ?? "netease";
  if (shown === platform) return;
  router.push({ name: "home" });
});

onUnmounted(() => {
  stopLikedSync();
  offPlatformChange();
  loadingMsgShow(false);
});

onMounted(() => {
  getPlaylistDetail(playlistId.value);
  void loadPlatformSubscribeState();
});
</script>
