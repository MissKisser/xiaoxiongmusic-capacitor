@echo off
chcp 65001 >nul
echo ========================================
echo   SPlayer 独立服务器启动脚本
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

REM 验证文件完整性
echo [验证] 检查服务器文件完整性...
call pnpm server:verify >nul 2>&1
if %errorlevel% neq 0 (
    echo [警告] 文件验证失败，但将继续尝试启动...
)

REM 设置环境变量（可选，start.ts 会默认使用 production）
if "%NODE_ENV%"=="" set NODE_ENV=production
if "%VITE_SERVER_PORT%"=="" set VITE_SERVER_PORT=25884

echo [信息] 启动服务器...
echo [信息] 端口: %VITE_SERVER_PORT%
echo [信息] 环境: %NODE_ENV%
echo.
echo 按 Ctrl+C 停止服务器
echo.

REM 检查端口是否被占用
echo [检查] 检查端口 %VITE_SERVER_PORT% 是否可用...
netstat -ano | findstr :%VITE_SERVER_PORT% >nul 2>&1
if %errorlevel% equ 0 (
    echo [警告] 端口 %VITE_SERVER_PORT% 已被占用！
    echo [提示] 正在查找占用端口的进程...
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr :%VITE_SERVER_PORT% ^| findstr LISTENING') do (
        echo [信息] 进程 ID: %%a
        tasklist /FI "PID eq %%a" 2>nul
    )
    echo.
    echo [选择] 请选择操作：
    echo   1. 结束占用端口的进程并启动服务器
    echo   2. 使用其他端口启动服务器
    echo   3. 退出
    set /p choice="请输入选项 (1-3): "
    if "!choice!"=="1" (
        for /f "tokens=5" %%a in ('netstat -ano ^| findstr :%VITE_SERVER_PORT% ^| findstr LISTENING') do (
            echo [操作] 正在结束进程 %%a...
            taskkill /PID %%a /F >nul 2>&1
        )
        timeout /t 2 >nul
    ) else if "!choice!"=="2" (
        set /p newPort="请输入新端口号: "
        set VITE_SERVER_PORT=!newPort!
    ) else (
        exit /b 0
    )
)

REM 启动服务器
echo [启动] 正在启动服务器...
call pnpm server:prod

pause
