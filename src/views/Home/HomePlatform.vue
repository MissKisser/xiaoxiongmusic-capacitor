<!-- 第三方音源平台首页（QQ 音乐 / 酷狗音乐） -->
<template>
  <div class="home-platform">
    <!-- 登录态卡片区：与网易云首页同一套骨架（每日推荐 / 我喜欢的音乐 / 刷歌） -->
    <div v-if="isLoggedIn" class="main-rec">
      <div class="main-rec-grid">
        <div class="rec-list">
          <!-- 每日推荐 -->
          <SongListCard
            :data="dailySongs"
            :cover="dailyCover"
            :title="dailySongsTitle"
            :description="dailyDescription"
            size="small"
            vertical
            @click="openDailyRecommend"
          />
          <!-- 我喜欢的音乐 -->
          <SongListCard
            :data="likedSongs"
            :cover="likedCover"
            title="我喜欢的音乐"
            :description="likedDescription"
            size="small"
            vertical
            @click="openLikedSongs"
          />
        </div>
        <!-- 刷歌 -->
        <SongFM />
      </div>
      <!-- 取数失败：区块骨架保留，并给出重试入口 -->
      <n-alert v-if="cardError" type="error" class="card-error" :show-icon="false">
        <n-flex align="center" justify="space-between">
          <n-text>{{ cardError }}</n-text>
          <n-button size="small" secondary @click="loadCards">重试</n-button>
        </n-flex>
      </n-alert>
    </div>

    <!-- 公共区块：按「首页栏目配置」的显隐与顺序渲染 -->
    <template v-for="section in sortedSections" :key="section.key">
      <!-- 精选歌单 -->
      <div v-if="section.key === 'square'" class="rec-public">
        <div class="section-head">
          <n-flex
            class="title"
            align="center"
            justify="space-between"
            @click="router.push({ name: 'discover-playlists' })"
          >
            <n-h3 prefix="bar">
              <n-text>精选歌单</n-text>
              <SvgIcon :size="26" name="Right" />
            </n-h3>
          </n-flex>
          <!-- 分类切换：QQ 音乐的歌单广场按分类取材 -->
          <n-space v-if="squareCategories.length" :size="14" class="cats">
            <n-text
              v-for="cat in squareCategories"
              :key="cat.id"
              :class="['cat', { active: cat.id === squareCategory }]"
              @click="switchSquareCategory(cat.id)"
            >
              {{ cat.name }}
            </n-text>
          </n-space>
        </div>
        <CoverList
          :data="squarePlaylists"
          type="playlist"
          :loading="loading"
          :empty-description="squareError ? '精选歌单加载失败，点击重试' : undefined"
        />
        <div v-if="squareError" class="retry">
          <n-button size="small" secondary @click="loadSquareBlock">重试</n-button>
        </div>
      </div>

      <!-- 为你推荐 -->
      <div v-else-if="section.key === 'recommend'" class="rec-public">
        <div class="section-head">
          <n-flex
            class="title"
            align="center"
            justify="space-between"
            @click="openMore('recommend')"
          >
            <n-h3 prefix="bar">
              <n-text>为你推荐</n-text>
              <SvgIcon v-if="moreRoute('recommend')" :size="26" name="Right" />
            </n-h3>
          </n-flex>
        </div>
        <CoverList
          :data="recommendPlaylists"
          type="playlist"
          :loading="loading"
          :empty-description="recommendError ? '为你推荐加载失败，点击重试' : undefined"
        />
        <div v-if="recommendError" class="retry">
          <n-button size="small" secondary @click="loadPublicSections">重试</n-button>
        </div>
      </div>

      <!-- 歌手推荐 -->
      <div v-else-if="section.key === 'singer'" class="rec-public">
        <div class="section-head">
          <n-flex class="title" align="center" justify="space-between" @click="openMore('singer')">
            <n-h3 prefix="bar">
              <n-text>歌手推荐</n-text>
              <SvgIcon v-if="moreRoute('singer')" :size="26" name="Right" />
            </n-h3>
          </n-flex>
        </div>
        <ArtistList :data="singerArtists" :loading="loading" />
        <div v-if="singerError" class="retry">
          <n-button size="small" secondary @click="loadPublicSections">重试</n-button>
        </div>
      </div>

      <!-- 新碟上架 -->
      <div v-else-if="section.key === 'album'" class="rec-public">
        <div class="section-head">
          <n-flex class="title" align="center" justify="space-between">
            <n-h3 prefix="bar">
              <n-text>新碟上架</n-text>
              <SvgIcon v-if="moreRoute('album')" :size="26" name="Right" />
            </n-h3>
          </n-flex>
        </div>
        <CoverList
          :data="albumCovers"
          type="album"
          :loading="loading"
          :empty-description="albumError ? '新碟上架加载失败，点击重试' : undefined"
        />
        <div v-if="albumError" class="retry">
          <n-button size="small" secondary @click="loadPublicSections">重试</n-button>
        </div>
      </div>

      <!-- 场景电台：主题卡入口，点击按主题关键词看该场景的歌单 -->
      <div v-else-if="section.key === 'radioTheme'" class="rec-public">
        <div class="section-head">
          <n-flex class="title" align="center" justify="space-between">
            <n-h3 prefix="bar">
              <n-text>场景电台</n-text>
            </n-h3>
          </n-flex>
        </div>
        <div v-if="themeCards.length" class="theme-list">
          <n-card
            v-for="item in themeCards"
            :key="item.id"
            class="theme-item"
            :content-style="{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px' }"
            hoverable
            @click="openTheme(item)"
          >
            <div class="cover">
              <s-image
                :src="item.cover"
                default-src="/images/album.jpg?asset"
                class="cover-img"
              />
            </div>
            <div class="theme-data">
              <n-text class="name text-hidden">{{ item.title }}</n-text>
              <n-text v-if="item.tag" class="tag text-hidden" depth="3">{{ item.tag }}</n-text>
            </div>
          </n-card>
        </div>
        <n-empty
          v-else-if="!loading"
          :description="themeError ? '场景电台加载失败，点击重试' : '空空如也，怎么什么都没有啊'"
          size="large"
        />
        <div v-if="themeError" class="retry">
          <n-button size="small" secondary @click="loadPublicSections">重试</n-button>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, onActivated, h } from "vue";
