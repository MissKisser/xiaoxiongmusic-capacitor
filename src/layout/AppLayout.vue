<template>
  <div id="app-layout" ref="appLayoutRef">
    <!-- 主框架 -->
    <n-layout
      id="main"
      :class="{
        'show-player': musicStore.isHasPlayer && statusStore.showPlayBar,
        'show-full-player': statusStore.showFullPlayer
      }"
      has-sider
    >
      <!-- 侧边栏 -->
      <n-layout-sider
        v-if="isDesktop"
        id="main-sider"
        :style="{
          height:
            musicStore.isHasPlayer && statusStore.showPlayBar ? 'calc(100vh - 80px)' : '100vh',
        }"
        :content-style="{
          overflow: 'hidden',
          height: '100%',
          padding: '0',
        }"
        :native-scrollbar="false"
        :collapsed="statusStore.menuCollapsed"
        :collapsed-width="64"
        :width="240"
        collapse-mode="width"
        show-trigger="bar"
        bordered
        @collapse="statusStore.menuCollapsed = true"
        @expand="statusStore.menuCollapsed = false"
      >
        <Sider />
      </n-layout-sider>
      <n-layout id="main-layout">
        <!-- 导航栏：未授权时隐藏 -->
        <Nav v-if="authStore.isAuthorized" id="main-header" />
        <n-layout
          ref="contentRef"
          id="main-content"
          :native-scrollbar="false"
          :style="{
            '--layout-height': contentHeight,
          }"
          :content-style="{
            display: 'grid',
            gridTemplateRows: '1fr',
            minHeight: '100%',
            padding: isMobile ? '0 16px' : '0 24px',
          }"
          position="absolute"
          embedded
        >
          <!-- 路由页面 -->
          <RouterView v-slot="{ Component }">
            <Transition :name="`router-${settingStore.routeAnimation}`" mode="out-in" @enter="onScrollRestore">
              <KeepAlive v-if="settingStore.useKeepAlive" :max="20" :exclude="['layout']">
                <component :is="Component" class="router-view" />
              </KeepAlive>
              <component v-else :is="Component" class="router-view" />
            </Transition>
          </RouterView>
        </n-layout>
      </n-layout>
    </n-layout>
    <!-- 回顶按钮 - 使用 Teleport 渲染到 body 确保不被遮挡 -->
    <Teleport to="body">
      <Transition name="fade">
        <div 
          v-show="showBackTop"
          class="global-back-top-btn"
          :style="{
            bottom: (musicStore.isHasPlayer && statusStore.showPlayBar ? 100 : 40) + 'px'
          }"
          @click="scrollToTop"
        >
          <SvgIcon :size="22" name="Up" />
        </div>
      </Transition>
    </Teleport>
    <!-- 播放列表：未授权时隐藏 -->
    <SongPlayList v-if="authStore.isAuthorized" />
    <!-- 全局播放器：未授权时隐藏 -->
    <MainPlayer v-if="authStore.isAuthorized" />
    <!-- 全屏播放器：未授权时隐藏 -->
    <FullPlayer v-if="authStore.isAuthorized" />
    <!-- 移动端侧边栏抽屉 -->
    <n-drawer 
      v-model:show="statusStore.showAside" 
      :width="240" 
      placement="left" 
      :z-index="3000"
      class="mobile-aside-drawer"
    >
      <n-drawer-content :body-content-style="{ padding: 0 }" :native-scrollbar="false">
        <template #header>
          <n-flex align="center" justify="center" class="aside-logo">
            <Logo />
            <n-text>小熊音乐</n-text>
          </n-flex>
        </template>
        <Menu @menu-click="statusStore.showAside = false" />
      </n-drawer-content>
    </n-drawer>

    <!-- 授权遮罩 (仅覆盖内容区，不遮挡导航和侧边栏) -->
    <GlobalAuthModal />
  </div>
</template>

<script setup lang="ts">
import { useMusicStore, useStatusStore, useSettingStore, useAuthStore } from "@/stores";
import GlobalAuthModal from "@/components/Modal/GlobalAuthModal.vue";
import { useBlobURLManager } from "@/core/resource/BlobURLManager";
import { isElectron } from "@/utils/env";
import { useMobile } from "@/composables/useMobile";
import { useSwipe } from "@vueuse/core";
import { usePlayerController } from "@/core/player/PlayerController";
import { scrollPositions } from "@/router";
import init from "@/utils/init";

const route = useRoute();

const musicStore = useMusicStore();
const statusStore = useStatusStore();
const settingStore = useSettingStore();
const authStore = useAuthStore();

const blobURLManager = useBlobURLManager();
const player = usePlayerController();

const { isDesktop, isMobile } = useMobile();

// 滚动位置恢复（在 Transition @enter 时调用）
// @enter 时元素已在 DOM 中但处于 opacity:0（CSS 过渡起始状态），
// 此时设置 scrollTop 可在用户看到内容前就跳到正确位置
const onScrollRestore = () => {
  nextTick(() => {
    const mainContent = document.getElementById("main-content");
    if (mainContent) {
      const scrollContainer = mainContent.querySelector(".n-scrollbar-container");
      if (scrollContainer) {
        const savedPosition = scrollPositions.get(route.fullPath);
        if (savedPosition !== undefined) {
          scrollContainer.scrollTop = savedPosition;
        } else {
          scrollContainer.scrollTop = 0;
        }
      }
    }
  });
};

