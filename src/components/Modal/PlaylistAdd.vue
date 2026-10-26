<!-- 添加到歌单 -->
<template>
  <div class="playlist-add">
    <!-- 在线歌曲只能添加到在线歌单 -->
    <template v-if="!isLocal">
      <n-scrollbar style="max-height: 70vh">
        <n-list class="playlists-list" hoverable clickable>
          <!-- 新建歌单 -->
          <n-list-item class="playlist add" @click="openCreatePlaylist">
            <template #prefix>
              <SvgIcon name="Add" :size="20" />
            </template>
            <n-thing title="创建新歌单" />
          </n-list-item>
          <!-- 已有歌单 -->
          <n-list-item
            v-for="(item, index) in onlinePlaylists"
            :key="index"
            class="playlist"
            @click="addToOnlinePlaylist(item)"
          >
            <template #prefix>
              <n-image
                :src="item.coverSmall || item.cover || '/images/album.jpg?asset'"
                class="cover"
                preview-disabled
                lazy
                @load="coverLoaded"
              >
                <template #placeholder>
                  <div class="cover-loading">
                    <img class="loading-img" src="/images/album.jpg?asset" alt="loading-img" />
                  </div>
                </template>
              </n-image>
            </template>
            <n-thing :title="item.name">
              <template #description>
                <n-text depth="3" class="size">{{ item.count }} 首音乐</n-text>
              </template>
            </n-thing>
          </n-list-item>
        </n-list>
      </n-scrollbar>
    </template>
    <!-- 本地歌曲只能添加到本地歌单 -->
    <template v-else>
      <n-scrollbar style="max-height: 70vh">
        <n-list class="playlists-list" hoverable clickable>
          <!-- 新建本地歌单 -->
          <n-list-item class="playlist add" @click="openCreatePlaylist(true)">
            <template #prefix>
              <SvgIcon name="Add" :size="20" />
            </template>
            <n-thing title="创建新歌单" />
          </n-list-item>
          <!-- 本地歌单列表 -->
          <template v-if="localPlaylists.length > 0">
            <n-list-item
              v-for="item in localPlaylists"
              :key="item.id"
              class="playlist"
              @click="addToLocalPlaylist(item.id)"
            >
              <template #prefix>
                <n-image
                  :src="item.cover || '/images/album.jpg?asset'"
                  class="cover"
                  preview-disabled
                  lazy
                  @load="coverLoaded"
                >
                  <template #placeholder>
                    <div class="cover-loading">
                      <img class="loading-img" src="/images/album.jpg?asset" alt="loading-img" />
                    </div>
                  </template>
                </n-image>
              </template>
              <n-thing :title="item.name">
                <template #description>
                  <n-text depth="3" class="size">{{ item.songs.length }} 首音乐</n-text>
                </template>
              </n-thing>
            </n-list-item>
          </template>
          <n-empty v-else description="暂无本地歌单" style="padding: 40px 0" />
        </n-list>
      </n-scrollbar>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted } from "vue";
import type { SongType } from "@/types/main";
import type { MessageReactive } from "naive-ui";
import { useDataStore, useLocalStore, usePlatformStore } from "@/stores";
import { coverLoaded } from "@/utils/helper";
import { playlistTracks } from "@/api/playlist";
import { debounce } from "lodash-es";
import { isLogin, updateUserLikePlaylist, updateUserLikeSongs } from "@/utils/auth";
import { openCreatePlaylist } from "@/utils/modal";
import {
  addSongsToPlaylist,
  getManageablePlaylists,
  likeSongs,
  type ManageablePlaylist,
} from "@/api/platform/manage";

const props = defineProps<{
  data: SongType[];
  isLocal: boolean;
}>();

const emit = defineEmits<{
  close: [];
}>();

const dataStore = useDataStore();
const localStore = useLocalStore();
const platformStore = usePlatformStore();

// 加载提示
const loadingMsg = ref<MessageReactive>();

// 当前音源平台
const currentPlatform = computed(() => platformStore.currentPlatform);

// 是否为第三方平台（QQ 音乐 / 酷狗）
const isPlatformSource = computed<boolean>(() => currentPlatform.value !== "netease");

// 在线歌单（网易云沿用既有本地缓存，第三方平台按平台拉取）
const onlinePlaylists = ref<ManageablePlaylist[]>([]);

// 本地歌单
const localPlaylists = computed(() => localStore.localPlaylists);

/**
 * 拉取当前平台的可管理歌单
 */
