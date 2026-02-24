<template>
  <div :class="['search', { focus: statusStore.searchFocus, 'mobile-expanded': isMobileExpanded }]">
    <!-- 移动端搜索按钮 -->
    <n-button
      v-if="isMobile && !isMobileExpanded"
      :focusable="false"
      tertiary
      circle
      class="mobile-search-btn"
      @click="expandMobileSearch"
    >
      <template #icon>
        <SvgIcon :size="20" name="Search" />
      </template>
    </n-button>
    <!-- 搜索框 -->
    <n-input
      v-show="!isMobile || isMobileExpanded"
      ref="searchInputRef"
      v-model:value="statusStore.searchInputValue"
      :input-props="{ autocomplete: 'off' }"
      :placeholder="searchPlaceholder"
      :allow-input="noSideSpace"
      class="search-input"
      round
      clearable
      @focus="searchInputToFocus"
      @keyup.enter="toSearch(statusStore.searchInputValue)"
      @contextmenu.stop="searchInpMenuRef?.openDropdown($event)"
      @click.stop
    >
      <template #prefix>
        <SvgIcon :size="18" name="Search" />
      </template>
    </n-input>
    <!-- 搜索框遮罩 -->
    <Transition name="fade" mode="out-in">
      <div v-show="statusStore.searchFocus" class="search-mask" @click.stop="closeSearchFocus" />
    </Transition>
    <!-- 默认内容 -->
    <SearchDefault v-if="settingStore.useOnlineService" @to-search="toSearch" />
    <!-- 搜索结果 -->
    <SearchSuggest @to-search="toSearch" />
    <!-- 右键菜单 -->
    <SearchInpMenu ref="searchInpMenuRef" @to-search="toSearch" />
  </div>
</template>

<script setup lang="ts">
import { useStatusStore, useDataStore, useSettingStore } from "@/stores";
import { searchDefault } from "@/api/search";
import { usePlayerController } from "@/core/player/PlayerController";
import { songDetail } from "@/api/song";
import { formatSongsList } from "@/utils/format";
import SearchInpMenu from "@/components/Menu/SearchInpMenu.vue";
import { useMobile } from "@/composables/useMobile";

const router = useRouter();
const dataStore = useDataStore();
const statusStore = useStatusStore();
const settingStore = useSettingStore();
const player = usePlayerController();
const { isDesktop } = useMobile();

// 是否为移动端
const isMobile = computed(() => !isDesktop.value);
// 移动端搜索框是否展开
const isMobileExpanded = ref(false);

// 右键菜单
const searchInpMenuRef = ref<InstanceType<typeof SearchInpMenu> | null>(null);

// 搜索框数据
const searchInputRef = ref<HTMLInputElement | null>(null);
const searchPlaceholder = ref<string>(
  settingStore.useOnlineService ? "搜索音乐 / 视频" : "搜索本地音乐",
);
const searchRealkeyword = ref<string>("");

// 搜索框输入限制
const noSideSpace = (value: string) => !value.startsWith(" ");

// 展开移动端搜索框
const expandMobileSearch = () => {
  isMobileExpanded.value = true;
  statusStore.searchFocus = true;
  nextTick(() => {
    searchInputRef.value?.focus();
  });
};

// 搜索框 focus
const searchInputToFocus = () => {
  // searchInpRef.value?.focus();
  statusStore.searchFocus = true;
};

// 关闭搜索焦点（点击遮罩时）
const closeSearchFocus = () => {
  // 先关闭焦点，触发弹窗退出动画
  statusStore.searchFocus = false;
  
  // 如果设置开启，关闭搜索焦点时清空搜索框
  if (settingStore.clearSearchOnBlur) {
    statusStore.searchInputValue = "";
  }
  
  // 延迟收起移动端搜索框，让退出动画有时间播放
  setTimeout(() => {
    isMobileExpanded.value = false;
  }, 250);
};

// 添加搜索历史
const setSearchHistory = (keyword: string) => {
  // 去除空格
  keyword = keyword.trim();
  if (!keyword) return;
  const index = dataStore.searchHistory.indexOf(keyword);
  if (index !== -1) {
    dataStore.searchHistory.splice(index, 1);
  }
  dataStore.searchHistory.unshift(keyword);
  if (dataStore.searchHistory.length > 30) {
    dataStore.searchHistory.length = 30;
  }
};

// 更换搜索框关键词
const updatePlaceholder = async () => {
  if (!settingStore.enableSearchKeyword) {
    searchPlaceholder.value = "搜索音乐 / 视频";
    return;
  }
  try {
    const result = await searchDefault();
    searchPlaceholder.value = result.data.showKeyword;
    searchRealkeyword.value = result.data.realkeyword;
  } catch (error) {
    console.error("搜索关键词获取失败：", error);
    searchPlaceholder.value = "搜索音乐 / 视频";
  }
};

