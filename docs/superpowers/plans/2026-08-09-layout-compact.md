# 界面紧凑化调整 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 收紧全局卡片网格与歌曲列表的布局比例，新增手机端卡片 2/3 列设置项，并让歌曲名完整显示（2 行）。

**Architecture:** 设置项通过 `useSettingStore` 新增 `mobileCardColumns: 2 | 3` 字段（含 schema 迁移 v9）驱动 CoverList 手机端网格列数；其余改动为纯样式数值收紧（CSS），集中在 Card/List/Home/Discover 组件；SongCard 行高与 SongList/SongPlayList 的虚拟列表 `item-height`、滚动计算强耦合，必须同步修改。

**Tech Stack:** Vue 3 + TypeScript + Vite 7 + Pinia（pinia-plugin-persistedstate）+ Naive UI + SCSS

## Global Constraints

- 所有注释、文档使用中文，作者标记 `Hackerdallas`
- 依赖安装/脚本执行必须使用 `pnpm`
- 任务级验证命令：`pnpm exec vue-tsc --noEmit`（项目无单元测试框架，以类型检查为任务验收，对比既有基线判断是否新增错误）
- 最终集成验证：`pnpm build:check` → `pnpm cap:sync:android` → Gradle `assembleDebug`（构建产物 `android/app/build/outputs/apk/debug/app-debug.apk`）
- **禁止**启动模拟器/真机进行自动验证；UI 效果由用户手动验证
- 虚拟列表同步规则：`SongCard` 行高、`SongList` 的 `:item-height`、`scrollIndex` 除法、表头高度四处必须保持一致，漏改会导致滚动错位
- 全局样式 `* { box-sizing: border-box }`（`src/style/main.scss:5`），高度与 padding 同属一个盒模型
- 本环境 shell 无 `git` 命令：commit 步骤在环境支持时执行，否则跳过并在任务记录中说明

---

### Task 1: 设置 Store 新增 mobileCardColumns 字段与迁移 v9

**Files:**
- Modify: `src/stores/setting.ts`（interface 约 L362 `enableBlurEffect: boolean` 之后；state 约 L550 `enableBlurEffect: false,` 之后）
- Modify: `src/stores/migrations/settingMigrations.ts`（L9 版本号；L156 `8:` 之后）

**Interfaces:**
- Produces: `SettingState.mobileCardColumns: 2 | 3`（默认 `2`），`CURRENT_SETTING_SCHEMA_VERSION = 9`，迁移 `9: () => ({ mobileCardColumns: 2 })`。Task 2/4 依赖此字段。

- [ ] **Step 1: 修改 `src/stores/setting.ts` 类型定义**

在 `SettingState` interface 的 `enableBlurEffect: boolean;` 行后追加：

```ts
  /** 手机端卡片列数（2 或 3 列） */
  mobileCardColumns: 2 | 3;
```

- [ ] **Step 2: 修改 `src/stores/setting.ts` 默认值**

在 state 中 `enableBlurEffect: false,` 行后追加：

```ts
    mobileCardColumns: 2,
```

- [ ] **Step 3: 修改 `src/stores/migrations/settingMigrations.ts` 版本号与迁移**

L9 改为：

```ts
export const CURRENT_SETTING_SCHEMA_VERSION = 9;
```

在 `8: () => { ... }` 之后追加：

```ts
  9: () => {
    // 新增手机端卡片列数设置，默认 2 列
    return {
      mobileCardColumns: 2,
    };
  },
```

- [ ] **Step 4: 类型检查验证**

Run: `pnpm exec vue-tsc --noEmit`
Expected: 无新增错误（输出为既有基线，或干净通过）

- [ ] **Step 5: 提交（环境支持时）**

```bash
git add src/stores/setting.ts src/stores/migrations/settingMigrations.ts
git commit -m "feat: 设置新增手机端卡片列数字段 mobileCardColumns"
```

---

