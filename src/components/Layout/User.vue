<template>
  <n-popover
    :show="userMenuShow"
    style="padding: 12px; max-width: 160px"
    trigger="manual"
    @clickoutside="userMenuShow = false"
  >
    <template #trigger>
      <div
        class="user"
        :style="{ pointerEvents: userMenuShow ? 'none' : 'auto' }"
        @click="openMenu"
      >
        <div class="avatar">
          <n-avatar
            v-if="dataStore.userLoginStatus"
            :src="dataStore.userData?.avatarUrl"
            fallback-src="/images/avatar.jpg?asset"
            round
          />
          <n-avatar v-else round>
            <SvgIcon name="Person" :depth="3" size="26" />
          </n-avatar>
        </div>
        <n-flex v-if="isDesktop" class="user-data" size="small">
          <n-text class="name">
            {{ dataStore.userLoginStatus ? dataStore.userData.name || "未知用户名" : "未登录" }}
          </n-text>
          <!-- VIP -->
          <img
            v-if="dataStore.userLoginStatus && dataStore.userData.vipType !== 0"
            class="vip-img"
            src="/images/vip.png?asset"
          />
          <SvgIcon :class="['down', { open: userMenuShow }]" name="DropDown" :depth="3" />
        </n-flex>
      </div>
    </template>
    <div class="user-menu" @click="userMenuShow = false">
      <!-- 用户信息 -->
      <n-flex class="user-info" align="center" justify="center" vertical>
        <n-text class="nickname text-hidden">{{ dataStore.userData.name || "未知用户名" }}</n-text>
        <n-flex align="center" size="small">
          <n-tag :bordered="false" size="small" round type="warning">
            Lv.{{ dataStore.userData.level ?? 0 }}
          </n-tag>
          <!-- VIP -->
          <img
            v-if="dataStore.userLoginStatus && dataStore.userData.vipType !== 0"
            class="vip-img"
            src="/images/vip.png?asset"
          />
        </n-flex>
      </n-flex>
      <n-divider />
      <!-- 喜欢数量 -->
      <div v-if="dataStore.loginType !== 'uid'" class="like-num">
        <div
          v-for="(item, index) in userLikeData"
          :key="index"
          class="num-item"
          @click="router.push({ name: item.name })"
        >
          <n-number-animation :from="0" :to="item.value" />
          <n-text :depth="3">{{ item.label }}</n-text>
        </div>
      </div>
      <n-flex v-else align="center" vertical>
        <n-text>UID 登录模式</n-text>
        <n-text :depth="3">部分功能暂不可用</n-text>
      </n-flex>
      <n-divider />
      <!-- 退出登录 -->
      <n-button :focusable="false" class="logout" strong secondary round @click="isLogout">
        <template #icon>
          <SvgIcon name="Power" />
        </template>
        退出登录
      </n-button>
    </div>
  </n-popover>
</template>

<script setup lang="ts">
import { useDataStore } from "@/stores";
import { openUserLogin } from "@/utils/modal";
import { getLoginState } from "@/api/login";
import {
  toLogout,
  isLogin,
  refreshLoginData,
  updateUserData,
  updateSpecialUserData,
} from "@/utils/auth";
import { useMobile } from "@/composables/useMobile";

const router = useRouter();
const dataStore = useDataStore();

const { isDesktop } = useMobile();

// 用户菜单展示
const userMenuShow = ref<boolean>(false);

// 开启用户菜单
const openMenu = () => {
  if (dataStore.userLoginStatus) {
    userMenuShow.value = !userMenuShow.value;
  } else {
    openUserLogin();
  }
};

// 用户喜欢数据
const userLikeData = computed(() => {
  return [
    {
      label: "歌单",
      name: "like-playlists",
      value: dataStore.userLikeData.playlists.length,
    },
    {
      label: "专辑",
      name: "like-albums",
      value: dataStore.userLikeData.albums.length,
    },
    {
      label: "歌手",
      name: "like-artists",
      value: dataStore.userLikeData.artists.length,
    },
  ];
});

