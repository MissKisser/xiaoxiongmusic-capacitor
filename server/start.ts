#!/usr/bin/env node

/**
 * 独立服务器启动入口
 * 不依赖 Electron，可直接运行
 */

// 如果 NODE_ENV 未设置，默认使用 production
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = "production";
}

import initAppServer from "./index.js";
import { serverLog } from "./logger.js";
import { port } from "./config.js";
import { checkPort } from "./check-port.js";

// 处理未捕获的异常
process.on("uncaughtException", (error) => {
  serverLog.error("未捕获的异常:", error);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  serverLog.error("未处理的 Promise 拒绝:", reason);
  process.exit(1);
});

// 检查端口并启动服务器
(async () => {
  try {
    const isPortAvailable = await checkPort(port);
    if (!isPortAvailable) {
      serverLog.error(`❌ 端口 ${port} 已被占用`);
      serverLog.info(`💡 解决方案：`);
      serverLog.info(`   Windows: netstat -ano | findstr :${port}`);
      serverLog.info(`   Linux: lsof -i :${port} 或 netstat -tulpn | grep :${port}`);
      serverLog.info(`   或修改环境变量: $env:VITE_SERVER_PORT="3000" (PowerShell)`);
      process.exit(1);
      return;
    }

    await initAppServer();
    serverLog.info(`✅ 服务器已启动，监听端口: ${port}`);
    serverLog.info(`🌐 API 地址: http://localhost:${port}/api`);
    serverLog.info(`📝 按 Ctrl+C 停止服务器`);
  } catch (error: any) {
    if (error.code === "EADDRINUSE") {
      serverLog.error(`❌ 端口 ${port} 已被占用`);
      serverLog.info(`💡 请先停止占用端口的进程，或使用其他端口`);
    } else {
      serverLog.error("❌ 服务器启动失败:", error);
    }
    process.exit(1);
  }
})();
