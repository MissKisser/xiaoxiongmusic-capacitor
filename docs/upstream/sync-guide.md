# SPlayer 上游代码同步规范

本文档定义了小熊音乐 (xiaoxiongmusic_capacitor) 与上游 SPlayer 代码同步的标准流程和规范。后续开发者应严格遵循本规范执行同步操作。

---

## 1. 项目架构差异分析

### 1.1 运行环境对比

| 维度 | SPlayer (上游) | 小熊音乐 (当前项目) |
|------|----------------|---------------------|
| **运行平台** | Windows/macOS/Linux 桌面 | Android 移动端 |
| **技术框架** | Electron + Node.js | Capacitor 8 + Web View |
| **音频引擎** | MPV 桌面播放器 | Web Audio API |
| **进程模型** | 多进程 (主进程+渲染进程) | 单进程 (WebView + Native Service) |
| **IPC 通信** | Electron IPC (window.electron) | Capacitor Plugin API |
| **HTTP 请求** | Node.js Axios (服务器端) | CapacitorHttp (前端本地) |
| **Cookie 管理** | 浏览器 Cookie Jar 自动携带 | localStorage 影子库 + CapacitorCookies |
| **文件系统** | Node.js fs 模块 | Capacitor Filesystem Plugin |
| **全局快捷键** | Electron globalShortcut | Android MediaSession |
| **通知系统** | Electron Notification | Android Notification + MediaSession |

### 1.2 核心功能差异

