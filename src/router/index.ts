import { createRouter, createWebHashHistory, Router } from "vue-router";
import { isElectron } from "@/utils/env";
import { isLogin } from "@/utils/auth";
import { isRouteSupported } from "@/api/platform/capability";
import { usePlatformStore } from "@/stores";
import routes from "./routes";

// 基础配置
const router: Router = createRouter({
  history: createWebHashHistory(import.meta.env.BASE_URL),
  routes,
});

// 滚动位置记忆（导出供 AppLayout 使用）
export const scrollPositions = new Map<string, number>();

// 前置守卫
router.beforeEach((to, from, next) => {
  // 进度条
  if (!isElectron && to.path !== from.path) {
    window.$loadingBar.start();
  }

  // 保存当前页面的滚动位置
  if (from.fullPath) {
    const mainContent = document.getElementById("main-content");
    if (mainContent) {
      const scrollContainer = mainContent.querySelector(".n-scrollbar-container");
      if (scrollContainer) {
        scrollPositions.set(from.fullPath, scrollContainer.scrollTop);
      }
    }
  }

  const platformStore = usePlatformStore();
  const isPlatformSource = platformStore.currentPlatform !== "netease";

  // 平台能力校验：第三方平台不支持的页面直接拦截
  const routeName = to.name as string | undefined;
  if (routeName && !isRouteSupported(platformStore.currentPlatform, routeName)) {
    if (!isElectron) window.$loadingBar.error();
    window.$message.warning("当前平台不支持该功能");
    next({ path: "/" });
    return;
  }

  // 需要登录（第三方平台不走网易云登录拦截）
  if (to.meta.needLogin && !isLogin() && !isPlatformSource) {
    if (!isElectron) window.$loadingBar.error();
    window.$message.warning("请登录后使用");
    import("@/utils/modal").then(({ openUserLogin }) => {
      openUserLogin();
    });
    return;
  }
  // 需要客户端
  else if (to.meta.needApp && !isElectron) {
    window.$message.warning("该功能为客户端独占功能");
    next("/403");
  }
  next();
});

// 后置守卫
router.afterEach(() => {
  // 进度条
  window.$loadingBar.finish();
});

export default router;
