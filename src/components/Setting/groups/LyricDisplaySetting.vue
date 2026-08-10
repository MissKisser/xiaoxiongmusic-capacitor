<template>
  <div class="setting-type">
    <div class="set-list">
      <n-h3 prefix="bar"> 显示设置 </n-h3>
      <!-- 预览 -->
      <n-card
        id="lyrics-show"
        :content-style="{
          'flex-direction': 'column',
          'align-items': settingStore.lyricsPosition,
          '--font-weight': settingStore.lyricFontWeight,
          '--font-size': settingStore.lyricFontSize,
          '--font-tran-size': tranFontSize,
          '--font-roma-size': romaFontSize,
          '--transform-origin':
            settingStore.lyricsPosition === 'center'
              ? 'center'
              : settingStore.lyricsPosition === 'flex-start'
                ? 'left'
                : 'right',
          '--font-family': settingStore.LyricFont !== 'follow' ? settingStore.LyricFont : '',
        }"
        class="set-item"
      >
        <n-card class="warning" v-if="settingStore.useAMLyrics">
          <n-text>
            正在使用 Apple Music-like Lyrics，实际显示效果可能与此处的预览有较大差别
          </n-text>
        </n-card>
        <div v-for="item in 2" :key="item" :class="['lrc-item', { on: item === 2 }]">
          <n-text>我是一句歌词</n-text>
          <template v-if="settingStore.swapTranRoma">
            <n-text v-if="settingStore.showRoma">wo shi yi ju ge ci</n-text>
            <n-text v-if="settingStore.showTran">I'm the lyric</n-text>
          </template>
          <template v-else>
            <n-text v-if="settingStore.showTran">I'm the lyric</n-text>
            <n-text v-if="settingStore.showRoma">wo shi yi ju ge ci</n-text>
          </template>
        </div>
      </n-card>

      <!-- 字体大小 -->
      <n-card class="set-item">
        <div class="label">
          <n-text class="name">歌词字体大小</n-text>
          <n-text class="tip" :depth="3">单位 px，最小 12，最大 60</n-text>
        </div>
        <n-flex>
          <Transition name="fade" mode="out-in">
            <n-button
              v-if="settingStore.lyricFontSize !== 46"
              type="primary"
              strong
             
              @click="settingStore.lyricFontSize = 46"
            >
              恢复默认
            </n-button>
          </Transition>
          <n-input-number
            v-model:value="settingStore.lyricFontSize"
            :min="12"
            :max="60"
            class="set"
            placeholder="请输入歌词字体大小"
            @blur="settingStore.lyricFontSize === null ? (settingStore.lyricFontSize = 30) : null"
          >
            <template #suffix> px </template>
          </n-input-number>
        </n-flex>
      </n-card>
      <n-card class="set-item">
        <div class="label">
          <n-text class="name">翻译歌词大小</n-text>
          <n-text class="tip" :depth="3">单位 px，最小 5，最大 40</n-text>
        </div>
        <n-flex>
          <Transition name="fade" mode="out-in">
            <n-button
              v-if="settingStore.lyricTranFontSize !== 22"
              type="primary"
              strong
             
              @click="settingStore.lyricTranFontSize = 22"
            >
              恢复默认
            </n-button>
          </Transition>
          <n-input-number
            v-model:value="tranFontSize"
            :min="5"
            :max="40"
            :disabled="settingStore.useAMLyrics"
            class="set"
            placeholder="请输入翻译歌词字体大小"
            :title="tranFontSizeTitle"
            @blur="
              settingStore.lyricTranFontSize === null ? (settingStore.lyricTranFontSize = 22) : null
            "
          >
            <template #suffix> px </template>
          </n-input-number>
        </n-flex>
      </n-card>
      <n-card class="set-item">
        <div class="label">
          <n-text class="name">音译歌词大小</n-text>
          <n-text class="tip" :depth="3">单位 px，最小 5，最大 40</n-text>
        </div>
        <n-flex>
          <Transition name="fade" mode="out-in">
            <n-button
              v-if="settingStore.lyricRomaFontSize !== 18"
              type="primary"
              strong
             
              @click="settingStore.lyricRomaFontSize = 18"
            >
              恢复默认
            </n-button>
          </Transition>
          <n-input-number
            v-model:value="romaFontSize"
            :min="5"
            :max="40"
            :disabled="settingStore.useAMLyrics"
            class="set"
            placeholder="请输入歌词字体大小"
            :title="tranFontSizeTitle"
            @blur="
              settingStore.lyricRomaFontSize === null ? (settingStore.lyricRomaFontSize = 18) : null
            "
          >
            <template #suffix> px </template>
          </n-input-number>
        </n-flex>
      </n-card>

      <!-- 字体设置与字重 -->
      <n-card class="set-item">
        <div class="label">
          <n-text class="name">歌词字体设置</n-text>
          <n-text class="tip" :depth="3"> 统一配置各语种歌词区域的字体 </n-text>
        </div>
        <n-button type="primary" strong @click="openFontManager"> 配置 </n-button>
      </n-card>
      <n-card class="set-item">
        <div class="label">
          <n-text class="name">歌词字重设置</n-text>
          <n-text class="tip" :depth="3">设置歌词显示的字重，部分字体可能不支持所有字重</n-text>
        </div>
        <n-input-number
          v-model:value="settingStore.lyricFontWeight"
          :min="100"
          :max="900"
          :step="100"
          class="set"
        />
      </n-card>

      <!-- 位置与布局 -->
      <n-card class="set-item">
        <div class="label">
          <n-text class="name">歌词位置</n-text>
          <n-text class="tip" :depth="3">歌词的默认垂直位置</n-text>
        </div>
        <n-select
          v-model:value="settingStore.lyricsPosition"
          :disabled="settingStore.useAMLyrics"
          :options="[
            { label: '居左', value: 'flex-start' },
            { label: '居中', value: 'center' },
            { label: '居右', value: 'flex-end' },
          ]"
          class="set"
        />
      </n-card>
      <n-card class="set-item">
        <div class="label">
          <n-text class="name">歌词左侧边距</n-text>
          <n-text class="tip" :depth="3">调整全屏模式下歌词的起始位置</n-text>
        </div>
        <n-slider
          v-model:value="settingStore.lyricHorizontalOffset"
          :min="0"
          :max="200"
          :step="1"
          :marks="{ 10: '默认' }"
          :format-tooltip="(value: number) => `${value}px`"
          class="set"
        />
      </n-card>
      <n-card class="set-item">
        <div class="label">
          <n-text class="name">默认歌词靠右</n-text>
          <n-text class="tip" :depth="3">左右对唱位置互换</n-text>
        </div>
        <n-switch v-model:value="settingStore.lyricAlignRight" class="set" :round="false" />
      </n-card>
      <n-card class="set-item">
        <div class="label">
          <n-text class="name">歌词滚动位置</n-text>
          <n-text class="tip" :depth="3">歌词高亮时在屏幕中的垂直位置</n-text>
        </div>
        <n-slider
          v-model:value="settingStore.lyricsScrollOffset"
          :min="0.1"
          :max="0.9"
          :step="0.05"
          :format-tooltip="(value: number) => `${(value * 100).toFixed(0)}%`"
          :marks="{ '0.1': '靠上', '0.9': '靠下' }"
          class="set"
        />
      </n-card>

      <!-- 模糊与时延 -->
      <n-card class="set-item">
        <div class="label">
          <n-text class="name">歌词自动模糊</n-text>
          <n-text class="tip" :depth="3"> 是否聚焦显示当前播放行，其他行将模糊显示 </n-text>
        </div>
        <n-switch v-model:value="settingStore.lyricsBlur" class="set" :round="false" />
      </n-card>
      <n-card class="set-item">
        <div class="label">
          <n-text class="name">歌词时延调节步长</n-text>
          <n-text class="tip" :depth="3">单位毫秒，每次点击调节的时延大小</n-text>
        </div>
        <n-flex>
          <Transition name="fade" mode="out-in">
            <n-button
              v-if="settingStore.lyricOffsetStep !== 500"
              type="primary"
              strong
             
              @click="settingStore.lyricOffsetStep = 500"
            >
              恢复默认
            </n-button>
          </Transition>
          <n-input-number
            v-model:value="settingStore.lyricOffsetStep"
            :min="10"
            :max="10000"
            :step="10"
            class="set"
            placeholder="请输入时延步长"
            @blur="
              settingStore.lyricOffsetStep === null ? (settingStore.lyricOffsetStep = 500) : null
            "
          >
            <template #suffix> ms </template>
          </n-input-number>
        </n-flex>
      </n-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useSettingStore } from "@/stores";
