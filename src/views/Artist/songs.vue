<template>
  <div class="artist-songs">
    <SongList
      :data="songData"
      :loading="loading"
      disableHeightTransition
      loadMore
      @reachBottom="reachBottom"
      @scroll="emit('scroll', $event)"
    />
  </div>
</template>

<script setup lang="ts">
import SongList from "@/components/List/SongList.vue";
import type { SongType } from "@/types/main";
import type { ApiPlatform } from "@/types/shared";
import { artistAllSongs } from "@/api/artist";
import { songDetail } from "@/api/song";
import { dispatchArtistDetail } from "@/api/platform/dispatch";
import { formatSongsList } from "@/utils/format";
import { debounce } from "lodash-es";
import { usePlayerController } from "@/core/player/PlayerController";

const props = defineProps<{
  id: string;
  platform?: ApiPlatform | null;
}>();

const emit = defineEmits<{
  scroll: [e: Event];
}>();

const player = usePlayerController();

// 歌曲数据
const loading = ref<boolean>(true);
const hasMore = ref<boolean>(true);
const songData = ref<SongType[]>([]);
const songOffset = ref<number>(0);

// 单次取回的歌曲数
const PAGE_SIZE = 100;

// 获取歌手全部歌曲
const getArtistAllSongs = async () => {
  try {
    if (!props.id) return;
    loading.value = true;
    // 第三方平台：走平台数据层
    if (props.platform) {
      const result = await dispatchArtistDetail(props.platform, {
        id: props.id,
        limit: PAGE_SIZE,
        offset: songOffset.value,
      });
      songData.value = songData.value.concat(result.songs);
      hasMore.value = result.songs.length >= PAGE_SIZE;
      loading.value = false;
      return;
    }
    // 获取数据
    const result = await artistAllSongs(Number(props.id), PAGE_SIZE, songOffset.value);
    // 是否还有
    hasMore.value = result?.more;
    // 处理数据
    const ids: number[] = result?.songs.map((song: any) => song.id as number);
    const songs = await songDetail(ids);
    const songDetailData = formatSongsList(songs?.songs);
    songData.value = songData.value.concat(songDetailData);
    loading.value = false;
  } catch (error) {
    console.error("Error getting artist all songs:", error);
    window.$message.error("加载失败，请重试");
    // 复位加载状态，避免失败后永久加载
    loading.value = false;
  }
};

// 播放全部歌曲
const playAllSongs = debounce(() => {
  if (!songData.value || !songData.value?.length) return;
  player.updatePlayList(songData.value);
}, 300);

// 列表触底
const reachBottom = () => {
  if (hasMore.value) {
    songOffset.value += PAGE_SIZE;
    getArtistAllSongs();
  } else {
    loading.value = false;
  }
};

defineExpose({ playAllSongs, songData });

onMounted(getArtistAllSongs);
</script>
