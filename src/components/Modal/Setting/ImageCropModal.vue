<template>
  <div class="image-crop-modal">
    <n-text depth="3" style="display: block; margin-bottom: 12px">
      拖动裁剪框选择背景区域（9:16 竖屏比例）
    </n-text>
    <div class="crop-wrapper">
      <img ref="cropImageRef" :src="imageSrc" class="crop-image" />
      <div 
        ref="cropBoxRef"
        class="crop-box"
        :style="cropBoxStyle"
        @mousedown="startDrag"
        @touchstart="startDrag"
      >
        <div class="crop-handle" />
      </div>
    </div>
    <n-space justify="end" style="margin-top: 16px">
      <n-button @click="emit('cancel')">取消</n-button>
      <n-button type="primary" @click="handleConfirm">确认裁剪</n-button>
    </n-space>
  </div>
</template>

<script setup lang="ts">
/**
 * 图片裁剪弹窗组件
 * @author Hackerdallas
 */
import { useSettingStore } from "@/stores";

const props = defineProps<{
  imageSrc: string;
}>();

const emit = defineEmits<{
  (e: "cancel"): void;
  (e: "confirm"): void;
}>();

const settingStore = useSettingStore();
const cropImageRef = ref<HTMLImageElement | null>(null);
const cropBoxRef = ref<HTMLDivElement | null>(null);

// 裁剪框状态
const cropBoxStyle = ref({ left: "0px", top: "0px", width: "56.25%", height: "100%" });
const isDragging = ref(false);
const dragStart = ref({ x: 0, y: 0 });
const cropBoxPos = ref({ left: 0, top: 0 });

// 图片加载完成后初始化裁剪框
const initCropBox = () => {
  if (!cropImageRef.value) return;
  const img = cropImageRef.value;
  const containerWidth = img.offsetWidth;
  const containerHeight = img.offsetHeight;
  const cropHeight = Math.min(containerHeight, containerWidth * 16 / 9);
  const cropWidth = cropHeight * 9 / 16;
  cropBoxStyle.value = {
    left: `${(containerWidth - cropWidth) / 2}px`,
    top: `${(containerHeight - cropHeight) / 2}px`,
    width: `${cropWidth}px`,
    height: `${cropHeight}px`,
  };
  cropBoxPos.value = {
    left: (containerWidth - cropWidth) / 2,
    top: (containerHeight - cropHeight) / 2,
  };
};

onMounted(() => {
  nextTick(() => initCropBox());
});

// 拖动裁剪框
const startDrag = (e: MouseEvent | TouchEvent) => {
  e.preventDefault();
  isDragging.value = true;
  const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
  const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
  dragStart.value = { x: clientX, y: clientY };
  
  const handleMove = (moveEvent: MouseEvent | TouchEvent) => {
    if (!isDragging.value || !cropImageRef.value) return;
    const moveX = ("touches" in moveEvent ? moveEvent.touches[0].clientX : moveEvent.clientX) - dragStart.value.x;
    const moveY = ("touches" in moveEvent ? moveEvent.touches[0].clientY : moveEvent.clientY) - dragStart.value.y;
    
    const img = cropImageRef.value;
    const containerWidth = img.offsetWidth;
    const containerHeight = img.offsetHeight;
    const cropWidth = parseFloat(cropBoxStyle.value.width);
    const cropHeight = parseFloat(cropBoxStyle.value.height);
    
    const newLeft = Math.max(0, Math.min(containerWidth - cropWidth, cropBoxPos.value.left + moveX));
    const newTop = Math.max(0, Math.min(containerHeight - cropHeight, cropBoxPos.value.top + moveY));
    
    cropBoxPos.value = { left: newLeft, top: newTop };
    cropBoxStyle.value = {
      ...cropBoxStyle.value,
      left: `${newLeft}px`,
      top: `${newTop}px`,
    };
    
    dragStart.value = {
      x: "touches" in moveEvent ? moveEvent.touches[0].clientX : moveEvent.clientX,
      y: "touches" in moveEvent ? moveEvent.touches[0].clientY : moveEvent.clientY,
    };
  };
  
  const handleEnd = () => {
    isDragging.value = false;
    document.removeEventListener("mousemove", handleMove as any);
    document.removeEventListener("mouseup", handleEnd);
    document.removeEventListener("touchmove", handleMove as any);
    document.removeEventListener("touchend", handleEnd);
  };
  
  document.addEventListener("mousemove", handleMove as any);
  document.addEventListener("mouseup", handleEnd);
  document.addEventListener("touchmove", handleMove as any);
  document.addEventListener("touchend", handleEnd);
};

// 确认裁剪
const handleConfirm = () => {
  if (!cropImageRef.value || !cropBoxRef.value) return;
  
  const img = cropImageRef.value;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  
  // 计算裁剪区域（相对于图片原始尺寸）
  const imgRect = img.getBoundingClientRect();
  const cropRect = cropBoxRef.value.getBoundingClientRect();
  
  const scaleX = img.naturalWidth / imgRect.width;
  const scaleY = img.naturalHeight / imgRect.height;
  
  const cropX = (cropRect.left - imgRect.left) * scaleX;
  const cropY = (cropRect.top - imgRect.top) * scaleY;
  const cropWidth = cropRect.width * scaleX;
  const cropHeight = cropRect.height * scaleY;
  
  canvas.width = cropWidth;
  canvas.height = cropHeight;
  
  ctx.drawImage(
    img,
    cropX, cropY, cropWidth, cropHeight,
    0, 0, cropWidth, cropHeight
  );
  
  const croppedImage = canvas.toDataURL("image/jpeg", 0.9);
  settingStore.globalBackgroundImage = croppedImage;
  
  // 自动开启全局着色
  settingStore.themeGlobalColor = true;
  settingStore.themeFollowCover = true;
  window.$message.success("背景设置成功，已自动开启全局着色");
  
  emit("confirm");
};
</script>

<style lang="scss" scoped>
.crop-wrapper {
  position: relative;
  width: 100%;
  max-height: 60vh;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid rgba(128, 128, 128, 0.2);
  background: #000;
  display: flex;
  align-items: center;
  justify-content: center;
  
  .crop-image {
    max-width: 100%;
    max-height: 60vh;
    display: block;
    object-fit: contain;
  }
  
  .crop-box {
    position: absolute;
    border: 2px solid var(--primary-hex);
    cursor: move;
    box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.5);
    
    .crop-handle {
      position: absolute;
      width: 100%;
      height: 100%;
      background: transparent;
    }
    
    &::before {
      content: "";
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      border: 2px dashed rgba(255, 255, 255, 0.5);
      pointer-events: none;
    }
  }
}
</style>
