<template>
  <div class="discover-playlists">
    <n-flex justify="space-between" align="center" class="menu">
      <!-- 分类 -->
      <n-button
        v-if="!isPlatformSource"
        :focusable="false"
        icon-placement="right"
        strong
        secondary
        round
        @click="catChangeShow = true"
      >
        <template #icon>
          <n-icon class="more" depth="3">
            <SvgIcon name="Right" />
          </n-icon>
        </template>
        {{ catName }}
      </n-button>
      <!-- 第三方平台没有歌单分类数据源：保留按钮位并说明不可用 -->
      <n-tooltip v-else>
        <template #trigger>
          <span class="filter-disabled">
            <n-button :focusable="false" disabled icon-placement="right" strong secondary round>
              <template #icon>
                <n-icon class="more" depth="3">
                  <SvgIcon name="Right" />
                </n-icon>
              </template>
              歌单分类
            </n-button>
          </span>
        </template>
        该平台暂不支持分类筛选
      </n-tooltip>
      <!-- 场景关键词筛选：来自首页场景电台主题卡 -->
      <n-tag
        v-if="isPlatformSource && keyword"
        closable
        size="small"
        round
        :bordered="false"
        type="primary"
        @close="clearKeyword"
      >
        {{ keyword }}
      </n-tag>
      <!-- 精品 -->
      <Transition name="fade" mode="out-in">
        <n-tabs
          v-if="hasHqPlaylist && !isPlatformSource"
          v-model:value="catHqType"
          class="tabs"
          type="segment"
          @update:value="
            (name: string) => changeCatName(catName, name === 'normal' ? 'false' : 'true')
          "
        >
          <n-tab name="normal"> 推荐 </n-tab>
          <n-tab name="hq"> 精品 </n-tab>
        </n-tabs>
      </Transition>
    </n-flex>
    <CoverList
      v-if="playlistCount > 0 || platformPlaylistReady"
      :data="playlistData"
      :loading="loading"
      :loadMore="hasMore"
      type="playlist"
      @loadMore="loadMore"
    />
    <!-- 分类选择 -->
    <n-modal
      v-model:show="catChangeShow"
      display-directive="show"
      style="width: 600px"
      preset="card"
    >
      <template #header>
        <n-flex align="center" class="cat-header">
          <n-text>歌单分类</n-text>
          <n-tag
            :type="catName == '全部歌单' ? 'primary' : 'default'"
            :bordered="false"
            round
            @click="changeCatName('全部歌单')"
          >
            全部歌单
          </n-tag>
        </n-flex>
      </template>
      <n-tabs type="segment" animated>
        <n-tab-pane
          v-for="(item, key, index) in dataStore.catData.type"
          :key="index"
          :name="key"
          :tab="item"
        >
          <n-flex class="cat-list">
            <n-tag
              v-for="(cat, catIndex) in dataStore.catData.cats.filter(
                (cat) => cat.category === Number(key),
              )"
              :key="catIndex"
              :bordered="catName === cat.name"
              :type="catName === cat.name ? 'primary' : 'default'"
              size="large"
              round
              @click="changeCatName(cat.name)"
            >
              {{ cat.name }}
              <template #icon>
                <SvgIcon v-if="cat.hot" :depth="3" name="Fire" />
              </template>
            </n-tag>
          </n-flex>
        </n-tab-pane>
      </n-tabs>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import SvgIcon from "@/components/Global/SvgIcon.vue";
import CoverList from "@/components/List/CoverList.vue";
import type { CoverType } from "@/types/main";
import { onPlatformChange, useDataStore, usePlatformStore } from "@/stores";
import { allCatlistPlaylist } from "@/api/playlist";
import { dispatchSquarePlaylists } from "@/api/platform/dispatch";
import { formatCoverList } from "@/utils/format";

const router = useRouter();
const dataStore = useDataStore();
const platformStore = usePlatformStore();

// 是否为第三方平台（QQ 音乐 / 酷狗）
const isPlatformSource = computed<boolean>(() => platformStore.currentPlatform !== "netease");

const catChangeShow = ref<boolean>(false);

// 歌单分类
const catName = ref<string>((router.currentRoute.value.query?.cat as string) || "全部歌单");
const catHqType = ref<string>(
  (router.currentRoute.value.query?.hq as string) === "true" ? "hq" : "normal",
);

/**
 * 场景关键词
 *
 * 第三方平台按关键词向上游检索歌单：首页场景电台的主题卡点击后
 * 带关键词进入本页，此时广场按该关键词取材而不是按分类轮换。
 * 缺省为空串，表示按平台自身的广场口径取数。
 */
const keyword = ref<string>((router.currentRoute.value.query?.keyword as string) || "");

// 歌单数据
const hasMore = ref<boolean>(true);
const loading = ref<boolean>(true);
const playlistOffset = ref<number>(0);
const playlistCount = ref<number>(1);
const playlistData = ref<CoverType[]>([]);

/**
 * 平台广场是否已响应
 *
 * 平台广场的首屏可能一条都没有：此时上游总数与当页条数都是 0，
 * 计数口径用不上，页面会整块空掉。这里单独记一次响应，
 * 让空态与骨架屏都有渲染位置（网易云按上游总数判定，不受此影响）。
 */
