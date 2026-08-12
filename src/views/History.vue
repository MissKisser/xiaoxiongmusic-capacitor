<template>
  <div class="history">
    <div class="title">
      <n-text class="keyword">最近播放</n-text>
      <n-text class="size" depth="3">共 {{ dataStore.historyList?.length || 0 }} 首</n-text>
    </div>
    <n-flex class="menu">
      <n-button
        :focusable="false"
        :disabled="!dataStore.historyList?.length"
        type="primary"
        strong
        secondary
        round
        v-debounce="() => player.updatePlayList(dataStore.historyList)"
      >
        <template #icon>
          <SvgIcon name="Play" />
        </template>
        播放
      </n-button>
      <n-button
        :focusable="false"
        :disabled="!dataStore.historyList?.length"
        class="more"
        strong
        secondary
        round
        @click="cleanHistory"
      >
        <template #icon>
          <SvgIcon name="Delete" />
        </template>
        清空列表
      </n-button>
    </n-flex>
    <!-- 收听统计 -->
    <div v-if="statsLoaded" class="stats">
      <div class="stat-item">
        <div class="stat-value">{{ formatDuration(totalListenMs) }}</div>
        <div class="stat-label">累计收听</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">{{ statsCount }}</div>
        <div class="stat-label">统计歌曲</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">{{ totalPlayCount }}</div>
        <div class="stat-label">播放次数</div>
      </div>
    </div>
    <Transition name="fade" mode="out-in">
      <SongList
        v-if="dataStore.historyList.length > 0"
        :data="dataStore.historyList"
        :loading="false"
        hiddenCover
        hiddenSize
      />
      <n-empty
        v-else
        description="暂无记录，快去播放一些歌曲吧"
        style="margin-top: 60px"
        size="large"
      >
        <template #icon>
          <SvgIcon name="SearchOff" />
        </template>
      </n-empty>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { useDataStore } from "@/stores";
import { usePlayerController } from "@/core/player/PlayerController";
import { loadPlayStats } from "@/core/player/PlayStats";

const player = usePlayerController();
const dataStore = useDataStore();

// 收听统计
const statsLoaded = ref(false);
const totalListenMs = ref(0);
const statsCount = ref(0);
const totalPlayCount = ref(0);

// 加载播放统计
const loadStats = async () => {
  try {
    const entries = await loadPlayStats();
    const values = Object.values(entries);
    statsCount.value = values.length;
    totalListenMs.value = values.reduce((sum, s) => sum + s.totalListenMs, 0);
    totalPlayCount.value = values.reduce((sum, s) => sum + s.playCount, 0);
    statsLoaded.value = true;
  } catch {
    statsLoaded.value = false;
  }
};

// 格式化时长（小时/分钟/秒）
const formatDuration = (ms: number): string => {
  if (ms <= 0) return "0s";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
};

// 清空最近播放
const cleanHistory = () => {
  window.$dialog.warning({
    title: "清空列表",
    content: "确认清空最近播放列表？该操作不可撤销！",
    positiveText: "确认",
    negativeText: "取消",
    onPositiveClick: async () => {
      await dataStore.clearHistory();
      window.$message.success("最近播放列表已清空");
    },
  });
};

onMounted(loadStats);
</script>

<style lang="scss" scoped>
.history {
  display: flex;
  flex-direction: column;
  height: 100%;
  .title {
    display: flex;
    align-items: flex-end;
    line-height: normal;
    margin-top: 12px;
    margin-bottom: 20px;
    .keyword {
      font-size: 30px;
      font-weight: bold;
      margin-right: 8px;
      line-height: normal;
    }
    .size {
      font-size: 15px;
      font-weight: normal;
      line-height: 30px;
    }
  }
  .menu {
    width: 100%;
    margin-bottom: 12px;
    .n-button {
      height: 40px;
      transition: all 0.3s var(--n-bezier);
    }
  }
  .song-list {
    flex: 1;
    overflow: hidden;
  }
  .stats {
    display: flex;
    gap: 12px;
    margin-bottom: 16px;

    .stat-item {
      flex: 1;
      padding: 14px 16px;
      background-color: var(--n-color);
      border-radius: 12px;
      text-align: center;

      .stat-value {
        font-size: 22px;
        font-weight: bold;
        font-variant-numeric: tabular-nums;
      }

      .stat-label {
        font-size: 12px;
        opacity: 0.6;
        margin-top: 4px;
      }
    }
  }
}
</style>