const loadOnlinePlaylists = async () => {
  if (isPlatformSource.value) {
    onlinePlaylists.value = await getManageablePlaylists(currentPlatform.value);
    return;
  }
  const userId = dataStore.userData?.userId;
  onlinePlaylists.value = (dataStore.userLikeData.playlists || [])
    .filter((playlist) => playlist.userId === userId)
    .map((playlist, index) => ({
      id: String(playlist.id),
      name: index === 0 ? "我喜欢的音乐" : playlist.name,
      cover: playlist.cover,
      coverSmall: playlist.coverSize?.s,
      count: playlist.count ?? 0,
      isLiked: index === 0,
    }));
};

// 添加到在线歌单
const addToOnlinePlaylist = debounce(
  async (playlist: ManageablePlaylist) => {
    // 网易云的 UID 登录模式不支持写操作
    if (!isPlatformSource.value && isLogin() === 2) {
      window.$message.warning("该登录模式暂不支持该操作");
      return;
    }
    const ids = props.data.map((item) => item.id).filter((item) => item !== 0);
    if (ids.length === 0) {
      window.$message.warning("没有可添加的歌曲");
      return;
    }
    loadingMsg.value = window.$message.loading("正在添加歌曲至歌单", { duration: 0 });
    // 第三方平台：走平台写操作分派层
    if (isPlatformSource.value) {
      const result = playlist.isLiked
        ? await likeSongs(currentPlatform.value, props.data, true)
        : await addSongsToPlaylist(currentPlatform.value, playlist.id, props.data);
      if (loadingMsg.value) loadingMsg.value.destroy();
      if (!result.ok) {
        window.$message.error(result.message || "添加失败，请重试");
        return;
      }
      emit("close");
      window.$message.success("添加歌曲至歌单成功");
      return;
    }
    // 网易云歌单
    try {
      const result = await playlistTracks(Number(playlist.id), ids);
      if (result?.code === 200) {
        emit("close");
        window.$message.success("添加歌曲至歌单成功");
        if (playlist.isLiked) await updateUserLikeSongs();
        await updateUserLikePlaylist();
      } else {
        window.$message.error(result?.msg || result?.message || "添加失败，请重试");
      }
    } catch (error) {
      console.error("❌ 添加歌曲至歌单失败:", error);
      window.$message.error("添加失败，请重试");
    } finally {
      if (loadingMsg.value) loadingMsg.value.destroy();
    }
  },
  500,
  { leading: true, trailing: false },
);

// 添加到本地歌单
const addToLocalPlaylist = debounce(
  async (playlistId: number) => {
    loadingMsg.value = window.$message.loading("正在添加歌曲至本地歌单", { duration: 0 });
    try {
      const songIds = props.data.map((item) => item.id.toString());
      const result = await localStore.addSongsToLocalPlaylist(playlistId, songIds);
      if (loadingMsg.value) loadingMsg.value.destroy();
      if (result.success) {
        emit("close");
        if (result.addedCount > 0) {
          window.$message.success(`成功添加 ${result.addedCount} 首歌曲至本地歌单`);
        } else {
          window.$message.info("所选歌曲已在歌单中");
        }
      } else {
        window.$message.error("添加失败，歌单不存在");
      }
    } catch (error) {
      if (loadingMsg.value) loadingMsg.value.destroy();
      window.$message.error("添加失败，请重试");
    }
  },
  500,
  { leading: true, trailing: false },
);

onMounted(() => {
  void loadOnlinePlaylists();
});

// 平台切换后重新拉取可管理歌单
watch(currentPlatform, () => {
  void loadOnlinePlaylists();
});
</script>

<style lang="scss" scoped>
.playlist-add {
  .playlists-list {
    background-color: transparent;
    .playlist {
      border-radius: 8px;
      cursor: pointer;
      padding: 6px 12px;
      margin-bottom: 4px;
      transition: background-color 0.3s;
      .cover {
        width: 48px;
        height: 48px;
        border-radius: 6px;
        overflow: hidden;
      }
      .cover-loading {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        background-color: rgba(var(--primary), 0.08);
        .loading-img {
          width: 50%;
          height: 50%;
          object-fit: cover;
        }
      }
      &.add {
        display: flex;
        align-items: center;
        :deep(.n-list-item__prefix) {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 48px;
          height: 48px;
          border-radius: 6px;
          background-color: rgba(var(--primary), 0.08);
          color: var(--primary-hex);
        }
      }
    }
  }
}
</style>