| 功能模块 | SPlayer 实现 | 小熊音乐实现 | 同步策略 |
|----------|-------------|-------------|----------|
| **音乐播放** | MPV 进程 + IPC 控制 | Web Audio + Android MusicService | ❌ 不同步，保持 Android 原生 |
| **歌词渲染** | AMLL Web 组件 | AMLL Web 组件 (相同) | ✅ 直接同步 |
| **歌曲解锁** | 服务器端 unblock/*.ts | 前端本地 unblock/*.ts | ⚠️ 同步逻辑，保留本地调用 |
| **音频缓存** | Electron 本地文件 | Android AudioProxyServer | ❌ 不同步，保持原生代理 |
| **睡眠定时器** | setTimeout (渲染进程) | Android MusicService Timer | ❌ 不同步，保持原生定时器 |
| **通知栏控制** | Electron Notification | Android MediaSession + Notification | ❌ 不同步，保持原生通知栏 |
| **Cookie 注入** | 浏览器自动携带 | 手动注入 params.cookie + Header | ⚠️ 同步逻辑，保留注入机制 |
| **音频均衡器** | MPV 内置 DSP | Web Audio BiquadFilterNode | ❌ 不同步，保持 Web Audio |
| **状态栏歌词** | macOS/Windows 任务栏 | Android 无此概念 | ❌ 平台不适用 |
| **Discord RPC** | Discord 客户端集成 | Android 无 Discord | ❌ 平台不适用 |

---

## 2. Electron 独有功能清单

以下功能为 Electron 平台特有，**禁止同步**到 Android 项目：

### 2.1 桌面系统集成类

| 功能 | 文件位置 | 原因 |
|------|----------|------|
| macOS 状态栏歌词 | `src/utils/desktopLyric.ts` | Android 无系统状态栏概念 |
| Windows 任务栏歌词 | `src/utils/taskbarLyric.ts` | Android 无任务栏概念 |
| 桌面歌词窗口 | `src/components/DesktopLyric/*.vue` | 需要 Electron BrowserWindow |
| 全局快捷键 | `src/utils/hotkey.ts` | 使用 Android MediaSession 替代 |
| 系统托盘 | `src/utils/tray.ts` | Android 无系统托盘 |
| 窗口管理 | `src/utils/window.ts` | Electron BrowserWindow API |

### 2.2 MPV 播放器相关

| 功能 | 文件位置 | 原因 |
|------|----------|------|
| MPV 服务集成 | `server/services/mpvService.ts` | Android 使用 Web Audio |
| 杜比全景声支持 | `src/core/audio-player/MpvPlayer.ts` | MPV 专有功能 |
| 音频缓存音质优先级 | `src/core/resource/MusicCacheService.ts` | 依赖 Electron IPC |
| MD5 校验下载 | `src/utils/fileUrl.ts` | MPV 本地文件播放需要 |
| UNC 路径处理 | `src/utils/fileUrl.ts` | Windows 网络路径，Android 不适用 |

### 2.3 IPC 通信相关

| 功能 | 文件位置 | 原因 |
|------|----------|------|
| IPC 主进程 API | `server/ipc/*.ts` | `window.electron` 不存在 |
| IPC 渲染进程调用 | `src/core/player/PlayerIpc.ts` | Capacitor 使用 Plugin API |
| 音乐缓存服务 | `src/core/resource/MusicCacheService.ts` | 依赖 Electron IPC |
| 文件对话框 | `src/utils/dialog.ts` | Electron dialog API |
| 原生菜单 | `src/utils/menu.ts` | Electron Menu API |

### 2.4 其他桌面特有功能

| 功能 | 文件位置 | 原因 |
|------|----------|------|
| Discord RPC | `src/utils/discord.ts` | Android 无 Discord 客户端 |
| Socket 服务 | `server/socket/*.ts` | 本地服务器，Android 无需求 |
| 自动更新 | `src/components/Modal/UpdateApp.vue` | Android 使用应用商店更新 |
| 本地歌曲标签编辑 | `src/components/Modal/SongInfoEditor.vue` | 需要 music-metadata Node 模块 |

---

## 3. 可同步/需改造功能清单

以下功能可从上游同步，但需根据 Android 平台特性进行改造：

### 3.1 纯 Web 层功能（直接同步）

| 功能 | 同步方式 | 检查点 |
|------|----------|--------|
| AMLL 歌词库升级 | 直接更新 package.json | 检查废弃 API (如 `setLinePosXSpringParams`) |
| 歌词解析器改进 | 直接同步 `lyricParser.ts` | 保留本地时间验证逻辑 |
| 歌词源优先级 | 同步 `setting.ts` + `LyricManager.ts` | 保留 `isElectron` 条件判断 |
| 热搜显示开关 | 同步 `setting.ts` + `SearchDefault.vue` | 无特殊处理 |
| 解锁匹配改进 | 同步逻辑，保留本地调用 | 见 4.2 节 |
| WordByWord LRC 修复 | 直接同步 `lyricParser.ts` | 无特殊处理 |
| 动画样式优化 | 直接同步 `animate.scss` | 验证移动端性能 |
| UI 组件样式 | 直接同步 Vue 组件样式 | 添加移动端响应式 CSS |

### 3.2 需改造功能

| 功能 | 上游实现 | Android 改造方案 |
|------|----------|------------------|
| **歌曲百科** | Vue 组件 + API | 同步组件，添加响应式布局 (媒体查询) |
| **评论页半屏** | FullPlayer 布局 | 可选同步，需适配移动端手势 |
| **播放延迟补偿** | AudioElementPlayer.ts | 可选同步，Web Audio 需验证 |
| **音质切换** | Electron IPC | 改用 Capacitor Plugin 调用 |
| **下载管理** | Node.js fs | 改用 Capacitor Filesystem + File Opener |

### 3.3 解锁功能改造重点

上游解锁逻辑在服务器端执行 (`server/unblock/*.ts`)，Android 项目改为前端本地执行：

```typescript
// 上游实现 (server端)
import axios from 'axios';
export async function unlockSongUrl(id: number, server: string) {
  const response = await axios.get(`http://localhost:3000/api/unblock/${server}/${id}`);
  return response.data;
}

// Android 改造 (前端本地)
import { CapacitorHttp } from '@capacitor/core';
import { isCapacitor } from '@/utils/env';

export async function unlockSongUrl(id: number, songName: string, artist: string, server: string) {
  if (isCapacitor) {
    return localUnlockSongUrl(id, songName, artist, server); // 本地解锁
  }
  // Web 端保留服务器调用...
}
```

**改造要点**：
1. 使用 `CapacitorHttp` 替代 `axios`，绕过 CORS 限制
2. 传递结构化参数 (`songName`, `artist`) 而非依赖 `split("-")`
3. URL 编码特殊字符歌名：`encodeURIComponent(keyword)`
4. 保留 `isCapacitor` 条件判断，保护双平台兼容

---

## 4. 二次开发内容保护规范

### 4.1 完全禁止合并的文件

以下文件包含二次开发核心逻辑，**严禁从上游合并任何变更**：

| 文件 | 保护内容 | 覆盖后果 |
|------|----------|----------|
| `server/routes/auth.ts` | 授权验证 API | 授权系统失效 |
| `server/routes/version.ts` | 版本管理 API | 版本检查失效 |
| `server/routes/admin.ts` | 管理员面板 | 管理功能失效 |
| `server/db.ts` | 数据库连接 | 数据库断连 |
| `src/stores/auth.ts` | 授权状态管理 | 授权状态丢失 |
| `src/stores/version.ts` | 版本检查逻辑 | 更新提示失效 |
| `src/components/Modal/GlobalAuthModal.vue` | 授权弹窗 | 无法授权 |
| `src/components/Modal/GlobalUpdateModal.vue` | 更新弹窗 | 无法更新 |
| `src/utils/env.ts` | `isCapacitor` 定义 | 环境检测失效 |
| `src/utils/request.ts` | CapacitorHttp 适配器 | HTTP 请求失效 |
| `src/utils/init.ts` | 原生模块初始化 | 原生功能失效 |
| `src/utils/cookie.ts` | Cookie 影子库 | 登录状态丢失 |
| `src/plugins/MusicNotificationPlugin.ts` | 通知栏插件接口 | 通知栏失效 |
| `src/plugins/MusicNotificationWeb.ts` | Web 降级实现 | Web 端降级失效 |
| `native/emi-stub.ts` | EMI 桩模块 | Electron API 模拟失效 |
| `capacitor.config.ts` | Capacitor 配置 | 配置丢失 |
| `vite.config.ts` | Capacitor 构建配置 | 构建失败 |
| `scripts/init_database.sql` | 数据库初始化 | 数据库结构错误 |
| `android/` 整目录 | Android 原生代码 | 原生功能全部失效 |

### 4.2 需谨慎合并的文件

以下文件包含混合内容（上游新增 + 二次开发特有），需手动选择性合并：

| 文件 | 本地特有内容 | 上游新增内容 | 合并策略 |
|------|-------------|-------------|----------|
| `src/stores/setting.ts` | Capacitor 特定设置项 | 新增设置项 | 手动添加新字段，保留全部本地字段 |
| `src/core/player/LyricManager.ts` | `isElectron` 条件判断 | 歌词优先级、TTML BG | 保留条件判断，新增功能代码块 |
| `src/core/player/PlayerController.ts` | `listenNativeSleepTimer` 原生定时器 | 播放控制改进 | 保留原生定时器代码，合并其他改进 |
| `src/core/player/SongManager.ts` | `processUrlForWeb` 代理 URL | songName/artist 参数 | 保留代理构造，合并参数传递 |
| `src/api/song.ts` | `unlockSongUrl` 本地解锁分支 | 百科 API | 保留本地解锁分支，新增 API |
| `src/router/routes.ts` | 本地路由结构 | 新路由 | 在末尾添加新路由，保留已有路由 |
| `src/utils/unblock/index.ts` | `localUnlockSongUrl` 函数 | 参数签名变化 | 保留函数实现，更新参数顺序 |
| `src/utils/unblock/kuwo.ts` | 本地匹配逻辑 | URL 编码修复 | 合入编码修复，保留匹配逻辑 |

### 4.3 isCapacitor 条件判断保护点

以下代码位置包含 `isCapacitor` 条件判断，**同步时必须保留**：

| 文件 | 行号 | 功能描述 |
|------|------|----------|
| `src/api/song.ts` | 55-58 | 本地解锁调用分支 |
| `src/core/player/SongManager.ts` | 155+ | 代理 URL 构造 (`localhost:18520`) |
| `src/core/player/PlayerController.ts` | 62-93 | 原生睡眠定时器监听 |
| `src/utils/request.ts` | 61, 78, 86, 140, 220, 226 | Cookie 注入、CapacitorHttp 适配 |
| `src/utils/cookie.ts` | 27, 102, 112 | Cookie 影子库同步 |
| `src/utils/init.ts` | 5, 17, 79, 90 | 状态栏、音乐控制、Cookie 同步、后台播放 |
| `src/utils/unblock/http.ts` | 6, 15, 44 | CapacitorHttp 绕过 CORS |
| `src/composables/useBackgroundPlayback.ts` | 22, 46, 59 | WakeLock、应用生命周期 |
| `src/components/Modal/Setting/OtherSettingsModal.vue` | 63, 170, 256 | 缓存设置 Capacitor 特定配置 |
| `src/App.vue` | 4, 21, 115, 117 | 授权检查、Cookie 同步、返回按钮监听 |

---

## 5. Android 原生层架构

### 5.1 原生模块清单

| 模块 | 文件路径 | 功能 | 替代的上游功能 |
|------|----------|------|----------------|
| **MusicService.java** | `android/app/src/main/java/.../MusicService.java` | 前台服务 + MediaSession + 睡眠定时器 | Electron IPC + setTimeout |
| **MusicNotificationPlugin.java** | `android/app/src/main/java/.../MusicNotificationPlugin.java` | Capacitor 插件桥梁 | window.electron IPC |
| **AudioProxyServer.java** | `android/app/src/main/java/.../AudioProxyServer.java` | NanoHTTPD 本地代理 + LRU 缓存(500MB) | MPV 直接请求 |
| **AudioCachePlugin.java** | `android/app/src/main/java/.../AudioCachePlugin.java` | 缓存配置管理接口 | Electron IPC 缓存操作 |
| **MusicControlReceiver.java** | `android/app/src/main/java/.../MusicControlReceiver.java` | 系统广播控制转发 | Electron 无此模块 |
| **MainActivity.java** | `android/app/src/main/java/.../MainActivity.java` | 插件注册 + WakeLock 管理 | Electron 无此模块 |

### 5.2 音频代理 URL 构造规范

Android 原生层提供本地音频代理服务，解决 Web Audio API 的 CORS 问题并实现缓存：

```typescript
// SongManager.ts - processUrlForWeb 方法
private processUrlForWeb(url: string, cacheKey?: string): string {
    if (isCapacitor) {
        // 必须保留此分支
        let proxyUrl = `http://localhost:18520/proxy/audio?url=${encodeURIComponent(url)}`;
        if (cacheKey) {
            proxyUrl += `&key=${encodeURIComponent(String(cacheKey))}`;
        }
        return proxyUrl;
    }
    // Web/Electron 端...
}
```

**代理服务特性**：
- 端口：18520 (NanoHTTPD)
- 缓存：LRU 策略，最大 500MB
- CORS：自动添加 `Access-Control-Allow-Origin: *`
- 等效器支持：代理后 Web Audio 均衡器生效

---

## 6. 同步执行流程规范

### 6.1 同步前准备工作

```bash
# 1. 确认上游仓库地址
UPSTREAM_REPO="https://github.com/SteveZhangJiang/SPlayer"

# 2. 获取上游最新变更范围
git fetch upstream
git log upstream/main --since="2026-02-28" --oneline

# 3. 创建同步分支
git checkout -b sync/splayer-YYYY-MM-DD

# 4. 备份当前状态
git stash push -m "pre-sync-backup"
```

### 6.2 文件同步检查清单

**Step 1: 依赖升级**
```bash
# 检查 package.json 中以下依赖版本
- @applemusic-like-lyrics/core
- @applemusic-like-lyrics/lyric

# 执行升级
pnpm install
pnpm build:check  # 验证编译
```

**Step 2: AMLL API 变化检查**
```bash
# 搜索废弃 API 调用
grep -r "setLinePosXSpringParams" src/
grep -r "SpringParams" src/

# 若存在，需移除或替换
```

**Step 3: 设置项同步**
```typescript
// 在 setting.ts 中手动添加新字段
// 禁止复制粘贴整个文件

interface SettingState {
  // ... 现有字段全部保留 ...
  
  // 新增字段（手动添加）
  showHotSearch: boolean;
  lyricPriority: "auto" | "qm" | "ttml" | "official";
}

// 默认值（手动添加）
showHotSearch: true,
lyricPriority: "auto",
```

**Step 4: 歌词管理器同步**
```bash
# 检查 LyricManager.ts 中的 isElectron 条件判断位置
grep -n "isElectron\|isCapacitor" src/core/player/LyricManager.ts

# 手动合并上游改进，保留条件判断
```

**Step 5: 解锁逻辑同步**
```bash
# 更新参数传递方式
# src/core/player/SongManager.ts - 传递 songName/artist 参数

# 更新函数签名
# src/utils/unblock/index.ts - localUnlockSongUrl(id, songName, artist, server)

# 添加 URL 编码
# src/utils/unblock/kuwo.ts - encodeURIComponent(keyword)
```

### 6.3 同步后验证清单

| 验证项 | 验证命令 | 验收标准 |
|--------|----------|----------|
| TypeScript 编译 | `pnpm build:check` | 无新增错误 |
| Vite 构建 | `pnpm vite build` | 成功输出 dist |
| Capacitor 同步 | `pnpm cap:sync:android` | 无错误警告 |
| Debug APK | `./gradlew assembleDebug` | 成功生成 APK |
| Release APK | `./gradlew assembleRelease` | 成功签名 |
| 授权系统 | 启动应用 | 授权流程正常 |
| 通知栏控制 | 播放歌曲 | 通知栏元数据正确 |
| 后台播放 | 熄屏测试 | 播放继续 |
| 睡眠定时器 | 设置定时关闭 | 定时暂停生效 |
| Cookie 同步 | 登录后检查 | Cookie 影子库有数据 |

---

## 7. 经验总结

### 7.1 同步过程中的关键教训

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| 图标不显示 | 使用不存在的图标名称 | 检查 `src/assets/icons/` 目录，使用可用图标 |
| APK 体积过大 | 未优化资源 | 检查 Web 资源大小，启用压缩 |
| 歌词解析错误 | `romanWord` 类型变化 | 改为可选字段 `romanWord?: string` |
| 解锁匹配失败 | 依赖 `split("-")` 解析歌名 | 传递结构化参数 `songName/artist` |
| 特殊字符搜索截断 | URL 未编码 | `encodeURIComponent(keyword)` |
| 深拷贝意外修改入参 | 直接修改歌词数据 | 使用 `cloneDeep(lyricsData)` |
| 时间验证不严谨 | 使用 `startTime` 未检查 `isFinite` | 添加 `Number.isFinite(startTime)` |
| Java 版本不匹配 | Gradle 配置与 JDK 不一致 | 强制使用 Java 21 (Capacitor 8 要求) |

### 7.2 移动端适配经验

| 场景 | 处理方式 |
|------|----------|
| 封面尺寸 | 使用响应式尺寸：移动端 140px，平板 160-200px，桌面 200px+ |
| 标题字号 | 移动端 18px，桌面 24px，使用媒体查询切换 |
| 信息布局 | 移动端居中对齐，桌面左对齐，使用 Flexbox |
| 卡片网格 | Naive UI `n-grid` 使用 `responsive="screen"` 属性 |
| 播放按钮 | 移动端 34px 高度，桌面 40px，使用媒体查询 |
| 菜单入口 | 使用 `n-dropdown` 桌面端，`n-drawer` 移动端底部抽屉 |

### 7.3 环境配置经验

| 配置项 | 规范 |
|--------|------|
| JAVA_HOME | 系统环境变量设置，不写入项目文件 |
| Gradle JDK | Android Studio 设置 Gradle JDK 为 JAVA_HOME |
| 代理配置 | 不写入 `gradle.properties`，使用系统代理或手动下载 |
| 签名配置 | 独立存放于项目外目录，绝对路径引用 |

### 7.4 Git 操作规范

| 操作 | 规范 |
|------|------|
| 同步分支命名 | `sync/splayer-YYYY-MM-DD` |
| 提交信息格式 | `feat: SPlayer 上游代码同步 vX.X.X` + 详细变更列表 |
| 推送前检查 | `git diff --stat` 确认无敏感文件 |
| Release 创建 | 使用 `gh release create` 命令上传 APK |
| 忽略文件 | 添加 `.claude/`、IDE 配置、构建产物、签名配置 |

---

## 8. 附录

### 8.1 可用图标清单

项目支持的图标位于 `src/assets/icons/`，使用时通过 `SvgIcon` 组件引用：

```vue
<SvgIcon name="Play" :size="18" />
```

常用图标：`Play`, `Pause`, `SkipNext`, `SkipPrev`, `HeartBroken`, `Favorite`, `FavoriteBorder`, `Info`, `Search`, `Share`, `Download`, `Delete`, `Menu`, `List`, `Video`, `Person`, `Album`, `Time`, `Cloud`, `Settings`, `Edit`, `Copy`, `Folder`, `Music`, `Stream`...

### 8.2 版本号更新规范

| 位置 | 字段 | 说明 |
|------|------|------|
| `package.json` | `"version"` | 前端版本号 |
| `android/app/build.gradle` | `versionCode` | Android 内部版本号 (递增整数) |
| `android/app/build.gradle` | `versionName` | Android 显示版本号 |

**示例**：
```groovy
// 从 4.5.3 升级到 4.6.4
versionCode 5  // 递增
versionName "4.6.4"
```

### 8.3 Release 发布规范

```bash
# 1. 构建 Release APK
./gradlew assembleRelease

# 2. 复制 APK 到项目根目录
cp android/app/build/outputs/apk/release/app-release.apk xiaoxiongmusic-vX.X.X.apk

# 3. 创建 GitHub Release
gh release create vX.X.X \
  --title "vX.X.X - 功能描述" \
  --notes-file RELEASE_NOTES.md \
  xiaoxiongmusic-vX.X.X.apk

# 4. 清理临时文件
rm xiaoxiongmusic-vX.X.X.apk RELEASE_NOTES.md
```

---

**文档版本**: 1.0  
**编写日期**: 2026-04-13  
**编写者**: Claude Code (SPlayer 上游同步执行)