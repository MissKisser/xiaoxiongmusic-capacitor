# 界面紧凑化调整设计

> 日期：2026-08-09
> 作者：Hackerdallas
> 状态：待审阅

## 背景与目标

用户在 Android 手机（约 360-430px 宽度）上使用本应用，反馈当前布局存在以下问题：

1. **一屏内容太少**：卡片网格每行 2 列、歌曲列表行高 90px，空间利用率低
2. **整体比例偏大**：卡片、间距、字体、封面偏大，不够精致
3. **歌曲名显示不完全**：长歌名被单行省略号截断（核心痛点，次要标签与歌手名显示正常）

**目标**：在不改变信息结构的前提下，整体收紧布局比例；手机端卡片列数做成用户可切换的设置项（2/3 列，默认 2 列）；保证歌曲名完整显示。

## 调整范围

- 卡片网格（`CoverList`，歌单/专辑/电台/MV 封面网格，20+ 页面共用）
- 首页推荐卡片（`HomeOnline` + `SongListCard` vertical 模式）
- 排行榜卡片（`Discover/toplists.vue`，`SongListCard` normal 模式）
- 歌曲列表（`SongCard` + `SongList` + `SongPlayList`）
- 页面整体边距（`AppLayout`）
- 设置项：应用设置 → 新建"界面布局"子分组

## 详细设计

### 1. 设置项：界面布局子分组

- **路由**：`type=app&item=layout`（三级设置页）
- **新建组件**：`src/components/Setting/groups/AppLayoutSetting.vue`
- **设置项**：卡片列数（手机端），`n-radio-button` 两档「2 列 / 3 列」，默认 2 列
- **Store 变更**：`useSettingStore` 新增字段 `mobileCardColumns: 2 | 3`，默认 `2`
- **接线点**：
  - `src/views/Settings/detail.vue`：`menus.app.items` 新增 `{ item: "layout", label: "界面布局", desc: "卡片列数、布局密度", icon: "SettingsOther" }`（图标已确认存在于 `src/assets/icons/SettingsOther.svg`）
  - `src/views/Settings/item.vue`：新增渲染分支 `AppLayoutSetting`，`titles` 映射 `layout: "界面布局"`

### 2. 卡片网格紧凑化（`src/components/List/CoverList.vue`）

| 项 | 现值 | 调整后 |
|---|---|---|
| 网格容器 padding | `20px 4px` | `12px 2px` |
| gap（桌面 / ≤768 / ≤600 / ≤400） | 20 / 16 / 12 / 10px | 16 / 12 / 10 / 8px |
| 手机端列数 | ≤600px 固定 3 列、≤400px 固定 2 列 | 读取 `settingStore.mobileCardColumns`，≤600px 与 ≤400px 均按设置渲染 2 或 3 列 |
| 卡片圆角（cover 与 item） | 16px | 12px |
| 卡片文字区 `.cover-data` padding | 12px | 8px |
| 播放按钮（`.play`） | 42px | 36px |
| 歌名 `.name` | 13px、line-clamp 2 | 保持 13px、line-clamp 2（3 列模式下不额外截断） |
| 播放量角标 | 图标 16px、右上 `10px 12px` | 图标 14px、右上 `8px 10px` |

- **实现方式**：网格列数在 ≤600px 断点内通过内联样式或 CSS 变量读取设置值；桌面端（>600px）保持 `auto-fill` 自适应不变
- 3 列模式下每列宽度约 110-125px（390px 屏），歌名 2 行 + 描述区仍完整显示

### 3. 首页推荐卡片（`src/views/Home/HomeOnline.vue` + `SongListCard`）

- `main-rec-grid`：gap 20 → 12px
- `SongListCard` vertical 模式：卡片内容 padding 12 → 10px、封面下间距 `margin-bottom 12 → 8px`、歌名 16 → 14px、描述 12 → 11px
- 移动端 `rec-list` 保持 2 列（每日推荐 + 我喜欢的音乐）

### 4. 排行榜卡片（`src/views/Discover/toplists.vue`）

- 固定高度 160 → 140px
- `SongListCard` normal 模式：内容 padding 16 → 12px、封面右侧距 `margin-right 20 → 12px`、歌名 18 → 16px、描述 12px 保持

### 5. 歌曲列表紧凑化（`SongCard` + `SongList` + `SongPlayList`）

**SongCard（`src/components/Card/SongCard.vue`）**

