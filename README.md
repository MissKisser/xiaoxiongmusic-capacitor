# SPlayer Mobile - 独立前端版本

这是 SPlayer 的移动端独立前端版本，使用远程服务器 API。

## 快速开始

### 1. 安装依赖
```bash
pnpm install
```

### 2. 开发模式
```bash
pnpm dev
```
访问 `http://localhost:14558` 查看应用

### 3. 构建生产版本
```bash
pnpm build
```
构建产物在 `dist` 目录

## 配置说明

### API 地址
在 `.env` 文件中配置：
```
VITE_API_URL=https://music.viaxv.top
```

### 特性
- ✅ 完全独立的 Web 应用
- ✅ 连接远程服务器 API (`https://music.viaxv.top`)
- ✅ 支持 PWA（渐进式 Web 应用）
- ✅ 移除了所有 Electron 依赖
- ✅ 可以直接部署到服务器或封装为 APP

## 与主项目的区别

| 项目 | 主项目 (SPlayer) | Mobile 版本 |
|------|------------------|-------------|
| 运行环境 | Electron 桌面应用 | Web / PWA / Capacitor |
| 后端 | 内置 Node.js 服务器 | 连接远程 API |
| 原生功能 | Electron API | Capacitor 插件 (待集成) |
| 适用场景 | Windows/Mac/Linux 桌面 | 浏览器 / 移动设备 |

## 下一步：封装为 APP

### 使用 Capacitor 封装
```bash
# 安装 Capacitor
pnpm install @capacitor/core @capacitor/cli @capacitor/android

# 初始化
npx cap init SPlayer com.imsyy.splayer --web-dir dist

# 添加 Android 平台
npx cap add android

# 构建并同步
pnpm build
npx cap copy

# 在 Android Studio 中打开
npx cap open android
```

## 技术栈
- Vue 3 + TypeScript
- Vite 7
- Pinia (状态管理)
- Naive UI (UI 组件)
- Axios (HTTP 请求)
- PWA (离线支持)
