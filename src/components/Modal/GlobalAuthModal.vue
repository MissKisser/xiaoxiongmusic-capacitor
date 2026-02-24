<template>
  <n-modal
    v-model:show="showModal"
    :mask-closable="false"
    :close-on-esc="false"
    :closable="false"
    :show-icon="false"
    preset="card"
    class="global-auth-modal"
    title="应用授权"
    style="width: 90%; max-width: 420px;"
  >
    <div class="auth-content">
      <!-- 授权图标 -->
      <div class="auth-icon">
        <SvgIcon name="Lock" :size="48" />
      </div>
      
      <p class="auth-desc">
        请输入授权码以继续使用本应用
      </p>

      <n-input
        v-model:value="inputCode"
        placeholder="请输入授权码"
        size="large"
        :disabled="authStore.isChecking"
        class="auth-input"
        @keyup.enter="handleVerify"
      />

      <n-alert
        v-if="errorMessage"
        type="error"
        :show-icon="true"
        class="error-alert"
      >
        {{ errorMessage }}
      </n-alert>

      <n-button
        type="primary"
        size="large"
        block
        :loading="authStore.isChecking"
        :disabled="!inputCode.trim()"
        class="auth-btn"
        @click="handleVerify"
      >
        {{ authStore.isChecking ? '验证中...' : '验证授权' }}
      </n-button>
    </div>
  </n-modal>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useAuthStore } from '@/stores/auth';

const authStore = useAuthStore();

const inputCode = ref('');
const errorMessage = ref<string | null>(null);

// 控制显示
const showModal = computed(() => !authStore.isAuthorized);

// 监听 store 的错误消息
watch(() => authStore.errorMessage, (msg) => {
  if (msg) {
    errorMessage.value = msg;
  }
});

// 验证授权码
const handleVerify = async () => {
  if (!inputCode.value.trim()) return;
  
  errorMessage.value = null;
  const result = await authStore.verifyCode(inputCode.value);
  
  if (!result.success) {
    errorMessage.value = result.message;
  }
};
</script>

<style lang="scss" scoped>
.global-auth-modal {
  :deep(.n-card) {
    border-radius: 16px;
  }
}

.auth-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;

  .auth-icon {
    width: 80px;
    height: 80px;
    border-radius: 50%;
    background: var(--n-color-primary-suppl, rgba(255, 90, 95, 0.12));
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 16px;
    
    :deep(.n-icon) {
      font-size: 48px;
      color: var(--n-color-primary);
    }
  }

  .auth-desc {
    font-size: 14px;
    color: var(--n-text-color-2);
    margin-bottom: 20px;
    text-align: center;
    line-height: 1.6;
  }

  .auth-input {
    margin-bottom: 16px;
    width: 100%;
  }

  .error-alert {
    width: 100%;
    margin-bottom: 16px;
  }

  .auth-btn {
    margin-top: 8px;
    width: 100%;
  }
}
</style>