// 主布局元素引用
const appLayoutRef = ref<HTMLElement | null>(null);

// 右滑展开菜单手势（仅移动端，全屏播放器关闭时）
const { direction, lengthX } = useSwipe(appLayoutRef, {
  threshold: 10,
  onSwipeEnd: (event) => {
    // 全屏播放器打开时不响应
    if (statusStore.showFullPlayer) return;
    // 桌面端不响应
    if (isDesktop.value) return;
    // 检查是否在播放器区域滑动
    if (event?.target) {
      const target = event.target as HTMLElement;
      const mainPlayer = target.closest('.main-player');
      if (mainPlayer) {
        // 在播放器区域滑动时，不处理（由 MainPlayer 组件自己处理）
        // 避免重复触发导致跳过一首歌
        return;
      }
    }
    // 右滑展开菜单（从左向右滑）
    if (direction.value === "right" && lengthX.value < -50) {
      statusStore.showAside = true;
    }
  },
});


// 全局着色是否启用
const isGlobalColorEnabled = computed(() => {
  return settingStore.themeGlobalColor;
});

// 根据全局着色状态切换 body 类名及设置背景图变量
watchEffect(() => {
  if (isGlobalColorEnabled.value) {
    document.body.classList.add('global-color-enabled');
    if (settingStore.globalBackgroundImage) {
      document.body.style.setProperty('--global-background-image', `url(${settingStore.globalBackgroundImage})`);
    } else {
      document.body.style.removeProperty('--global-background-image');
    }
  } else {
    document.body.classList.remove('global-color-enabled');
    document.body.style.removeProperty('--global-background-image');
  }
});

// 根据毛玻璃特效设置切换 body 类名
watchEffect(() => {
  if (settingStore.enableBlurEffect) {
    document.body.classList.add('blur-effects-enabled');
  } else {
    document.body.classList.remove('blur-effects-enabled');
  }
});

// 主内容
const contentRef = ref<HTMLElement | null>(null);

// 主内容高度
const { height: contentHeight } = useElementSize(contentRef);

watchEffect(() => {
  statusStore.mainContentHeight = contentHeight.value;
});

// 回顶按钮逻辑
const showBackTop = ref(false);
const scrollContainer = ref<Element | null>(null);

// 监听滚动
const handleScroll = () => {
  if (scrollContainer.value) {
    showBackTop.value = scrollContainer.value.scrollTop > 200;
  }
};

// 滚动到顶部
const scrollToTop = () => {
  if (scrollContainer.value) {
    scrollContainer.value.scrollTo({ top: 0, behavior: "smooth" });
  }
};

// 监听滚动容器
watch(
  () => contentRef.value,
  () => {
    nextTick(() => {
      const container = document.querySelector("#main-content .n-scrollbar-container");
      if (container) {
        scrollContainer.value = container;
        container.addEventListener("scroll", handleScroll);
      }
    });
  },
  { immediate: true }
);

onBeforeUnmount(() => {
  if (scrollContainer.value) {
    scrollContainer.value.removeEventListener("scroll", handleScroll);
  }
});

onMounted(() => {
  init();
  if (!isElectron) {
    window.addEventListener("beforeunload", (event) => {
      event.preventDefault();
      // 释放所有 blob URL
      blobURLManager.revokeAllBlobURLs();
      event.returnValue = "";
    });
  }
});
</script>

<style lang="scss" scoped>
#app-layout {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  position: relative;
}

#main {
  flex: 1;
  height: 100%;
  transition:
    transform 0.3s var(--n-bezier),
    opacity 0.3s var(--n-bezier);
  #main-layout {
    background-color: transparent;
  }
  #main-content {
    top: calc(70px + env(safe-area-inset-top, 0px));
    background-color: transparent;
    transition: bottom 0.3s;
    .router-view {
      position: relative;
      height: 100%;
      &.n-result {
        display: flex;
        flex-direction: column;
        justify-content: center;
      }
    }
  }
  &.show-player {
    #main-content {
      bottom: 80px;
    }
  }
  &.show-full-player {
    opacity: 0;
    transform: scale(0.9);
    #main-header {
      -webkit-app-region: no-drag;
    }
  }
}

.aside-logo {
  .n-text {
    flex-shrink: 0;
    white-space: nowrap;
    font-size: 22px;
    font-family: "logo";
    margin-top: 2px;
    line-height: 40px;
  }
}
</style>

<style lang="scss">
// 移动端侧边栏抽屉 - 适配状态栏
.mobile-aside-drawer {
  padding-top: env(safe-area-inset-top, 0px);
}

// 全局回顶按钮 - 使用 Teleport 渲染到 body
.global-back-top-btn {
  position: fixed;
  right: 24px;
  width: 42px;
  height: 42px;
  border-radius: 50%;
  background-color: var(--n-color);
  border: 1px solid rgba(var(--primary), 0.28);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  z-index: 100; // 降低z-index，避免显示在菜单、弹窗和全屏播放器上层
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  transition: transform 0.2s, background-color 0.2s;
  
  &:hover {
    transform: scale(1.1);
  }
  
  &:active {
    transform: scale(0.95);
  }
  
  .n-icon {
    color: var(--primary-hex);
  }
}
</style>
