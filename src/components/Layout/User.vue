<!-- 用户信息与平台账号切换菜单 -->
<template>
  <n-popover
    :show="userMenuShow"
    style="padding: 12px; max-width: 240px"
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
            v-if="currentLoggedIn"
            :src="currentAvatarUrl"
            fallback-src="/images/avatar.jpg?asset"
            round
          />
          <n-avatar v-else round>
            <SvgIcon name="Person" :depth="3" size="26" />
          </n-avatar>
        </div>
        <n-flex v-if="isDesktop" class="user-data" size="small">
          <n-text class="name">
            {{ currentDisplayName }}
          </n-text>
          <!-- VIP -->
          <img v-if="showVipBadge" class="vip-img" src="/images/vip.png?asset" />
          <SvgIcon :class="['down', { open: userMenuShow }]" name="DropDown" :depth="3" />
        </n-flex>
      </div>
    </template>
    <div class="user-menu" @click="userMenuShow = false">
      <!-- 平台账号 -->
      <div class="platforms">
        <div
          v-for="item in platformList"
          :key="item.platform"
          :class="['platform-item', { active: item.active }]"
          @click="handlePlatform(item)"
        >
          <n-radio
            class="platform-radio"
            :checked="item.active"
            :name="item.platform"
            @click.stop
            @update:checked="() => handlePlatform(item)"
          />
          <span class="platform-badge">{{ item.short }}</span>
          <n-text class="platform-name">{{ item.name }}</n-text>
          <template v-if="item.loggedIn">
            <n-avatar
              round
              :size="20"
              :src="item.avatarUrl"
              fallback-src="/images/avatar.jpg?asset"
            />
            <n-text class="platform-nickname" depth="3">{{ item.nickname }}</n-text>
          </template>
          <n-text v-else class="platform-login" depth="3">登录</n-text>
        </div>
      </div>
      <!-- 当前平台已登录时展示用户信息、喜欢数据与退出登录 -->
      <template v-if="currentLoggedIn">
        <n-divider />
        <!-- 用户信息 -->
        <n-flex class="user-info" align="center" justify="center" vertical>
          <!-- 第三方平台：头像 + 昵称 + 会员标记 -->
          <template v-if="!isNetease">
            <n-avatar
              v-if="currentProfile?.avatarUrl"
              round
              :size="40"
              :src="currentProfile.avatarUrl"
              fallback-src="/images/avatar.jpg?asset"
            />
            <n-text class="nickname text-hidden">{{ currentProfileName }}</n-text>
            <!-- VIP -->
            <img v-if="currentProfile?.isVip" class="vip-img" src="/images/vip.png?asset" />
          </template>
          <!-- 网易云：昵称 + 等级 + 会员标记 -->
          <template v-else>
            <n-text class="nickname text-hidden">{{
              dataStore.userData.name || "未知用户名"
            }}</n-text>
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
          </template>
        </n-flex>
        <n-divider />
        <!-- 喜欢数量 -->
        <div v-if="showLikeNum" class="like-num">
          <div
            v-for="(item, index) in userLikeData"
            :key="index"
            class="num-item"
            @click="router.push({ name: item.name, query: item.query })"
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
      </template>
    </div>
  </n-popover>
</template>

<script setup lang="ts">
import { computed, ref, onBeforeMount, onUnmounted } from "vue";
import { useRouter } from "vue-router";
import {
  useDataStore,
  usePlatformStore,
  onPlatformChange,
  onAccountChange,
  PLATFORM_META,
} from "@/stores";
import { openUserLogin, openPlatformLogin } from "@/utils/modal";
import { getLoginState } from "@/api/login";
import type { ApiPlatform } from "@/types/shared";
import {
  buildPlatformListItems,
  resolvePlatformSelectAction,
  type PlatformListItem,
} from "@/api/platform/capability";
import {
  toLogout,
  isLogin,
  refreshLoginData,
  updateUserData,
  updateSpecialUserData,
} from "@/utils/auth";
import { useMobile } from "@/composables/useMobile";
import { useLikeStats } from "@/composables/useLikeStats";
import { whenCookiesReady } from "@/utils/cookie";

const router = useRouter();
const dataStore = useDataStore();
const platformStore = usePlatformStore();

