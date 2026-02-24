/**
 * 验证服务器代码完整性
 */

import { existsSync } from "fs";
import { join } from "path";

const requiredFiles = [
  "server/start.ts",
  "server/index.ts",
  "server/logger.ts",
  "server/config.ts",
  "server/store.ts",
  "server/check-port.ts",
  "server/netease/index.ts",
  "server/proxy/index.ts",
  "server/unblock/index.ts",
  "server/qqmusic/index.ts",
];

const requiredDirs = [
  "server/netease",
  "server/proxy",
  "server/unblock",
  "server/qqmusic",
];

console.log("🔍 验证服务器文件完整性...\n");

let hasError = false;

// 检查必需文件
for (const file of requiredFiles) {
  const filePath = join(process.cwd(), file);
  if (!existsSync(filePath)) {
    console.error(`❌ 缺少文件: ${file}`);
    hasError = true;
  } else {
    console.log(`✅ ${file}`);
  }
}

// 检查必需目录
for (const dir of requiredDirs) {
  const dirPath = join(process.cwd(), dir);
  if (!existsSync(dirPath)) {
    console.error(`❌ 缺少目录: ${dir}`);
    hasError = true;
  }
}

if (hasError) {
  console.error("\n❌ 验证失败，请检查缺失的文件");
  process.exit(1);
} else {
  console.log("\n✅ 所有必需文件都存在");
  process.exit(0);
}
