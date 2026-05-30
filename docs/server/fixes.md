# 服务器修复清单

## ✅ 已修复的问题

### 1. ES 模块导入问题
- ✅ 所有相对路径导入已添加 `.js` 扩展名
- ✅ 类型导入使用 `import type` 语法
- ✅ 所有子模块导入路径已修复

### 2. `__dirname` 问题
- ✅ 使用 `process.cwd()` 替代 `__dirname`
- ✅ 移除了对 `fileURLToPath` 和 `dirname` 的依赖

### 3. 端口占用问题
- ✅ 添加了端口检查功能 (`check-port.ts`)
- ✅ 启动前自动检查端口是否可用
- ✅ 提供详细的错误提示和解决方案

### 4. 错误处理
- ✅ 改进了错误处理逻辑
- ✅ 添加了友好的错误提示
- ✅ 提供了端口占用时的解决方案

### 5. 编译配置
- ✅ 修复了 TypeScript 编译配置
- ✅ 确保所有文件能正确编译
- ✅ 编译后的代码可以正常运行

## 📝 使用方法

### Windows

```powershell
# 方式 1: 使用脚本（推荐）
pnpm server:prod

# 方式 2: 使用批处理文件
server\start-server.bat

# 方式 3: 分步执行
pnpm server:build  # 编译
pnpm server:start  # 运行
```

### 如果端口被占用

```powershell
# 查看占用端口的进程
netstat -ano | findstr :25884

# 结束进程（替换 PID）
taskkill /PID <PID> /F

# 或使用其他端口
$env:VITE_SERVER_PORT="3000"
pnpm server:prod
```

## 🔍 验证

运行验证脚本检查文件完整性：

```powershell
pnpm server:verify
```

## 📋 文件清单

所有必需的文件：
- ✅ `server/start.ts` - 启动入口
- ✅ `server/index.ts` - 服务器主文件
- ✅ `server/logger.ts` - 日志模块
- ✅ `server/config.ts` - 配置模块
- ✅ `server/store.ts` - 存储模块
- ✅ `server/check-port.ts` - 端口检查
- ✅ `server/netease/index.ts` - 网易云 API
- ✅ `server/proxy/index.ts` - 代理服务
- ✅ `server/unblock/index.ts` - 解锁服务
- ✅ `server/qqmusic/index.ts` - QQ 音乐 API

## 🚀 现在可以运行

所有问题已修复，可以直接运行：

```powershell
pnpm server:prod
```

如果遇到端口占用，脚本会自动检测并提示解决方案。