const { isDesktop } = useMobile();

// 收藏统计条目（与收藏页同一真源）
const likeStats = useLikeStats();

/** 用户喜欢数据条目 */
interface UserLikeItem {
  /** 数量标签 */
  label: string;
  /** 跳转路由名 */
  name: string;
  /** 数量 */
  value: number;
  /** 跳转时附带的查询参数 */
  query?: Record<string, string>;
}

// 用户菜单展示
const userMenuShow = ref<boolean>(false);

// 平台账号列表
const platformList = computed<PlatformListItem[]>(() =>
  buildPlatformListItems(
    platformStore.currentPlatform,
    {
      loggedIn: dataStore.userLoginStatus,
      nickname: dataStore.userData.name,
      avatarUrl: dataStore.userData?.avatarUrl,
    },
    platformStore.platformProfiles,
  ),
);

// 当前平台是否已登录
const currentLoggedIn = computed(() => {
  if (platformStore.currentPlatform === "netease") return dataStore.userLoginStatus;
  return !!platformStore.platformProfiles[platformStore.currentPlatform];
});

/** 当前是否为网易云平台 */
const isNetease = computed(() => platformStore.currentPlatform === "netease");

/** 当前平台的账号资料（网易云走既有登录态，不经平台资料） */
const currentProfile = computed(() =>
  isNetease.value ? null : platformStore.platformProfiles[platformStore.currentPlatform],
);

/** 当前平台的昵称 */
const currentProfileName = computed(() => {
  const nickname = String(currentProfile.value?.nickname ?? "").trim();
  if (nickname) return nickname;
  const userId = String(currentProfile.value?.userId ?? "").trim();
  return userId || PLATFORM_META[platformStore.currentPlatform].name;
});

/** 顶栏会员标记 */
const showVipBadge = computed<boolean>(() => {
  if (isNetease.value) {
    return dataStore.userLoginStatus && dataStore.userData.vipType !== 0;
  }
  return !!currentProfile.value?.isVip;
});

// 当前平台头像
const currentAvatarUrl = computed(() => {
  if (platformStore.currentPlatform === "netease") return dataStore.userData?.avatarUrl;
  return platformStore.platformProfiles[platformStore.currentPlatform]?.avatarUrl;
});

// 当前平台显示名
const currentDisplayName = computed(() => {
  if (platformStore.currentPlatform === "netease") {
    return dataStore.userLoginStatus ? dataStore.userData.name || "未知用户名" : "未登录";
  }
  const profile = platformStore.platformProfiles[platformStore.currentPlatform];
  if (!profile) return "未登录";
  return currentProfileName.value;
});

/** 开启或关闭用户菜单（未登录任何平台时亦允许展示，以便直选平台登录） */
const openMenu = () => {
  userMenuShow.value = !userMenuShow.value;
};

/**
 * 选择平台：已登录则切换，未登录则拉起对应平台的登录弹窗
 * @param item 平台条目
 */
const handlePlatform = (item: PlatformListItem) => {
  userMenuShow.value = false;
  const action = resolvePlatformSelectAction(item);
  if (action.type === "login-netease") {
    openUserLogin();
  } else if (action.type === "login-platform") {
    openPlatformLogin(action.platform);
  } else if (action.type === "switch-platform") {
    platformStore.switchPlatform(action.platform);
  }
};

// 用户喜欢数据
const userLikeData = computed<UserLikeItem[]>(() =>
  likeStats.value.map((item) => ({
    label: item.label,
    name: item.name,
    value: item.length,
    query: item.query,
  })),
);

/** 是否展示统计区 */
const showLikeNum = computed<boolean>(
  () => platformStore.currentPlatform !== "netease" || dataStore.loginType !== "uid",
);

