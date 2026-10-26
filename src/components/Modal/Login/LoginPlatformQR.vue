<!-- 第三方平台扫码登录弹窗（支持 QQ 扫码 / 微信扫码 / 酷狗 H5 扫码） -->
<template>
  <div class="platform-login">
    <div class="qr-box">
      <div v-if="qrContent && !isFetchingQr" :class="['qr', { success: statusCode === 2 }]">
        <!-- 后端下发的二维码图片（QQ 音乐原生扫码） -->
        <img v-if="isImageQr" :src="qrContent" class="qr-image" alt="qrcode" />
        <!-- 需要前端编码的二维码内容（酷狗等） -->
        <n-qr-code
          v-else
          :value="qrContent"
          :size="240"
          :icon-size="36"
          icon-src="/images/logo.png?asset"
          error-correction-level="H"
        />
        <!-- 待确认 -->
        <Transition name="fade" mode="out-in">
          <div v-if="loginName" class="login-data">
            <n-image :src="loginAvatar" class="cover" preview-disabled />
            <n-text>{{ loginName }}</n-text>
          </div>
        </Transition>
      </div>
      <!-- 加载中状态 -->
      <div v-else-if="isFetchingQr" class="qr qr-loading">
        <n-spin size="large">
          <template #description>
            <div class="loading-desc">
              <n-text depth="3">
                {{ scanType === "wx" ? "正在获取微信二维码..." : "正在生成二维码..." }}
              </n-text>
              <n-button
                size="tiny"
                secondary
                strong
                round
                class="cancel-load-btn"
                @click="cancelGetQr"
              >
                取消获取
              </n-button>
            </div>
          </template>
        </n-spin>
      </div>
      <n-skeleton v-else class="qr" />
    </div>

    <!-- 引导文案与状态文案 -->
    <n-text class="guide-tip" depth="2">{{ guideTipText }}</n-text>
    <n-text class="tip" depth="3">{{ tipText }}</n-text>

    <!-- 扫码方式（QQ 音乐支持 QQ / 微信两种扫码协议） -->
    <n-radio-group
      v-if="platform === 'qqmusic'"
      v-model:value="scanType"
      size="small"
      class="scan-type"
    >
      <n-radio value="qq">QQ 扫码</n-radio>
      <n-radio value="wx">微信扫码</n-radio>
    </n-radio-group>

    <!-- 操作按钮区 -->
    <n-flex vertical align="center" size="small" class="actions">
      <!-- 保存二维码到相册 -->
      <n-button
        v-if="qrContent && !isFetchingQr && statusCode !== 4"
        :focusable="false"
        :loading="isSaving"
        size="small"
        type="primary"
        secondary
        round
        class="save-btn"
        @click="saveQrToAlbum"
      >
        <template #icon>
          <SvgIcon name="Download" />
        </template>
        保存二维码到相册
      </n-button>

      <!-- 关闭按钮 -->
      <n-button :focusable="false" class="close" strong secondary round @click="handleClose">
        <template #icon>
          <SvgIcon name="WindowClose" />
        </template>
        取消
      </n-button>
    </n-flex>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from "vue";
import type { ApiPlatform } from "@/types/shared";
import { platformCall } from "@/api/platform/music";
import { usePlatformStore } from "@/stores";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { isCapacitor } from "@/utils/env";
import SvgIcon from "@/components/Global/SvgIcon.vue";

const props = defineProps<{
  /** 音源平台 */
  platform: ApiPlatform;
}>();

const emit = defineEmits<{
  close: [];
}>();

const platformStore = usePlatformStore();

/** 扫码方式（QQ 音乐支持 QQ / 微信两种原生扫码协议） */
const scanType = ref<"qq" | "wx">("qq");

/** 二维码内容 */
const qrContent = ref<string>("");

/** 二维码 key（QQ 为 qrsig，酷狗为 qrcode） */
const qrKey = ref<string>("");

/** 扫描状态码 */
const statusCode = ref<number>(1);

/** 待确认的昵称与头像 */
const loginName = ref<string>("");
const loginAvatar = ref<string>("");

/** 是否正在获取二维码 */
const isFetchingQr = ref<boolean>(false);

/** 保存到相册加载状态 */
const isSaving = ref<boolean>(false);

/** 取码请求序号 */
let qrFetchSeq = 0;

/** 取码超时定时器（微信取码预算 ≥30s） */
let qrFetchTimeoutTimer: ReturnType<typeof setTimeout> | null = null;

