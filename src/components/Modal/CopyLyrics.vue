<template>
  <div class="copy-lyrics">
    <n-scrollbar class="lyrics-list">
      <n-checkbox-group v-model:value="selectedLines">
        <n-list hoverable>
          <n-list-item v-for="line in displayLyrics" :key="line.index">
            <n-checkbox :value="line.index" class="lyric-checkbox">
              <n-flex size="small" class="lyric-content" vertical>
                <n-text v-if="line.text" class="text">{{ line.text }}</n-text>
                <n-text v-if="showTranslation && line.translation" depth="1" class="translation">
                  {{ line.translation }}
                </n-text>
                <n-text v-if="showRomaji && line.romaji" depth="3" class="romaji">
                  {{ line.romaji }}
                </n-text>
              </n-flex>
            </n-checkbox>
          </n-list-item>
        </n-list>
      </n-checkbox-group>
    </n-scrollbar>
    <n-flex align="center" justify="space-between" class="footer">
      <n-flex align="center">
        <n-checkbox-group v-model:value="selectedFilters">
          <n-flex align="center">
            <n-checkbox value="translation" label="翻译" />
            <n-checkbox value="romaji" label="音译" />
          </n-flex>
        </n-checkbox-group>
      </n-flex>
      <n-flex align="center">
        <n-button @click="selectAll">全选</n-button>
        <n-button
          :loading="exporting"
          :disabled="selectedLines.length === 0"
          @click="handleExportImage"
        >
          导出图片
        </n-button>
        <n-button type="primary" :disabled="selectedLines.length === 0" @click="handleCopy">
          复制 ({{ selectedLines.length }})
        </n-button>
      </n-flex>
    </n-flex>
  </div>
</template>

<script setup lang="ts">
import { useMusicStore, useStatusStore } from "@/stores";
import { copyData } from "@/utils/helper";
import { getPlayerInfoObj } from "@/utils/format";
import { exportLyricPoster } from "@/utils/lyric/posterExport";

const props = defineProps<{ onClose: () => void }>();

const musicStore = useMusicStore();
const statusStore = useStatusStore();

const selectedFilters = ref<string[]>(["translation", "romaji"]);
const selectedLines = ref<number[]>([]);

const rawLyrics = computed(() => {
  const { songLyric } = musicStore;
  return songLyric.yrcData?.length ? songLyric.yrcData : songLyric.lrcData;
});

const displayLyrics = computed(() => {
  return rawLyrics.value
    // 过滤背景人声行，避免海报重复
    .filter((line) => !line.isBG)
    .map((line, index) => {
      const text =
        line.words?.map((w) => w.word).join("") || "";
      const translation = line.translatedLyric || "";
      const romaji = line.romanLyric || line.words?.map((w) => w.romanWord).join("") || "";
      return {
        index,
        text,
        translation,
        romaji,
        duet: !!line.isDuet,
      };
    });
});

const showTranslation = computed(() => selectedFilters.value.includes("translation"));
const showRomaji = computed(() => selectedFilters.value.includes("romaji"));

const selectAll = () => {
  if (selectedLines.value.length === displayLyrics.value.length) {
    selectedLines.value = [];
  } else {
    selectedLines.value = displayLyrics.value.map((l) => l.index);
  }
};

/**
 * 复制歌词
 */
const handleCopy = async () => {
  const linesToCopy = displayLyrics.value
    .filter((l) => selectedLines.value.includes(l.index))
    .map((l) => {
      const parts: string[] = [];
      if (l.text) parts.push(l.text);
      if (showTranslation.value && l.translation) parts.push(l.translation);
      if (showRomaji.value && l.romaji) parts.push(l.romaji);
      return parts.join("\n");
    })
    .filter((s) => s)
    .join("\n\n");

  if (linesToCopy) {
    await copyData(linesToCopy);
    props.onClose();
  } else {
    window.$message.warning("没有可复制的内容");
  }
};

/** 导出中，防重复点击 */
const exporting = ref(false);

/**
 * 导出歌词图片（海报）
 * 借鉴 SPlayer-Next 的 Canvas 海报方案，移动端落盘后调起分享 / 预览
 */
const handleExportImage = async () => {
  if (exporting.value || selectedLines.value.length === 0) return;
  const lines = displayLyrics.value
    .filter((l) => selectedLines.value.includes(l.index))
    .map((l) => ({
      text: l.text,
      translation: showTranslation.value && l.translation ? l.translation : undefined,
      romaji: showRomaji.value && l.romaji ? l.romaji : undefined,
      duet: l.duet,
    }))
    .filter((l) => l.text || l.translation || l.romaji);
  if (!lines.length) {
    window.$message.warning("没有可导出的歌词");
    return;
  }
  exporting.value = true;
  const loading = window.$message.loading("正在生成歌词图片...", { duration: 0 });
  try {
    const info = getPlayerInfoObj(musicStore.playSong);
    const result = await exportLyricPoster({
      title: info?.name || musicStore.playSong.name || "未知歌曲",
      artist: info?.artist || "未知歌手",
      cover: musicStore.getSongCover("l"),
      lines,
      fallbackColor: statusStore.mainColor,
    });
    if (!result.success) {
      window.$message.error(result.message || "导出图片失败");
      return;
    }
    if (result.action === "shared") {
      window.$message.success("已调起分享");
    } else if (result.action === "downloaded") {
      window.$message.success("歌词图片已下载");
    } else {
      window.$message.success(`已保存：${result.fileName}`);
    }
  } catch (error) {
    console.error("导出歌词图片失败", error);
    window.$message.error("导出图片失败");
  } finally {
    loading.destroy();
    exporting.value = false;
  }
};
</script>

<style lang="scss" scoped>
.copy-lyrics {
  display: flex;
  flex-direction: column;
  height: 60vh;
  width: 100%;
}

.lyrics-list {
  flex: 1;

  .lyric-checkbox {
    width: 100%;
  }

  .lyric-content {
    font-size: 14px;
    line-height: 1.6;
    .translation {
      font-size: 12px;
    }
    .romaji {
      font-size: 12px;
      font-style: italic;
    }
  }
}

.footer {
  margin-top: 20px;
}
</style>
