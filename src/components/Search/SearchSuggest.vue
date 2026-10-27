<template>
  <Transition
    name="fadeDown"
    mode="out-in"
    @after-enter="calcSearchSuggestHeights"
    @after-leave="calcSearchSuggestHeights"
  >
    <n-card
      v-if="statusStore.searchFocus && statusStore.searchInputValue"
      class="search-suggest"
      content-style="padding: 0"
      :style="{
        // height: `${searchSuggestHeights}px`,
        height: 'auto',
        border: searchSuggestHeights === 0 ? 'none' : null,
        backdropFilter: 'none',
        WebkitBackdropFilter: 'none',
      }"
    >
      <n-scrollbar class="scrollbar">
        <!-- 直接搜索 -->
        <div
          ref="directSearchRef"
          class="direct"
          @click="emit('toSearch', statusStore.searchInputValue, 'keyword')"
        >
          <SvgIcon name="Search" :depth="3" />
          <n-text class="text text-hidden">直接搜索：{{ statusStore.searchInputValue }}</n-text>
        </div>
        <!-- 搜索建议 -->
        <Transition name="fade" mode="out-in" @after-leave="calcSearchSuggestHeights">
          <div
            v-if="
              Object.keys(searchSuggestData)?.length &&
              searchSuggestData?.order &&
              settingStore.useOnlineService
            "
            ref="searchSuggestRef"
            class="all-suggest"
          >
            <div v-for="(item, index) in searchSuggestData.order" :key="index" class="suggest">
              <div class="suggest-type">
                <SvgIcon :name="searchSuggestionsType[item as keyof typeof searchSuggestionsType]?.icon" />
                <n-text>{{ searchSuggestionsType[item as keyof typeof searchSuggestionsType]?.name }}</n-text>
              </div>
              <div
                v-for="(suggestItem, suggestIndex) in searchSuggestData[item]"
                :key="suggestIndex"
                class="suggest-item"
                @click="emit('toSearch', suggestItem, item)"
              >
                <n-text class="name">{{ suggestItem.name }}</n-text>
                <n-text v-if="suggestItem?.artist" class="artist" depth="3">
                  {{ suggestItem.artist.name }}
                </n-text>
                <n-text v-else-if="suggestItem?.artists" class="artist" depth="3">
                  {{ suggestItem.artists[0].name }}
                </n-text>
              </div>
            </div>
          </div>
        </Transition>
      </n-scrollbar>
    </n-card>
  </Transition>
</template>

<script setup lang="ts">
import { dispatchSearchSuggest } from "@/api/platform/suggest";
import { onPlatformChange, useStatusStore, useSettingStore, usePlatformStore } from "@/stores";

const emit = defineEmits<{
  toSearch: [key: number | string, type: string];
}>();

const statusStore = useStatusStore();
const settingStore = useSettingStore();
const platformStore = usePlatformStore();

// 搜索建议数据
const searchSuggestData = ref<any>({});
const searchSuggestHeights = ref<number>(0);

// 搜索建议元素
const directSearchRef = ref<HTMLElement | null>(null);
const searchSuggestRef = ref<HTMLElement | null>(null);

// 搜索建议分类
const searchSuggestionsType = {
  songs: {
    name: "单曲",
    icon: "Music",
  },
  artists: {
    name: "歌手",
    icon: "Artist",
  },
  albums: {
    name: "专辑",
    icon: "Album",
  },
  playlists: {
    name: "歌单",
    icon: "MusicList",
  },
  share: {
    name: "分享的内容",
    icon: "Link",
  },
};

// 搜索建议请求序号，用于丢弃过期响应（防止竞态）
let suggestSeq = 0;

// 获取搜索建议
const getSearchSuggest = async (keywords: string) => {
  // 记录请求序号
  const seq = ++suggestSeq;
  searchSuggestData.value = {};
  const result = await dispatchSearchSuggest(platformStore.currentPlatform, keywords);
  // 响应已过期则丢弃
  if (seq !== suggestSeq) return;
  searchSuggestData.value = result;
  // 计算高度
  nextTick(calcSearchSuggestHeights);
};

// 计算高度
const calcSearchSuggestHeights = () => {
  const directSearchHeight = directSearchRef.value?.offsetHeight;
  const searchSuggestionsHeight = searchSuggestRef.value?.offsetHeight;
  if (directSearchHeight || searchSuggestionsHeight) {
    const totalHeight =
      (directSearchHeight || 0) +
      (searchSuggestionsHeight || 0) +
      (searchSuggestionsHeight ? 8 : 0) +
      20;
    searchSuggestHeights.value = totalHeight;
  } else {
    searchSuggestHeights.value = 0;
  }
};

/**
 * 识别链接类型
 * @param val 分享的内容
 */