// 前往搜索
const toSearch = async (key: any, type: string = "keyword") => {
  // 先关闭焦点，触发弹窗退出动画
  statusStore.searchFocus = false;
  searchInputRef.value?.blur();
  
  // 如果设置开启，搜索后清空搜索框
  if (settingStore.clearSearchOnBlur) {
    statusStore.searchInputValue = "";
  }
  
  // 延迟收起移动端搜索框
  setTimeout(() => {
    isMobileExpanded.value = false;
  }, 250);
  // 未输入内容且不存在推荐
  if (!key && searchPlaceholder.value === "搜索音乐 / 视频") return;
  if (!key && searchPlaceholder.value !== "搜索音乐 / 视频" && searchRealkeyword.value) {
    key = searchRealkeyword.value?.trim();
  }
  // 本地搜索
  if (!settingStore.useOnlineService) {
    // 跳转本地搜索页面
    router.push({
      name: "search",
      query: { keyword: key },
    });
    return;
  }
  // 更新推荐
  updatePlaceholder();
  // 前往搜索
  switch (type) {
    case "keyword":
      router.push({
        name: "search",
        query: { keyword: key },
      });
      setSearchHistory(key);
      break;
    case "songs": {
      const result = await songDetail(key?.id);
      const song = formatSongsList(result.songs)[0];
      player.addNextSong(song, true);
      break;
    }
    case "playlists":
      router.push({
        name: "playlist",
        query: { id: key?.id },
      });
      break;
    case "artists":
      router.push({
        name: "artist",
        query: { id: key?.id },
      });
      break;
    case "albums":
      router.push({
        name: "album",
        query: { id: key?.id },
      });
      break;
    case "share":
      if (key?.realType && key?.id) {
        toSearch({ id: key.id }, key.realType);
      }
      break;
    default:
      break;
  }
};

// 监听设置变化
watch([() => settingStore.enableSearchKeyword, () => settingStore.useOnlineService], () => {
  updatePlaceholder();
});

// 处理键盘事件，按返回键关闭搜索弹窗
const handleKeyDown = (event: KeyboardEvent) => {
  // 只在搜索弹窗打开时处理
  if (!statusStore.searchFocus) return;
  
  // 排除输入框内的按键（避免影响正常输入）
  const target = event.target as HTMLElement;
  if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
    // 在输入框内时，只处理 Escape 键
    if (event.key === "Escape" || event.code === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeSearchFocus();
    }
    return;
  }
  
  // 按 Escape 或 Backspace 键关闭搜索弹窗
  if (event.key === "Escape" || event.code === "Escape" || 
      (event.key === "Backspace" && event.code === "Backspace")) {
    event.preventDefault();
    event.stopPropagation();
    closeSearchFocus();
  }
};

onMounted(() => {
  // 添加键盘事件监听
  window.addEventListener("keydown", handleKeyDown);

  // 确保在线服务开启
  if (settingStore.useOnlineService) {
    // 立即更新一次
    updatePlaceholder();
    // 开启定时器
    useIntervalFn(updatePlaceholder, 60 * 1000, { immediate: true });
  }
});

onUnmounted(() => {
  // 移除键盘事件监听
  window.removeEventListener("keydown", handleKeyDown);
});
</script>

<style lang="scss" scoped>
.search {
  position: relative;
  -webkit-app-region: no-drag;

  .mobile-search-btn {
    width: 40px;
    height: 40px;
  }
  .search-input {
    width: 200px;
    height: 40px;
    border-radius: 50px;
    transition:
      background-color 0.3s var(--n-bezier),
      width 0.3s var(--n-bezier);
    z-index: 2001;
    :deep(input) {
      height: 100%;
      width: 100%;
    }
  }
  &.focus {
    .search-input {
      width: 300px;
    }
  }
  // 移动端样式
  @media (max-width: 768px) {
    // 移动端展开时的样式
    &.mobile-expanded {
      position: fixed;
      top: calc(15px + env(safe-area-inset-top, 0px)); // 适配状态栏高度
      left: 1rem;
      right: 1rem;
      z-index: 2006; // 高于 Nav 的 z-index: 2005
      .search-input {
        width: 100%;
      }
    }
  }
  .search-mask {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: 2000;
    background-color: #00000060;
    // backdrop-filter: blur(20px); // 移除以提升性能
    // -webkit-backdrop-filter: blur(20px);
    -webkit-app-region: no-drag;
  }
}
</style>