/** 状态提示文案 */
const statusTip = {
  0: "二维码已失效，正在刷新",
  1: "请扫码登录",
  2: "扫描成功，请在手机中确认登录",
  4: "登录成功",
} as const;

/** 当前状态提示文案 */
const tipText = computed(() => {
  return statusTip[statusCode.value as keyof typeof statusTip] ?? "遇到未知状态，请重试";
});

/** 扫码引导文案 */
const guideTipText = computed(() => {
  if (props.platform === "qqmusic") {
    return scanType.value === "wx"
      ? "请使用另一台手机微信扫一扫"
      : "请使用另一台手机 QQ 扫一扫";
  }
  return "请使用另一台手机酷狗音乐扫一扫";
});

/** 二维码内容是否为后端下发的图片 */
const isImageQr = computed(() => qrContent.value.startsWith("data:image/"));

/** 取消获取二维码 */
const cancelGetQr = () => {
  isFetchingQr.value = false;
  qrFetchSeq++;
  if (qrFetchTimeoutTimer) {
    clearTimeout(qrFetchTimeoutTimer);
    qrFetchTimeoutTimer = null;
  }
};

/**
 * 获取二维码
 *
 * 微信取码支持 ≥30s 超时预算（35s）与取消操作
 */
const getQrData = async () => {
  const currentSeq = ++qrFetchSeq;
  pauseCheck();
  statusCode.value = 1;
  loginName.value = "";
  loginAvatar.value = "";
  isFetchingQr.value = true;
  qrContent.value = "";
  qrKey.value = "";

  if (qrFetchTimeoutTimer) {
    clearTimeout(qrFetchTimeoutTimer);
    qrFetchTimeoutTimer = null;
  }

  // 微信取码路给 ≥30s 超时预算（35s），其他路 15s
  const timeoutBudget = scanType.value === "wx" ? 35000 : 15000;
  qrFetchTimeoutTimer = setTimeout(() => {
    if (currentSeq === qrFetchSeq && isFetchingQr.value) {
      isFetchingQr.value = false;
      window.$message.error(
        scanType.value === "wx"
          ? "获取微信二维码超时，请重试或改用 QQ 扫码"
          : "获取二维码超时，请重试",
      );
    }
  }, timeoutBudget);

  try {
    const res = await platformCall<{ code: number; key: string; content: string }>(
      props.platform,
      "login_qr_key",
      props.platform === "qqmusic" ? { type: scanType.value } : {},
    );
    if (currentSeq !== qrFetchSeq) return;
    if (qrFetchTimeoutTimer) {
      clearTimeout(qrFetchTimeoutTimer);
      qrFetchTimeoutTimer = null;
    }
    isFetchingQr.value = false;
    qrKey.value = res.key;
    qrContent.value = res.content;
    resumeCheck();
  } catch (error) {
    if (currentSeq !== qrFetchSeq) return;
    if (qrFetchTimeoutTimer) {
      clearTimeout(qrFetchTimeoutTimer);
      qrFetchTimeoutTimer = null;
    }
    isFetchingQr.value = false;
    console.error("二维码获取失败：", error);
    window.$message.error(
      scanType.value === "wx"
        ? "微信二维码获取失败，请重试或改用 QQ 扫码"
        : "二维码获取失败，请重试",
    );
  }
};

/**
 * 轮询二维码状态
 */
const checkQrStatus = async () => {
  if (!qrKey.value || isFetchingQr.value) return;
  try {
    const res = await platformCall<{
      code: number;
      status: number;
      nickname?: string;
      avatarUrl?: string;
    }>(props.platform, "login_qr_check", {
      key: qrKey.value,
      type: scanType.value,
    });
    statusCode.value = res.status ?? 1;
    if (res.nickname) loginName.value = res.nickname;
    if (res.avatarUrl) loginAvatar.value = res.avatarUrl.replace(/^http:/, "https:");
    // 二维码失效：重新取一个
    if (statusCode.value === 0) {
      getQrData();
      return;
    }
    // 登录成功：刷新账号资料并切换到该平台
    if (statusCode.value === 4) {
      pauseCheck();
      await platformStore.refreshProfile(props.platform);
      platformStore.switchPlatform(props.platform);
      window.$message.success("登录成功");
      emit("close");
    }
  } catch (error) {
    console.error("二维码状态检查失败：", error);
  }
};

/**
 * 保存二维码到系统相册（失败降级保存到文档目录）
 */
