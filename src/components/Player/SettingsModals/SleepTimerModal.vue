<template>
  <n-modal
    v-model:show="showModal"
    preset="card"
    title="定时器"
    :bordered="false"
    :segmented="{ content: true }"
    class="sleep-timer-modal"
    transform-origin="center"
  >
    <n-scrollbar style="max-height: 65vh">
      <SleepTimerItem />
    </n-scrollbar>
  </n-modal>
</template>

<script setup lang="ts">
import SleepTimerItem from "@/components/Setting/items/SleepTimerItem.vue";

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
.sleep-timer-modal {
  :deep(.n-card) {
    width: min(90vw, 420px);
    max-width: calc(100vw - 32px);
    backdrop-filter: blur(20px);
    background-color: rgba(var(--n-color-rgb), 0.85);
  }

  :deep(.n-card__content) {
    padding: 20px;
  }
}
</style>
