/**
 * 独立日志模块（不依赖 Electron）
 */

import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, appendFileSync } from "fs";
import { join } from "path";

// 日志目录
const logDir = process.env.LOG_DIR || join(process.cwd(), "logs");

// 确保日志目录存在
if (!existsSync(logDir)) {
  mkdirSync(logDir, { recursive: true });
}

// 获取日期 - YYYY-MM-DD
const dateString = new Date().toISOString().slice(0, 10);
const logFilePath = join(logDir, `${dateString}.log`);

// 格式化日志消息
const formatMessage = (level: string, scope: string, ...args: any[]): string => {
  const timestamp = new Date().toISOString();
  const message = args.map(arg => 
    typeof arg === "object" ? JSON.stringify(arg, null, 2) : String(arg)
  ).join(" ");
  return `[${timestamp}] [${level}] [${scope}] ${message}\n`;
};

// 写入日志文件
const writeLog = (level: string, scope: string, ...args: any[]): void => {
  const message = formatMessage(level, scope, ...args);
  try {
    appendFileSync(logFilePath, message, "utf8");
  } catch (error) {
    console.error("Failed to write log:", error);
  }
};

// 创建日志作用域
const createLogScope = (scope: string) => {
  return {
    debug: (...args: any[]) => {
      if (process.env.LOG_LEVEL === "debug") {
        console.debug(`[${scope}]`, ...args);
        writeLog("DEBUG", scope, ...args);
      }
    },
    log: (...args: any[]) => {
      console.log(`[${scope}]`, ...args);
      writeLog("INFO", scope, ...args);
    },
    info: (...args: any[]) => {
      console.info(`[${scope}]`, ...args);
      writeLog("INFO", scope, ...args);
    },
    warn: (...args: any[]) => {
      console.warn(`[${scope}]`, ...args);
      writeLog("WARN", scope, ...args);
    },
    error: (...args: any[]) => {
      console.error(`[${scope}]`, ...args);
      writeLog("ERROR", scope, ...args);
    },
  };
};

// 自动清理旧日志
const autoCleanLog = (daysToKeep: number = 30) => {
  try {
    if (!existsSync(logDir)) return;
    const files = readdirSync(logDir);
    const now = Date.now();
    const msToKeep = daysToKeep * 24 * 60 * 60 * 1000;

    files.forEach((file) => {
      if (!file.endsWith(".log")) return;
      const filePath = join(logDir, file);
      const stats = statSync(filePath);

      if (now - stats.mtimeMs > msToKeep) {
        unlinkSync(filePath);
        console.log(`已清理旧日志: ${file}`);
      }
    });
  } catch (err) {
    console.error("清理日志失败:", err);
  }
};

// 启动时清理
autoCleanLog();

// 导出日志作用域
export const serverLog = createLogScope("server");
export const processLog = createLogScope("process");
