<template>
  <div class="home">
    <div v-if="settingStore.showHomeGreeting" class="welcome">
      <n-h1>{{ greetings }}</n-h1>
      <n-text depth="3">由此开启好心情 ~</n-text>
    </div>
    <!-- 在线模式 -->
    <HomePlatform v-if="settingStore.useOnlineService && isPlatformSource" />
    <HomeOnline v-else-if="settingStore.useOnlineService" />
    <!-- 本地模式 -->
    <HomeLocal v-else />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { usePlatformStore, useSettingStore } from "@/stores";
import { getGreeting } from "@/utils/time";
import HomeOnline from "./HomeOnline.vue";
import HomeLocal from "./HomeLocal.vue";
import HomePlatform from "./HomePlatform.vue";

const settingStore = useSettingStore();
const platformStore = usePlatformStore();

// 是否为第三方平台（QQ 音乐 / 酷狗）
const isPlatformSource = computed<boolean>(() => platformStore.currentPlatform !== "netease");

// 问候语
const greetings = computed(getGreeting);
</script>

<style lang="scss" scoped>
.home {
  width: 100%;
  max-width: 1500px;
  margin: 0 auto;
  .welcome {
    font-size: calc(15px * var(--home-card-scale, 1));
    margin-top: 5px;
    margin-bottom: 20px;
    .n-h1 {
      font-size: calc(24px * var(--home-card-scale, 1));
      margin: 0;
      font-weight: bold;
    }
  }
}
</style>