### Task 2: 新建 AppLayoutSetting 界面布局设置组件

**Files:**
- Create: `src/components/Setting/groups/AppLayoutSetting.vue`

**Interfaces:**
- Consumes: `useSettingStore().mobileCardColumns: 2 | 3`（Task 1）
- Produces: 默认导出 Vue 组件 `AppLayoutSetting`，Task 3 在 `item.vue` 中挂载。结构与 `AppThemeSetting.vue` 一致：根节点 `div.setting-type.app-setting > div.set-list`，设置项用 `n-h3 prefix="bar"` + `n-card.set-item`（`.set-item` 全局样式已在 `item.vue` 的 `<style lang="scss">` 定义，无需重复）。

- [ ] **Step 1: 创建组件文件**

创建 `src/components/Setting/groups/AppLayoutSetting.vue`：

```vue
<template>
  <div class="setting-type app-setting">
    <div class="set-list">
      <!-- 卡片列数 -->
      <n-h3 prefix="bar"> 卡片布局 </n-h3>
      <n-card class="set-item">
        <div class="label">
          <n-text class="name">卡片列数（手机端）</n-text>
          <n-text class="tip" :depth="3">
            歌单、专辑等卡片网格在手机上每行显示 2 列或 3 列，桌面端自动适配
          </n-text>
        </div>
        <n-radio-group
          :value="settingStore.mobileCardColumns"
          size="small"
          @update:value="handleColumnChange"
        >
          <n-radio-button :value="2">2 列</n-radio-button>
          <n-radio-button :value="3">3 列</n-radio-button>
        </n-radio-group>
      </n-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useSettingStore } from "@/stores";

const settingStore = useSettingStore();

// 切换卡片列数
const handleColumnChange = (value: 2 | 3) => {
  settingStore.mobileCardColumns = value;
  window.$message.success(`已切换为 ${value} 列`);
};
</script>
```

- [ ] **Step 2: 类型检查验证**

Run: `pnpm exec vue-tsc --noEmit`
Expected: 无新增错误（`n-radio-button` 的 `value: 2 | 3` 与 `@update:value` 回调类型需匹配 number）

- [ ] **Step 3: 提交（环境支持时）**

```bash
git add src/components/Setting/groups/AppLayoutSetting.vue
git commit -m "feat: 新增界面布局设置组件 AppLayoutSetting"
```

---

### Task 3: 设置页接线（detail.vue + item.vue）

**Files:**
- Modify: `src/views/Settings/detail.vue`（`menus.app.items`，L64-68）
- Modify: `src/views/Settings/item.vue`（import 区 L40-52、渲染分支 L28-30、titles L61-75）

**Interfaces:**
- Consumes: `AppLayoutSetting` 组件（Task 2）
- Produces: 设置路由 `type=app&item=layout` 可用，标题「界面布局」，图标 `SettingsOther`

- [ ] **Step 1: `detail.vue` 增加菜单入口**

在 `menus.app.items` 数组中 `other` 项之前新增：

```ts
      { item: "layout", label: "界面布局", desc: "卡片列数、布局密度", icon: "SettingsOther" },
```

- [ ] **Step 2: `item.vue` 增加 import**

在 `import AppThemeSetting from "@/components/Setting/groups/AppThemeSetting.vue";` 之后新增：

```ts
import AppLayoutSetting from "@/components/Setting/groups/AppLayoutSetting.vue";
```

- [ ] **Step 3: `item.vue` 增加渲染分支**

在 `<!-- 应用设置 -->` 分支的 `AppThemeSetting` 行之前新增：

```html
      <AppLayoutSetting v-else-if="type === 'app' && item === 'layout'" />
```

- [ ] **Step 4: `item.vue` 增加标题映射**

在 `titles` 中 `theme: "主题与背景",` 之后新增：

```ts
  layout: "界面布局",
```

- [ ] **Step 5: 类型检查验证**

Run: `pnpm exec vue-tsc --noEmit`
Expected: 无新增错误

