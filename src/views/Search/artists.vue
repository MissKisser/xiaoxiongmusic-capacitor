<template>
  <div class="search-type">
    <Transition name="fade" mode="out-in">
      <ArtistList
        v-if="searchCount > 0"
        :data="searchResultData"
        :loading="loading"
        :loadMore="hasMore"
        @loadMore="loadMore"
      />
      <n-empty
        v-else
        :description="`很抱歉，未能找到与 ${keyword} 相关的任何歌手`"
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
import type { ArtistType } from "@/types/main";
import { dispatchSearch } from "@/api/platform/dispatch";
import { onPlatformChange, usePlatformStore } from "@/stores";

const props = defineProps<{
  keyword: string;
}>();

const platformStore = usePlatformStore();

// 搜索数据
const hasMore = ref<boolean>(true);
const loading = ref<boolean>(true);
const searchPage = ref<number>(1);
const searchCount = ref<number>(1);
const searchResultData = ref<ArtistType[]>([]);
// 请求序号：平台切换后丢弃旧平台的在途响应
const requestId = ref<number>(0);

// 获取搜索结果
const getSearchResult = async (reset: boolean = false) => {
  // 获取数据
  loading.value = true;
  if (reset) {
    searchPage.value = 1;
    searchResultData.value = [];
  }
  const currentId = ++requestId.value;
  try {
    const result = await dispatchSearch(platformStore.currentPlatform, {
      keyword: props.keyword,
      category: "artist",
      page: searchPage.value,
      limit: 50,
    });
    // 已被更新的请求取代时丢弃本次结果
    if (currentId !== requestId.value) return;
    // 是否还有
    hasMore.value = result.hasMore;
    // 搜索总数
    searchCount.value = result.total;
    // 处理数据
    searchResultData.value = searchResultData.value.concat(result.artists);
  } catch (error) {
    if (currentId !== requestId.value) return;
    console.error("获取搜索结果失败", error);
    window.$message.error("加载失败，请重试");
  } finally {
    // 复位加载状态，避免失败后永久加载
    if (currentId === requestId.value) {
      loading.value = false;
    }
  }
};

// 加载更多
const loadMore = () => {
  searchPage.value += 1;
  getSearchResult();
};

onMounted(() => {
  getSearchResult(true);
});

// 平台切换后清空当前结果并重搜
const stopPlatformWatch = onPlatformChange(() => {
  getSearchResult(true);
});

onUnmounted(() => {
  stopPlatformWatch();
});
</script>