const saveQrToAlbum = async () => {
  if (!qrContent.value) return;
  isSaving.value = true;
  try {
    let base64Data = "";
    if (isImageQr.value) {
      const commaIdx = qrContent.value.indexOf(",");
      base64Data = commaIdx >= 0 ? qrContent.value.slice(commaIdx + 1) : qrContent.value;
    } else {
      const qrEl = document.querySelector(".platform-login .qr");
      const canvas = qrEl?.querySelector("canvas");
      if (canvas) {
        const dataUrl = canvas.toDataURL("image/png");
        const commaIdx = dataUrl.indexOf(",");
        base64Data = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
      } else {
        throw new Error("无法读取二维码图像");
      }
    }

    const fileName = `xiaoxiong_qr_${props.platform}_${Date.now()}.png`;

    if (isCapacitor) {
      try {
        // 先尝试写 Directory.Photos（部分平台支持），失败降级 Directory.Documents 并提示路径
        const photosDir = (Directory as any).Photos;
        if (!photosDir) {
          throw new Error("Photos directory not supported");
        }
        await Filesystem.writeFile({
          path: fileName,
          data: base64Data,
          directory: photosDir,
        });
        window.$message.success("二维码已保存到系统相册");
      } catch (err) {
        console.warn("保存到相册失败，降级保存到文档目录:", err);
        try {
          const res = await Filesystem.writeFile({
            path: fileName,
            data: base64Data,
            directory: Directory.Documents,
          });
          const uri = res?.uri || fileName;
          window.$message.info(`已保存到文档目录: ${uri}`);
        } catch (fallbackErr) {
          console.error("保存到文档目录失败:", fallbackErr);
          window.$message.error("保存失败，请检查存储权限");
        }
      }
    } else {
      const a = document.createElement("a");
      a.href = `data:image/png;base64,${base64Data}`;
      a.download = fileName;
      a.click();
      window.$message.success("二维码已下载");
    }
  } catch (error: any) {
    console.error("保存二维码出错:", error);
    window.$message.error(error?.message || "保存二维码失败");
  } finally {
    isSaving.value = false;
  }
};

/** 轮询控制（每 2 秒一次） */
const { pause: pauseCheck, resume: resumeCheck } = useIntervalFn(checkQrStatus, 2000, {
  immediate: false,
});

/** 关闭弹窗处理 */
const handleClose = () => {
  cancelGetQr();
  pauseCheck();
  emit("close");
};

// 切换扫码方式后重新取码
watch(scanType, () => {
  getQrData();
});

onMounted(getQrData);
onBeforeUnmount(() => {
  cancelGetQr();
  pauseCheck();
});
</script>

<style lang="scss" scoped>
.platform-login {
  display: flex;
  flex-direction: column;
  align-items: center;
  max-height: calc(90vh - 120px);
  overflow-y: auto;
  padding: 4px;

  .qr-box {
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 8px 0 12px;
    width: 250px;
    height: 250px;

    .qr {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 240px;
      height: 240px;

      .qr-image {
        width: 240px;
        height: 240px;
        object-fit: contain;
      }

      .n-qr-code {
        padding: 0;
        height: 240px;
        width: 240px;
        min-height: 240px;
        min-width: 240px;
        transition:
          opacity 0.3s,
          filter 0.3s;

        :deep(canvas) {
          width: 100% !important;
          height: 100% !important;
        }
      }

      .login-data {
        position: absolute;
        display: flex;
        flex-direction: column;
        align-items: center;
        z-index: 1;

        .cover {
          width: 48px;
          height: 48px;
          border-radius: 50%;
          overflow: hidden;
          margin-bottom: 8px;
        }
      }

      &.qr-loading {
        background: rgba(var(--primary), 0.04);
        border-radius: 12px;
        .loading-desc {
          margin-top: 12px;
          display: flex;
          flex-direction: column;
          align-items: center;
        }
      }

      &.success {
        .n-qr-code,
        .qr-image {
          opacity: 0.5;
          filter: blur(4px);
        }
      }
    }
  }

  .guide-tip {
    font-size: 14px;
    font-weight: 500;
    margin-bottom: 4px;
    text-align: center;
  }

  .tip {
    font-size: 12px;
    margin-bottom: 12px;
    text-align: center;
  }

  .scan-type {
    margin-bottom: 12px;
    font-size: 12px;
  }

  .actions {
    margin-top: 4px;
    width: 100%;

    .save-btn {
      width: 180px;
      margin-bottom: 4px;
    }

    .close {
      width: 180px;
      margin-bottom: 4px;
    }
  }
}
</style>
