<template>
  <div class="background-setting-modal">
    <n-space vertical size="large">
      <n-card :bordered="false" title="主题模式">
        <div class="theme-mode-group">
          <n-button 
            v-for="mode in themeModes" 
            :key="mode.value"
            :type="settingStore.themeMode === mode.value ? 'primary' : 'default'"
            :secondary="settingStore.themeMode !== mode.value"
            @click="setThemeMode(mode.value)"
          >
            {{ mode.label }}
          </n-button>
        </div>
      </n-card>

      <n-card :bordered="false" title="全局背景">
        <n-space vertical>
          <n-text depth="3">设置自定义全局背景图片</n-text>
          
          <n-space align="center">
            <n-button @click="triggerUpload">
              <template #icon>
                <component :is="renderIcon('Image')" />
              </template>
              选择图片
            </n-button>
             <input 
              type="file" 
              ref="fileInput" 
              accept="image/*" 
              @change="handleFileChange" 
              style="display: none" 
            />
            <n-button type="warning" secondary @click="resetBackground">
              恢复默认
            </n-button>
          </n-space>

          <!-- 图片裁剪区域 -->
          <div v-if="showCrop" class="crop-container">
            <div class="crop-wrapper">
              <img ref="cropImageRef" :src="cropImageSrc" class="crop-image" />
              <div 
                ref="cropBoxRef"
                class="crop-box"
                :style="cropBoxStyle"
                @mousedown="startCrop"
                @touchstart="startCrop"
              >
                <div class="crop-handle" />
              </div>
            </div>
            <n-space justify="center" style="margin-top: 12px">
              <n-button @click="cancelCrop">取消</n-button>
              <n-button type="primary" @click="confirmCrop">确认裁剪</n-button>
            </n-space>
          </div>

          <!-- 预览区域 -->
          <div v-if="settingStore.globalBackgroundImage && !showCrop" class="preview-container">
            <n-image 
              :src="settingStore.globalBackgroundImage" 
              object-fit="contain" 
              class="preview-img"
              preview-disabled
            />
          </div>
        </n-space>
      </n-card>
    </n-space>
  </div>
</template>

<script setup lang="ts">
import { useSettingStore } from "@/stores";
import { renderIcon } from "@/utils/helper";

const settingStore = useSettingStore();
const fileInput = ref<HTMLInputElement | null>(null);
const cropImageRef = ref<HTMLImageElement | null>(null);
const cropBoxRef = ref<HTMLDivElement | null>(null);

// 裁剪相关状态
const showCrop = ref(false);
const cropImageSrc = ref<string>("");
const cropBoxStyle = ref({ left: "0px", top: "0px", width: "56.25%", height: "100%" }); // 9:16 比例
const isDragging = ref(false);
const dragStart = ref({ x: 0, y: 0 });
const cropBoxPos = ref({ left: 0, top: 0 });

// 主题模式选项
const themeModes = [
  { value: "auto", label: "跟随系统" },
  { value: "light", label: "浅色模式" },
  { value: "dark", label: "深色模式" },
];

// 设置主题模式
const setThemeMode = (mode: string) => {
  settingStore.themeMode = mode as "auto" | "light" | "dark";
  settingStore.setThemeMode(mode as "auto" | "light" | "dark");
};

const triggerUpload = () => {
  fileInput.value?.click();
};

const handleFileChange = async (e: Event) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) {
    if (file.size > 5 * 1024 * 1024) { // 5MB limit
        window.$message.warning("图片大小不能超过 5MB");
        return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
       if (e.target?.result) {
         cropImageSrc.value = e.target.result as string;
         showCrop.value = true;
         // 重置裁剪框位置
         nextTick(() => {
           if (cropImageRef.value) {
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
           }
         });
       }
    };
    reader.readAsDataURL(file);
  }
};

// 开始拖动裁剪框
const startCrop = (e: MouseEvent | TouchEvent) => {
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
const confirmCrop = () => {
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
  
  // 设置画布尺寸（9:16）
  canvas.width = cropWidth;
  canvas.height = cropHeight;
  
  // 绘制裁剪后的图片
  ctx.drawImage(
    img,
    cropX, cropY, cropWidth, cropHeight,
    0, 0, cropWidth, cropHeight
  );
  
  // 转换为 base64
  const croppedImage = canvas.toDataURL("image/jpeg", 0.9);
  settingStore.globalBackgroundImage = croppedImage;
  
  // 自动开启全局着色
  settingStore.themeGlobalColor = true;
  settingStore.themeFollowCover = true;
  window.$message.success("背景设置成功，已自动开启全局着色");
  
  showCrop.value = false;
  cropImageSrc.value = "";
};

// 取消裁剪
const cancelCrop = () => {
  showCrop.value = false;
  cropImageSrc.value = "";
};

const resetBackground = () => {
  settingStore.globalBackgroundImage = null;
  window.$message.success("已恢复默认背景");
};
</script>

<style lang="scss" scoped>
.theme-mode-group {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  width: 100%;
  
  .n-button {
    flex: 1;
    min-width: 80px;
  }
}

.crop-container {
  margin-top: 12px;
  .crop-wrapper {
    position: relative;
    width: 100%;
    max-height: 400px;
    border-radius: 8px;
    overflow: hidden;
    border: 1px solid rgba(128, 128, 128, 0.2);
    background: #000;
    display: flex;
    align-items: center;
    justify-content: center;
    
    .crop-image {
      max-width: 100%;
      max-height: 400px;
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
}

.preview-container {
  position: relative;
  width: 100%;
  min-height: 200px;
  max-height: 400px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid rgba(128, 128, 128, 0.2);
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--n-color);
  
  .preview-img {
    max-width: 100%;
    max-height: 100%;
    display: block;
    object-fit: contain;
  }
}
</style>
