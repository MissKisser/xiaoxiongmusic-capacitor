<!-- 编辑歌单弹窗 -->
<template>
  <div class="update-playlist">
    <n-form ref="updateFormRef" :model="updateFormData" :rules="updateFormRules">
      <n-form-item label="歌单名" path="name">
        <n-input
          v-model:value="updateFormData.name"
          :disabled="isLiked"
          placeholder="请输入歌单名"
        />
      </n-form-item>
      <n-form-item v-if="!isPlatformSource" label="歌单描述" path="desc">
        <n-input
          v-model:value="updateFormData.desc"
          :autosize="{
            minRows: 3,
            maxRows: 6,
          }"
          :maxlength="800"
          placeholder="请输入歌单描述"
          type="textarea"
          show-count
          clearable
        />
      </n-form-item>
      <n-form-item v-if="!isPlatformSource" label="歌单分类" path="tags">
        <n-select
          v-model:value="updateFormData.tags"
          :options="tagList"
          placeholder="请选择歌单标签"
          filterable
          multiple
          @update:value="checkTags"
        />
      </n-form-item>
    </n-form>
    <n-button class="create" type="primary" @click="toUpdatePlaylist"> 编辑 </n-button>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted } from "vue";
import type { CoverType } from "@/types/main";
import type { ApiPlatform } from "@/types/shared";
import type { FormInst, FormRules, SelectOption } from "naive-ui";
import { textRule } from "@/utils/rules";
import { useDataStore, usePlatformStore } from "@/stores";
import { debounce, isEmpty, size } from "lodash-es";
import { updatePlaylist } from "@/api/playlist";
import { renamePlaylist as manageRenamePlaylist } from "@/api/platform/manage";
import { updateUserLikePlaylist } from "@/utils/auth";

// 表单类型
interface UpdateFormType {
  name: string;
  desc?: string;
  tags?: string[];
}

const props = defineProps<{
  id: number | string;
  data: CoverType;
  /** 音源平台（缺省为网易云） */
  platform?: ApiPlatform;
}>();

const emit = defineEmits<{ success: [] }>();

const dataStore = useDataStore();
const platformStore = usePlatformStore();

// 是否为第三方平台（QQ 音乐 / 酷狗）
const isPlatformSource = computed<boolean>(
  () => props.platform !== undefined && props.platform !== "netease",
);

// 是否为我喜欢
const isLiked = computed(() => {
  // 网易云：沿用既有口径
  if (!isPlatformSource.value) return dataStore.userLikeData.playlists?.[0]?.id === Number(props.id);
  // 第三方平台：按平台语义定位「我喜欢」系统歌单
  return platformStore.playlists.owned.some(
    (playlist) =>
      playlist.isLiked === true && String(playlist.platformId ?? playlist.id) === String(props.id),
  );
});

// 表单数据
const updateFormRef = ref<FormInst | null>(null);
const updateFormData = ref<UpdateFormType>({
  name: isLiked.value ? "我喜欢的音乐" : props.data.name,
  desc: props.data.description,
  tags: props.data.tags,
});
const updateFormRules: FormRules = { name: textRule };

// 歌单分类数据
const tagList = computed<SelectOption[]>(() => {
  if (isEmpty(dataStore.catData?.cats)) return [];
  return Object.keys(dataStore.catData?.type).map((key) => ({
    type: "group",
    key,
    label: dataStore.catData?.type[Number(key)],
    children: dataStore.catData?.cats
      ?.filter((cat) => cat.category === Number(key))
      .map((cat) => ({
        label: cat.name,
        value: cat.name,
      })),
  }));
});

// 检查标签
const checkTags = (tags: string[]) => {
  if (size(tags) > 3) {
    updateFormData.value.tags = tags.slice(0, 3);
    window.$message.warning("最多只能有3个标签");
  }
};

// 更新歌单
const toUpdatePlaylist = debounce(
  async (e: MouseEvent) => {
    e.preventDefault();
    // 是否输入
    await updateFormRef.value?.validate((errors) => errors);
    // 第三方平台：走平台写操作分派层
    if (isPlatformSource.value && props.platform) {
      const result = await manageRenamePlaylist(
        props.platform,
        props.id,
        updateFormData.value.name,
      );
      if (result.ok) {
        emit("success");
        window.$message.success("歌单编辑成功");
      } else {
        window.$message.error(result.message || "歌单编辑失败，请重试");
      }
      return;
    }
    // 网易云歌单
    const result = await updatePlaylist(
      Number(props.id),
      updateFormData.value.name,
      updateFormData.value.desc ?? "",
      updateFormData.value.tags ?? [],
    );
    if (result.code === 200) {
      emit("success");
      window.$message.success("歌单编辑成功");
      await updateUserLikePlaylist();
    } else {
      window.$message.error(result.message || "歌单编辑失败，请重试");
    }
  },
  300,
  { leading: true, trailing: false },
);

onMounted(() => {
  if (!isPlatformSource.value) dataStore.getPlaylistCatList();
});
</script>

<style lang="scss" scoped>
.update-playlist {
  .create {
    width: 100%;
  }
}
</style>
