<template>
  <div class="home-online">
    <!-- 登录功能 -->
    <div v-if="isLogin()" class="main-rec">
      <div class="main-rec-grid">
        <div class="rec-list">
          <!-- 每日推荐 -->
          <SongListCard
            :data="musicStore.dailySongsData.list"
            :title="dailySongsTitle"
            description="根据你的音乐口味 · 每日更新"
            size="small"
            vertical
            @click="router.push({ name: 'daily-songs' })"
          />
          <!-- 我喜欢的音乐 -->
          <SongListCard
            :data="dataStore.likeSongsList.data"
            :cover="likeSongsCover"
            title="我喜欢的音乐"
            description="发现你独特的音乐品味"
            size="small"
            vertical
            @click="router.push({ name: 'like-songs' })"
          />
        </div>
        <!-- 私人FM -->
        <PersonalFM />
      </div>
    </div>
    <!-- 公共推荐 -->
    <div v-for="(item, index) in sortedRecData" :key="index" class="rec-public">
      <n-flex
        class="title"
        align="center"
        justify="space-between"
        @click="router.push({ path: item.path ?? undefined })"
      >
        <n-h3 prefix="bar">
          <n-text>{{ item.name }}</n-text>
          <SvgIcon v-if="item.path" :size="26" name="Right" />
        </n-h3>
      </n-flex>
      <!-- 列表 -->
      <ArtistList v-if="item.type === 'artist'" :data="item.list" :loading="true" />
      <CoverList v-else :data="item.list" :type="item.type" :loading="true" />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ArtistType, CoverType } from "@/types/main";
import { NText } from "naive-ui";
import { useDataStore, useMusicStore, useSettingStore } from "@/stores";
import { newAlbumsAll, personalized, radarPlaylist, topArtists } from "@/api/rec";
import { allMv } from "@/api/video";
import { radioRecommend } from "@/api/radio";
import { getCacheData } from "@/utils/cache";
import { formatArtistsList, formatCoverList } from "@/utils/format";
import { sleep } from "@/utils/helper";
import { isLogin } from "@/utils/auth";
import SvgIcon from "@/components/Global/SvgIcon.vue";

interface RecItemTypeBase {
  name: string;
  path?: string;
}

interface RecItemArtist extends RecItemTypeBase {
  type: "artist";
  list: ArtistType[];
}

interface RecItemCover extends RecItemTypeBase {
  type: "playlist" | "video" | "radio" | "album";
  list: CoverType[];
}

interface RecDataType {
  playlist: RecItemCover;
  radar: RecItemCover;
  artist: RecItemArtist;
  video: RecItemCover;
  radio: RecItemCover;
  album: RecItemCover;
}

const router = useRouter();
const dataStore = useDataStore();
const musicStore = useMusicStore();
const settingStore = useSettingStore();

// 日推标题
const dailySongsTitle = computed(() => {
  const day = new Date().getDate();
  // 图标尺寸随大卡片比例联动（预览/缩放时保持协调）
  const scale = settingStore.homeCardScale / 100;
  return h("div", { class: "date" }, [
    h("div", { class: "date-icon" }, [
      h(SvgIcon, { name: "Calendar-Empty", size: Math.max(20, 30 * scale), depth: 2 }),
      h(NText, null, () => day),
    ]),
    h(NText, { class: "name text-hidden" }, () => ["每日推荐"]),
  ]);
});

// 我喜欢的音乐封面
const likeSongsCover = computed(() => {
  return dataStore.likeSongsList.detail?.cover || "/images/album.jpg?asset";
});

// 推荐数据
const recData = ref<RecDataType>({
  playlist: {
    name: isLogin() ? "专属歌单" : "推荐歌单",
    list: [] as CoverType[],
    type: "playlist",
    path: "/discover/playlists",
  },
  radar: {
    name: "雷达歌单",
    list: [] as CoverType[],
    type: "playlist",
  },
  artist: {
    name: "歌手推荐",
    list: [] as ArtistType[],
    type: "artist",
    path: "/discover/artists",
  },
  video: {
    name: "推荐 MV",
    list: [] as CoverType[],
    type: "video",
  },
  radio: {
    name: "推荐播客",
    list: [] as CoverType[],
    type: "radio",
  },
  album: {
    name: "新碟上架",
    list: [] as CoverType[],
    type: "album",
    path: "/discover/new",
  },
});

