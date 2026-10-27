<template>
  <div class="artist-type">
    <CoverList
      :data="albumData"
      :loading="loading"
      :loadMore="hasMore"
      type="album"
      @loadMore="loadMore"
    />
  </div>
</template>

<script setup lang="ts">
import CoverList from "@/components/List/CoverList.vue";
import type { CoverType } from "@/types/main";
import type { ApiPlatform } from "@/types/shared";
import { artistAblums } from "@/api/artist";
import { dispatchArtistDetail } from "@/api/platform/dispatch";
import { formatCoverList } from "@/utils/format";

const props = defineProps<{
  id: string;
  platform?: ApiPlatform | null;
}>();

// 歌曲数据
const loading = ref<boolean>(true);
const hasMore = ref<boolean>(true);
const albumData = ref<CoverType[]>([]);
const albumOffset = ref<number>(0);

// 单次取回的专辑数
const PAGE_SIZE = 50;

// 获取歌手全部专辑
const getArtistAllAlbums = async () => {
  try {
    if (!props.id) return;
    loading.value = true;
    // 第三方平台：走平台数据层
    if (props.platform) {
      const result = await dispatchArtistDetail(props.platform, {
        id: props.id,
        limit: 1,
        offset: albumOffset.value,
      });
      albumData.value = albumData.value.concat(result.albums);
      hasMore.value = false;
      loading.value = false;
      return;
    }
    // 获取数据
    const result = await artistAblums(Number(props.id), PAGE_SIZE, albumOffset.value);
    // 是否还有
    hasMore.value = result?.more;
    // 处理数据
    const listData = formatCoverList(result?.hotAlbums);
    albumData.value = albumData.value.concat(listData);
    loading.value = false;
  } catch (error) {
    console.error("Error getting artist all albums:", error);
    window.$message.error("加载失败，请重试");
    // 复位加载状态，避免失败后永久加载
    loading.value = false;
  }
};

// 加载更多
const loadMore = () => {
  if (hasMore.value) {
    albumOffset.value += PAGE_SIZE;
    getArtistAllAlbums();
  } else {
    loading.value = false;
  }
};

onMounted(getArtistAllAlbums);
</script>