- [ ] **Step 6: 提交（环境支持时）**

```bash
git add src/views/Settings/detail.vue src/views/Settings/item.vue
git commit -m "feat: 设置页接入界面布局子分组"
```

---

### Task 4: CoverList 网格列数读取设置 + 紧凑化样式

**Files:**
- Modify: `src/components/List/CoverList.vue`（模板 L4 `cover-grid` 根节点；script import 区 L116-124；样式 L240-257 网格块、L261/274 圆角、L354-362 文字区、L329-339 播放按钮、L299-313 播放量角标）

**Interfaces:**
- Consumes: `useSettingStore().mobileCardColumns`（Task 1）
- Produces: 手机端（≤600px）网格列数跟随设置（2 或 3 列）；桌面端 >600px 保持 `auto-fill` 自适应；整体更紧凑。

- [ ] **Step 1: 模板绑定列数 class**

`src/components/List/CoverList.vue` 模板 L4：

```html
      <div class="cover-grid">
```

改为：

```html
      <div :class="['cover-grid', `cols-${settingStore.mobileCardColumns}`]">
```

（loading 骨架网格 L97 的 `cover-grid` 保持原样，不绑 class）

- [ ] **Step 2: script 引入 settingStore**

import 区（L116）：

```ts
import { useMusicStore, useStatusStore, useLocalStore } from "@/stores";
```

改为：

```ts
import { useMusicStore, useStatusStore, useLocalStore, useSettingStore } from "@/stores";
```

在 `const localStore = useLocalStore();` 之后新增：

```ts
const settingStore = useSettingStore();
```

- [ ] **Step 3: 网格样式紧凑化 + 列数断点**

样式 L240-257 的 `.cover-list` 与 `.cover-grid` 块整体替换为：

```scss
.cover-list {
  width: 100%;
  padding: 12px 2px;
  .cover-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(160px, 100%), 1fr));
    gap: 16px;
    @media (max-width: 768px) {
      grid-template-columns: repeat(auto-fill, minmax(min(140px, 30vw), 1fr));
      gap: 12px;
    }
    @media (max-width: 600px) {
      // 手机端列数跟随设置（2 列或 3 列）
      &.cols-2 {
        grid-template-columns: repeat(2, 1fr);
      }
      &.cols-3 {
        grid-template-columns: repeat(3, 1fr);
      }
      gap: 10px;
      @media (max-width: 400px) {
        gap: 8px;
      }
    }
  }
```

- [ ] **Step 4: 卡片圆角与文字区紧凑化**

`.cover-item` 的 `border-radius: 16px;` 改为 `border-radius: 12px;`（L261）
`.cover` 的 `border-radius: 16px;` 改为 `border-radius: 12px;`（L274）
`.cover-data` 的 `padding: 12px;` 改为 `padding: 8px;`（L357）

- [ ] **Step 5: 播放按钮与播放量角标缩小**

`.play` 按钮（L338-339）：

```scss
        --n-width: 42px;
        --n-height: 42px;
```

改为：

```scss
        --n-width: 36px;
        --n-height: 36px;
```

`.play-count`（L301-304）：

```scss
        top: 10px;
        right: 12px;
```

改为：

```scss
        top: 8px;
        right: 10px;
```

`.play-count` 内 `.n-icon` 的 `font-size: 16px;` 改为 `font-size: 14px;`（L308）

- [ ] **Step 6: 类型检查验证**

Run: `pnpm exec vue-tsc --noEmit`
Expected: 无新增错误（注意 `&.video` 网格块在 `.cover-list` 内缩进层级为 2 级，修改时保持其 `@media` 结构不被破坏）

- [ ] **Step 7: 提交（环境支持时）**

```bash
git add src/components/List/CoverList.vue
git commit -m "feat: CoverList 网格列数跟随设置并紧凑化"
```

---

### Task 5: SongListCard / HomeOnline / toplists 卡片紧凑化

