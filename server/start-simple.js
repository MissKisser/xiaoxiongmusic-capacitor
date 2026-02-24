// 简单的启动脚本，用于测试
console.log('正在启动服务器...');
console.log('Node.js 版本:', process.version);
console.log('当前目录:', process.cwd());

try {
  // 动态导入 TypeScript 文件
  import('./start.ts').catch(err => {
    console.error('启动失败:', err);
    console.log('\n提示: 如果遇到权限错误，请尝试:');
    console.log('1. 以管理员身份运行 PowerShell');
    console.log('2. 或者运行: pnpm server:build && pnpm server:start');
    process.exit(1);
  });
} catch (err) {
  console.error('导入失败:', err);
  process.exit(1);
}
