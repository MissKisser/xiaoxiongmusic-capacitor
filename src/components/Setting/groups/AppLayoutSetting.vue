<template>
  <div class="setting-type app-setting">
    <div class="set-list">
      <!-- 卡片列数 -->
      <n-h3 prefix="bar"> 卡片布局 </n-h3>
      <n-card class="set-item">
        <div class="label">
          <n-text class="name">卡片列数（手机端）</n-text>
          <n-text class="tip" :depth="3">
            歌单、专辑等卡片网格在手机上每行显示 2 列或 3 列，桌面端自动适配
          </n-text>
        </div>
        <n-radio-group
          :value="settingStore.mobileCardColumns"
          size="small"
          @update:value="handleColumnChange"
        >
          <n-radio-button :value="2">2 列</n-radio-button>
          <n-radio-button :value="3">3 列</n-radio-button>
        </n-radio-group>
      </n-card>

      <!-- 顶栏高度 -->
      <n-h3 prefix="bar"> 顶栏高度 </n-h3>
      <n-card class="set-item">
        <div class="label">
          <n-text class="name">菜单栏高度</n-text>
          <n-text class="tip" :depth="3">
            拖动滑块实时调整顶部导航栏高度（当前 {{ settingStore.navHeight }}px），让内容区显示更多内容
          </n-text>
        </div>
        <n-slider
          :value="settingStore.navHeight"
          :min="50"
          :max="70"
          :step="1"
          class="nav-slider"
          :format-tooltip="(v: number) => v + 'px'"
          @update:value="handleNavHeightChange"
        />
      </n-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useSettingStore } from "@/stores";

const settingStore = useSettingStore();

// 切换卡片列数
const handleColumnChange = (value: 2 | 3) => {
  settingStore.mobileCardColumns = value;
  window.$message.success(`已切换为 ${value} 列`);
};

// 顶栏高度实时调整（写 store 后 Nav/main-content 通过 CSS 变量即时联动）
const handleNavHeightChange = (value: number) => {
  settingStore.navHeight = value;
};
</script>

<style scoped lang="scss">
.nav-slider {
  width: min(50vw, 260px);
}
</style>
