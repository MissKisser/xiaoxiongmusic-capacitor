# SPlayer 上游代码同步日志

## 同步版本信息

- **同步日期**: 2026-04-13
- **同步目标**: SPlayer 上游 2026-02-28 至 2026-04-11 期间更新
- **当前版本**: 4.6.4 (versionCode: 5)
- **上游参考**: https://github.com/SteveZhangJiang/SPlayer

---

## 同步内容清单

### 依赖升级

| 模块 | 原版本 | 新版本 | 状态 |
|------|--------|--------|------|
| @applemusic-like-lyrics/core | 0.2.0 | 0.3.2 | ✅ 已同步 |
| @applemusic-like-lyrics/lyric | 0.3.0 | 0.4.1 | ✅ 已同步 |

**修改文件**: `package.json`, `pnpm-lock.yaml`

---

### 新增功能

#### 1. SongWiki 音乐百科模块

| 项目 | 详情 |
|------|------|
| 新增文件 | `src/views/Song/wiki.vue`, `src/views/Song/types.ts` |
| 新增路由 | `/song/wiki` (name: `song-wiki`) |
| 新增 API | `songWikiSummary`, `songFirstListenInfo`, `songSheetList`, `songSheetPreview` |
| 菜单入口 | `useSongMenu.ts` - 歌曲百科菜单项 |
| 图标 | `Info` (Info.svg) |
| 移动端适配 | 响应式布局，封面 140-200px，移动端居中显示 |

**修改文件**:
- `src/views/Song/wiki.vue` (新建)
- `src/views/Song/types.ts` (新建)
- `src/api/song.ts` (新增 4 个 API 接口)
- `src/router/routes.ts` (新增路由)
- `src/composables/useSongMenu.ts` (新增菜单项)

---

### 设置项新增

| 设置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `showHotSearch` | boolean | true | 热搜榜显示开关 |
| `lyricPriority` | string | "auto" | 歌词源优先级 (auto/qm/ttml/official) |

**修改文件**: `src/stores/setting.ts`

---

### 歌词系统改进

#### LyricManager.ts

| 改进项 | 详情 |
|--------|------|
| 歌词优先级支持 | 根据 `lyricPriority` 设置选择歌词源 |
| 深拷贝修复 | `alignLyrics` 使用 `cloneDeep` 避免意外修改入参 |
| 时间验证 | 新增 `Number.isFinite(startTime)` 检查 |
| 翻译歌词 | `translatedLyric` 字段支持 |

**修改文件**: `src/core/player/LyricManager.ts`

#### SearchDefault.vue

| 改进项 | 详情 |
|--------|------|
| 热搜开关 | `showHotSearch` 条件显示热搜榜区域 |
| 数据获取 | `getSearchHotData` 增加开关判断 |

**修改文件**: `src/components/Search/SearchDefault.vue`

---

### 解锁匹配改进

#### SongManager.ts

| 改进项 | 详情 |
|--------|------|
| 参数传递 | 传递 `songName` 和 `artist` 结构化参数 |
| 匹配准确性 | 避免依赖 `split("-")` 解析 |

**修改文件**: `src/core/player/SongManager.ts`

#### unblock/index.ts

| 改进项 | 详情 |
|--------|------|
| 函数签名 | `localUnlockSongUrl(id, songName, artist, server)` |
| 参数顺序 | 新增 `songName` 参数 |

**修改文件**: `src/utils/unblock/index.ts`

#### unblock/kuwo.ts

| 改进项 | 详情 |
|--------|------|
| URL 编码 | `encodeURIComponent(keyword)` 修复特殊字符截断 |
| 歌名匹配 | `songName` 参数用于精确匹配 |

**修改文件**: `src/utils/unblock/kuwo.ts`

---

### Android 构建配置

#### Java 版本要求

| 项目 | 配置 |
|------|------|
| Java 版本 | Java 21 (Capacitor 8 要求) |
| JAVA_HOME | `C:\Program Files\Eclipse Adoptium\jdk-21.0.9.10-hotspot` |
| compileOptions | `sourceCompatibility VERSION_21`, `targetCompatibility VERSION_21` |

**修改文件**:
- `android/app/build.gradle`
- `android/build.gradle`
- `android/gradle.properties`

#### 签名配置

| 项目 | 配置 |
|------|------|
| 密钥库 | `D:/document/Projects/xiaoxiongmusic/splayer-release-key.jks` |
| 配置文件 | `D:/document/Projects/xiaoxiongmusic/keystore.properties` |
| keyAlias | `xiaoxiongmusic` |

---

## 跳过的同步项

| 功能 | 原因 |
|------|------|
| 评论页半屏显示 | 布局设计偏好跳过 |
| Web Audio 延迟补偿 | 用户选择跳过 |
| 歌单/列表动画优化 | 可选，未同步 |
| macOS 状态栏歌词 | 平台不适用 |
| Windows 任务栏歌词 | 平台不适用 |
| MPV 服务集成 | Android 使用 Web Audio |
| Discord RPC | 移动端无 Discord |
| 全局快捷键 | 使用 MediaSession 替代 |
| Electron IPC | Capacitor 环境禁用 |

---

## 保护代码清单

以下二次开发代码完全保留，未受上游合并影响：

| 文件 | 保护内容 |
|------|----------|
| `src/api/song.ts:55-58` | `unlockSongUrl` isCapacitor 本地解锁分支 |
| `src/core/player/SongManager.ts:155` | `processUrlForWeb` 代理 URL 构造 |
| `src/core/player/PlayerController.ts:62-93` | `listenNativeSleepTimer` 睡眠定时器 |
| `src/utils/request.ts` | CapacitorHttp 适配器 + Cookie 注入 |
| `src/utils/cookie.ts` | Cookie 影子库 + CapacitorCookies 同步 |
| `src/utils/init.ts` | 原生模块初始化 |
| `src/utils/env.ts` | isCapacitor 环境检测 |
| `android/` 整目录 | Android 原生代码 |

---

## 构建验证

| 验证项 | 结果 |
|--------|------|
| Vite 构建 | ✅ 成功 (3915 modules, ~20s) |
| Capacitor 同步 | ✅ 成功 (0.38s) |
| Debug APK | ✅ 成功 (15.62 MB) |
| Release APK | ✅ 成功 (13.49 MB) |
| 签名验证 | ✅ 已签名 |

---

## 同步执行者

- Claude Code (claude.ai/code)
- 同步日期: 2026-04-13