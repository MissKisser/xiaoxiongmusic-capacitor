# Capacitor 端设置体系说明

> 本文档说明本仓库（xiaoxiongmusic-capacitor）的设置 UI 体系：**菜单导航方式（分组子菜单 + 三级子页面）**。供后续开发参考，避免把设置改到不可达的位置。

## 设置体系：菜单导航（三级结构）

设置采用"菜单导航"形态，参考主流音乐 App（QQ 音乐 / 网易云音乐 / Spotify）的设置页交互：

```
/settings                          ← ① 设置主页：分类菜单列表（播放/歌词/应用）
/settings/:type                    ← ② 分类子菜单：该分类下的设置项列表
/settings/:type/:item              ← ③ 三级子页面：具体设置项内容
```

### ① 设置主页 `src/views/Settings/index.vue`

三个分类菜单卡片，点击进入对应分类子菜单：

| type | 菜单 | 说明 |
|------|------|------|
| `play` | 播放设置 | 定时器、均衡器、播放速度、AB 循环 |
| `lyrics` | 歌词设置 | 歌词显示、逐字歌词、翻译音译、歌词内容、歌词引擎、本地 TTML 库、桌面歌词 |
| `app` | 应用设置 | 主题与背景、缓存/性能/更多 |

### ② 分类子菜单 `src/views/Settings/detail.vue`

按 `:type` 渲染该分类下的设置项列表（卡片式菜单，带图标与说明），点击进入三级子页面。

### ③ 三级子页面 `src/views/Settings/item.vue`

按 `:type/:item` 渲染对应分组组件，顶部带返回按钮：

| 路由参数 | 渲染组件 |
|---------|---------|
| `play/timer` | `items/SleepTimerItem.vue` |
| `play/equalizer` | `items/EqualizerItem.vue` |
| `play/rate` | `items/PlayRateItem.vue` |
| `play/abloop` | `items/ABLoopItem.vue` |
| `lyrics/display` | `groups/LyricDisplaySetting.vue` |
| `lyrics/word` | `groups/LyricWordSetting.vue` |
| `lyrics/translate` | `groups/LyricTranslateSetting.vue` |
| `lyrics/content` | `groups/LyricContentSetting.vue` |
| `lyrics/engine` | `groups/LyricEngineSetting.vue` |
| `lyrics/ttml` | `groups/LyricTtmlSetting.vue` |
| `lyrics/desktop` | `items/DesktopLyricItem.vue` |
| `app/theme` | `groups/AppThemeSetting.vue` |
| `app/other` | `groups/AppOtherSetting.vue` |

路由在 `src/router/routes.ts` 中定义，`/settings/:type/:item` 带 `beforeEnter` 校验，非法的 type/item 组合回退到设置主页。

## 设置组件目录结构

```
src/components/Setting/
├── groups/       # 分组设置组件（完整设置区块，供三级子页面渲染）
│   ├── LyricDisplaySetting.vue    # 歌词显示：预览、字号、字体、位置、模糊、时延
│   ├── LyricWordSetting.vue       # 逐字歌词：显示逐字、KRC、来源优先级、QM
│   ├── LyricTranslateSetting.vue  # 翻译与音译：showTran/showRoma/swapTranRoma
│   ├── LyricContentSetting.vue    # 歌词内容：繁体、在线TTML、排除、屏蔽词还原
│   ├── LyricEngineSetting.vue     # 歌词引擎：默认/逐字卡拉OK/AMLL
│   ├── LyricTtmlSetting.vue       # 本地 TTML 歌词库：导入/列表/重命名/删除
│   ├── AppThemeSetting.vue        # 主题与背景：主题模式、全局背景、背景参数入口
│   └── AppOtherSetting.vue        # 缓存/性能/更多：audioCache、毛玻璃、5个Manager入口
└── items/        # 纯内容设置组件（弹窗与设置页复用）
    ├── SleepTimerItem.vue         # 定时器
    ├── EqualizerItem.vue          # 均衡器
    ├── PlayRateItem.vue           # 播放速度
    ├── ABLoopItem.vue             # AB 循环
    └── DesktopLyricItem.vue       # 桌面歌词
```

> `items/` 下的纯内容组件同时被播放器快捷弹窗（`src/components/Player/SettingsModals/*.vue`）引用，实现"弹窗与设置页同一份代码"。

## 设置入口（移动端真机可达）

### 1. 侧边栏菜单 → 设置
- `src/components/Layout/Menu.vue`："设置"菜单项（`link: "settings"`）→ 跳转 `/settings` 路由
- 旧的"其他设置"弹窗入口已移除

### 2. 播放器设置弹窗 `PlayerSettingsModal.vue`
- 播放页右上角齿轮按钮
- 保留为快捷弹窗：定时器 / 均衡器 / 播放速度 / AB 循环 / 桌面歌词
- 弹窗内容引用 `items/` 组件，与设置页共用逻辑

### 3. 快捷跳转入口（`src/utils/modal.ts`）
- `openSetting(type)` → 路由跳转 `/settings` 对应分类
- `openOtherSettings()` → 路由跳转 `/settings` 应用分类

## 已删除的旧组件

| 文件 | 说明 |
|------|------|
| `src/components/Setting/MainSetting.vue` | 旧歌词设置弹窗容器 |
| `src/components/Setting/LyricsSetting.vue` | 旧歌词设置内容（已拆分为 6 个 groups 组件） |
| `src/components/Setting/AppSettingContent.vue` | 旧应用设置内容（已拆分为 2 个 groups 组件） |
| `src/components/Modal/Setting/OtherSettingsModal.vue` | 旧"其他设置"弹窗 |
| electron 遗留 7 组件（GeneralSetting 等） | 无 Capacitor 引用的死代码 |

## 给开发者的提醒

1. **新增设置项时**，先确认它最终要在哪个入口显示：若是低频全局设置，放入 `groups/` 分组组件并挂到 `/settings/:type/:item` 三级路由；若是播放中高频操作（定时器/速度等），放入 `items/` 供快捷弹窗与设置页复用。
2. **修改分组组件**时注意 `items/` 与 `groups/` 的分工：`items/` 是纯内容（无标题栏），`groups/` 是完整设置区块（含标题分组）。
3. 判断组件是否被使用：`git grep "组件名" src`（含动态 import）。未被任何文件引用的 `Setting/*` 组件即为冗余代码，应删除。
4. 移动端可达性：所有入口必须在触摸屏上可见可用，不要用 `@media (hover:hover)` 锁定关键入口（历史上歌词设置入口曾因此不可达）。
