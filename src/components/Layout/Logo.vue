<template>
  <img
    :style="{ 
      height: `${size}px`, 
      width: `${size}px`,
      borderRadius: '50%',
      objectFit: 'cover'
    }"
    src="/images/logo.png?asset"
    alt="小熊音乐"
  />
</template>

<script setup lang="ts">
defineProps({
  size: {
    type: Number,
    default: 36,
  },
});
</script>

<style lang="scss" scoped>
svg {
  path {
    &:nth-of-type(1) {
      fill: rgba(var(--primary), 0.29);
    }
    &:nth-of-type(2),
    &:nth-of-type(3) {
      fill: var(--primary-hex);
    }
  }
}
</style>
