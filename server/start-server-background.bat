@echo off
chcp 65001 >nul
echo ========================================
echo   SPlayer 独立服务器后台启动脚本
echo ========================================
echo.

cd /d %~dp0\..

REM 检查 Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未找到 Node.js，请先安装 Node.js 20+
    pause
    exit /b 1
)

REM 检查依赖
if not exist "node_modules" (
    echo [提示] 正在安装依赖...
    call pnpm install
    if %errorlevel% neq 0 (
        echo [错误] 依赖安装失败
        pause
        exit /b 1
    )
)

REM 创建日志目录
if not exist "logs" mkdir logs

REM 设置环境变量（可选，start.ts 会默认使用 production）
if "%NODE_ENV%"=="" set NODE_ENV=production
if "%VITE_SERVER_PORT%"=="" set VITE_SERVER_PORT=25884

echo [信息] 在后台启动服务器...
echo [信息] 端口: %VITE_SERVER_PORT%
echo [信息] 环境: %NODE_ENV%
echo [信息] 日志文件: logs\server.log
echo.

REM 后台启动（使用 start /B）
start /B pnpm server:prod > logs\server.log 2>&1

echo [成功] 服务器已在后台启动
echo [提示] 查看日志: type logs\server.log
echo [提示] 停止服务器: 使用任务管理器结束 node.exe 进程
echo.

pause
