/**
 * 移动端设置页布局与交互防御回归测试
 *
 * 覆盖移动端设置项横向溢出防御、标签自适应换行（flex: 1 1 auto）、滑块触摸穿透防御，
 * 共享 column 修饰类规范，各分组禁止私配 .n-card-content 布局契约，
 * 以及 DesktopLyricItem 与各控件尺寸自适应约束。
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * 读取仓库内源文件内容
 * @param relativePath 相对仓库根的路径
 * @returns 文件文本内容
 */
const readSource = (relativePath: string): string =>
  readFileSync(path.join(repoRoot, relativePath), "utf8");

describe("设置页共享层容器与标签自适应（src/views/Settings/item.vue）", () => {
  const itemVue = readSource("src/views/Settings/item.vue");

  it("设置卡片内容容器支持换行与间距接管", () => {
    assert.match(
      itemVue,
      /\.set-item[\s\S]*?\.n-card-content[\s\S]*?flex-wrap:\s*wrap;/s,
      ".set-item .n-card-content 应声明 flex-wrap: wrap",
    );
    assert.match(
      itemVue,
      /\.set-item[\s\S]*?\.n-card-content[\s\S]*?gap:\s*12px;/s,
      ".set-item .n-card-content 应声明 gap: 12px",
    );
  });

  it("设置项标签声明 flex: 1 1 auto 与自适应折行", () => {
    assert.match(
      itemVue,
      /\.label[\s\S]*?flex:\s*1\s+1\s+auto;/s,
      ".label 必须声明 flex: 1 1 auto（flex-basis: auto），禁止回归为 0%",
    );
    assert.match(
      itemVue,
      /\.label[\s\S]*?flex-wrap:\s*wrap;/s,
      ".label 应声明 flex-wrap: wrap",
    );
    assert.match(
      itemVue,
      /\.label[\s\S]*?min-width:\s*0;/s,
      ".label 应声明 min-width: 0 避免撑破弹性盒",
    );
    assert.match(
      itemVue,
      /\.label[\s\S]*?\.tip[\s\S]*?word-break:\s*break-word;/s,
      ".label .tip 应声明 word-break: break-word 防止长文案溢出",
    );
    assert.match(
      itemVue,
      /\.label[\s\S]*?\.tip[\s\S]*?overflow-wrap:\s*anywhere;/s,
      ".label .tip 应声明 overflow-wrap: anywhere",
    );
  });

  it("共享层提供标准整卡纵向排版修饰类 .column", () => {
    assert.match(
      itemVue,
      /&?\.column[\s\S]*?\.n-card-content[\s\S]*?flex-direction:\s*column;[\s\S]*?align-items:\s*stretch;[\s\S]*?gap:\s*12px;/s,
      ".set-item 应提供 .column 修饰类，声明 flex-direction: column、align-items: stretch 与 gap: 12px",
    );
  });

  it("设置项内单选按钮组保持原生内联块排布且窄屏可折行", () => {
    const radioGroupBlock = itemVue.match(
      /\.n-radio-group\s*\{([\s\S]*?)\n\s{6}\}/,
    )?.[1] ?? "";
    assert.ok(radioGroupBlock.length > 0, "应存在 .n-radio-group 规则块");
    assert.match(
      radioGroupBlock,
      /white-space:\s*normal;/,
      "单选按钮组应放开 white-space 以便窄屏折行",
    );
    assert.match(
      radioGroupBlock,
      /height:\s*auto;/,
      "单选按钮组应自适应高度，避免折行后压行",
    );
    assert.match(
      radioGroupBlock,
      /flex:\s*0\s+0\s+auto;/,
      "单选按钮组作为弹性子项时不应被压缩",
    );
    assert.doesNotMatch(
      radioGroupBlock,
      /display:\s*flex;/,
      ".n-radio-group 不得被强制为 flex 容器",
    );
  });

  it("设置子页面与滚动容器声明横向溢出防御", () => {
    assert.match(
      itemVue,
      /\.settings-item-page[\s\S]*?min-width:\s*0;[\s\S]*?overflow-x:\s*hidden;/s,
      ".settings-item-page 应声明 min-width: 0 与 overflow-x: hidden",
    );
    assert.match(
      itemVue,
      /\.n-scrollbar-container[\s\S]*?overflow-x:\s*hidden\s*!important;/s,
      ".item-content 下 .n-scrollbar-container 应限定 overflow-x: hidden !important",
    );
    assert.match(
      itemVue,
      /\.n-scrollbar-content[\s\S]*?min-width:\s*0;[\s\S]*?max-width:\s*100%;/s,
      ".item-content 下 .n-scrollbar-content 应声明 min-width: 0 与 max-width: 100%",
    );
  });
});

