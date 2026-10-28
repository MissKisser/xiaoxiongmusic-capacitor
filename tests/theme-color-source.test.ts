/**
 * 主题色来源分流测试（resolveThemeColorRoute）
 *
 * 验证 preset / background / cover 三路选择逻辑、不可用时的回退行为，
 * 以及取色数据缺少明暗配色时按预设色回退。
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import "./helpers/setup";
import { resolveThemeColorRoute } from "../src/utils/color";
import type { CoverColors } from "@/types/main";

/** 构造与真实取色结果同构的主题数据 */
const buildTheme = (seed: number): CoverColors => ({
  main: { r: seed, g: seed + 1, b: seed + 2 },
  light: {
    primary: { r: seed, g: seed + 1, b: seed + 2 },
    background: { r: 240, g: 240, b: 240 },
    "surface-container": { r: 255, g: 255, b: 255 },
  },
  dark: {
    primary: { r: seed, g: seed + 1, b: seed + 2 },
    background: { r: 16, g: 16, b: 20 },
    "surface-container": { r: 24, g: 24, b: 28 },
  },
});

const coverTheme = buildTheme(1);
const backgroundTheme = buildTheme(4);

describe("主题色来源分流 resolveThemeColorRoute", () => {
  describe("cover 路径", () => {
    it("有封面主题时选择 cover", () => {
      const route = resolveThemeColorRoute("cover", {
        presetColor: "#fe7971",
        backgroundTheme,
        coverTheme,
      });
      assert.deepEqual(route, { kind: "cover", theme: coverTheme });
    });

    it("无封面主题时回退 preset", () => {
      const route = resolveThemeColorRoute("cover", {
        presetColor: "#fe7971",
        backgroundTheme,
        coverTheme: null,
      });
      assert.deepEqual(route, { kind: "preset", presetColor: "#fe7971" });
    });

    it("封面主题为空数据时回退 preset", () => {
      const route = resolveThemeColorRoute("cover", {
        presetColor: "#fe7971",
        backgroundTheme,
        coverTheme: {} as CoverColors,
      });
      assert.deepEqual(route, { kind: "preset", presetColor: "#fe7971" });
    });

    it("封面主题缺少明暗配色时回退 preset", () => {
      const route = resolveThemeColorRoute("cover", {
        presetColor: "#fe7971",
        backgroundTheme,
        coverTheme: { main: { r: 1, g: 2, b: 3 } } as CoverColors,
      });
      assert.deepEqual(route, { kind: "preset", presetColor: "#fe7971" });
    });
  });

  describe("background 路径", () => {
    it("有背景图主题时选择 background", () => {
      const route = resolveThemeColorRoute("background", {
        presetColor: "#fe7971",
        backgroundTheme,
        coverTheme,
      });
      assert.deepEqual(route, { kind: "background", theme: backgroundTheme });
    });

    it("背景图主题未就绪时回退 preset", () => {
      const route = resolveThemeColorRoute("background", {
        presetColor: "#fe7971",
        backgroundTheme: null,
        coverTheme,
      });
      assert.deepEqual(route, { kind: "preset", presetColor: "#fe7971" });
    });

    it("背景图主题缺少明暗配色时回退 preset", () => {
      const route = resolveThemeColorRoute("background", {
        presetColor: "#fe7971",
        backgroundTheme: { main: { r: 4, g: 5, b: 6 } } as CoverColors,
        coverTheme,
      });
      assert.deepEqual(route, { kind: "preset", presetColor: "#fe7971" });
    });
  });

  describe("preset 路径", () => {
    it("preset 来源始终使用预设颜色", () => {
      const route = resolveThemeColorRoute("preset", {
        presetColor: "#123456",
        backgroundTheme,
        coverTheme,
      });
      assert.deepEqual(route, { kind: "preset", presetColor: "#123456" });
    });

    it("presetColor 缺省时返回 null（由调用方保持现状）", () => {
      const route = resolveThemeColorRoute("preset", {
        presetColor: null,
        backgroundTheme,
        coverTheme,
      });
      assert.equal(route, null);
    });
  });

  describe("回退链", () => {
    it("选定来源不可用且 presetColor 为空字符串时返回 null", () => {
      const route = resolveThemeColorRoute("background", {
        presetColor: "",
        backgroundTheme: null,
        coverTheme: null,
      });
      assert.equal(route, null);
    });
  });
});
