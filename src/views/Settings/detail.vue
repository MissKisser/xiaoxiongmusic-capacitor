<template>
  <div class="settings-detail">
    <!-- 顶部返回栏 -->
    <div class="detail-header">
      <div class="back-btn" @click="router.back()">
        <SvgIcon name="NavigateBefore" :size="24" />
      </div>
      <n-text class="detail-title">{{ currentTitle }}</n-text>
    </div>

    <!-- 子菜单列表 -->
    <div class="submenu-list">
      <div
        v-for="item in submenuItems"
        :key="item.item"
        class="submenu-row"
        @click="goTo(item.item)"
      >
        <div class="row-icon">
          <SvgIcon :name="item.icon" :size="20" />
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
import { useRoute, useRouter } from "vue-router";

const route = useRoute();
const router = useRouter();

const type = computed(() => String(route.params.type ?? ""));

// 分类标题与子菜单定义
const menus: Record<string, { title: string; items: { item: string; label: string; desc?: string; icon: string }[] }> = {
  play: {
    title: "播放设置",
    items: [
      { item: "timer", label: "定时器", desc: "设定时间后自动停止播放", icon: "TimeAuto" },
      { item: "equalizer", label: "均衡器", desc: "多频段音效调节", icon: "Eq" },
      { item: "rate", label: "播放速度", desc: "调整播放倍速", icon: "PlayRate" },
      { item: "abloop", label: "AB 循环", desc: "在进度条上设置区间循环播放", icon: "Repeat" },
    ],
  },
  lyrics: {
    title: "歌词设置",
    items: [
      { item: "display", label: "显示设置", desc: "字号、字体、位置、模糊", icon: "Lyrics" },
      { item: "word", label: "逐字歌词", desc: "逐字显示、KRC、来源优先级", icon: "TextPlay" },
      { item: "translate", label: "翻译与音译", desc: "翻译、音译显示开关", icon: "Earth" },
      { item: "content", label: "歌词内容", desc: "繁体、在线 TTML、排除、屏蔽词", icon: "FormatList" },
      { item: "engine", label: "歌词引擎", desc: "默认 / 逐字卡拉OK / AMLL", icon: "PlayCircle" },
      { item: "ttml", label: "本地 TTML 库", desc: "导入与管理本地 TTML 歌词", icon: "FolderMusic" },
      { item: "desktop", label: "桌面歌词", desc: "悬浮窗显示与样式", icon: "DesktopLyric" },
    ],
  },
  app: {
    title: "应用设置",
    items: [
      { item: "theme", label: "主题与背景", desc: "主题模式、全局背景、背景参数", icon: "ColorLens" },
      { item: "other", label: "缓存 / 性能 / 更多", desc: "音频缓存、毛玻璃、音源管理", icon: "Settings" },
    ],
  },
};

const current = computed(() => menus[type.value] || menus.app);
const currentTitle = computed(() => current.value.title);
const submenuItems = computed(() => current.value.items);

// 进入三级具体设置页
const goTo = (item: string) => {
  router.push({ name: "settings-item", params: { type: type.value, item } });
};
</script>

<style lang="scss" scoped>
.settings-detail {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 0 40px;

  .detail-header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px 0;
    margin-bottom: 4px;

    .back-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      border-radius: 50%;
      background-color: var(--n-color);
      cursor: pointer;
      transition: background-color 0.2s;

      &:active {
        background-color: rgba(var(--primary), 0.15);
      }
    }

    .detail-title {
      font-size: 22px;
      font-weight: bold;
    }
  }

  .submenu-list {
    display: flex;
    flex-direction: column;
    gap: 10px;

    .submenu-row {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 14px 16px;
      border-radius: 12px;
      background-color: var(--n-color);
      cursor: pointer;
      transition: background-color 0.2s;

      &:active {
        background-color: rgba(var(--primary), 0.1);
      }

      .row-icon {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 36px;
        height: 36px;
        border-radius: 10px;
        background-color: rgba(var(--primary), 0.12);
        color: rgb(var(--primary));
        flex-shrink: 0;
      }

      .row-info {
        flex: 1;
        min-width: 0;

        .row-title {
          font-size: 16px;
          font-weight: 500;
        }

        .row-desc {
          font-size: 12px;
          opacity: 0.55;
          margin-top: 2px;
        }
      }

      .row-arrow {
        opacity: 0.4;
        flex-shrink: 0;
      }
    }
  }

  @media (max-width: 768px) {
    padding: 0 16px;
  }
}
</style>
