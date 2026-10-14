<template>
  <div class="song-unlock-manager">
    <n-alert title="免责声明" type="info">
      本功能仅作为测试使用，资源来自网络，若侵犯到您的权益，请及时联系我们删除
    </n-alert>
    <div class="channel-list">
      <n-card
        v-for="item in orderedServers"
        :key="item.key"
        :content-style="{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '16px',
        }"
        class="channel-item"
      >
        <div class="channel-info">
          <n-text class="name">{{ getUnlockSourceName(item.key) }}</n-text>
          <n-text :depth="3" class="key-name">{{ item.key }}</n-text>
        </div>
        <n-switch v-model:value="item.enabled" :round="false" />
      </n-card>
    </div>
    <n-text :depth="3" class="hint">
      解锁服务按固定优先级依次尝试（网易云 → 波点音乐 → 歌曲宝 → 酷我音乐），可在此单独启用或停用各渠道。
    </n-text>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useSettingStore } from "@/stores";
import {
  SONG_UNLOCK_PRIORITY,
  SongUnlockServer,
  getUnlockSourceName,
} from "@/core/player/SongManager";

const settingStore = useSettingStore();

/**
 * 按固定优先级展示解锁渠道列表
 */
const orderedServers = computed(() => {
  const byKey = new Map(settingStore.songUnlockServer.map((item) => [item.key, item]));
  return SONG_UNLOCK_PRIORITY.map((key) => {
    const existing = byKey.get(key);
    if (existing) return existing;
    const newItem = { key, enabled: key !== SongUnlockServer.KUWO };
    settingStore.songUnlockServer.push(newItem);
    return newItem;
  });
});
</script>

<style scoped lang="scss">
.song-unlock-manager {
  display: flex;
  flex-direction: column;
  gap: 12px;

  .channel-list {
    display: flex;
    flex-direction: column;
    gap: 12px;

    .channel-item {
      border-radius: 8px;

      .channel-info {
        display: flex;
        align-items: baseline;
        gap: 8px;

        .name {
          font-size: 16px;
          line-height: normal;
        }

        .key-name {
          font-size: 13px;
        }
      }

      .n-switch {
        margin-left: auto;
      }
    }
  }

  .hint {
    font-size: 13px;
    line-height: 1.5;
    padding: 0 4px;
  }
}
</style>
