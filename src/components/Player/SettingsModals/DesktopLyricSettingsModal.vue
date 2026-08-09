<template>
  <n-modal
    v-model:show="showModal"
    preset="card"
    title="桌面歌词"
    :bordered="false"
    :segmented="{ content: true }"
    class="desktop-lyric-settings-modal"
    transform-origin="center"
  >
    <n-scrollbar style="max-height: 66vh">
      <DesktopLyricItem />
    </n-scrollbar>
  </n-modal>
</template>

<script setup lang="ts">
import DesktopLyricItem from "@/components/Setting/items/DesktopLyricItem.vue";

interface Props {
  show: boolean;
}

interface Emits {
  (e: "update:show", value: boolean): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const showModal = computed({
  get: () => props.show,
  set: (val) => emit("update:show", val),
});
</script>

<style scoped lang="scss">
.desktop-lyric-settings-modal {
  :deep(.n-card) {
    width: min(92vw, 460px);
    max-width: calc(100vw - 24px);
    backdrop-filter: blur(20px);
    background-color: rgba(var(--n-color-rgb), 0.88);
  }

  :deep(.n-card__content) {
    padding: 16px;
  }
}
</style>