describe("桌面歌词私有行布局与控件自适应（src/components/Setting/items/DesktopLyricItem.vue）", () => {
  const desktopVue = readSource("src/components/Setting/items/DesktopLyricItem.vue");

  it("桌面歌词 .label 必须声明 flex: 1 1 auto 对齐共享口径", () => {
    assert.match(
      desktopVue,
      /\.label[\s\S]*?flex:\s*1\s+1\s+auto;[\s\S]*?min-width:\s*0;/s,
      "DesktopLyricItem 的 .label 必须声明 flex: 1 1 auto 与 min-width: 0",
    );
  });

  it("控件容器通过 :deep(.control) 约束宽度以确保取色器正常生效", () => {
    assert.match(
      desktopVue,
      /:deep\(\.control\)[\s\S]*?width:\s*min\(42vw,\s*168px\);[\s\S]*?flex-shrink:\s*0;/s,
      "DesktopLyricItem 必须使用 :deep(.control) 确保包含 n-color-picker 在内的所有控件生效宽度约束",
    );
  });
});

describe("契约测试：各设置分组组件严禁包含私有卡片布局覆盖（src/components/Setting/groups/*.vue）", () => {
  const groupsDir = path.join(repoRoot, "src/components/Setting/groups");
  const groupFiles = readdirSync(groupsDir).filter((file) => file.endsWith(".vue"));

  it("所有设置分组组件中不得包含针对 .n-card-content 的 flex 布局覆盖", () => {
    for (const file of groupFiles) {
      const content = readSource(path.join("src/components/Setting/groups", file));
      assert.doesNotMatch(
        content,
        /n-card-content/s,
        `${file} 严禁包含针对 .n-card-content 的样式覆盖，布局必须统一由 item.vue 共享层接管`,
      );
    }
  });

  it("确需列式排版的卡片统一使用共享 column 修饰类", () => {
    const themeVue = readSource("src/components/Setting/groups/AppThemeSetting.vue");
    const engineVue = readSource("src/components/Setting/groups/LyricEngineSetting.vue");
    const ttmlVue = readSource("src/components/Setting/groups/LyricTtmlSetting.vue");
    const wordVue = readSource("src/components/Setting/groups/LyricWordSetting.vue");
    const layoutVue = readSource("src/components/Setting/groups/AppLayoutSetting.vue");

    assert.ok(
      themeVue.includes('class="set-item column theme-mode-item"') ||
      themeVue.includes('class="set-item column'),
      "AppThemeSetting 主题模式卡片应声明 column 修饰类",
    );
    assert.ok(
      engineVue.includes('class="set-item column'),
      "LyricEngineSetting 歌词引擎卡片应声明 column 修饰类",
    );
    assert.ok(
      ttmlVue.includes('class="set-item column'),
      "LyricTtmlSetting 本地 TTML 库卡片应声明 column 修饰类",
    );
    assert.ok(
      wordVue.includes('class="set-item column'),
      "LyricWordSetting 来源优先级卡片应声明 column 修饰类",
    );
    assert.ok(
      layoutVue.includes('class="set-item column preview-card"'),
      "AppLayoutSetting 大卡片比例卡片应声明 column 修饰类",
    );
    assert.ok(
      layoutVue.includes('class="set-item column nav-card"'),
      "AppLayoutSetting 菜单栏高度卡片应声明 column 修饰类",
    );
    // 预设模式卡片不使用 column 修饰类
    assert.ok(
      !layoutVue.includes('class="set-item column">\n          <div class="label">\n            <n-text class="name">预设模式'),
      "AppLayoutSetting 预设模式卡片不加 column 修饰类，依靠 flex: 1 1 auto 根治",
    );
  });
});