**Files:**
- Modify: `src/components/Card/SongListCard.vue`（L82 `n-card__content` padding、L93 cover margin、L152-155 normal、L166-194 vertical）
- Modify: `src/views/Home/HomeOnline.vue`（模板 L6 `:size="20"`、L239-241 main-rec-grid）
- Modify: `src/views/Discover/toplists.vue`（L11 `:height="160"`、L87 `.loading` height）

**Interfaces:**
- 无新接口。纯样式数值调整，影响首页「每日推荐/我喜欢的音乐」卡片、排行榜官方榜卡片。

- [ ] **Step 1: `SongListCard.vue` 基础 padding 与封面间距**

L82 `:deep(.n-card__content)`：

```scss
    padding: 16px;
```

改为：

```scss
    padding: 12px;
```

L93 `.cover` 的 `margin-right: 20px;` 改为 `margin-right: 12px;`

- [ ] **Step 2: `SongListCard.vue` normal 模式**

L152 `.title` 的 `margin-bottom: 12px;` 改为 `margin-bottom: 8px;`
L155 `.name` 的 `font-size: 18px;` 改为 `font-size: 16px;`

- [ ] **Step 3: `SongListCard.vue` vertical 模式**

L168 `:deep(.n-card__content)` 的 `padding: 12px;` 改为 `padding: 10px;`
L175 `.cover` 的 `margin-bottom: 12px;` 改为 `margin-bottom: 8px;`
L183 `.name` 的 `font-size: 16px;` 改为 `font-size: 14px;`
L187 `.desc` 的 `font-size: 12px;` 改为 `font-size: 11px;`

- [ ] **Step 4: `HomeOnline.vue` 首页推荐卡片间距**

模板 L6 `<n-flex :size="20" ...>` 的 `:size="20"` 改为 `:size="12"`

样式 L240 `.main-rec-grid` 的 `gap: 20px;` 改为 `gap: 12px;`

样式 L277 `.title` 的 `margin-top: 28px;` 改为 `margin-top: 20px;`

- [ ] **Step 5: `toplists.vue` 排行榜卡片高度**

模板 L11 `:height="160"` 改为 `:height="140"`
样式 L87 `.loading` 的 `height: 160px;` 改为 `height: 140px;`

- [ ] **Step 6: 类型检查验证**

Run: `pnpm exec vue-tsc --noEmit`
Expected: 无新增错误

- [ ] **Step 7: 提交（环境支持时）**

```bash
git add src/components/Card/SongListCard.vue src/views/Home/HomeOnline.vue src/views/Discover/toplists.vue
git commit -m "style: 首页与排行榜卡片紧凑化"
```

---

### Task 6: SongCard 行高/尺寸紧凑化 + 歌名 2 行显示

**Files:**
- Modify: `src/components/Card/SongCard.vue`（模板 L35 n-ellipsis `:line-clamp="1"`；样式 L244-252 行高、L258 padding、L304-307 序号列、L336-341 封面、L334 title padding、L353 name 字号、L355 desc 字号、L360 标签高度、L437-441 操作列、L453-463 meta）

**Interfaces:**
- Produces: 行高 76px（桌面）/ min-height 72px（≤768）/ 68px（≤512），封面 40-44px。Task 7 的虚拟列表数值必须与此同步。

- [ ] **Step 1: 歌名改为最多 2 行**

模板 L35：

```html
            <n-ellipsis
              :line-clamp="1"
```

改为：

```html
            <n-ellipsis
              :line-clamp="2"
```

- [ ] **Step 2: 行高与 padding**

L244-252：

```scss
.song-card {
  height: 90px;
  cursor: pointer;
  @media (max-width: 768px) {
    height: auto;
    min-height: 80px;
  }
  @media (max-width: 512px) {
    min-height: 75px;
  }
```

改为：

