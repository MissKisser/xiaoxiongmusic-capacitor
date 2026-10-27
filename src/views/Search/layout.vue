<template>
  <div class="search">
    <div class="title">
      <n-text class="keyword">{{ searchKeyword }}</n-text>
      <n-text depth="3">的相关搜索</n-text>
    </div>
    <!-- 标签页 -->
    <n-tabs v-model:value="searchType" class="tabs" type="segment" @update:value="tabChange">
      <n-tab v-for="tab in visibleTabs" :key="tab.name" :name="tab.name">
        {{ tab.label }}
      </n-tab>
    </n-tabs>
    <!-- 路由 -->
    <RouterView v-slot="{ Component }">
      <Transition :name="`router-${settingStore.routeAnimation}`" mode="out-in">
        <!-- max=3 限制缓存实例数量，避免每个搜索词累积页面实例导致内存增长 -->
        <KeepAlive v-if="settingStore.useKeepAlive" :max="3">
          <component
            :is="Component"
            :key="route.fullPath"
            :keyword="searchKeyword"
            class="router-view"
          />
        </KeepAlive>
        <component
          v-else
          :is="Component"
          :key="route.fullPath"
          :keyword="searchKeyword"
          class="router-view"
        />
      </Transition>
    </RouterView>
  </div>
</template>

<script setup lang="ts">
import { onPlatformChange, usePlatformStore, useSettingStore } from "@/stores";

const route = useRoute();
const router = useRouter();
const settingStore = useSettingStore();
const platformStore = usePlatformStore();

// 搜索关键词
const searchKeyword = computed(() => route.query.keyword as string);

// 搜索分类
const searchType = ref<string>("search-songs");

/** 搜索结果分类标签 */
interface SearchTab {
  /** 路由名 */
  name: string;
  /** 标签文案 */
  label: string;
  /** 是否为网易云独有能力（视频 / 播客） */
  neteaseOnly?: boolean;
}

/** 搜索结果分类标签表（顺序与既有页面一致） */
const SEARCH_TABS: SearchTab[] = [
  { name: "search-songs", label: "单曲" },
  { name: "search-playlists", label: "歌单" },
  { name: "search-artists", label: "歌手" },
  { name: "search-albums", label: "专辑" },
  { name: "search-videos", label: "视频", neteaseOnly: true },
  { name: "search-radios", label: "播客", neteaseOnly: true },
];

// 当前平台可见的标签（视频 / 播客为网易云独有能力，第三方平台隐藏）
const visibleTabs = computed<SearchTab[]>(() =>
  SEARCH_TABS.filter((tab) => !tab.neteaseOnly || platformStore.currentPlatform === "netease"),
);

// Tabs 改变
const tabChange = (value: string) => {
  router.push({
    name: value,
    query: {
      keyword: searchKeyword.value,
    },
  });
};

// 监听路由变化，同步 Tab 状态
watch(
  () => route.name,
  (name) => {
    if (name && name.toString().startsWith("search-")) {
      searchType.value = name as string;
    }
  },
  { immediate: true },
);

// 平台切换：当前所在标签在目标平台不可见时回到单曲
const stopPlatformWatch = onPlatformChange(() => {
  const name = route.name?.toString() ?? "";
  if (!name) return;
  if (visibleTabs.value.some((tab) => tab.name === name)) return;
  router.push({
    name: "search-songs",
    query: {
      keyword: searchKeyword.value,
    },
  });
});

onUnmounted(() => {
  stopPlatformWatch();
});
</script>

<style lang="scss" scoped>
.search {
  display: flex;
  flex-direction: column;
  height: 100%;
  .title {
    margin-top: 12px;
    margin-bottom: 12px;
    font-size: 22px;
    .keyword {
      font-size: 36px;
      font-weight: bold;
      margin-right: 8px;
      line-height: normal;
    }
    .n-text {
      display: inline-block;
    }
  }
  .router-view {
    flex: 1;
    overflow: hidden;
  }
}
</style>
