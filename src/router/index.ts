import { createRouter, createWebHashHistory, Router } from "vue-router";
import { openUserLogin } from "@/utils/modal";
import { isElectron } from "@/utils/env";
import { isLogin } from "@/utils/auth";
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

  // 需要登录
  if (to.meta.needLogin && !isLogin()) {
    if (!isElectron) window.$loadingBar.error();
    window.$message.warning("请登录后使用");
    openUserLogin();
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
  // 注意：滚动位置恢复由 AppLayout 的 Transition @after-enter 处理
  // 不在这里操作滚动，因为 out-in 过渡动画此时尚未完成
});

export default router;
