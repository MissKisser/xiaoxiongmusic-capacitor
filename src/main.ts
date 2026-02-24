import { createApp } from "vue";
import App from "./App.vue";
// pinia
import { createPinia } from "pinia";
import piniaPluginPersistedstate from "pinia-plugin-persistedstate";
// router
import router from "@/router";
// 自定义指令
import { debounceDirective, throttleDirective, visibleDirective } from "@/utils/instruction";
// ipc
import initIpc from "@/utils/initIpc";
// use-store
import { useSettingStore } from "@/stores";
import { sendRegisterProtocol } from "@/utils/protocol";
// 全局样式
import "@/style/main.scss";
import "@/style/animate.scss";
import "github-markdown-css/github-markdown.css";
import { isElectron, isCapacitor } from "./utils/env";

// 前端控制台静音（仅 Web/Renderer，不影响后端/主进程日志）
// 目标：Web 端不在浏览器控制台输出这些调试日志（你贴出来那一堆）
// 注意：浏览器自身的 [Intervention] 等提示不属于 console.*，无法通过这里移除
if (!isElectron && !isCapacitor) {
  const noop = () => { };
  const methods = [
    "log",
    "debug",
    "info",
    "warn",
    "trace",
    "group",
    "groupCollapsed",
    "groupEnd",
    "time",
    "timeEnd",
    "table",
  ] as const;
  for (const m of methods) (console as any)[m] = noop;
}

// 挂载
const app = createApp(App);
// pinia
const pinia = createPinia();
pinia.use(piniaPluginPersistedstate);
app.use(pinia);
// router
app.use(router);
// 自定义指令
app.directive("debounce", debounceDirective);
app.directive("throttle", throttleDirective);
app.directive("visible", visibleDirective);
// app
app.mount("#app");

// 初始化 ipc
initIpc();

// 根据设置判断是否要注册协议
if (isElectron) {
  const settings = useSettingStore();
  sendRegisterProtocol("orpheus", settings.registryProtocol.orpheus);
}
