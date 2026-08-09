<template>
  <div class="setting-type">
    <div class="set-list">
      <n-h3 prefix="bar"> 翻译与音译 </n-h3>
      <n-card class="set-item">
        <div class="label">
          <n-text class="name">显示歌词翻译</n-text>
        </div>
        <n-switch v-model:value="settingStore.showTran" class="set" :round="false" />
      </n-card>
      <n-card class="set-item">
        <div class="label">
          <n-text class="name">显示歌词音译</n-text>
        </div>
        <n-switch v-model:value="settingStore.showRoma" class="set" :round="false" />
      </n-card>
      <n-card class="set-item">
        <div class="label">
          <n-text class="name">调换翻译与音译位置</n-text>
          <n-text class="tip" :depth="3">开启后音译显示在翻译上方</n-text>
        </div>
        <n-switch
          v-model:value="settingStore.swapTranRoma"
          :disabled="!settingStore.showTran || !settingStore.showRoma"
          class="set"
          :round="false"
        />
      </n-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useSettingStore } from "@/stores";

const settingStore = useSettingStore();
</script>
