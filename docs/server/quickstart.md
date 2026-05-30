# 快速启动指南

## ✅ 所有问题已修复

### 已修复的问题：
1. ✅ ES 模块导入路径（已添加 `.js` 扩展名）
2. ✅ `__dirname` 问题（已移除，使用 `process.cwd()`）
3. ✅ 端口占用检测（启动前自动检查）
4. ✅ 错误处理（友好的错误提示）
5. ✅ TypeScript 编译（所有文件可正常编译）

## 🚀 启动服务器

### Windows PowerShell

```powershell
# 方式 1: 直接启动（推荐）
pnpm server:prod

# 方式 2: 使用批处理文件
server\start-server.bat

# 方式 3: 分步执行
pnpm server:build  # 编译
pnpm server:start  # 运行
```

### 如果端口被占用

服务器会自动检测端口占用，如果端口 25884 被占用，会显示：

```
❌ 端口 25884 已被占用
💡 解决方案：
   Windows: netstat -ano | findstr :25884
   Linux: lsof -i :25884 或 netstat -tulpn | grep :25884
   或修改环境变量: $env:VITE_SERVER_PORT="3000" (PowerShell)
```

**解决方法：**

```powershell
# 1. 查看占用端口的进程
netstat -ano | findstr :25884

# 2. 结束进程（替换 <PID> 为实际的进程 ID）
taskkill /PID <PID> /F

# 3. 或使用其他端口
$env:VITE_SERVER_PORT="3000"
pnpm server:prod
```

## 📋 验证

启动成功后，你会看到：

```
[server] 🌐 Register NcmAPI successfully
[server] 🌐 Register UnblockAPI successfully
[server] 🌐 Register QQMusicAPI successfully
[server] 🌐 Register ProxyAPI successfully
[server] 🌐 Starting AppServer on port 25884
[server] ✅ 服务器已启动，监听端口: 25884
[server] 🌐 API 地址: http://localhost:25884/api
[server] 📝 按 Ctrl+C 停止服务器
```

## 🧪 测试

在浏览器中访问：
- API 信息：http://localhost:25884/api
- 网易云搜索：http://localhost:25884/api/netease/cloudsearch?keywords=test&type=1

## 📝 注意事项

1. **首次运行**：如果 `node_modules` 不存在，会自动安装依赖
2. **端口占用**：如果端口被占用，脚本会自动检测并提示
3. **编译**：每次修改代码后需要重新编译：`pnpm server:build`
4. **日志**：日志文件保存在 `logs/` 目录，按日期自动分割

## 🔧 环境变量

- `NODE_ENV`: 运行环境（development/production），默认 production
- `VITE_SERVER_PORT`: 服务器端口，默认 25884
- `LOG_DIR`: 日志目录，默认 `./logs`
- `LOG_LEVEL`: 日志级别（debug/info/warn/error）

## ✅ 现在可以运行了！

所有问题已修复，直接运行：

```powershell
pnpm server:prod
```
