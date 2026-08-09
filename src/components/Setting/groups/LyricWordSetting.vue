<template>
  <div class="setting-type">
    <div class="set-list">
      <n-h3 prefix="bar"> 逐字歌词 </n-h3>
      <n-card class="set-item">
        <div class="label">
          <n-text class="name">显示逐字歌词</n-text>
          <n-text class="tip" :depth="3"> 对性能要求较高，若发生卡顿请关闭 </n-text>
        </div>
        <n-switch v-model:value="settingStore.showYrc" class="set" :round="false" />
      </n-card>
      <n-card class="set-item">
        <div class="label">
          <n-text class="name">优先使用 KRC 逐字歌词</n-text>
          <n-text class="tip" :depth="3"> 网易云逐字歌词优先用 KRC 格式，无则退回 YRC </n-text>
        </div>
        <n-switch v-model:value="settingStore.preferKrcLyric" class="set" :round="false" />
      </n-card>
      <n-card class="set-item">
        <div class="label">
          <n-text class="name">歌词来源优先级</n-text>
          <n-text class="tip" :depth="3"> 选择在线歌词的获取顺序，可应对不同平台的缺失与差异 </n-text>
        </div>
        <n-radio-group v-model:value="settingStore.lyricPriority" class="priority-group" size="small">
          <n-radio-button value="auto">自动</n-radio-button>
          <n-radio-button value="qm">QM 优先</n-radio-button>
          <n-radio-button value="ttml">TTML 优先</n-radio-button>
          <n-radio-button value="official">官方优先</n-radio-button>
        </n-radio-group>
      </n-card>
      <n-collapse-transition :show="settingStore.showYrc">
        <n-card class="set-item">
          <div class="label">
            <n-text class="name">优先使用 QM 歌词</n-text>
            <n-text class="tip" :depth="3"> 优先从 QM 获取逐字歌词，模糊搜索，可能不准确 </n-text>
          </div>
          <n-switch v-model:value="settingStore.preferQQMusicLyric" class="set" :round="false" />
        </n-card>
        <n-card v-if="isElectron" class="set-item">
          <div class="label">
            <n-text class="name">本地歌曲使用 QM 歌词</n-text>
            <n-text class="tip" :depth="3">
              为本地歌曲从 QM 匹配逐字歌词，如已有 TTML 歌词则跳过
            </n-text>
          </div>
          <n-switch
            v-model:value="settingStore.localLyricQQMusicMatch"
            class="set"
            :round="false"
          />
        </n-card>
      </n-collapse-transition>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useSettingStore } from "@/stores";
import { isElectron } from "@/utils/env";

const settingStore = useSettingStore();
</script>

<style lang="scss" scoped>
.priority-group {
  display: flex;
  flex-wrap: wrap;
}
</style>