import { useRouter } from "vue-router";
import type { ArtistType, CoverType, SongType } from "@/types/main";
import type { PlatformThemeCard } from "@/api/platform/types";
import { NText } from "naive-ui";
import { onPlatformChange, useMusicStore, usePlatformStore, useSettingStore } from "@/stores";
import {
  dispatchHomeAlbums,
  dispatchHomeRecommend,
  dispatchHomeSingers,
  dispatchHomeSquare,
  dispatchHomeThemes,
  dispatchLikedSongs,
  dispatchSquarePlaylists,
} from "@/api/platform/dispatch";
import { isHomeSectionSupported, isRouteSupported } from "@/api/platform/capability";
import { QQ_HOME_SQUARE_CATEGORIES } from "@/api/platform/qqmusic";
import { kgDailyRecommend, qqDailyRecommend } from "@/api/platform/daily";
import { useSongManager } from "@/core/player/SongManager";
import SvgIcon from "@/components/Global/SvgIcon.vue";
import CoverList from "@/components/List/CoverList.vue";
import ArtistList from "@/components/List/ArtistList.vue";
import SongListCard from "@/components/Card/SongListCard.vue";
import SongFM from "@/components/Player/PlayerComponents/SongFM.vue";

const router = useRouter();
const platformStore = usePlatformStore();
const settingStore = useSettingStore();
const musicStore = useMusicStore();
const songManager = useSongManager();

/** 平台每日推荐页的路由名 */
const PLATFORM_DAILY_ROUTE = "platform-daily-songs";

/** 首页精选歌单取数条数 */
const HOME_SQUARE_LIMIT = 24;

/** 首页「为你推荐」取数条数 */
const HOME_RECOMMEND_LIMIT = 12;

/** 首页「歌手推荐」取数条数 */
const HOME_SINGER_LIMIT = 12;

/** 首页「新碟上架」取数条数 */
const HOME_ALBUM_LIMIT = 12;

/** 首页「场景电台」取数条数 */
const HOME_THEME_LIMIT = 6;

/** 首页各区块的「更多」入口路由 */
const SECTION_MORE_ROUTE: Record<string, string> = {
  square: "discover-playlists",
  recommend: "discover-playlists",
  singer: "discover-artists",
};

/** 各区块取数失败时的统一提示文案 */
const ERROR_TEXT: Record<string, string> = {
  daily: "获取每日推荐失败，请重试",
  liked: "获取我喜欢的音乐失败，请重试",
  fm: "获取刷歌推荐失败，请重试",
  square: "获取精选歌单失败，请重试",
  recommend: "获取为你推荐失败，请重试",
  singer: "获取歌手推荐失败，请重试",
  album: "获取新碟上架失败，请重试",
  theme: "获取场景电台失败，请重试",
};

