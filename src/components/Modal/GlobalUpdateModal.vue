<template>
  <n-modal
    v-model:show="showModal"
    :mask-closable="!versionStore.versionInfo?.isForce && !versionStore.isDownloading"
    :close-on-esc="!versionStore.versionInfo?.isForce && !versionStore.isDownloading"
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

      <!-- 安装权限提示 -->
      <div
        v-if="versionStore.isDownloading || versionStore.downloadStatus === 'completed'"
        class="install-tip"
      >
        <n-text :depth="3">
          首次安装若系统弹出提示，请开启“允许安装未知应用”
        </n-text>
      </div>

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
        <!-- 降级通道：原生下载失败或报错时展示 -->
        <n-button
          v-if="versionStore.downloadStatus === 'error' || versionStore.errorMessage"
          quaternary
          type="info"
          @click="handleBrowserDownload"
        >
          浏览器下载
        </n-button>
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
          :disabled="versionStore.isDownloading"
          @click="handleUpdate"
        >
          {{ buttonText }}
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

// 操作按钮文案
const buttonText = computed(() => {
  if (versionStore.isDownloading) {
    return `下载中 ${versionStore.downloadProgress}%`;
  }
  if (versionStore.downloadStatus === 'completed') {
    return '安装更新';
  }
  return '立即更新';
});

// 监听更新状态
watch(
  () => versionStore.hasUpdate,
  (hasUpdate) => {
    if (hasUpdate && versionStore.versionInfo) {
      showModal.value = true;
    }
  },
  { immediate: true }
);

// 开始更新或重新拉起安装
const handleUpdate = async () => {
  await versionStore.downloadUpdate();
};

// 降级使用浏览器下载
const handleBrowserDownload = () => {
  versionStore.downloadViaBrowser();
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

  .install-tip {
    font-size: 12px;
    margin-bottom: 14px;
    text-align: center;
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
