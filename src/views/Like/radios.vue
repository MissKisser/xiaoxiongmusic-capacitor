<template>
  <div class="like-type">
    <CoverList :data="dataStore.userLikeData.djs" :loading="false" type="radio" />
  </div>
</template>

<script setup lang="ts">
import { useDataStore } from "@/stores";

const dataStore = useDataStore();
</script>
