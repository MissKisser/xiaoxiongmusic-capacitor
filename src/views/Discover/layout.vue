<template>
  <div class="discover">
    <!-- 标题 -->
    <div class="title">
      <n-text class="keyword">发现音乐</n-text>
    </div>
    <!-- 标签页 -->
    <n-tabs
      v-model:value="discoverType"
      class="tabs"
      type="segment"
      @update:value="(name: string) => router.push({ name })"
    >
      <n-tab v-for="tab in visibleTabs" :key="tab.name" :name="tab.name">
        {{ tab.label }}
      </n-tab>
    </n-tabs>
    <!-- 路由 -->
    <RouterView v-slot="{ Component }">
      <Transition :name="`router-${settingStore.routeAnimation}`" mode="out-in">
        <KeepAlive v-if="settingStore.useKeepAlive">
          <component :is="Component" class="router-view" />
        </KeepAlive>
        <component v-else :is="Component" class="router-view" />
      </Transition>
    </RouterView>
  </div>
</template>

<script setup lang="ts">
import { DISCOVER_TABS } from "@/api/platform/capability";
import { onPlatformChange, usePlatformStore, useSettingStore } from "@/stores";

const router = useRouter();
const settingStore = useSettingStore();
const platformStore = usePlatformStore();

/** 当前应高亮的标签页 */
const resolveDiscoverType = (): string => {
  const name = router.currentRoute.value?.name;
  return (typeof name === "string" && name) || "discover-playlists";
};

// 发现路由
const discoverType = ref<string>(resolveDiscoverType());

// 路由变化时同步标签高亮：平台切换、前进后退都会走到这里
watch(
  () => router.currentRoute.value.name,
  () => {
    discoverType.value = resolveDiscoverType();
  },
);

// 当前平台可见的子页（平台不支持的子页隐藏）
const visibleTabs = computed(() => DISCOVER_TABS[platformStore.currentPlatform] ?? []);

// 平台切换：当前所在子页在目标平台不可见时回到首个可见子页
const stopPlatformWatch = onPlatformChange(() => {
  const name = router.currentRoute.value.name?.toString() ?? "";
  if (!name) return;
  if (visibleTabs.value.some((tab) => tab.name === name)) return;
  const fallback = visibleTabs.value[0];
  if (!fallback) return;
  router.push({ name: fallback.name });
});

onUnmounted(() => {
  stopPlatformWatch();
});
</script>

<style lang="scss" scoped>
.discover {
  display: flex;
  flex-direction: column;
  .title {
    display: flex;
    align-items: flex-end;
    line-height: normal;
    margin-top: 12px;
    margin-bottom: 20px;
    height: 40px;
    .keyword {
      font-size: 30px;
      font-weight: bold;
      margin-right: 12px;
      line-height: normal;
    }
  }
}
</style>