// 精选歌单
const squarePlaylists = ref<CoverType[]>([]);
// 为你推荐歌单
const recommendPlaylists = ref<CoverType[]>([]);
// 歌手推荐
const singerArtists = ref<ArtistType[]>([]);
// 新碟上架
const albumCovers = ref<CoverType[]>([]);
// 场景电台主题卡
const themeCards = ref<PlatformThemeCard[]>([]);
// 每日推荐曲目与封面
const dailySongs = ref<SongType[]>([]);
const dailyCover = ref<string>("");
// 我喜欢的音乐曲目与封面
const likedSongs = ref<SongType[]>([]);
const likedCover = ref<string>("");
const likedCount = ref<number>(0);
// 公共区块加载状态
const loading = ref<boolean>(true);
// 卡片区失败提示
const cardError = ref<string>("");
// 公共区块失败标记
const squareError = ref<boolean>(false);
const recommendError = ref<boolean>(false);
const singerError = ref<boolean>(false);
const albumError = ref<boolean>(false);
const themeError = ref<boolean>(false);
// 精选歌单当前分类
const squareCategory = ref<number>(QQ_HOME_SQUARE_CATEGORIES[0].id);

/** 精选歌单的分类清单 */
const squareCategories = computed(() =>
  platformStore.currentPlatform === "qqmusic" ? [...QQ_HOME_SQUARE_CATEGORIES] : [],
);

/** 已取数的卡片区标识（平台 + 登录态） */
let cardsKey = "";

/** 卡片区已载入的平台 */
let cardsPlatform = "";

/** 当前平台是否已登录 */
const isLoggedIn = computed<boolean>(
  () => !!platformStore.platformProfiles[platformStore.currentPlatform],
);

/** 每日推荐标题（日历 + 当日日期 + 统一名称） */
const dailySongsTitle = computed(() => {
  const day = new Date().getDate();
  const scale = settingStore.homeCardScale / 100;
  return h("div", { class: "date" }, [
    h("div", { class: "date-icon" }, [
      h(SvgIcon, { name: "Calendar-Empty", size: Math.max(20, 30 * scale), depth: 2 }),
      h(NText, null, () => day),
    ]),
    h(NText, { class: "name text-hidden" }, () => ["每日推荐"]),
  ]);
});

/** 每日推荐卡副标题：首曲与曲目数 */
const dailyDescription = computed<string>(() => {
  const first = dailySongs.value[0];
  if (!first) return "根据你的音乐口味 · 每日更新";
  return `${first.name} · ${dailySongs.value.length} 首`;
});

/** 我喜欢的音乐卡副标题：曲目数 */
const likedDescription = computed<string>(() => {
  if (!likedCount.value) return "发现你独特的音乐品味";
  return `发现你独特的音乐品味 · ${likedCount.value} 首`;
});

/** 首页栏目列表（按「首页栏目配置」的显隐与顺序） */
const sortedSections = computed(() =>
  settingStore.platformHomeSections
    .filter((section) => section.visible)
    .filter((section) => isHomeSectionSupported(platformStore.currentPlatform, section.key))
    .sort((a, b) => a.order - b.order),
);

/**
 * 取区块的「更多」入口路由
 * @param key 区块键
 * @returns 可用的路由名，没有时为空串
 */
const moreRoute = (key: string): string => {
  const route = SECTION_MORE_ROUTE[key] ?? "";
  if (!route) return "";
  return isRouteSupported(platformStore.currentPlatform, route) ? route : "";
};

/**
 * 进入区块的「更多」页
 * @param key 区块键
 */
const openMore = (key: string) => {
  const route = moreRoute(key);
  if (!route) return;
  router.push({ name: route });
};

/**
 * 打开场景电台主题
 * @param theme 主题卡
 */
const openTheme = (theme: PlatformThemeCard) => {
  const keyword = theme.title.trim();
  if (!keyword) return;
  router.push({ name: "discover-playlists", query: { keyword } });
};

/**
 * 读取当前平台的每日推荐
 * @returns 失败提示文案，成功时为空串
 */
const loadDaily = async (): Promise<string> => {
  try {
    const platform = platformStore.currentPlatform;
    if (platform === "netease") {
      dailySongs.value = [];
      dailyCover.value = "";
      return "";
    }
    const result = platform === "qqmusic" ? await qqDailyRecommend() : await kgDailyRecommend();
    if (result.code !== 200 || !result.data) {
      dailySongs.value = [];
      dailyCover.value = "";
      return ERROR_TEXT.daily;
    }
    dailySongs.value = result.data.songs;
    dailyCover.value = result.data.cover;
    return "";
  } catch (error) {
    console.error("获取每日推荐失败：", error);
    dailySongs.value = [];
    dailyCover.value = "";
    return ERROR_TEXT.daily;
  }
};

