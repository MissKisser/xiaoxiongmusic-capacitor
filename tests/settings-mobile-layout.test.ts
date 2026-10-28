/**
 * 移动端设置页布局与交互防御回归测试
 *
 * 覆盖移动端设置项横向溢出防御、标签自适应换行、滑块触摸穿透防御，
 * 以及主题模式、歌词引擎、本地 TTML 库与缓存设置项的列式布局与宽度自适应约束。
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

  it("设置项标签支持换行、弹性收缩与长文案自动折行", () => {
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

  it("设置项内单选按钮组在窄屏下支持自适应折行", () => {
    assert.match(
      itemVue,
      /\.set-item[\s\S]*?\.n-radio-group[\s\S]*?display:\s*flex;[\s\S]*?flex-wrap:\s*wrap;[\s\S]*?gap:\s*8px;/s,
      ".set-item 内的 .n-radio-group 应限定在卡片内并支持 flex wrap 与 gap",
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

describe("主题设置页列式结构与自适应（src/components/Setting/groups/AppThemeSetting.vue）", () => {
  const themeVue = readSource("src/components/Setting/groups/AppThemeSetting.vue");

  it("主题模式卡片使用 theme-mode-item 修饰类并呈现列式排版", () => {
    assert.ok(
      themeVue.includes('class="set-item theme-mode-item"') ||
      themeVue.includes("theme-mode-item"),
      "主题模式卡片模板应包含 theme-mode-item 修饰类",
    );
    assert.match(
      themeVue,
      /\.theme-mode-item[\s\S]*?:deep\(\.n-card-content\)[\s\S]*?flex-direction:\s*column;/s,
      ".theme-mode-item 应将 .n-card-content 设为 flex-direction: column",
    );
    assert.match(
      themeVue,
      /\.theme-mode-item[\s\S]*?:deep\(\.n-card-content\)[\s\S]*?align-items:\s*stretch;/s,
      ".theme-mode-item 应将 .n-card-content 设为 align-items: stretch",
    );
  });

  it("主题模式按钮取消固定最小宽度以实现三等分", () => {
    assert.match(
      themeVue,
      /\.theme-mode-group[\s\S]*?\.n-button[\s\S]*?min-width:\s*0;/s,
      ".theme-mode-group 中的 .n-button 应使用 min-width: 0",
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

  it("滑块卡片内容使用拉伸对齐", () => {
    assert.match(
      themeVue,
      /\.slider-item[\s\S]*?:deep\(\.n-card-content\)[\s\S]*?align-items:\s*stretch;/s,
      ".slider-item 的 align-items 应为 stretch",
    );
  });
});

describe("其余设置分组列式与宽度补齐", () => {
  it("歌词渲染引擎卡片采用列式结构与全宽单选组", () => {
    const engineVue = readSource("src/components/Setting/groups/LyricEngineSetting.vue");
    assert.match(
      engineVue,
      /:deep\(\.n-card-content\)[\s\S]*?flex-direction:\s*column;/s,
      "歌词渲染引擎卡片应采用 flex-direction: column 列式结构",
    );
  });

  it("本地 TTML 歌词库卡片声明列式结构", () => {
    const ttmlVue = readSource("src/components/Setting/groups/LyricTtmlSetting.vue");
    assert.match(
      ttmlVue,
      /#lyrics-local-ttml[\s\S]*?:deep\(\.n-card-content\)[\s\S]*?flex-direction:\s*column;[\s\S]*?align-items:\s*stretch;[\s\S]*?gap:\s*12px;/s,
      "#lyrics-local-ttml 应声明列式结构与间距",
    );
  });

  it("缓存上限滑杆改为行内自适应宽度", () => {
    const otherVue = readSource("src/components/Setting/groups/AppOtherSetting.vue");
    assert.match(
      otherVue,
      /\.cache-slider[\s\S]*?flex:\s*1;[\s\S]*?min-width:\s*120px;[\s\S]*?width:\s*auto;/s,
      ".cache-slider 应声明 flex: 1; min-width: 120px; width: auto",
    );
  });
});
