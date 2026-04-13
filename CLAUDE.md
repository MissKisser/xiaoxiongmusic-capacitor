# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

小熊音乐（SPlayer Mobile）是基于 Capacitor 8 框架构建的 Android 平台音乐播放应用。采用 Vue 3 + TypeScript + Vite 7 技术栈，通过 Pinia 管理状态，使用 Naive UI 作为组件库。后端服务器独立部署，API 地址为 `https://music.viaxv.top`。

**平台约束**：所有开发严格限定于 Capacitor Android 端，不涉及 iOS/Web 平台兼容性处理。

## 常用开发命令

```bash
# 安装依赖（必须使用 pnpm）
pnpm install

# 开发模式（启动 Vite 开发服务器，端口 14558）
pnpm dev

# 构建生产版本
pnpm build

# TypeScript 类型检查 + 构建
pnpm build:check

# 同步资源到 Android 项目
pnpm cap:sync:android

# 在 Android Studio 中打开项目
pnpm cap:open:android

# 一键构建流程：构建 + 同步 + 打开 Android Studio
pnpm android:build

# 运行后端服务器（开发环境）
pnpm server:dev
```

## 核心架构

### 目录结构

```
src/
├── api/              # API 层，与后端服务交互
├── components/       # Vue 组件（Player、Modal、Setting、List 等）
├── composables/      # Vue 组合式函数
├── core/
│   ├── player/       # 播放器核心（PlayerController、AudioManager、LyricManager 等）
│   ├── audio-player/ # 音频引擎实现（AudioElement、FFmpeg、MPV）
│   └── resource/     # 资源管理（BlobURL、Cache、Download）
├── stores/           # Pinia 状态管理（music、setting、status、data 等）
├── views/            # 页面视图
├── router/           # Vue Router 路由配置
├── utils/            # 工具函数
└── types/            # TypeScript 类型定义

server/               # 独立后端服务器（Fastify）
├── routes/           # API 路由（auth、admin、version）
├── netease/          # 网易云音乐 API 代理
├── unblock/          # 歌曲解锁服务
└── proxy/            # 音频流代理

native/               # 原生模块桥接
├── emi-stub.ts       # Electron API 模拟（Capacitor 环境禁用）
└── ferrous-opencc-wasm/  # OpenCC 中文转换 WASM 模块

android/              # Capacitor Android 原生项目
```

### 播放器核心

播放器采用分层架构设计：

- **PlayerController**：主控制器，协调各管理器、处理播放生命周期
- **AudioManager**：音频引擎管理，支持 AudioElement / FFmpeg / MPV 多引擎切换
- **SongManager**：歌曲数据获取与解锁逻辑
- **LyricManager**：歌词解析与同步
- **MediaSessionManager**：Android 媒体会话通知栏控制

### 状态管理

主要 Store 模块：

- `useMusicStore`：当前播放歌曲、歌词、私人 FM、每日推荐
- `useSettingStore`：用户设置（播放、歌词、主题等）
- `useStatusStore`：运行状态（加载状态、自动关闭定时器等）
- `useDataStore`：歌单、专辑等数据缓存
- `useLocalStore`：本地歌曲数据（localforage 持久化）
- `useStreamingStore`：流媒体服务数据
- `useAuthStore`：用户认证状态

### 环境判断

```typescript
// src/utils/env.ts
isCapacitor  // Capacitor 原生环境（Android）
isElectron   // Electron 环境（本项目中为 false）
isMobile     // 移动端设备
isDev        // 开发环境
```

## 响应式布局规范

所有 UI 布局必须采用响应式设计，确保在不同分辨率和屏幕尺寸的 Android 设备上正确显示：

- 使用 CSS 媒体查询、Flexbox、Grid 布局
- 使用相对单位（rem、vw、vh）而非固定像素值
- 禁止使用绝对定位或固定尺寸导致适配问题
- 在 Android Studio 布局编辑器中验证多设备预览效果

## 代码规范

- 所有文档、注释、沟通使用中文
- 注释描述代码功能和用途，采用标准技术文档风格
- 代码作者标记统一使用 `Hackerdallas`
- 保留代码文件中的标准注释结构
- 代码风格体现专业工程实践，避免自动化生成特征

## 调试方式

使用 Android Studio Logcat 进行日志调试：

- 添加日志 TAG 标识后通过 Logcat 过滤器定向追踪
- 不使用 ADB 命令行调试方案

## 关键配置文件

- `capacitor.config.ts`：Capacitor 配置（appId: `com.xiaoxiong.music`）
- `vite.config.ts`：Vite 构建配置（代理、PWA、自动导入）
- `tsconfig.json`：TypeScript 配置（路径别名 `@/`、`@emi`、`@opencc`）
- `baota.nginx.conf`：Nginx 反向代理配置（用于服务器部署）

## 后端服务

后端服务器独立部署于 `music.viaxv.top`，功能包括：

- 网易云音乐 API 代理（`/api/netease/*`）
- 歌曲解锁服务（`/api/unblock/*`，支持网易云、酷我、波点、歌曲宝）
- 音频流代理（`/api/proxy/audio`）
- QQ 音乐歌词 API（`/api/qqmusic/*`）
- 授权与版本管理 API

数据库初始化脚本位于 `scripts/init_database.sql`。

## 依赖管理

**必须使用 pnpm**，使用其他包管理器可能导致依赖异常。