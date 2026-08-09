<template>
  <div class="setting-type">
    <div class="set-list">
      <n-h3 prefix="bar"> 歌词引擎 </n-h3>
      <n-card class="set-item">
        <div class="label">
          <n-text class="name">歌词渲染引擎</n-text>
          <n-text class="tip" :depth="3">
            默认 / 逐字卡拉OK（CSS 逐字高亮 + 弹簧滚动）/ Apple Music-like Lyrics
          </n-text>
        </div>
        <n-radio-group v-model:value="settingStore.lyricEngine" class="engine-group" size="small">
          <n-radio-button value="default">默认</n-radio-button>
          <n-radio-button value="karaoke">逐字卡拉OK</n-radio-button>
          <n-radio-button value="amll">AMLL</n-radio-button>
        </n-radio-group>
      </n-card>

      <n-h3 prefix="bar">
        Apple Music-like Lyrics
        <n-tag type="warning" size="small" round>Beta</n-tag>
      </n-h3>
      <n-card class="set-item">
        <div class="label">
          <n-text class="name">使用 Apple Music-like Lyrics</n-text>
          <n-text class="tip" :depth="3">
            歌词使用 Apple Music-like Lyrics 进行渲染，需要高性能设备
          </n-text>
        </div>
        <n-switch v-model:value="settingStore.useAMLyrics" class="set" :round="false" />
      </n-card>
      <n-collapse-transition :show="settingStore.useAMLyrics">
        <n-card class="set-item">
          <div class="label">
            <n-text class="name">歌词弹簧效果</n-text>
            <n-text class="tip" :depth="3">
              是否使用物理弹簧算法实现歌词动画效果，需要高性能设备
            </n-text>
          </div>
          <n-switch v-model:value="settingStore.useAMSpring" class="set" :round="false" />
        </n-card>
        <n-card class="set-item">
          <div class="label">
            <n-text class="name">隐藏已播放歌词</n-text>
            <n-text class="tip" :depth="3">是否隐藏已播放歌词</n-text>
          </div>
          <n-switch v-model:value="settingStore.hidePassedLines" class="set" :round="false" />
        </n-card>
        <n-card class="set-item">
          <div class="label">
            <n-text class="name">文字动画的渐变宽度</n-text>
            <n-text class="tip" :depth="3">
              单位以歌词行的主文字字体大小的倍数为单位 <br />
              默认为 0.5，即一个全角字符的一半宽度 <br />
              若模拟 Apple Music for Android 的效果，可以设为 1 <br />
              若模拟 Apple Music for iPad 的效果，可以设为 0.5 <br />
              若需近乎禁用渐变，可设为非常接近 0 的小数，如 0.01
            </n-text>
          </div>
          <n-input-number
            v-model:value="settingStore.wordFadeWidth"
            class="set"
            :min="0.01"
            :max="1"
            :step="0.01"
            :round="false"
          />
        </n-card>
        <n-card class="set-item">
          <div class="label">
            <n-text class="name">显示逐字音译</n-text>
          </div>
          <n-switch v-model:value="settingStore.showWordsRoma" class="set" :round="false" />
        </n-card>
      </n-collapse-transition>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useSettingStore } from "@/stores";

const settingStore = useSettingStore();

// 歌词引擎与 useAMLyrics 双向同步（兼容旧逻辑）
watch(
  () => settingStore.lyricEngine,
  (engine) => {
    settingStore.useAMLyrics = engine === "amll";
  },
);
watch(
  () => settingStore.useAMLyrics,
  (isAmll) => {
    if (isAmll && settingStore.lyricEngine !== "amll") {
      settingStore.lyricEngine = "amll";
    }
  },
);
</script>