// 检查登录状态
const checkLoginStatus = async () => {
  console.log("🔐 [User] 开始检查登录状态...");
  console.log(
    "🔐 [User] 当前状态: userLoginStatus =",
    dataStore.userLoginStatus,
    ", loginType =",
    dataStore.loginType,
  );

  await whenCookiesReady();

  if (dataStore.loginType === "uid") {
    console.log("🔐 [User] UID 登录模式，更新用户数据");
    await updateSpecialUserData();
    return;
  }

  try {
    console.log("🔐 [User] 正在获取登录状态...");
    const loginState = await getLoginState();
    console.log("🔐 [User] 登录状态响应:", JSON.stringify(loginState).slice(0, 300));

    if (loginState.data?.profile && Object.keys(loginState.data?.profile)?.length) {
      console.log("✅ [User] 登录状态有效，profile:", loginState.data.profile.nickname);
      dataStore.userLoginStatus = true;
      await refreshLoginData();
      await updateUserData();
    } else if (dataStore.userData?.userId && dataStore.userData.userId !== 0) {
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
    if (dataStore.userLoginStatus && dataStore.userData?.userId) {
      console.log("⚠️ [User] 网络请求失败，但本地有缓存，继续使用本地数据");
    }
  }
};

// 退出登录（作用于当前平台）
const isLogout = () => {
  if (platformStore.currentPlatform !== "netease") {
    const platform = platformStore.currentPlatform;
    window.$dialog.warning({
      title: "退出登录",
      content: `确认退出${PLATFORM_META[platform].name}登录？`,
      positiveText: "确认登出",
      negativeText: "取消",
      onPositiveClick: async () => {
        await platformStore.logout(platform);
        window.$message.success("已退出登录");
      },
    });
    return;
  }
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

/** 已提示过凭据失效的平台（重新登录后解除，避免重复弹窗） */
const authExpiredNotified = new Set<ApiPlatform>();

/**
 * 提示凭据失效并拉起该平台的登录弹窗
 * @param platform 音源平台
 */
const notifyAuthExpired = (platform: ApiPlatform) => {
  if (authExpiredNotified.has(platform)) return;
  authExpiredNotified.add(platform);
  window.$message.warning(`${PLATFORM_META[platform].name}登录已过期，请重新登录`, {
    duration: 3000,
  });
  openPlatformLogin(platform);
};

/**
 * 刷新指定平台的账号资料
 * @param platform 音源平台
 */
const refreshPlatformProfile = async (platform: ApiPlatform) => {
  const previous = platformStore.platformProfiles[platform];
  const profile = await platformStore.refreshProfile(platform);
  if (platformStore.authExpired[platform]) {
    notifyAuthExpired(platform);
    return;
  }
  if (profile) {
    authExpiredNotified.delete(platform);
    return;
  }
  if (previous) {
    platformStore.platformProfiles[platform] = previous;
  }
};

// 平台切换：刷新目标平台的账号资料
const stopPlatformWatch = onPlatformChange(({ platform }) => {
  if (platform === "netease") return;
  void refreshPlatformProfile(platform);
});

// 账号变更广播：若凭据失效则自动弹窗提示
const stopAccountWatch = onAccountChange(({ platform, loggedIn }) => {
  if (loggedIn) {
    authExpiredNotified.delete(platform);
  } else if (platform !== "netease" && platformStore.authExpired[platform]) {
    notifyAuthExpired(platform);
  }
});

onBeforeMount(() => {
  checkLoginStatus();
  void platformStore.refreshAllProfiles().then((expired) => {
    for (const platform of expired) notifyAuthExpired(platform);
  });
});

onUnmounted(() => {
  stopPlatformWatch();
  stopAccountWatch();
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
    flex-wrap: nowrap;
    .name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 100px;
    }
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
  .platforms {
    display: flex;
    flex-direction: column;
    gap: 2px;
    .platform-item {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 5px 4px;
      border-radius: 6px;
      cursor: pointer;
      transition: background-color 0.2s;
      &:hover {
        background-color: rgba(var(--primary), 0.08);
      }
      &.active .platform-name {
        font-weight: bold;
      }
      .platform-radio {
        flex-shrink: 0;
      }
      .platform-badge {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 20px;
        height: 20px;
        min-width: 20px;
        border-radius: 5px;
        background-color: rgba(var(--primary), 0.12);
        color: var(--primary-hex);
        font-size: 11px;
        line-height: 1;
      }
      .platform-name {
        font-size: 12px;
        white-space: nowrap;
      }
      .platform-nickname {
        font-size: 12px;
        max-width: 76px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .platform-login {
        font-size: 12px;
      }
    }
  }
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
