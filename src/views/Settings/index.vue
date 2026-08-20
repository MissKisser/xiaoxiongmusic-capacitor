<template>
  <div class="settings-menu">
    <!-- 标题 -->
    <div class="settings-header">
      <n-text class="settings-title">设置</n-text>
      <n-text class="settings-subtitle" depth="3">个性化设置</n-text>
    </div>

    <!-- 分类菜单列表 -->
    <div class="settings-list">
      <div
        v-for="item in menuItems"
        :key="item.type"
        class="settings-menu-row"
        @click="goTo(item.type)"
      >
        <div class="row-icon">
          <SvgIcon :name="item.icon" :size="22" />
        </div>
        <div class="row-info">
          <div class="row-title">{{ item.label }}</div>
          <div class="row-desc" v-if="item.desc">{{ item.desc }}</div>
        </div>
        <SvgIcon name="Right" :size="18" class="row-arrow" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from "vue-router";

const router = useRouter();

// 分类菜单
const menuItems = [
  {
    type: "play",
    label: "播放设置",
    desc: "定时器、均衡器、播放速度、AB 循环",
    icon: "Play",
  },
  {
    type: "lyrics",
    label: "歌词设置",
    desc: "歌词显示、逐字歌词、翻译音译、桌面歌词",
    icon: "Lyrics",
  },
  {
    type: "app",
    label: "应用设置",
    desc: "主题、背景、缓存、性能、音源管理",
    icon: "Settings",
  },
];

// 进入分类详情
const goTo = (type: string) => {
  router.push({ name: "settings-detail", params: { type } });
};
</script>

<style lang="scss" scoped>
.settings-menu {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 0 40px;

  .settings-header {
    display: flex;
    flex-direction: column;
    margin: 20px 0;

    .settings-title {
      font-size: 30px;
      font-weight: bold;
    }

    .settings-subtitle {
      font-size: 15px;
      margin-top: 4px;
    }
  }

  // 菜单行样式统一在全局 .settings-menu-row（main.scss）
  .settings-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  @media (max-width: 768px) {
    padding: 0 16px;
  }
}
</style>