| 项 | 现值 | 调整后 |
|---|---|---|
| 行高 | 90px；≤768：auto+min 80px；≤512：min 75px | 76px；≤768：auto+min 72px；≤512：min 68px |
| 行内 padding | `8px 12px` | `6px 10px` |
| 封面 | `clamp(45px, 10vw, 50px)` | `clamp(40px, 8vw, 44px)` |
| 序号/操作列宽 | `clamp(36px, 8vw, 40px)` | `clamp(30px, 6vw, 34px)` |
| 歌名字号 | 16px | 15px |
| 描述行字号 | 13px | 12px |
| 标签高度 | `--n-height: 18px` | 16px |
| 歌名行数 | `line-clamp: 1` | **`line-clamp: 2`（核心改动：长歌名完整显示）** |

- 歌名 2 行 + 别名 `(alia)` 跟随第一行省略；描述行保持 1 行
- 高度预算：padding 12 + 歌名 2 行（15px×1.3≈39）+ 间距 2 + 描述 1 行 ≈17 = **70px < 76px**，不会撑高
- desc 行保持现有 flex + min-width:0 + 省略结构，不隐藏任何标签（用户确认标签与歌手显示正常）

**SongList（`src/components/List/SongList.vue`）— 同步点（防止滚动错位）**

- `VirtualScroll :item-height="90"` → `76`
- `scrollIndex = Math.floor(top / 90)` → `/ 76`
- 表头高度 40px → 36px（`.list-header` height、虚拟列表 `calc(100% - 40px)` → `calc(100% - 36px)`）

**SongPlayList（`src/components/List/SongPlayList.vue`）— 播放队列**

- `VirtualScroll :item-height="80"` → `72`
- 队列行内封面等尺寸按 SongCard 同比例微调（以实际 DOM 结构为准）

### 6. 页面整体边距（`src/layout/AppLayout.vue`）

- 内容区移动端 padding `0 16px` → `0 12px`；桌面端 `0 24px` 保持
- 首页栏目标题 `.title` margin-top 28 → 20px（`HomeOnline.vue`）

## 不动的东西（YAGNI）

- 不做"标准/紧凑"密度档位设置（用户已确认直接调默认值）
- 不做 vw/rem 全量自动缩放（现有响应式已足够）
- 不隐藏歌曲行次要标签（音质/原唱/翻唱/VIP/MV）——用户确认显示正常
- 桌面端（>768px）网格与列表布局规则不变，仅数值收紧
- 不涉及 `server/` submodule 任何改动

## 改动文件清单

| 文件 | 改动 |
|---|---|
| `src/stores/setting.ts` | 新增 `mobileCardColumns: 2 \| 3`（默认 2） |
| `src/components/Setting/groups/AppLayoutSetting.vue` | **新建**：界面布局设置组件 |
| `src/views/Settings/detail.vue` | 应用设置子菜单新增"界面布局"入口 |
| `src/views/Settings/item.vue` | 新增渲染分支与标题映射 |
| `src/components/List/CoverList.vue` | 网格列数读设置 + 紧凑化样式 |
| `src/components/Card/SongListCard.vue` | normal/vertical 紧凑化 |
| `src/components/Card/SongCard.vue` | 行高/尺寸/歌名 2 行 |
| `src/components/List/SongList.vue` | item-height/scrollIndex/表头同步 |
| `src/components/List/SongPlayList.vue` | item-height 80→72 同步 |
| `src/views/Home/HomeOnline.vue` | 推荐卡片 gap/标题边距 |
| `src/views/Discover/toplists.vue` | 卡片高度 160→140 |
| `src/layout/AppLayout.vue` | 移动端内容区 padding 16→12px |

## 验证方式

按 AGENTS.md 工作流程：`vue-tsc --noEmit` 类型检查 → `vite build` 生产构建 → `cap sync android` → Gradle `assembleDebug` 构建 APK。UI 效果由用户在真机手动验证（禁止模拟器/真机自动验证）。

构建产物：`android/app/build/outputs/apk/debug/app-debug.apk`

## 风险与注意

- **虚拟列表强耦合**：`SongCard` 行高、`SongList` 的 `item-height` 与 `scrollIndex` 计算必须同步修改，漏改会导致滚动错位、内容重叠
- **移动端行间空隙**：移动端 `min-height` 72px 与虚拟列表固定 `item-height` 76px 存在 4px 差值（内容不足 76px 时行间留白略松），位置计算不受影响，属可接受范围；桌面端 76px 固定高度无此问题
- **3 列模式下歌名/描述**：3 列每列约 110-125px 宽，歌名 line-clamp 2 仍可能截断极长歌名，属可接受范围（与桌面端行为一致）
- **设置项对桌面端无影响**：`mobileCardColumns` 仅在 ≤600px 断点读取
