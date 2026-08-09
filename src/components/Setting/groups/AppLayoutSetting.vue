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
</script>
