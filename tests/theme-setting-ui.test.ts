/**
 * 主题设置 UI 绑定逻辑测试（themeSetting）
 *
 * 验证主题色来源选项归一、来源与背景调节项的禁用判定、百分比收敛。
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  THEME_COLOR_SOURCE_OPTIONS,
  clampPercent,
  isBackgroundTuningDisabled,
  isThemeColorSourceDisabled,
  normalizeThemeColorSource,
} from "../src/utils/themeSetting";

describe("主题色来源选项归一 normalizeThemeColorSource", () => {
  it("合法来源值原样通过", () => {
    assert.equal(normalizeThemeColorSource("preset"), "preset");
    assert.equal(normalizeThemeColorSource("background"), "background");
    assert.equal(normalizeThemeColorSource("cover"), "cover");
  });

  it("非法值回退为 cover", () => {
    assert.equal(normalizeThemeColorSource("custom"), "cover");
    assert.equal(normalizeThemeColorSource(""), "cover");
    assert.equal(normalizeThemeColorSource(null), "cover");
    assert.equal(normalizeThemeColorSource(undefined), "cover");
    assert.equal(normalizeThemeColorSource(123), "cover");
  });

  it("选项列表恰好包含三个合法来源且顺序固定", () => {
    assert.deepEqual(
      THEME_COLOR_SOURCE_OPTIONS.map((option) => option.value),
      ["preset", "background", "cover"],
    );
  });
});

describe("主题色来源禁用判定 isThemeColorSourceDisabled", () => {
  it("背景取色在未设置背景图时禁用", () => {
    assert.equal(isThemeColorSourceDisabled("background", { hasBackgroundImage: false }), true);
  });

  it("背景取色在已设置背景图时可用", () => {
    assert.equal(isThemeColorSourceDisabled("background", { hasBackgroundImage: true }), false);
  });

  it("预设色与封面取色恒可用", () => {
    assert.equal(isThemeColorSourceDisabled("preset", { hasBackgroundImage: false }), false);
    assert.equal(isThemeColorSourceDisabled("preset", { hasBackgroundImage: true }), false);
    assert.equal(isThemeColorSourceDisabled("cover", { hasBackgroundImage: false }), false);
    assert.equal(isThemeColorSourceDisabled("cover", { hasBackgroundImage: true }), false);
  });
});

describe("背景调节项禁用判定 isBackgroundTuningDisabled", () => {
  it("未设置背景图时禁用模糊度、卡片透明度与毛玻璃", () => {
    assert.equal(isBackgroundTuningDisabled(false), true);
  });

  it("已设置背景图时可用", () => {
    assert.equal(isBackgroundTuningDisabled(true), false);
  });
});

describe("滑杆百分比收敛 clampPercent", () => {
  it("区间内数值四舍五入", () => {
    assert.equal(clampPercent(50), 50);
    assert.equal(clampPercent(49.6), 50);
    assert.equal(clampPercent(0.4), 0);
  });

  it("越界数值收敛到边界", () => {
    assert.equal(clampPercent(-10), 0);
    assert.equal(clampPercent(120), 100);
  });

  it("非法输入按 0 处理", () => {
    assert.equal(clampPercent(Number.NaN), 0);
    assert.equal(clampPercent(Number.POSITIVE_INFINITY), 0);
  });
});
