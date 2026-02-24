<template>
  <div class="login">
    <img src="/images/logo.png?asset" alt="logo" class="logo" style="border-radius: 50%;" />
    <!-- 登录方式 -->
    <n-tabs class="login-tabs" default-value="login-qr" type="segment" animated>
      <n-tab-pane name="login-qr" tab="扫码登录">
        <LoginQRCode :pause="qrPause" @saveLogin="saveLogin" />
      </n-tab-pane>
      <n-tab-pane name="login-phone" tab="验证码登录">
        <LoginPhone @saveLogin="saveLogin" />
      </n-tab-pane>
    </n-tabs>
    <!-- 关闭登录 -->
    <n-button :focusable="false" class="close" strong secondary round @click="emit('close')">
      <template #icon>
        <SvgIcon name="WindowClose" />
      </template>
      取消
    </n-button>
  </div>
</template>

<script setup lang="ts">
import { setCookies } from "@/utils/cookie";
import { updateUserData } from "@/utils/auth";
import { useDataStore } from "@/stores";
import { LoginType } from "@/types/main";

const emit = defineEmits<{
  close: [];
}>();

const dataStore = useDataStore();

// 暂停二维码检查
const qrPause = ref(false);

// 保存登录信息
const saveLogin = async (loginData: any, type: LoginType = "qr") => {
  console.log("🔐 [Login] 登录响应数据:", loginData);
  if (!loginData) return;
  if (loginData.code === 200) {
    // 更改状态
    emit("close");
    dataStore.userLoginStatus = true;
    dataStore.loginType = type;
    window.$message.success("登录成功");
    
    // Cookie 调试日志
    if (loginData.cookie) {
      console.log(`🍪 [Login] 获取到 Cookie，长度: ${loginData.cookie.length}`);
      console.log(`🍪 [Login] Cookie 预览: ${loginData.cookie.slice(0, 100)}...`);
      // 检查是否包含 MUSIC_U
      if (loginData.cookie.includes("MUSIC_U")) {
        console.log("✅ [Login] Cookie 包含 MUSIC_U 关键凭证");
      } else {
        console.warn("⚠️ [Login] Cookie 不包含 MUSIC_U，可能导致后续请求失败");
      }
    } else {
      console.error("❌ [Login] 登录成功但未获取到 Cookie！");
      window.$message.warning("登录成功但未获取到凭证，部分功能可能不可用");
    }

    // 保存 cookie
    setCookies(loginData.cookie);
    // 保存登录时间
    localStorage.setItem("lastLoginTime", Date.now().toString());
    
    // 获取用户信息
    try {
      await updateUserData();
      console.log("✅ [Login] 用户信息获取成功");
    } catch (error) {
      console.error("❌ [Login] 获取用户信息失败:", error);
      window.$message.error("获取用户信息失败，请刷新重试");
    }
  } else {
    window.$message.error(loginData.msg ?? loginData.message ?? "账号或密码错误，请重试");
  }
};


onBeforeMount(() => {
  if (dataStore.userLoginStatus) {
    window.$message.warning("已登录，请勿再次操作");
    emit("close");
  }
});
</script>

<style lang="scss" scoped>
.login {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  .logo {
    width: 60px;
    height: 60px;
    margin: 20px auto 30px auto;
  }
  .close {
    margin-bottom: 8px;
  }
}
</style>