const getLinkType = (val: string) => {
  // 通用正则表达式提取任意URL
  const urlRegex = /(https?:\/\/)?([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(\/[^\s]*)?/;
  const urlMatch = val.match(urlRegex);
  if (!urlMatch) return null;
  // 补全协议
  let fullUrl = urlMatch[0];
  if (!fullUrl.startsWith("http")) {
    fullUrl = "https://" + fullUrl;
  }
  try {
    // 使用URL API解析
    const url = new URL(fullUrl);
    let pathname = url.pathname;
    let searchParams = url.searchParams;
    // 处理hash路由格式: /#/song?id=123
    if (url.hash) {
      const hashPath = url.hash.slice(1); // 移除 #
      if (hashPath.includes("?")) {
        const [hashPathname, hashSearch] = hashPath.split("?");
        pathname = hashPathname;
        // 解析hash中的查询参数
        const hashParams = new URLSearchParams(hashSearch);
        // 合并参数，hash参数优先级更高
        for (const [key, value] of hashParams) {
          if (!searchParams.has(key)) {
            searchParams.set(key, value);
          }
        }
      } else {
        pathname = hashPath;
      }
    }
    // 从路径中提取类型：/song /playlist /album /artist
    const pathMatch = pathname.match(/\/(song|playlist|album|artist)(?:\/|$)/);
    const type = pathMatch?.[1];
    // 提取ID参数
    const id = searchParams.get("id") || searchParams.get("hash");
    if (!type || !id) {
      return null;
    }
    const typeMap: Record<string, string> = {
      song: "songs",
      playlist: "playlists",
      album: "albums",
      artist: "artists",
    };
    const nameMap: Record<string, string> = {
      song: "歌曲",
      playlist: "歌单",
      album: "专辑",
      artist: "歌手",
    };
    return {
      type: typeMap[type],
      typeName: nameMap[type],
      id: id,
    };
  } catch (error) {
    console.warn("解析链接失败:", error);
    return null;
  }
};

// 搜索框改变
watchDebounced(
  () => statusStore.searchInputValue,
  (val) => {
    if (!val || val === "" || !settingStore.useOnlineService) return;
    // 识别链接
    const linkData = getLinkType(val);
    if (linkData) {
      searchSuggestData.value = {
        order: ["share"],
        share: [
          {
            name: `前往分享的${linkData.typeName}`,
            id: linkData.id,
            realType: linkData.type,
          },
        ],
      };
      nextTick(calcSearchSuggestHeights);
      return;
    }
    getSearchSuggest(val);
  },
  { debounce: 300 },
);

// 平台切换后按新平台重取建议
//
// 平台切换不改动搜索框里的关键词，建议只随关键词变化重新拉取，
// 只清空不重取会让下拉面板一直是空的；留着旧平台的结果又会串台。
const stopPlatformWatch = onPlatformChange(() => {
  // 作废在途响应，避免旧平台的建议覆盖新平台
  suggestSeq += 1;
  searchSuggestData.value = {};
  nextTick(calcSearchSuggestHeights);
  // 关键词仍在输入框里时，按新平台重取一次建议
  const keyword = statusStore.searchInputValue;
  if (!keyword || !settingStore.useOnlineService) return;
  getSearchSuggest(keyword).catch((error) => {
    console.error("切换平台后刷新搜索建议失败：", error);
  });
});

onUnmounted(() => {
  stopPlatformWatch();
});
</script>

<style lang="scss" scoped>
.search-suggest {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  top: 50px;
  width: 300px;
  border-radius: 8px;
  overflow: hidden;
  // max-height: calc(50vh - 80px);
  max-height: calc(80vh - 80px);
  z-index: 2002;
  // 搜索建议不使用透明背景
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
  transition:
    height 0.3s ease,
    opacity 0.3s ease,
    transform 0.3s ease;
  :deep(.scrollbar) {
    max-height: calc(80vh - 80px);
    .n-scrollbar-content {
      padding: 10px;
    }
  }
  @media (max-width: 768px) {
    width: 100%;
    max-height: 75vh;
    :deep(.scrollbar) {
      max-height: 75vh;
    }
  }
  .direct {
    display: flex;
    align-items: center;
    padding: 6px;
    border-radius: 8px;
    transition: background-color 0.3s;
    cursor: pointer;
    .n-icon {
      font-size: 16px;
      margin-right: 6px;
    }
    &:hover {
      background-color: var(--n-border-color);
    }
  }
  .all-suggest {
    margin-top: 8px;
    .suggest {
      margin-bottom: 8px;
      .suggest-type {
        display: flex;
        align-items: center;
        margin-bottom: 8px;
        color: var(--n-color-target);
        .n-icon {
          font-size: 18px;
          margin-right: 4px;
        }
        .n-text {
          color: var(--n-color-target);
        }
      }
      .suggest-item {
        padding: 14px 18px 14px 22px;
        margin-bottom: 8px;
        border-radius: 8px;
        transition: background-color 0.3s;
        cursor: pointer;
        .name {
          white-space: normal;
        }
        .artist {
          &::before {
            content: " - ";
          }
        }
        &:last-child {
          margin-bottom: 0;
        }
        &:hover {
          background-color: var(--n-border-color);
        }
      }
      &:last-child {
        margin-bottom: 0;
      }
    }
  }
}
</style>