```scss
.song-card {
  height: 76px;
  cursor: pointer;
  @media (max-width: 768px) {
    height: auto;
    min-height: 72px;
  }
  @media (max-width: 512px) {
    min-height: 68px;
  }
```

L258 `.song-content` 的 `padding: 8px 12px;` 改为 `padding: 6px 10px;`

- [ ] **Step 3: 序号列与操作列收窄**

L304-307 `.num`：

```scss
    width: clamp(36px, 8vw, 40px);
    min-width: clamp(36px, 8vw, 40px);
    font-weight: bold;
    margin-right: clamp(8px, 2vw, 12px);
```

改为：

```scss
    width: clamp(30px, 6vw, 34px);
    min-width: clamp(30px, 6vw, 34px);
    font-weight: bold;
    margin-right: clamp(6px, 1.5vw, 10px);
```

L437-441 `.actions`：

```scss
    width: clamp(36px, 8vw, 40px);
```

改为：

```scss
    width: clamp(30px, 6vw, 34px);
```

- [ ] **Step 4: 封面缩小**

L336-341 `.cover`：

```scss
      width: clamp(45px, 10vw, 50px);
      height: clamp(45px, 10vw, 50px);
      min-width: clamp(45px, 10vw, 50px);
      border-radius: 8px;
      margin-right: clamp(8px, 2vw, 12px);
```

改为：

```scss
      width: clamp(40px, 8vw, 44px);
      height: clamp(40px, 8vw, 44px);
      min-width: clamp(40px, 8vw, 44px);
      border-radius: 8px;
      margin-right: clamp(6px, 1.5vw, 10px);
```

L334 `.title` 的 `padding: 4px 20px 4px 0;` 改为 `padding: 4px 12px 4px 0;`

- [ ] **Step 5: 字号与标签缩小**

L353 `.name` 的 `font-size: 16px;` 改为 `font-size: 15px;`
L355 `.desc` 的 `margin-top: 2px;` 保持，`font-size: 13px;` 改为 `font-size: 12px;`
L360-362 `.n-tag`：

```scss
        .n-tag {
          --n-height: 18px;
          font-size: 10px;
```

改为：

```scss
        .n-tag {
          --n-height: 16px;
          font-size: 10px;
```

- [ ] **Step 6: 类型检查验证**

Run: `pnpm exec vue-tsc --noEmit`
Expected: 无新增错误

- [ ] **Step 7: 提交（环境支持时）**

```bash
git add src/components/Card/SongCard.vue
git commit -m "style: 歌曲列表行紧凑化，歌名支持两行显示"
```

---

### Task 7: SongList / SongPlayList 虚拟列表同步

**Files:**
- Modify: `src/components/List/SongList.vue`（L79 `:item-height="90"`、L82 `calc(100% - 40px)`、L363 `top / 90`、L464 `.list-header` height、L457-460 `.song-card` padding-bottom）
- Modify: `src/components/List/SongPlayList.vue`（L23 `:item-height="80"`、L171 `.song-item` min-height）

**Interfaces:**
- Consumes: SongCard 行高 76px（Task 6）
- Produces: 虚拟列表固定高与 SongCard 实际渲染高一致，滚动定位正确。

- [ ] **Step 1: `SongList.vue` 虚拟列表 item-height**

L79：

```html
            :item-height="90"
```

改为：

```html
            :item-height="76"
```

- [ ] **Step 2: `SongList.vue` 滚动索引计算**

L363：

```ts
  scrollIndex.value = Math.floor(top / 90);
```

改为：

```ts
  scrollIndex.value = Math.floor(top / 76);
```

- [ ] **Step 3: `SongList.vue` 表头与列表高度**

L82 `:height="\`calc(100% - 40px)\`"` 改为 `:height="\`calc(100% - 36px)\`"`
L464 `.list-header` 的 `height: 40px;` 改为 `height: 36px;`

- [ ] **Step 4: `SongList.vue` 行间距收紧**

L457-460：