import { openFontManager } from "@/utils/modal";

const settingStore = useSettingStore();

/**
 * 创建响应式字体大小计算属性
 * 当启用 AMLL 时，翻译和音译的字体大小会根据主歌词大小自动调整
 */
type LyricFontSizeKey = "lyricTranFontSize" | "lyricRomaFontSize";

const fontSizeComputed = (key: LyricFontSizeKey) =>
  computed<number>({
    get: () =>
      settingStore.useAMLyrics
        ? // AMLL 会为翻译和音译设置 `font-size: max(.5em, 10px);`
          Math.max(0.5 * settingStore.lyricFontSize, 10)
        : settingStore[key],
    set: (value) => (settingStore[key] = value),
  });

// 真实显示的翻译歌词字体大小
const tranFontSize = fontSizeComputed("lyricTranFontSize");

// 真实显示的音译歌词字体大小
const romaFontSize = fontSizeComputed("lyricRomaFontSize");

// 显示翻译和音译歌词字体大小被禁用的原因
const tranFontSizeTitle = computed(() =>
  settingStore.useAMLyrics ? "翻译和音译歌词字体大小由 Apple Music-like Lyrics 自动设置" : "",
);
</script>

<style lang="scss" scoped>
#lyrics-show {
  .lrc-item {
    display: flex;
    flex-direction: column;
    opacity: 0.3;
    transform-origin: var(--transform-origin);
    transform: scale(0.86);
    transition: all 0.3s;
    &.on {
      opacity: 1;
      transform: scale(1);
    }
    .n-text {
      font-family: var(--font-family);

      &:nth-of-type(1) {
        font-weight: var(--font-weight);
        font-size: calc(var(--font-size) * 1px);
      }
      &:nth-of-type(2) {
        opacity: 0.6;
        font-size: calc(var(--font-tran-size) * 1px);
      }
      &:nth-of-type(3) {
        opacity: 0.6;
        font-size: calc(var(--font-roma-size) * 1px);
      }
    }
  }
  .warning {
    border-radius: 8px;
    font-size: 16px;
    background-color: rgba(255, 255, 255, 0.1);
    margin-bottom: 4px;
  }
}
</style>
