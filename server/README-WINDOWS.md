# Windows 运行指南

## 快速开始

### 1. 安装依赖

```powershell
# 确保已安装 Node.js 20+ 和 pnpm
node --version
pnpm --version

# 安装项目依赖
pnpm install
```

### 2. 开发环境运行

```powershell
# 直接启动服务器
pnpm server

# 或使用生产模式
$env:NODE_ENV="production"; pnpm server:prod
```

服务器默认运行在 `http://localhost:25884`

### 3. 生产环境运行

#### 方式一：使用 PM2（推荐）

```powershell
# 安装 PM2（全局）
npm install -g pm2

# 启动服务器
pm2 start server/start.ts --interpreter tsx --name splayer-server

# 查看状态
pm2 status

# 查看日志
pm2 logs splayer-server

# 停止服务器
pm2 stop splayer-server

# 重启服务器
pm2 restart splayer-server

# 设置开机自启
pm2 startup
pm2 save
```

#### 方式二：使用 Windows 服务（NSSM）

1. **下载 NSSM**：
   - 访问：https://nssm.cc/download
   - 下载 Windows 版本并解压

2. **安装服务**：
```powershell
# 进入 NSSM 解压目录
cd C:\path\to\nssm\win64

# 安装服务
.\nssm.exe install SPlayerServer

# 在弹出的窗口中配置：
# Path: C:\path\to\node.exe (或 tsx 的完整路径)
# Startup directory: D:\document\Projects\Splayer\SPlayer
# Arguments: server/start.ts
# 或使用 tsx: C:\path\to\tsx.exe server/start.ts
```

3. **管理服务**：
```powershell
# 启动服务
.\nssm.exe start SPlayerServer

# 停止服务
.\nssm.exe stop SPlayerServer

# 删除服务
.\nssm.exe remove SPlayerServer
```

#### 方式三：使用批处理文件

创建 `start-server.bat`：

```batch
@echo off
cd /d %~dp0
set NODE_ENV=production
tsx server/start.ts
pause
```

创建 `start-server-background.bat`（后台运行）：

```batch
@echo off
cd /d %~dp0
set NODE_ENV=production
start /B tsx server/start.ts > logs\server.log 2>&1
echo 服务器已在后台启动，查看日志: logs\server.log
pause
```

## 环境变量设置

### PowerShell
```powershell
# 临时设置
$env:NODE_ENV="production"
$env:VITE_SERVER_PORT="25884"
$env:LOG_DIR="D:\document\Projects\Splayer\SPlayer\logs"

# 永久设置（系统环境变量）
[System.Environment]::SetEnvironmentVariable("NODE_ENV", "production", "Machine")
```

### CMD
```cmd
# 临时设置
set NODE_ENV=production
set VITE_SERVER_PORT=25884
set LOG_DIR=D:\document\Projects\Splayer\SPlayer\logs

# 永久设置（通过系统设置）
# 右键"此电脑" -> 属性 -> 高级系统设置 -> 环境变量
```

## 构建 Web 前端

```powershell
# 跳过原生模块构建（Windows 上可能不需要）
$env:SKIP_NATIVE_BUILD="true"
pnpm build

# 构建后的文件在 out/renderer 目录
```

## 使用 IIS 部署（可选）

如果需要使用 IIS 作为反向代理：

1. **安装 IIS 和 URL Rewrite 模块**
2. **创建 web.config**：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
  <system.webServer>
    <rewrite>
      <rules>
        <!-- API 代理 -->
        <rule name="API Proxy" stopProcessing="true">
          <match url="^api/(.*)" />
          <action type="Rewrite" url="http://localhost:25884/api/{R:1}" />
        </rule>
        <!-- 前端路由 -->
        <rule name="Frontend Routes" stopProcessing="true">
          <match url=".*" />
          <conditions logicalGrouping="MatchAll">
            <add input="{REQUEST_FILENAME}" matchType="IsFile" negate="true" />
            <add input="{REQUEST_FILENAME}" matchType="IsDirectory" negate="true" />
          </conditions>
          <action type="Rewrite" url="/index.html" />
        </rule>
      </rules>
    </rewrite>
    <httpProtocol>
      <customHeaders>
        <add name="Access-Control-Allow-Origin" value="*" />
        <add name="Access-Control-Allow-Methods" value="GET, POST, PUT, DELETE, OPTIONS" />
        <add name="Access-Control-Allow-Headers" value="Content-Type, Authorization, Range" />
      </customHeaders>
    </httpProtocol>
  </system.webServer>
</configuration>
```

## 测试服务器

### 1. 检查服务器是否运行

```powershell
# 在浏览器中访问
http://localhost:25884/api

# 或使用 PowerShell 测试
Invoke-WebRequest -Uri http://localhost:25884/api
```

### 2. 查看日志

```powershell
# 日志文件位置
Get-Content logs\*.log -Tail 50

# 实时查看日志（如果使用 PM2）
pm2 logs splayer-server
```

## 常见问题

### 1. 端口被占用

```powershell
# 查看端口占用
netstat -ano | findstr :25884

# 结束占用进程（替换 PID）
taskkill /PID <PID> /F

# 或修改端口
$env:VITE_SERVER_PORT="3000"
pnpm server
```

### 2. tsx 命令未找到

```powershell
# 确保已安装依赖
pnpm install

# 或使用 npx
npx tsx server/start.ts
```

### 3. 权限问题

```powershell
# 以管理员身份运行 PowerShell
# 右键 PowerShell -> 以管理员身份运行
```

### 4. 防火墙设置

```powershell
# 允许端口通过防火墙
New-NetFirewallRule -DisplayName "SPlayer Server" -Direction Inbound -LocalPort 25884 -Protocol TCP -Action Allow
```

## 开发调试

### 使用 VS Code

1. 创建 `.vscode/launch.json`：

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "启动服务器",
      "runtimeExecutable": "tsx",
      "runtimeArgs": ["server/start.ts"],
      "env": {
        "NODE_ENV": "development",
        "VITE_SERVER_PORT": "25884"
      },
      "console": "integratedTerminal",
      "internalConsoleOptions": "neverOpen"
    }
  ]
}
```

2. 按 F5 启动调试

## 完整部署示例

```powershell
# 1. 进入项目目录
cd D:\document\Projects\Splayer\SPlayer

# 2. 安装依赖
pnpm install

# 3. 构建前端
$env:SKIP_NATIVE_BUILD="true"
pnpm build

# 4. 启动服务器（PM2）
pm2 start server/start.ts --interpreter tsx --name splayer-server --env production

# 5. 设置开机自启
pm2 startup
pm2 save

# 6. 验证
Invoke-WebRequest -Uri http://localhost:25884/api
```

## 注意事项

1. Windows 路径使用反斜杠 `\`，但在配置文件中通常使用正斜杠 `/` 也可以
2. 环境变量在 PowerShell 和 CMD 中设置方式不同
3. 建议使用 PM2 管理进程，比 Windows 服务更灵活
4. 日志文件保存在 `logs/` 目录，按日期自动分割
5. 确保防火墙允许端口 25884 的访问