/**
 * 读取当前平台的「我喜欢的音乐」
 * @returns 失败提示文案，成功时为空串
 */
const loadLiked = async (): Promise<string> => {
  try {
    const platform = platformStore.currentPlatform;
    const result = await dispatchLikedSongs(platform, { page: 1, pageSize: 3 });
    likedSongs.value = result.tracks;
    likedCover.value = result.detail?.cover ?? "";
    likedCount.value = result.count;
    return "";
  } catch (error) {
    console.error("获取我喜欢的音乐失败：", error);
    likedSongs.value = [];
    likedCover.value = "";
    likedCount.value = 0;
    return ERROR_TEXT.liked;
  }
};

/**
 * 读取刷歌推荐流
 * @returns 失败提示文案，成功时为空串
 */
const loadSongFM = async (): Promise<string> => {
  try {
    await songManager.initPersonalFM();
    if (!musicStore.personalFMSong?.id) return ERROR_TEXT.fm;
    return "";
  } catch (error) {
    console.error("获取刷歌推荐失败：", error);
    return ERROR_TEXT.fm;
  }
};

/**
 * 读取卡片区数据
 */
const loadCards = async () => {
  const results = await Promise.all([loadDaily(), loadLiked(), loadSongFM()]);
  const errors = results.filter(Boolean);
  cardError.value = errors.join("；");
  if (errors.length) {
    window.$message.error(errors[0]);
  }
};

/** 清空卡片区数据 */
const clearCards = () => {
  dailySongs.value = [];
  dailyCover.value = "";
  likedSongs.value = [];
  likedCover.value = "";
  likedCount.value = 0;
};

/**
 * 按当前平台与登录态取卡片区数据
 */
const ensureCards = async () => {
  const platform = platformStore.currentPlatform;
  const key = `${platform}:${isLoggedIn.value ? "in" : "out"}`;
  if (!isLoggedIn.value) {
    cardsKey = key;
    cardsPlatform = platform;
    clearCards();
    return;
  }
  if (key === cardsKey) return;
  if (cardsPlatform !== platform) clearCards();
  cardsKey = key;
  cardsPlatform = platform;
  await loadCards();
};

/**
 * 读取精选歌单区块
 */
const loadSquareBlock = async () => {
  const platform = platformStore.currentPlatform;
  squareError.value = false;
  try {
    if (platform === "qqmusic") {
      const square = await dispatchHomeSquare(platform, {
        category: squareCategory.value,
        limit: HOME_SQUARE_LIMIT,
      });
      squarePlaylists.value = square.items;
      return;
    }
    const square = await dispatchSquarePlaylists(platform, { limit: HOME_SQUARE_LIMIT });
    squarePlaylists.value = square.playlists;
  } catch (error) {
    console.error("获取平台精选歌单失败：", error);
    squarePlaylists.value = [];
    squareError.value = true;
    window.$message.error(ERROR_TEXT.square);
  }
};

/**
 * 读取首页公共区块数据
 */
const loadPublicSections = async () => {
  const platform = platformStore.currentPlatform;
  loading.value = true;
  squareError.value = false;
  recommendError.value = false;
  singerError.value = false;
  albumError.value = false;
  themeError.value = false;
  try {
    await loadSquareBlock();

    // 为你推荐（仅 QQ 音乐有数据源）
    if (isHomeSectionSupported(platform, "recommend")) {
      try {
        const recommend = await dispatchHomeRecommend(platform, { limit: HOME_RECOMMEND_LIMIT });
        recommendPlaylists.value = recommend.items;
      } catch (error) {
        console.error("获取为你推荐失败：", error);
        recommendPlaylists.value = [];
        recommendError.value = true;
        window.$message.error(ERROR_TEXT.recommend);
      }
    } else {
      recommendPlaylists.value = [];
    }

    // 歌手推荐
    if (isHomeSectionSupported(platform, "singer")) {
      try {
        const singers = await dispatchHomeSingers(platform, { limit: HOME_SINGER_LIMIT });
        singerArtists.value = singers.artists;
      } catch (error) {
        console.error("获取歌手推荐失败：", error);
        singerArtists.value = [];
        singerError.value = true;
        window.$message.error(ERROR_TEXT.singer);
      }
    } else {
      singerArtists.value = [];
    }

    // 新碟上架
    if (isHomeSectionSupported(platform, "album")) {
      try {
        const albums = await dispatchHomeAlbums(platform, { limit: HOME_ALBUM_LIMIT });
        albumCovers.value = albums.items;
      } catch (error) {
        console.error("获取新碟上架失败：", error);
        albumCovers.value = [];
        albumError.value = true;
        window.$message.error(ERROR_TEXT.album);
      }
    } else {
      albumCovers.value = [];
    }

    // 场景电台（酷狗独有能力）
    if (isHomeSectionSupported(platform, "radioTheme")) {
      try {
        const themes = await dispatchHomeThemes(platform, { limit: HOME_THEME_LIMIT });
        themeCards.value = themes.themes;
      } catch (error) {
        console.error("获取场景电台失败：", error);
        themeCards.value = [];
        themeError.value = true;
        window.$message.error(ERROR_TEXT.theme);
      }
    } else {
      themeCards.value = [];
    }
  } finally {
    loading.value = false;
  }
};

