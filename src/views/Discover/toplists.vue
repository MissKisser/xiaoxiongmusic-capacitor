<template>
  <div class="discover-toplists">
    <n-divider> 官方榜 </n-divider>
    <Transition name="fade" mode="out-in">
      <div v-if="topListData.official?.length > 0" class="official-list">
        <n-grid cols="1 600:2 1000:3" x-gap="20" y-gap="20">
          <n-gi v-for="(item, index) in topListData.official" :key="index">
            <SongListCard
              :cover="item.coverSize?.m || item.cover"
              :title="item.name"
              :height="140"
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
    <n-divider style="margin-bottom: 0"> 精选榜 </n-divider>
    <CoverList :data="topListData.selected" :loading="loading" type="playlist" />
  </div>
</template>

<script setup lang="ts">
import { topPlaylist } from "@/api/playlist";
import type { CoverType } from "@/types/main";
import { formatCoverList } from "@/utils/format";

const router = useRouter();

// 排行榜数据
const loading = ref<boolean>(true);
const topListData = ref<{
  official: CoverType[];
  selected: CoverType[];
}>({
  official: [],
  selected: [],
});

// 获取排行榜数据
const getTopPlaylistData = async () => {
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

onMounted(getTopPlaylistData);
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
  .loading {
    height: 140px;
    border-radius: 12px;
    cursor: pointer;
    :deep(.n-card__content) {
      display: flex;
      height: 100%;
      padding: 12px;
    }
    .cover {
      height: 100%;
      width: auto;
      border-radius: 8px;
      aspect-ratio: 1/1;
      margin-right: 12px;
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