// 根据设置过滤和排序推荐数据
const sortedRecData = computed(() => {
  const sections = settingStore.homePageSections
    .filter((section) => section.visible)
    .sort((a, b) => a.order - b.order)
    .map((section) => {
      const key = section.key as keyof RecDataType;
      return recData.value[key];
    })
    .filter((item) => item);
  return sections;
});

// 获取全部推荐
const getAllRecData = async () => {
  try {
    // 延时
    await sleep(300);

    // 歌单
    try {
      const playlistRes = await getCacheData(
        personalized,
        { key: "playlistRec", time: 10 },
        "playlist",
        isLogin() ? 21 : 20,
      );
      recData.value.playlist.list = formatCoverList(
        playlistRes.result?.filter((pl: any) => !pl.name.includes("私人雷达")),
      );
    } catch (error) {
      console.error("Error getting playlist:", error);
    }

    // 雷达
    try {
      const radarRes = await getCacheData(radarPlaylist, { key: "radarRec", time: 30 });
      recData.value.radar.list = formatCoverList(radarRes);
    } catch (error) {
      console.error("Error getting radar:", error);
    }

    // 歌手
    try {
      const artistRes = await getCacheData(topArtists, { key: "artistRec", time: 10 }, 6);
      recData.value.artist.list = formatArtistsList(artistRes.artists);
    } catch (error) {
      console.error("Error getting artist:", error);
    }

    // MV
    try {
      const videoRes = await getCacheData(allMv, { key: "videoRec", time: 10 });
      recData.value.video.list = formatCoverList(videoRes.data);
    } catch (error) {
      console.error("Error getting video:", error);
    }

    // 播客
    try {
      const radioRes = await getCacheData(radioRecommend, { key: "radioRec", time: 10 });
      recData.value.radio.list = formatCoverList(radioRes.djRadios);
    } catch (error) {
      console.error("Error getting radio:", error);
    }

    // 新碟
    try {
      const albumRes = await getCacheData(newAlbumsAll, { key: "albumRec", time: 10 });
      recData.value.album.list = formatCoverList(albumRes.albums);
    } catch (error) {
      console.error("Error getting album:", error);
    }
  } catch (error) {
    window.$message.error("个性化推荐获取出错");
    console.error("Error getting personalized data:", error);
  }
};

// KeepAlive 激活时不再重新加载（数据已在内存中保留）
// 避免返回首页时数据重新加载导致的闪烁
// 如需手动刷新，用户可以下拉或重新进入页面

onMounted(() => {
  getAllRecData();
});
</script>

<style lang="scss" scoped>
.main-rec {
  .main-rec-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    // 间距随大卡片比例联动缩放，保持自然比例
    gap: calc(12px * var(--home-card-scale, 1));
  }
  .rec-list {
    display: flex;
    flex-direction: column;
    gap: calc(12px * var(--home-card-scale, 1));
  }
  .date {
    display: flex;
    align-items: center;
    margin-bottom: 4px;
    .date-icon {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-right: 4px;
      .n-text {
        position: absolute;
        // 日期数字随大卡片比例联动
        font-size: max(9px, calc(12px * var(--home-card-scale, 1)));
        color: var(--primary-hex);
        line-height: normal;
        margin-top: 4px;
        transform: scale(0.8);
      }
    }
    .name {
      // 标题字号随大卡片比例联动
      font-size: max(12px, calc(18px * var(--home-card-scale, 1)));
      font-weight: bold;
    }
  }
  @media (max-width: 768px) {
    .main-rec-grid {
      grid-template-columns: repeat(1, 1fr);
    }
    .rec-list {
      // 移动端：两个卡片并排居中，卡片宽度随比例缩放，
      // 卡片间距与两侧屏幕留白相等（三处空隙均衡），下限 12px 保证最小间距
      flex-direction: row;
      justify-content: center;
      gap: max(12px, calc((100% - 100% * var(--home-card-scale, 1)) / 3));
      > * {
        flex: 0 1 calc(50% * var(--home-card-scale, 1));
        min-width: 0;
      }
    }
  }
}
.title {
  margin-top: 20px;
  padding: 0 4px;
  width: max-content;
  .n-h {
    margin: 0;
    display: flex;
    align-items: center;
    cursor: pointer;
    .n-icon {
      opacity: 0;
      transform: translateX(4px);
      transition:
        opacity 0.3s,
        transform 0.3s;
    }
    &:hover {
      .n-icon {
        opacity: 1;
        transform: translateX(0);
      }
    }
  }
}
</style>