describe("全局移动端滑杆触摸穿透防御（src/style/main.scss）", () => {
  const mainScss = readSource("src/style/main.scss");

  it("移动端断点内为滑杆及其轨道设置 touch-action: none", () => {
    assert.match(
      mainScss,
      /@media\s*\(max-width:\s*768px\)[\s\S]*?\.n-slider[\s\S]*?touch-action:\s*none;/s,
      "移动端断点内 .n-slider 应包含 touch-action: none",
    );
    assert.match(
      mainScss,
      /@media\s*\(max-width:\s*768px\)[\s\S]*?\.n-slider-rail[\s\S]*?touch-action:\s*none;/s,
      "移动端断点内 .n-slider-rail 应包含 touch-action: none",
    );
  });
});

describe("设置分组控件尺寸规范与豁免清单", () => {
  const themeVue = readSource("src/components/Setting/groups/AppThemeSetting.vue");
  const engineVue = readSource("src/components/Setting/groups/LyricEngineSetting.vue");
  const otherVue = readSource("src/components/Setting/groups/AppOtherSetting.vue");

  it("主题模式按钮保留内容宽度以免文字重叠", () => {
    assert.match(
      themeVue,
      /\.theme-mode-group[\s\S]*?\.n-button[\s\S]*?flex:\s*1\s+1\s+auto;[\s\S]*?min-width:\s*fit-content;/s,
      ".theme-mode-group 中的 .n-button 应可均分宽度但不低于内容宽度（min-width: fit-content）",
    );
  });

  it("自定义颜色行支持折行且选择器宽度自适应", () => {
    assert.match(
      themeVue,
      /\.custom-color-row[\s\S]*?flex-wrap:\s*wrap;/s,
      ".custom-color-row 应支持 flex-wrap: wrap",
    );
    assert.match(
      themeVue,
      /\.custom-color-picker[\s\S]*?min-width:\s*120px;[\s\S]*?max-width:\s*100%;/s,
      ".custom-color-picker 应设置 min-width: 120px 与 max-width: 100%",
    );
    assert.ok(
      !themeVue.includes(".custom-color-picker {\n      width: 100% !important;"),
      "不应在移动端媒体查询中设置 .custom-color-picker 宽度为 100% !important",
    );
  });

  it("主题调节滑杆与歌词引擎单选组保持控件全宽尺寸", () => {
    assert.match(
      themeVue,
      /\.tuning-slider\s*\{[\s\S]*?width:\s*100%;[\s\S]*?\}/s,
      "AppThemeSetting 的 .tuning-slider 应保持 width: 100%",
    );
    assert.match(
      engineVue,
      /\.engine-group\s*\{[\s\S]*?width:\s*100%;[\s\S]*?\}/s,
      "LyricEngineSetting 的 .engine-group 应保持 width: 100%",
    );
  });

  it("缓存上限滑杆保持行内自适应宽度（豁免规范）", () => {
    assert.match(
      otherVue,
      /\.cache-slider[\s\S]*?flex:\s*1;[\s\S]*?min-width:\s*120px;[\s\S]*?width:\s*auto;/s,
      ".cache-slider 应声明 flex: 1; min-width: 120px; width: auto 作为控件自身尺寸规则豁免",
    );
  });
});
