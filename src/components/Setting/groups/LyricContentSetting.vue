<template>
  <div class="setting-type">
    <div class="set-list">
      <n-h3 prefix="bar"> 歌词内容 </n-h3>

      <!-- 繁体中文 -->
      <n-card class="set-item">
        <div class="label">
          <n-text class="name">更喜欢繁体中文</n-text>
          <n-text class="tip" :depth="3"> 将简体中文的歌词文本和翻译内容转换为繁体中文 </n-text>
        </div>
        <n-switch
          v-model:value="settingStore.preferTraditionalChinese"
          class="set"
          :round="false"
        />
      </n-card>
      <n-collapse-transition :show="settingStore.preferTraditionalChinese">
        <n-card class="set-item">
          <div class="label">
            <n-text class="name">繁体中文变体</n-text>
            <n-text class="tip" :depth="3"> 偏好的繁体中文变体 </n-text>
          </div>
          <n-select
            v-model:value="settingStore.traditionalChineseVariant"
            :options="[
              { label: '繁体中文 (标准)', value: 's2t' },
              { label: '台湾正体', value: 's2tw' },
              { label: '香港繁体', value: 's2hk' },
            ]"
            class="set"
          />
        </n-card>
      </n-collapse-transition>

      <!-- 在线 TTML -->
      <n-card class="set-item">
        <div class="label">
          <n-text class="name">
            启用在线 TTML 歌词
            <n-tag type="warning" size="small" round> Beta </n-tag>
          </n-text>
          <n-text class="tip" :depth="3">
            是否从 AMLL TTML DB 获取歌词（如有），TTML
            歌词支持逐字、翻译、音译等功能，将会在下一首歌生效
          </n-text>
        </div>
        <n-switch v-model:value="settingStore.enableOnlineTTMLLyric" class="set" :round="false" />
      </n-card>
      <n-collapse-transition :show="settingStore.enableOnlineTTMLLyric">
        <n-card class="set-item">
          <div class="label">
            <n-text class="name">AMLL TTML DB 地址</n-text>
            <n-text class="tip" :depth="3">
              AMLL TTML DB 地址，请确保地址正确，否则将导致歌词获取失败
            </n-text>
          </div>
          <n-button type="primary" strong secondary @click="openAMLLServer"> 配置 </n-button>
        </n-card>
      </n-collapse-transition>

      <!-- 歌词排除与屏蔽词 -->
      <n-card class="set-item">
        <div class="label">
          <n-text class="name">启用歌词排除</n-text>
          <n-text class="tip" :depth="3">
            开启后可配置排除歌词，包含关键词或匹配正则表达式的歌词行将不会显示
          </n-text>
        </div>
        <n-switch v-model:value="settingStore.enableExcludeLyrics" class="set" :round="false" />
      </n-card>
      <n-collapse-transition :show="settingStore.enableExcludeLyrics">
        <n-card class="set-item">
          <div class="label">
            <n-text class="name">TTML 歌词排除</n-text>
            <n-text class="tip" :depth="3">
              是否要对 TTML 歌词进行歌词排除 <br />
              AMLL TTML DB 对此有硬性规定，不得包含作词、作曲等歌词无关内容，因此大多情况下无需开启
            </n-text>
          </div>
          <n-switch v-model:value="settingStore.enableExcludeTTML" class="set" :round="false" />
        </n-card>
        <n-card v-if="isElectron" class="set-item">
          <div class="label">
            <n-text class="name">本地歌词排除</n-text>
            <n-text class="tip" :depth="3">
              是否要对来自本地的歌词进行歌词排除，这包含本地覆盖的在线歌词和本地歌曲中的歌词
            </n-text>
          </div>
          <n-switch
            v-model:value="settingStore.enableExcludeLocalLyrics"
            class="set"
            :round="false"
          />
        </n-card>
        <n-card class="set-item">
          <div class="label">
            <n-text class="name">歌词排除内容</n-text>
            <n-text class="tip" :depth="3"> 包含关键词或匹配正则表达式的歌词行将不会显示 </n-text>
          </div>
          <n-button type="primary" strong secondary @click="openLyricExclude">配置</n-button>
        </n-card>
        <n-card class="set-item">
          <div class="label">
            <n-text class="name">还原屏蔽词</n-text>
            <n-text class="tip" :depth="3">
              将歌词中被星号遮盖的脏话（如 f\*\*k）还原为原词
            </n-text>
          </div>
          <n-switch v-model:value="settingStore.uncensorLyrics" class="set" :round="false" />
        </n-card>
      </n-collapse-transition>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useSettingStore } from "@/stores";
import { isElectron } from "@/utils/env";
import { openAMLLServer, openLyricExclude } from "@/utils/modal";

const settingStore = useSettingStore();
</script>
