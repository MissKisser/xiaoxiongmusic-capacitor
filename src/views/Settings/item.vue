<template>
  <div class="settings-item-page">
    <!-- 顶部返回栏 -->
    <div class="item-header">
      <div class="back-btn" @click="router.back()">
        <SvgIcon name="NavigateBefore" :size="24" />
      </div>
      <n-text class="item-title">{{ itemTitle }}</n-text>
    </div>

    <!-- 具体设置内容 -->
    <n-scrollbar class="item-content">
      <!-- 播放设置 -->
      <SleepTimerItem v-if="type === 'play' && item === 'timer'" />
      <EqualizerItem v-else-if="type === 'play' && item === 'equalizer'" />
      <PlayRateItem v-else-if="type === 'play' && item === 'rate'" />
      <ABLoopItem v-else-if="type === 'play' && item === 'abloop'" />

      <!-- 歌词设置 -->
      <LyricDisplaySetting v-else-if="type === 'lyrics' && item === 'display'" />
      <LyricWordSetting v-else-if="type === 'lyrics' && item === 'word'" />
      <LyricTranslateSetting v-else-if="type === 'lyrics' && item === 'translate'" />
      <LyricContentSetting v-else-if="type === 'lyrics' && item === 'content'" />
      <LyricEngineSetting v-else-if="type === 'lyrics' && item === 'engine'" />
      <LyricTtmlSetting v-else-if="type === 'lyrics' && item === 'ttml'" />
      <DesktopLyricItem v-else-if="type === 'lyrics' && item === 'desktop'" />

      <!-- 应用设置 -->
      <AppLayoutSetting v-else-if="type === 'app' && item === 'layout'" />
      <AppThemeSetting v-else-if="type === 'app' && item === 'theme'" />
      <AppOtherSetting v-else-if="type === 'app' && item === 'other'" />

      <!-- 未知 -->
      <n-empty v-else description="未知设置项" style="margin-top: 60px" size="large" />
    </n-scrollbar>
  </div>
</template>

<script setup lang="ts">
import { useRoute, useRouter } from "vue-router";
import SleepTimerItem from "@/components/Setting/items/SleepTimerItem.vue";
import EqualizerItem from "@/components/Setting/items/EqualizerItem.vue";
import PlayRateItem from "@/components/Setting/items/PlayRateItem.vue";
import ABLoopItem from "@/components/Setting/items/ABLoopItem.vue";
import DesktopLyricItem from "@/components/Setting/items/DesktopLyricItem.vue";
import LyricDisplaySetting from "@/components/Setting/groups/LyricDisplaySetting.vue";
import LyricWordSetting from "@/components/Setting/groups/LyricWordSetting.vue";
import LyricTranslateSetting from "@/components/Setting/groups/LyricTranslateSetting.vue";
import LyricContentSetting from "@/components/Setting/groups/LyricContentSetting.vue";
import LyricEngineSetting from "@/components/Setting/groups/LyricEngineSetting.vue";
import LyricTtmlSetting from "@/components/Setting/groups/LyricTtmlSetting.vue";
import AppThemeSetting from "@/components/Setting/groups/AppThemeSetting.vue";
import AppLayoutSetting from "@/components/Setting/groups/AppLayoutSetting.vue";
import AppOtherSetting from "@/components/Setting/groups/AppOtherSetting.vue";

const route = useRoute();
const router = useRouter();

const type = computed(() => String(route.params.type ?? ""));
const item = computed(() => String(route.params.item ?? ""));

// 三级页面标题映射
const titles: Record<string, string> = {
  timer: "定时器",
  equalizer: "均衡器",
  rate: "播放速度",
  abloop: "AB 循环",
  display: "显示设置",
  word: "逐字歌词",
  translate: "翻译与音译",
  content: "歌词内容",
  engine: "歌词引擎",
  ttml: "本地 TTML 库",
  desktop: "桌面歌词",
  theme: "主题与背景",
  layout: "界面布局",
  other: "缓存 / 性能 / 更多",
};
const itemTitle = computed(() => titles[item.value] || "设置");
</script>

<style lang="scss" scoped>
.settings-item-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 0 40px;

  .item-header {
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

    .item-title {
      font-size: 22px;
      font-weight: bold;
    }
  }

  .item-content {
    flex: 1;
    min-height: 0;
    padding-right: 12px;
  }

  @media (max-width: 768px) {
    padding: 0 16px;
  }
}
</style>

<style lang="scss">
.settings-item-page {
  // 设置页按钮统一纯色背景（default 类型按钮使用浅灰实底，
  // 排除 primary/error 等彩色类型与 secondary/tertiary 半透明模式）
  .n-button:not(.n-button--primary-type):not(.n-button--error-type):not(.n-button--warning-type):not(.n-button--info-type):not(.n-button--success-type):not(.n-button--secondary):not(.n-button--tertiary) {
    --n-color: color-mix(in srgb, var(--surface-container-hex), rgb(0 0 0 / 10%));
    --n-color-hover: color-mix(in srgb, var(--surface-container-hex), rgb(0 0 0 / 16%));
    --n-color-pressed: color-mix(in srgb, var(--surface-container-hex), rgb(0 0 0 / 22%));
    --n-color-focus: var(--n-color-hover);
  }

  // 单选按钮（radio-button）与主题模式按钮一致：选中纯色主色底白字，未选中浅灰底
  .n-radio-group {
    flex-wrap: wrap;
    // 按钮之间留出间距（splitor 为按钮间 1px 分割线）
    .n-radio-group__splitor + .n-radio-button {
      margin-left: 8px;
    }
    // 分割线透明，避免选中态主色泄露到按钮间隙
    .n-radio-group__splitor {
      background-color: transparent !important;
    }
  }
  .n-radio-button {
    --n-button-color: color-mix(in srgb, var(--surface-container-hex), rgb(0 0 0 / 10%));
    --n-button-color-active: rgb(var(--primary));
    --n-button-text-color-active: #fff;
    --n-button-border-color: transparent;
    --n-button-border-color-active: transparent;
  }

  .set-list {
    padding-bottom: 20px;

    .n-h {
      display: inline-flex;
      flex-direction: row;
      align-items: center;
      gap: 8px;
    }

    .set-item {
      width: 100%;
      border-radius: 8px;
      margin-bottom: 12px;

      .n-card__content {
        display: flex;
        flex-direction: row;
        align-items: center;
        justify-content: space-between;
        padding: 16px;
      }

      .label {
        display: flex;
        flex-direction: column;
        padding-right: 20px;

        .name {
          font-size: 16px;
        }
      }
    }
  }
}
</style>