```scss
  .song-card {
    padding-bottom: 12px;
    // padding-right: 4px;
  }
```

改为：

```scss
  .song-card {
    padding-bottom: 8px;
    // padding-right: 4px;
  }
```

（`box-sizing: border-box` 下 76px 含此 padding，与 item-height 76 一致）

- [ ] **Step 5: `SongPlayList.vue` 播放队列同步**

L23 `:item-height="80"` 改为 `:item-height="72"`

L171 `.song-item` 的 `min-height: 64px;` 改为 `min-height: 56px;`（56 + margin-bottom 16 = 72，与 item-height 一致；`margin-bottom: 16px` 保持）

- [ ] **Step 6: 类型检查验证**

Run: `pnpm exec vue-tsc --noEmit`
Expected: 无新增错误

- [ ] **Step 7: 提交（环境支持时）**

```bash
git add src/components/List/SongList.vue src/components/List/SongPlayList.vue
git commit -m "fix: 虚拟列表行高与 SongCard 同步，防止滚动错位"
```

---

### Task 8: AppLayout 内容区移动端边距收紧

**Files:**
- Modify: `src/layout/AppLayout.vue`（L51 `content-style` padding）

**Interfaces:**
- 无新接口。

- [ ] **Step 1: 修改内容区 padding**

L51：

```ts
            padding: isMobile ? '0 16px' : '0 24px',
```

改为：

```ts
            padding: isMobile ? '0 12px' : '0 24px',
```

- [ ] **Step 2: 类型检查验证**

Run: `pnpm exec vue-tsc --noEmit`
Expected: 无新增错误

- [ ] **Step 3: 提交（环境支持时）**

```bash
git add src/layout/AppLayout.vue
git commit -m "style: 移动端内容区边距 16px 收紧至 12px"
```

---

### Task 9: 全量集成验证与 APK 构建

**Files:**
- 无代码改动。执行 AGENTS.md 规定的完整构建流程。

**Interfaces:**
- 验证 Task 1-8 的全部改动可编译、可打包。

- [ ] **Step 1: 类型检查 + 生产构建**

Run: `pnpm build:check`
Expected: `vue-tsc` 无错误退出；`vite build` 成功，输出 dist 产物

- [ ] **Step 2: 同步 Android 项目**

Run: `pnpm cap:sync:android`
Expected: Capacitor 同步成功，web assets 复制到 android 工程

- [ ] **Step 3: Gradle 构建 APK**

Run: `cd android && .\gradlew.bat assembleDebug`
Expected: BUILD SUCCESSFUL；产物 `android/app/build/outputs/apk/debug/app-debug.apk`

- [ ] **Step 4: 交付说明**

汇报：改动摘要、构建产物路径、提醒用户手动安装验证（重点验证：手机端 2/3 列切换、歌曲列表滚动定位、长歌名 2 行显示、播放队列）

---

## Self-Review

**1. Spec 覆盖检查：**
- ✅ 设置项 mobileCardColumns + 迁移 → Task 1-3
- ✅ CoverList 网格列数 + 紧凑化 → Task 4
- ✅ 首页/排行榜卡片 → Task 5
- ✅ SongCard 行高/封面/字号/歌名 2 行 → Task 6
- ✅ SongList/SongPlayList 同步 → Task 7
- ✅ AppLayout 边距 → Task 8
- ✅ 验证构建 → Task 9
- （spec 中"隐藏次要标签"已在用户确认后移除，非遗漏）

**2. 占位符扫描：** 全部步骤含精确行号与完整代码，无 TBD/TODO。

**3. 类型一致性：** `mobileCardColumns: 2 | 3` 在 Task 1 定义，Task 2 组件（`value: 2 | 3`、`handleColumnChange`）与 Task 4（`cols-${settingStore.mobileCardColumns}` 生成 `cols-2`/`cols-3` class）引用一致；行高 76px 在 Task 6 定义，Task 7 三处同步值一致。
