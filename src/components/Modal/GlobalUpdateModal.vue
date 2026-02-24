<template>
  <n-modal
    v-model:show="showModal"
    :mask-closable="!versionStore.versionInfo?.isForce"
    :close-on-esc="!versionStore.versionInfo?.isForce"
    :closable="false"
    :show-icon="false"
    preset="card"
    class="global-update-modal"
    title="发现新版本"
    style="width: 90%; max-width: 420px;"
  >
    <div class="update-content">
      <!-- 版本信息 -->
      <n-flex :size="10" class="version-tags" align="center">
        <n-tag :bordered="false" type="info" size="small">
          当前 {{ versionStore.currentVersion }}
        </n-tag>
        <SvgIcon name="Right" :size="16" />
        <n-tag :bordered="false" type="warning" size="small">
          最新 {{ versionStore.versionInfo?.version }}
        </n-tag>
        <n-tag v-if="versionStore.versionInfo?.isForce" type="error" size="small">
          强制更新
        </n-tag>
      </n-flex>

      <!-- 更新日志 -->
      <n-scrollbar style="max-height: 300px; margin: 16px 0;">
        <div
          v-if="versionStore.versionInfo?.description"
          class="markdown-body update-desc"
          v-html="renderedDescription"
        />
        <div v-else class="update-desc empty">
          暂无更新说明
        </div>
      </n-scrollbar>

      <!-- 下载进度 -->
      <n-progress
        v-if="versionStore.isDownloading"
        type="line"
        :percentage="versionStore.downloadProgress"
        :show-indicator="true"
        status="info"
        style="margin-bottom: 16px;"
      />

      <!-- 错误提示 -->
      <n-alert
        v-if="versionStore.errorMessage"
        type="error"
        :show-icon="true"
        style="margin-bottom: 16px;"
      >
        {{ versionStore.errorMessage }}
      </n-alert>

      <!-- 操作按钮 -->
      <n-flex justify="end" :size="12">
        <n-button
          v-if="!versionStore.versionInfo?.isForce"
          secondary
          :disabled="versionStore.isDownloading"
          @click="handleSkip"
        >
          稍后再说
        </n-button>
        <n-button
          type="primary"
          :loading="versionStore.isDownloading"
          @click="handleUpdate"
        >
          {{ versionStore.isDownloading ? `下载中 ${versionStore.downloadProgress}%` : '立即更新' }}
        </n-button>
      </n-flex>
    </div>
  </n-modal>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useVersionStore } from '@/stores/version';
import { marked } from 'marked';

const versionStore = useVersionStore();

const showModal = ref(false);

// 渲染 Markdown
const renderedDescription = computed(() => {
  if (!versionStore.versionInfo?.description) return '';
  return marked.parse(versionStore.versionInfo.description);
});

// 监听更新状态
watch(() => versionStore.hasUpdate, (hasUpdate) => {
  if (hasUpdate && versionStore.versionInfo) {
    showModal.value = true;
  }
}, { immediate: true });

// 开始更新
const handleUpdate = async () => {
  await versionStore.downloadUpdate();
};

// 跳过更新
const handleSkip = () => {
  showModal.value = false;
  versionStore.reset();
};
</script>

<style lang="scss" scoped>
.global-update-modal {
  :deep(.n-card) {
    border-radius: 16px;
  }
}

.update-content {
  .version-tags {
    margin-bottom: 12px;
  }

  .update-desc {
    font-size: 14px;
    line-height: 1.6;
    color: var(--n-text-color-2);

    &.empty {
      text-align: center;
      color: var(--n-text-color-3);
      padding: 20px 0;
    }
  }

  :deep(.markdown-body) {
    background: transparent;
    font-size: 14px;

    h1, h2, h3, h4 {
      margin-top: 12px;
      margin-bottom: 8px;
    }

    ul, ol {
      padding-left: 20px;
    }

    li {
      margin: 4px 0;
    }
  }
}
</style>