/**
 * 切换精选歌单的分类
 * @param category 分类号
 */
const switchSquareCategory = async (category: number) => {
  if (category === squareCategory.value) return;
  squareCategory.value = category;
  squarePlaylists.value = [];
  loading.value = true;
  try {
    await loadSquareBlock();
  } finally {
    loading.value = false;
  }
};

/**
 * 读取当前平台的首页数据
 */
const loadData = async () => {
  cardsKey = "";
  cardError.value = "";
  await loadPublicSections();
  await ensureCards();
};

/**
 * 进入平台每日推荐页
 */
const openDailyRecommend = () => {
  if (!isRouteSupported(platformStore.currentPlatform, PLATFORM_DAILY_ROUTE)) {
    router.push({ name: "daily-songs" });
    return;
  }
  router.push({ name: PLATFORM_DAILY_ROUTE });
};

/** 进入「我喜欢的音乐」页 */
const openLikedSongs = () => {
  router.push({ name: "like-songs" });
};

// 平台切换：重新拉取首页数据
const stopPlatformWatch = onPlatformChange(() => {
  loadData();
});

// 登录态变化：登录后加载卡片区，登出后清空
watch(isLoggedIn, () => {
  ensureCards();
});

let activatedOnce = false;

onMounted(loadData);

onActivated(() => {
  if (!activatedOnce) {
    activatedOnce = true;
    return;
  }
  loadData();
});

onUnmounted(() => {
  stopPlatformWatch();
});
</script>

<style lang="scss" scoped>
.home-platform {
  width: 100%;

  .main-rec {
    .main-rec-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 20px;
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
          font-size: max(9px, calc(12px * var(--home-card-scale, 1)));
          color: var(--primary-hex);
          line-height: normal;
          margin-top: 4px;
          transform: scale(0.8);
        }
      }
      .name {
        font-size: max(12px, calc(18px * var(--home-card-scale, 1)));
        font-weight: bold;
      }
    }

    .card-error {
      margin-top: 12px;
    }

    @media (max-width: 768px) {
      .main-rec-grid {
        grid-template-columns: repeat(1, 1fr);
      }
      .rec-list {
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

  .rec-public {
    margin-bottom: 12px;
  }

  .section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;

    .cats {
      margin-top: 28px;
      padding-right: 4px;
      .cat {
        font-size: 14px;
        cursor: pointer;
        transition: color 0.3s;
        &:hover {
          color: var(--primary-hex);
        }
        &.active {
          color: var(--primary-hex);
          font-weight: 600;
        }
      }
    }
  }

  .title {
    margin-top: 28px;
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

  .retry {
    display: flex;
    justify-content: center;
    padding: 0 4px 12px;
  }

  .theme-list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(220px, 100%), 1fr));
    gap: 16px;
    padding: 20px 4px;

    @media (max-width: 600px) {
      grid-template-columns: repeat(2, 1fr);
      gap: 12px;
    }

    .theme-item {
      cursor: pointer;
      border-radius: 8px;
      :deep(.n-card-content) {
        padding: 12px;
      }
      .cover {
        flex-shrink: 0;
        width: 56px;
        height: 56px;
        border-radius: 8px;
        overflow: hidden;
      }
      .theme-data {
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
        .name {
          font-size: 15px;
          font-weight: 600;
        }
        .tag {
          font-size: 13px;
        }
      }
    }
  }
}
</style>
