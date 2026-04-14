<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { isCapacitor } from "@/utils/env";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { syncNativeCookies } from "@/utils/cookie";
import { useStatusStore, useAuthStore, useVersionStore, useSettingStore } from "@/stores";
import GlobalUpdateModal from "@/components/Modal/GlobalUpdateModal.vue";
import GlobalAuthModal from "@/components/Modal/GlobalAuthModal.vue";
import { WebViewCache } from "@/plugins/WebViewCache";

const router = useRouter();
const authStore = useAuthStore();
const versionStore = useVersionStore();
const settingStore = useSettingStore();

// 定义音频缓存插件接口供全局同步使用
interface AudioCachePlugin {
  setCacheConfig(options: { enabled: boolean; maxSize: number; strategy: string }): Promise<{ success: boolean }>;
}
let globalAudioCachePlugin: AudioCachePlugin | null = null;
if (isCapacitor) {
  try {
    globalAudioCachePlugin = registerPlugin<AudioCachePlugin>("AudioCache");
  } catch (e) {
    console.warn("AudioCache plugin not available for auto-sync", e);
  }
}

// 记录上次按返回键的时间，用于双击退出
const lastBackPressTime = ref(0);

// 初始化返回按钮监听器
const initBackButtonListener = async () => {
  try {
    // 动态导入 @capacitor/app
    const { App } = await import("@capacitor/app");
    
    // 注册返回按钮监听器
    App.addListener("backButton", () => {
      const statusStore = useStatusStore();
      
      // 如果全屏播放器打开，先关闭全屏播放器
      if (statusStore.showFullPlayer) {
        statusStore.showFullPlayer = false;
        return;
      }
      
      // 如果播放列表打开，先关闭播放列表
      if (statusStore.playListShow) {
        statusStore.playListShow = false;
        return;
      }
      
      // 如果侧边栏打开，先关闭侧边栏
      if (statusStore.showAside) {
        statusStore.showAside = false;
        return;
      }
      
      // 获取当前路由
      const currentRoute = router.currentRoute.value;
      const isHomePage = currentRoute.name === "home" || currentRoute.path === "/";
      
      // 如果在首页
      if (isHomePage) {
        const currentTime = Date.now();
        // 如果两次返回间隔小于2秒，退出应用
        if (currentTime - lastBackPressTime.value < 2000) {
          App.exitApp();
        } else {
          // 否则提示再按一次退出
          lastBackPressTime.value = currentTime;
          window.$message.info("再按一次返回键退出应用");
        }
      } else {
        // 不在首页，返回上一页
        router.back();
      }
    });
    
    console.log("✅ 返回按钮监听器注册成功");
  } catch (error) {
    console.warn("⚠️ @capacitor/app 未安装或加载失败，返回按钮功能不可用:", error);
  }
};

// 初始化授权检查
const initAuthCheck = async () => {
  console.log("[AuthCheck] 🔐 开始授权检查...");
  const isAuthorized = await authStore.checkAuth();
    if (isAuthorized) {
    console.log("[AuthCheck] ✅ 授权验证通过");  } else {
    console.log("[AuthCheck] ❌ 授权验证失败，等待用户输入授权码");  }
  
  return isAuthorized;
};

// 初始化版本检查 (重构版)
const initVersionCheck = async () => {
  console.log("[AppInit] 📦 准备启动版本检查...");
  
  try {
    // 动态导入更新检查器以避免循环依赖
    const { performVersionCheck } = await import('@/utils/updateChecker');
    console.log("[AppInit] ✅ 更新检查模块已加载");
    
    const hasUpdate = await performVersionCheck();
    console.log(`[AppInit] 版本检查完成, hasUpdate=${hasUpdate}`);
  } catch (error) {
    console.error("[AppInit] ❌ 版本检查模块加载或执行失败:", error);
  }
};

onMounted(async () => {
  console.log("🚀 App mounted, isCapacitor:", isCapacitor);
  
  if (isCapacitor) {
    console.log("📱 Capacitor 环境检测成功，平台:", Capacitor.getPlatform());

    // 应用启动时同步 Cookie 到原生层（先同步，避免缓存清除影响）
    // 这确保了之前登录保存的 Cookie 能在新会话中使用
    try {
      await syncNativeCookies();
      console.log("✅ 启动时 Cookie 同步完成");
    } catch (error) {
      console.error("❌ 启动时 Cookie 同步失败:", error);
    }

    // 检查版本并清除 WebView 缓存（确保加载最新资源）
    // 注意：原生层已保留 Local Storage/Cookies 等用户数据目录
    try {
      const cacheResult = await WebViewCache.checkVersionAndClear();
      if (cacheResult.cleared) {
        console.log("✅ 版本更新，WebView 缓存已清除，旧版本:", cacheResult.previousVersion);
      } else {
        console.log("ℹ️ 版本未变化，无需清除缓存");
      }
    } catch (error) {
      console.warn("⚠️ WebView 缓存检查失败:", error);
    }

    // [新增] 启动时同步系统缓存配置到原生层
    if (globalAudioCachePlugin) {
      try {
        await globalAudioCachePlugin.setCacheConfig({
          enabled: settingStore.audioCacheEnabled,
          maxSize: settingStore.audioCacheMaxSize,
          strategy: settingStore.audioCacheStrategy,
        });
        console.log("✅ 启动时音频缓存配置同步完成: ", settingStore.audioCacheMaxSize + "MB");
      } catch (e) {
        console.warn("❌ 启动时音频缓存配置同步失败:", e);
      }
    }
    
    // 调试：列出 localStorage 中的 cookie
    const cookieKeys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith("cookie-")) {
        cookieKeys.push(key.replace("cookie-", ""));
      }
    }
    console.log("🍪 localStorage 中的 Cookie 键:", cookieKeys.join(", ") || "(空)");
    
    // 初始化返回按钮监听器
    await initBackButtonListener();
    
    // 并行执行授权检查和版本检查（互不依赖）
    console.log("[AppInit] 🚀 并行启动授权检查和版本检查...");
    
    // 使用 Promise.allSettled 确保两者都执行，互不影响
    const [authResult, versionResult] = await Promise.allSettled([
      initAuthCheck(),
      initVersionCheck()
    ]);
    
    // 记录结果
    if (authResult.status === 'fulfilled') {
      console.log(`[AppInit] 授权检查完成: ${authResult.value ? '已授权' : '未授权'}`);
    } else {
      console.error("[AppInit] 授权检查失败:", authResult.reason);
    }
    
    if (versionResult.status === 'fulfilled') {
      console.log("[AppInit] 版本检查完成");
    } else {
      console.error("[AppInit] 版本检查失败:", versionResult.reason);
    }
  }
});
</script>

<template>
  <Provider>
    <router-view />
    <GlobalUpdateModal />
    <GlobalAuthModal />
  </Provider>
</template>

