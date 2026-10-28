/**
 * 主题背景调节与取色着色逻辑测试（themeSetting + 样式门控）
 *
 * 覆盖取色来源的整体着色判定、背景模糊度与卡片透明度的数值映射，
 * 以及壁纸渲染门控、毛玻璃门控与顶栏透明度跟随的源码约束。
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  isTintSurfacesRoute,
  resolveBackgroundBlurPx,
  resolveCardBgAlpha,
} from "../src/utils/themeSetting";
import type { ThemeColorRoute } from "../src/utils/color";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * 读取仓库内源文件内容
 * @param relativePath 相对仓库根的路径
 * @returns 文件文本内容
 */
const readSource = (relativePath: string): string =>
  readFileSync(path.join(repoRoot, relativePath), "utf8");

/** 构造取色来源分流结果的最小样例 */
const buildRoute = (kind: ThemeColorRoute["kind"]): ThemeColorRoute => {
  const theme = {
    main: { r: 1, g: 2, b: 3 },
    light: {
      primary: { r: 1, g: 2, b: 3 },
      background: { r: 4, g: 5, b: 6 },
      "surface-container": { r: 7, g: 8, b: 9 },
    },
    dark: {
      primary: { r: 1, g: 2, b: 3 },
      background: { r: 4, g: 5, b: 6 },
      "surface-container": { r: 7, g: 8, b: 9 },
    },
  };
  if (kind === "preset") return { kind: "preset", presetColor: "#ff0000" };
  return { kind, theme };
};

describe("取色来源的整体着色判定 isTintSurfacesRoute", () => {
  it("背景取色与封面取色触发整体着色", () => {
    assert.equal(isTintSurfacesRoute(buildRoute("background")), true);
    assert.equal(isTintSurfacesRoute(buildRoute("cover")), true);
  });

  it("预设色不触发整体着色", () => {
    assert.equal(isTintSurfacesRoute(buildRoute("preset")), false);
  });

  it("无分流结果时不触发整体着色", () => {
    assert.equal(isTintSurfacesRoute(null), false);
  });
});

describe("背景模糊度映射 resolveBackgroundBlurPx", () => {
  it("0-100 映射到 0-30 像素", () => {
    assert.equal(resolveBackgroundBlurPx(0, true), 0);
    assert.equal(resolveBackgroundBlurPx(50, true), 15);
    assert.equal(resolveBackgroundBlurPx(100, true), 30);
  });

  it("未设置背景图时恒为 0", () => {
    assert.equal(resolveBackgroundBlurPx(80, false), 0);
  });

  it("越界与非法输入收敛到边界", () => {
    assert.equal(resolveBackgroundBlurPx(120, true), 30);
    assert.equal(resolveBackgroundBlurPx(-10, true), 0);
    assert.equal(resolveBackgroundBlurPx(Number.NaN, true), 0);
  });
});

describe("卡片透明度映射 resolveCardBgAlpha", () => {
  it("0-100 映射到 0-1", () => {
    assert.equal(resolveCardBgAlpha(0, true), 0);
    assert.equal(resolveCardBgAlpha(85, true), 0.85);
    assert.equal(resolveCardBgAlpha(100, true), 1);
  });

  it("未设置背景图时恒为 1（不透明）", () => {
    assert.equal(resolveCardBgAlpha(40, false), 1);
  });

  it("越界与非法输入收敛到边界", () => {
    assert.equal(resolveCardBgAlpha(120, true), 1);
    assert.equal(resolveCardBgAlpha(-10, true), 0);
    assert.equal(resolveCardBgAlpha(Number.NaN, true), 0);
  });
});

describe("壁纸渲染与毛玻璃门控的源码约束", () => {
  it("背景图渲染由背景存在性驱动，不依赖历史全局着色开关", () => {
    const mainScss = readSource("src/style/main.scss");
    assert.ok(
      mainScss.includes("body.has-global-bg #app {"),
      "背景图渲染规则应挂在 body.has-global-bg 上",
    );
    assert.ok(
      !mainScss.includes("body.global-color-enabled #app"),
      "背景图渲染规则不应再挂在历史全局着色开关上",
    );
  });

  it("毛玻璃效果同时要求已设置背景图与开启开关", () => {
    const mainScss = readSource("src/style/main.scss");
    assert.ok(
      mainScss.includes("body.has-global-bg.blur-effects-enabled"),
      "毛玻璃规则应同时要求背景存在与开关开启",
    );
  });

  it("布局层不再读取历史全局着色开关", () => {
    const appLayout = readSource("src/layout/AppLayout.vue");
    assert.ok(
      !appLayout.includes("themeGlobalColor"),
      "布局层不应再读取 themeGlobalColor",
    );
  });

  it("顶栏透明度跟随卡片透明度变量", () => {
    const nav = readSource("src/components/Layout/Nav.vue");
    assert.ok(
      nav.includes("var(--card-bg-alpha"),
      "顶栏底色应消费与卡片一致的透明度变量",
    );
  });

  it("主题提供者按取色来源决定是否整体着色", () => {
    const provider = readSource("src/components/Global/Provider.vue");
    assert.ok(
      provider.includes("isTintSurfacesRoute(route)"),
      "整体着色判定应来自取色来源分流结果",
    );
    assert.ok(
      !provider.includes("settingStore.themeGlobalColor"),
      "主题提供者不应再以 themeGlobalColor 作为着色开关",
    );
  });
});