const platformPlaylistReady = ref<boolean>(false);

// 是否有精品歌单
const hasHqPlaylist = computed<boolean>(() => {
  if (dataStore.catData.hqCats?.length === 0) return false;
  if (catName.value === "全部歌单") return true;
  return dataStore.catData.hqCats.some((item) => item.name === catName.value);
});

/**
 * 获取第三方平台的歌单广场
 */
const getPlatformPlaylists = async () => {
  loading.value = true;
  try {
    const result = await dispatchSquarePlaylists(platformStore.currentPlatform, {
      page: playlistOffset.value / 50 + 1,
      limit: 50,
      ...(keyword.value ? { keyword: keyword.value } : {}),
    });
    hasMore.value = result.hasMore;
    // 平台广场按分类轮换取材，跨分类可能出现同一歌单，追加前先去重
    const seen = new Set(
      playlistData.value.map((item) => `${item.platform ?? ""}:${item.platformId ?? item.id}`),
    );
    const merged = playlistData.value.slice();
    for (const item of result.playlists) {
      const key = `${item.platform ?? ""}:${item.platformId ?? item.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
    }
    playlistData.value = merged;
    // 与网易云同口径按总数判定，总数缺失时按累计条数兜底
    playlistCount.value = result.total || merged.length;
  } catch (error) {
    console.error("获取平台歌单广场失败：", error);
    window.$message.error("加载失败，请重试");
  } finally {
    platformPlaylistReady.value = true;
    // 复位加载状态，避免失败后永久加载
    loading.value = false;
  }
};

// 获取歌单数据
const getAllCatlistPlaylist = async () => {
  // 第三方平台：走平台歌单广场
  if (isPlatformSource.value) {
    await getPlatformPlaylists();
    return;
  }
  // before
  const before = playlistData.value?.at(-1)?.updateTime ?? undefined;
  // 获取数据
  loading.value = true;
  try {
    const result = await allCatlistPlaylist(
      catName.value,
      50,
      playlistOffset.value,
      catHqType.value === "hq" ? true : false,
      before,
    );
    // 是否还有
    playlistCount.value = result?.total;
    hasMore.value = result.more || result?.total > playlistOffset.value + 50;
    // 处理数据
    const listData = formatCoverList(result.playlists);
    playlistData.value = playlistData.value?.concat(listData);
  } catch (error) {
    console.error("获取歌单数据失败", error);
    window.$message.error("加载失败，请重试");
  } finally {
    // 复位加载状态，避免失败后永久加载
    loading.value = false;
  }
};

// 加载更多
const loadMore = () => {
  playlistOffset.value += 50;
  getAllCatlistPlaylist();
};

// 分类切换
const changeCatName = (cat: string, hq: string = "false") => {
  catChangeShow.value = false;
  // 切换分类时重置分页偏移，避免新分类前 N 页缺失
  playlistOffset.value = 0;
  router.push({
    name: "discover-playlists",
    query: { cat, hq },
  });
};

/**
 * 清除场景关键词
 *
 * 回到平台自身的广场取材口径（不按关键词检索）。
 */
const clearKeyword = () => {
  router.push({
    name: "discover-playlists",
    query: { cat: catName.value, hq: catHqType.value === "hq" ? "true" : "false" },
  });
};

// 参数变化
onBeforeRouteUpdate((to) => {
  if (to.name !== "discover-playlists") return;
  catName.value = (to.query?.cat as string) || "全部歌单";
  catHqType.value = (to.query?.hq as string) === "true" ? "hq" : "normal";
  const nextKeyword = (to.query?.keyword as string) || "";
  // 关键词变了就是另一批歌单，分页从第一页重新开始
  if (nextKeyword !== keyword.value) {
    keyword.value = nextKeyword;
    playlistOffset.value = 0;
  }
  playlistData.value = [];
  // 重置分页偏移，避免沿用上一分类的翻页位置
  playlistOffset.value = 0;
  // 获取歌单
  getAllCatlistPlaylist();
});

// 平台切换：重新拉取歌单广场
const stopPlatformWatch = onPlatformChange(() => {
  playlistData.value = [];
  playlistOffset.value = 0;
  getAllCatlistPlaylist();
});

onMounted(() => {
  dataStore.getPlaylistCatList();
  // 获取歌单
  getAllCatlistPlaylist();
});

onUnmounted(() => {
  stopPlatformWatch();
});
</script>

<style lang="scss" scoped>
.discover-playlists {
  .menu {
    margin-top: 20px;
    .n-button {
      height: 40px;
    }
    // 置灰的筛选按钮包一层可触发提示的元素（禁用按钮不派发鼠标事件）
    .filter-disabled {
      display: inline-flex;
    }
    .n-tabs {
      height: 40px;
      width: 140px;
      --n-tab-border-radius: 25px !important;
      :deep(.n-tabs-rail) {
        outline: 1px solid var(--n-tab-color-segment);
      }
    }
  }
}
.cat-list {
  align-content: flex-start;
  min-height: 140px;
  margin-top: 8px;
  .n-tag {
    font-size: 14px;
    .n-icon {
      font-size: 16px;
      margin-left: 4px;
    }
  }
}
</style>
