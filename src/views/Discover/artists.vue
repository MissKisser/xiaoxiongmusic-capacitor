<template>
  <div class="discover-artists">
    <div v-if="!isPlatformSource" class="menu">
      <!-- 字母分类 -->
      <n-flex class="initial">
        <n-tag
          v-for="(item, index) in artistInitials"
          :key="index"
          :type="item.key === artistInitialChoose ? 'primary' : 'default'"
          :bordered="item.key === artistInitialChoose"
          round
          @click="artistQueryChange(item.key, artistTypeNamesChoose)"
        >
          {{ item.value }}
        </n-tag>
      </n-flex>
      <!-- 地区分类 -->
      <n-flex class="category">
        <n-tag
          v-for="(item, index) in artistTypeNames"
          :key="item"
          :type="index === artistTypeNamesChoose ? 'primary' : 'default'"
          :bordered="index === artistTypeNamesChoose"
          round
          @click="artistQueryChange(artistInitialChoose, index)"
        >
          {{ item }}
        </n-tag>
      </n-flex>
    </div>
    <!-- 平台歌手分类（上游分类清单：有则显示，无则整块隐藏） -->
    <div v-else-if="artistTypes.length" class="menu">
      <n-flex class="category">
        <n-tag
          v-for="(item, index) in artistTypes"
          :key="item.id"
          :type="index === artistTypeChoose ? 'primary' : 'default'"
          :bordered="index === artistTypeChoose"
          round
          @click="artistTypeChange(index)"
        >
          {{ item.name }}
        </n-tag>
      </n-flex>
    </div>
    <ArtistList :data="artistsData" :loading="loading" :loadMore="hasMore" @loadMore="loadMore" />
  </div>
</template>

<script setup lang="ts">
import ArtistList from "@/components/List/ArtistList.vue";
import type { ArtistType } from "@/types/main";
import { artistTypeList } from "@/api/artist";
import { onPlatformChange, usePlatformStore } from "@/stores";
import { dispatchHotArtists, type DispatchArtistType } from "@/api/platform/dispatch";
import { formatArtistsList } from "@/utils/format";

const router = useRouter();
const platformStore = usePlatformStore();

// 是否为第三方平台（QQ 音乐 / 酷狗）
const isPlatformSource = computed<boolean>(() => platformStore.currentPlatform !== "netease");

// 歌手标签数据
const artistInitials = [
  { key: -1, value: "热门" },
  ...Array.from({ length: 26 }, (_, i) => String.fromCharCode(i + 65)).map((v) => ({
    key: v,
    value: v,
  })),
  { key: 0, value: "#" },
];
const artistInitialChoose = ref<number | string>(
  (router.currentRoute.value.query?.initial as string) || artistInitials[0].key,
);

// 歌手分类数据
const artistTypeNames = [
  "全部",
  ...["华语", "欧美", "日本", "韩国"].flatMap((type) => [
    `${type}`,
    `${type}男`,
    `${type}女`,
    `${type}组合`,
  ]),
  "其他",
];
const artistType = [-1, -1, 1, 2, 3, -1, 1, 2, 3, -1, 1, 2, 3, -1, 1, 2, 3, -1];
const artistArea = [-1, 7, 7, 7, 7, 96, 96, 96, 96, 8, 8, 8, 8, 16, 16, 16, 16, 0];
const artistTypeNamesChoose = ref<number>(
  Number(router.currentRoute.value.query?.type as string) || 0,
);

// 歌手数据
const hasMore = ref<boolean>(true);
const loading = ref<boolean>(true);
const artistsOffset = ref<number>(0);
const artistsData = ref<ArtistType[]>([]);

/**
 * 平台歌手列表每页条数
 *
 * 与网易云歌手列表一页 50 条同口径，
 * 平台接口支持翻页时按此逐页追加。
 */
const PLATFORM_ARTIST_PAGE_SIZE = 50;

/** 平台歌手列表当前页码（从 1 开始） */
const artistPage = ref<number>(1);

// 酷狗歌手分类（上游下发）与当前选中项
const artistTypes = ref<DispatchArtistType[]>([]);
const artistTypeChoose = ref<number>(0);

// 获取歌手数据
const getArtistListData = async () => {
  // 第三方平台：取平台歌手列表
  if (isPlatformSource.value) {
    loading.value = true;
    try {
      const result = await dispatchHotArtists(platformStore.currentPlatform, {
        type: artistTypes.value[artistTypeChoose.value]?.id,
        page: artistPage.value,
        limit: PLATFORM_ARTIST_PAGE_SIZE,
      });
      // 平台接口支持翻页时按页追加，不支持时上游只给一次全量
      artistsData.value =
        artistPage.value === 1 ? result.artists : [...artistsData.value, ...result.artists];
      artistTypes.value = result.types;
      hasMore.value = result.hasMore;
    } catch (error) {
      console.error("获取平台热门歌手失败：", error);
      window.$message.error("加载失败，请重试");
      // 首页失败时清空列表，避免残留上一分类的数据
      if (artistPage.value === 1) artistsData.value = [];
    } finally {
      // 复位加载状态，避免失败后永久加载
      loading.value = false;
    }
    return;
  }
  // 获取数据
  loading.value = true;
  try {
    const result = await artistTypeList(
      // 类型
      artistType[artistTypeNamesChoose.value] || -1,
      // 地区
      artistArea[artistTypeNamesChoose.value] || -1,
      // 首字母索引
      artistInitialChoose.value,
      artistsOffset.value,
      50,
    );
    // 是否还有
    hasMore.value = result?.more;
    // 处理数据
    const arData = formatArtistsList(result.artists);
    artistsData.value = artistsData.value?.concat(arData);
  } catch (error) {
    console.error("获取歌手数据失败", error);
    window.$message.error("加载失败，请重试");
  } finally {
    // 复位加载状态，避免失败后永久加载
    loading.value = false;
  }
};

// 参数变化
const artistQueryChange = (initial: number | string, type: number) => {
  artistsOffset.value = 0;
  router.push({
    name: "discover-artists",
    query: { initial, type },
  });
};

// 酷狗分类切换
const artistTypeChange = (index: number) => {
  artistTypeChoose.value = index;
  artistPage.value = 1;
  artistsData.value = [];
  getArtistListData();
};

// 加载更多
const loadMore = () => {
  // 平台按页取，网易云按偏移取
  if (isPlatformSource.value) {
    artistPage.value += 1;
  } else {
    artistsOffset.value += 50;
  }
  getArtistListData();
};

// 参数变化
onBeforeRouteUpdate((to) => {
  if (to.name !== "discover-artists") return;
  // 更新参数
  artistInitialChoose.value = (to.query?.initial as string) || artistInitials[0].key;
  artistTypeNamesChoose.value = Number(to.query?.type as string) || 0;
  // 获取歌单
  loading.value = true;
  artistsData.value = [];
  getArtistListData();
});

onMounted(getArtistListData);

// 平台切换：重新拉取歌手
const stopPlatformWatch = onPlatformChange(() => {
  artistsData.value = [];
  artistsOffset.value = 0;
  artistPage.value = 1;
  artistTypes.value = [];
  artistTypeChoose.value = 0;
  getArtistListData();
});

onUnmounted(() => {
  stopPlatformWatch();
});
</script>

<style lang="scss" scoped>
.discover-artists {
  .menu {
    margin-top: 20px;
    .initial {
      margin-bottom: 20px;
    }
  }
}
</style>
