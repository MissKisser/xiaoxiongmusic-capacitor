<!-- 收藏歌单列表（支持网易云与第三方音源平台） -->
<template>
  <div class="like-type">
    <!-- 分类 -->
    <n-flex class="type">
      <n-tag
        v-for="(item, index) in plTypeName"
        :key="index"
        :bordered="plTypeChoose === index"
        :type="plTypeChoose === index ? 'primary' : 'default'"
        round
        @click="changeType(index)"
      >
        {{ item }}
      </n-tag>
    </n-flex>
    <Transition name="fade" mode="out-in">
      <CoverList :key="plTypeChoose" :data="listData" :loading="loading" type="playlist" />
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import type { CoverType } from "@/types/main";
import { onAccountChange, onPlatformChange, useDataStore, usePlatformStore } from "@/stores";
import { PLATFORM_PLAYLIST_TYPE_QUERY } from "@/api/platform/capability";
import CoverList from "@/components/List/CoverList.vue";

const route = useRoute();
const router = useRouter();
const dataStore = useDataStore();
const platformStore = usePlatformStore();

// 是否为第三方平台（QQ 音乐 / 酷狗）
const isPlatformSource = computed<boolean>(() => platformStore.currentPlatform !== "netease");

// 加载状态
const loading = ref<boolean>(false);

// 歌单分类
const plTypeChoose = ref(0);
const plTypeName = ["我创建的", "我收藏的"];

/**
 * 第三方平台的歌单分组（由路由参数决定）
 */
const platformTypeIndex = computed<number>(() => {
  const type = String(route.query.type ?? "");
  const index = PLATFORM_PLAYLIST_TYPE_QUERY.findIndex((item) => item === type);
  return index >= 0 ? index : 0;
});

// 歌单列表内容
const listData = computed<CoverType[]>(() => {
  // 第三方平台：平台把自建与收藏分成两套目录，按当前分组取数
  if (isPlatformSource.value) {
    const list =
      plTypeChoose.value === 0 ? platformStore.playlists.owned : platformStore.playlists.favorites;
    return list.map((item) => ({
      id: item.id,
      name: item.name,
      cover: item.cover,
      coverSize: item.coverSize,
      count: item.count,
      playCount: item.playCount,
      description: item.description,
      creator: {
        id: 0,
        name: item.creatorName ?? "",
        avatarUrl: "",
      },
      createTime: item.createTime,
      updateTime: item.updateTime,
      platform: item.platform,
      platformId: item.platformId,
    }));
  }
  return (
    dataStore.userLikeData.playlists
      ?.filter((pl) =>
        plTypeChoose.value === 0
          ? pl.userId === dataStore.userData.userId
          : pl?.userId !== dataStore.userData.userId,
      )
      .slice(plTypeChoose.value === 0 ? 1 : 0) ?? []
  );
});

// 更换歌单类型
const changeType = (index: number) => {
  plTypeChoose.value = index;
  if (!isPlatformSource.value) return;
  router.replace({
    name: "like-playlists",
    query: { ...route.query, type: PLATFORM_PLAYLIST_TYPE_QUERY[index] },
  });
};

// 路由参数变化时同步分组
watch(
  () => route.query.type,
  () => {
    if (!isPlatformSource.value) return;
    plTypeChoose.value = platformTypeIndex.value;
  },
  { immediate: true },
);

// 平台切换：重新拉取当前平台的收藏歌单
const stopPlatformWatch = onPlatformChange(() => {
  loading.value = true;
  void platformStore.refreshPlaylists().finally(() => {
    loading.value = false;
  });
});

// 账号变更：重新拉取当前账号的收藏歌单
const stopAccountWatch = onAccountChange(({ platform }) => {
  if (platform !== platformStore.currentPlatform) return;
  loading.value = true;
  void platformStore.refreshPlaylists(platform).finally(() => {
    loading.value = false;
  });
});

onUnmounted(() => {
  stopPlatformWatch();
  stopAccountWatch();
});
</script>

<style lang="scss" scoped>
.type {
  margin-top: 20px;
  .n-tag {
    font-size: 14px;
    padding: 0 16px;
    &.choose {
      background-color: rgba(var(--primary), 0.14);
    }
  }
}
</style>