// 检查登录状态
const checkLoginStatus = async () => {
  console.log("🔐 [User] 开始检查登录状态...");
  console.log("🔐 [User] 当前状态: userLoginStatus =", dataStore.userLoginStatus, ", loginType =", dataStore.loginType);
  
  // 若为 UID 登录
  if (dataStore.loginType === "uid") {
    console.log("🔐 [User] UID 登录模式，更新用户数据");
    await updateSpecialUserData();
    return;
  }
  
  try {
    // 获取登录状态
    console.log("🔐 [User] 正在获取登录状态...");
    const loginState = await getLoginState();
    console.log("🔐 [User] 登录状态响应:", JSON.stringify(loginState).slice(0, 300));
    
    // 登录正常
    if (loginState.data?.profile && Object.keys(loginState.data?.profile)?.length) {
      console.log("✅ [User] 登录状态有效，profile:", loginState.data.profile.nickname);
      dataStore.userLoginStatus = true;
      // 刷新登录
      await refreshLoginData();
      // 获取用户信息
      await updateUserData();
    }
    // 若还有用户数据，则登录过期
    else if (dataStore.userData?.userId && dataStore.userData.userId !== 0) {
      dataStore.userLoginStatus = false;
      dataStore.userData.userId = 0;
      console.log("⚠️ [User] 登录已过期或未获取到 Profile");
      window.$message.warning("登录已过期，请重新登录", { duration: 2000 });
      openUserLogin();
    } else {
      console.log("🔐 [User] 未登录且无本地缓存");
    }
  } catch (error) {
    console.error("❌ [User] 检查登录状态失败:", error);
    // 如果请求失败但本地有登录状态，尝试继续使用
    if (dataStore.userLoginStatus && dataStore.userData?.userId) {
      console.log("⚠️ [User] 网络请求失败，但本地有缓存，继续使用本地数据");
    }
  }
};

// 退出登录
const isLogout = () => {
  if (!isLogin()) {
    openUserLogin();
    return;
  }
  window.$dialog.warning({
    title: "退出登录",
    content: "确认退出当前用户登录？",
    positiveText: "确认登出",
    negativeText: "取消",
    onPositiveClick: () => toLogout(),
  });
};

onBeforeMount(() => {
  checkLoginStatus();
});
</script>

<style lang="scss" scoped>
.user {
  display: flex;
  align-items: center;
  height: 34px;
  border-radius: 25px;
  background-color: rgba(var(--primary), 0.08);
  transition: background-color 0.3s;
  cursor: pointer;
  -webkit-app-region: no-drag;
  .avatar {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 38px;
    height: 38px;
    min-width: 38px;
    border-radius: 50%;
    border: 2px solid rgba(var(--primary), 0.28);
    .n-avatar {
      width: 100%;
      height: 100%;
    }
  }
  .user-data {
    display: flex;
    align-items: center;
    padding-left: 8px;
    max-width: 200px;
    .down {
      font-size: 26px;
      margin-right: 4px;
      transition: transform 0.3s;
      &.open {
        transform: rotate(180deg);
      }
    }
  }
  &:hover {
    background-color: rgba(var(--primary), 0.28);
  }
  &:active {
    background-color: rgba(var(--primary), 0.12);
  }
}
.vip-img {
  height: 18px;
}
.user-menu {
  display: flex;
  justify-content: center;
  flex-direction: column;
  .user-info {
    .nickname {
      font-weight: bold;
    }
    .n-tag {
      height: 18px;
      font-size: 12px;
      pointer-events: none;
    }
  }
  .like-num {
    display: flex;
    justify-content: space-around;
    .num-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      font-size: 16px;
      font-weight: bold;
      cursor: pointer;
      .n-text {
        font-size: 12px;
        font-weight: normal;
      }
    }
  }
  .n-divider {
    margin: 12px 0;
  }
}
</style>
