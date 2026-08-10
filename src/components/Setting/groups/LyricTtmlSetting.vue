<template>
  <div class="setting-type">
    <div class="set-list">
      <n-h3 prefix="bar"> 本地 TTML 歌词库 </n-h3>
      <n-card class="set-item" id="lyrics-local-ttml">
        <div class="label">
          <n-text class="name">本地 TTML 歌词库</n-text>
          <n-text class="tip" :depth="3">
            通过 Capacitor Filesystem 管理的本地 TTML 文件，按歌曲名/歌手匹配
          </n-text>
        </div>
        <div class="local-ttml-toolbar">
          <input
            ref="localTtmlFileInput"
            type="file"
            accept=".ttml,text/xml,application/xml"
            multiple
            hidden
            @change="onLocalTtmlPick"
          />
          <n-button type="primary" strong @click="openLocalTtmlPicker">
            导入 TTML 文件
          </n-button>
          <n-button @click="refreshLocalTtml"> 刷新列表 </n-button>
        </div>
        <n-empty v-if="!localTtmlList.length" description="暂无本地 TTML 文件" />
        <n-scrollbar v-else style="max-height: 220px" trigger="none">
          <n-list bordered class="local-ttml-list">
            <n-list-item v-for="item in localTtmlList" :key="item.path">
              <div class="local-ttml-row">
                <div class="local-ttml-info">
                  <n-text class="local-ttml-name">{{ item.name }}</n-text>
                  <n-text class="local-ttml-meta" :depth="3">
                    {{ formatSize(item.size) }} · {{ formatTime(item.mtime) }}
                  </n-text>
                </div>
                <n-flex>
                  <n-button size="tiny" @click="renameLocalTtmlItem(item)">
                    重命名
                  </n-button>
                  <n-popconfirm @positive-click="removeLocalTtmlItem(item)">
                    <template #trigger>
                      <n-button size="tiny" type="error"> 删除 </n-button>
                    </template>
                    确认删除 {{ item.name }}？
                  </n-popconfirm>
                </n-flex>
              </div>
            </n-list-item>
          </n-list>
        </n-scrollbar>
      </n-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  deleteLocalTtml,
  listLocalTtml,
  renameLocalTtml,
  saveLocalTtml,
  type LocalTtmlEntry,
} from "@/services/localTtmlRepo";
import {
  NButton,
  NEmpty,
  NFlex,
  NList,
  NListItem,
  NPopconfirm,
  NScrollbar,
  NText,
} from "naive-ui";

/**
 * 本地 TTML 歌词库管理
 * Based on SPlayer-Next
 * Copyright (C) 2024 SPlayer-Dev
 * Licensed under AGPL-3.0
 */
const localTtmlList = ref<LocalTtmlEntry[]>([]);
const localTtmlFileInput = ref<HTMLInputElement | null>(null);

const refreshLocalTtml = async () => {
  localTtmlList.value = await listLocalTtml();
};

const openLocalTtmlPicker = () => {
  localTtmlFileInput.value?.click();
};

const formatSize = (bytes: number) => {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
};

const formatTime = (timestamp: number) => {
  if (!timestamp) return "—";
  try {
    return new Date(timestamp).toLocaleString();
  } catch {
    return "—";
  }
};

const onLocalTtmlPick = async (event: Event) => {
  const target = event.target as HTMLInputElement;
  const files = Array.from(target.files ?? []);
  target.value = "";
  if (!files.length) return;
  let success = 0;
  for (const file of files) {
    if (!/\.ttml$/i.test(file.name) && !/xml/.test(file.type)) {
      window.$message.warning(`已跳过非 TTML 文件: ${file.name}`);
      continue;
    }
    try {
      const text = await file.text();
      await saveLocalTtml(file.name, text);
      success += 1;
    } catch (err) {
      console.error("保存本地 TTML 失败", err);
      window.$message.error(`保存失败: ${file.name}`);
    }
  }
  if (success > 0) window.$message.success(`已导入 ${success} 个 TTML 文件`);
  await refreshLocalTtml();
};

const removeLocalTtmlItem = async (item: LocalTtmlEntry) => {
  try {
    await deleteLocalTtml(item.path);
    window.$message.success(`已删除 ${item.name}`);
    await refreshLocalTtml();
  } catch (err) {
    console.error("删除本地 TTML 失败", err);
    window.$message.error(`删除失败: ${item.name}`);
  }
};

const renameLocalTtmlItem = async (item: LocalTtmlEntry) => {
  const next = window.prompt("新的文件名（无需 .ttml 后缀）", item.name.replace(/\.ttml$/i, ""));
  if (!next) return;
  try {
    await renameLocalTtml(item.path, next);
    window.$message.success("重命名成功");
    await refreshLocalTtml();
  } catch (err) {
    console.error("重命名本地 TTML 失败", err);
    window.$message.error(`重命名失败: ${item.name}`);
  }
};

onMounted(refreshLocalTtml);
</script>

<style lang="scss" scoped>
#lyrics-local-ttml {
  .local-ttml-toolbar {
    display: flex;
    gap: 8px;
    margin-bottom: 12px;
  }
  .local-ttml-list {
    .local-ttml-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      width: 100%;
    }
    .local-ttml-info {
      display: flex;
      flex-direction: column;
      min-width: 0;
      flex: 1;
    }
    .local-ttml-name {
      font-size: 14px;
      font-weight: 500;
      word-break: break-all;
    }
    .local-ttml-meta {
      font-size: 12px;
    }
  }
}
</style>
