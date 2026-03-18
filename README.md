<div align="center">
  <img alt="logo" height="100" width="100" src="public/icons/favicon.png" />
  <h2>SPlayer Mobile</h2>
  <p>一款专为Android平台设计的独立音乐播放器应用</p>

  <br />

  ![Version](https://img.shields.io/github/v/release/imsyy/SPlayer)
  ![License](https://img.shields.io/github/license/imsyy/SPlayer)

</div>

## 项目概述

SPlayer Mobile 是基于 Capacitor 框架构建的 Android 平台独立移动应用，采用 Vue 3 + TypeScript 技术栈开发。本项目并非 Web 应用或 PWA，而是一个原生 Android 应用，通过 Capacitor 将前端代码封装为可在 Android 设备上独立运行的原生应用程序。

应用通过连接远程服务器 API 获取音乐数据，支持扫码登录、手机号登录等网易云音乐账户认证方式，为用户提供完整的移动端音乐播放体验。

## 技术架构

### 核心技术栈

| 类别 | 技术选型 |
|------|----------|
| 前端框架 | Vue 3 + TypeScript |
| 构建工具 | Vite 7 |
| 状态管理 | Pinia |
| UI 组件库 | Naive UI |
| HTTP 请求 | Axios |
| 移动端封装 | Capacitor 8 |
| 目标平台 | Android |

### 系统架构

```
┌─────────────────────────────────────────────┐
│              Android 原生层                  │
│  ┌─────────────────────────────────────────┐│
│  │           Capacitor 插件                 ││
│  │  - 文件系统访问 (Filesystem)             ││
│  │  - 本地通知 (Local Notifications)        ││
│  │  - 状态栏控制 (Status Bar)               ││
│  │  - 应用生命周期 (App)                    ││
│  │  - 音乐播放控制 (Music Controls)         ││
│  └─────────────────────────────────────────┘│
├─────────────────────────────────────────────┤
│              WebView 层                     │
│  ┌─────────────────────────────────────────┐│
│  │         Vue 3 应用前端                   ││
│  │  - 页面组件                              ││
│  │  - 状态管理 (Pinia)                      ││
│  │  - 路由管理 (Vue Router)                 ││
│  └─────────────────────────────────────────┘│
├─────────────────────────────────────────────┤
│              远程服务层                      │
│  ┌─────────────────────────────────────────┐│
│  │        网易云音乐 API 服务               ││
│  │   (需自行部署或使用兼容的第三方服务)      ││
│  └─────────────────────────────────────────┘│
└─────────────────────────────────────────────┘
```

## 功能特性

### 账户与认证

- 扫码登录网易云音乐账户
- 手机号登录支持
- 用户信息与播放记录同步

### 音乐播放

- 在线音乐播放与搜索
- 歌单管理与收藏
- 每日推荐歌曲
- 私人 FM
- 逐字歌词显示与歌词翻译
- 音乐渐入渐出效果
- 音频频谱可视化

### 云端功能

- 云盘音乐上传与管理
- 云盘歌曲播放与纠正
- 歌曲下载支持（需会员权限）

### 界面与体验

- 封面主题色自适应
- Light / Dark / Auto 模式自动切换
- 评论区互动
- MV 与视频播放

## 快速开始

### 环境要求

- Node.js >= 20
- pnpm >= 8
- Android SDK（用于构建 APK）

### 安装依赖

```bash
pnpm install
```

### 开发模式

```bash
pnpm dev
```

开发服务器启动后，可通过 `http://localhost:14558` 访问应用进行调试。在开发阶段，应用仍通过 WebView 加载运行。

### 构建生产版本

```bash
pnpm build
```

构建产物位于 `dist` 目录。

### 打包 Android 应用

```bash
# 同步资源到 Android 项目
pnpm cap:sync:android

# 在 Android Studio 中打开项目进行打包
pnpm cap:open:android
```

或使用一键构建命令：

```bash
pnpm android:build
```

## 配置说明

### API 地址配置

在项目根目录的 `.env` 文件中配置远程 API 地址：

```bash
VITE_API_URL=https://your-music-api.example.com
```

### 构建配置

Capacitor 相关配置位于 [`capacitor.config.ts`](capacitor.config.ts)：

```typescript
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.imsyy.splayer',
  appName: 'SPlayer',
  webDir: 'dist',
  android: {
    buildGradleProperties: [
      'android.useAndroidX=true',
      'android.enableJetifier=true'
    ]
  }
};

export default config;
```

## 与桌面版本的区别

| 特性 | 桌面版本 (Electron) | 移动版本 (Capacitor) |
|------|---------------------|----------------------|
| 运行环境 | Windows / macOS / Linux 桌面 | Android 移动设备 |
| 后端服务 | 内置 Node.js 服务器 | 连接远程 API |
| 原生能力 | Electron API | Capacitor 插件 |
| 打包方式 | Electron Builder | Android Studio / Gradle |
| 安装形式 | 安装包 / 可执行文件 | APK / AAB |

## 项目结构

```
├── android/                 # Android 原生项目
│   ├── app/                # 应用模块
│   ├── build.gradle        # 构建配置
│   └── ...
├── src/                    # Vue 3 源代码
├── public/                 # 静态资源
├── capacitor.config.ts     # Capacitor 配置
├── vite.config.ts          # Vite 构建配置
└── package.json            # 项目依赖
```

## 注意事项

- 后端服务位于/server目录中，需要单独部署在服务器上，并使用baota.nginx.conf进行反代
- 部分高级功能（如 Hi-Res 音质下载）需要网易云音乐会员账号
- Android 版本需通过 Android Studio 或 Gradle 构建工具生成 APK
- iOS 平台支持代码已包含，但当前主要针对 Android 平台进行优化

## 开源许可

本项目基于 [GNU Affero General Public License (AGPL-3.0)](https://www.gnu.org/licenses/agpl-3.0.html) 许可进行开源。

- 仅供个人学习研究使用，禁止用于商业及非法用途
- 修改和分发需遵循 AGPL-3.0 许可协议

