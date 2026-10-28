/**
 * 移动端布局默认值与数据迁移测试
 *
 * 验证新版布局默认值（顶栏高度 50px、卡片 3 列、大卡片比例 80%、布局模式 custom）、
 * 旧默认组合迁移、自定义值与小比例预设保留，以及组件滑杆与 store 源码断言。
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "./helpers/setup";
import { createPinia, setActivePinia } from "pinia";
import {
  CURRENT_SETTING_SCHEMA_VERSION,
  settingMigrations,
} from "../src/stores/migrations/settingMigrations";
import { useSettingStore } from "../src/stores/setting";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * 读取仓库源文件文本
 * @param relativePath 相对仓库根目录路径
 * @returns 源文件文本
 */
const readSource = (relativePath: string): string =>
  readFileSync(path.join(repoRoot, relativePath), "utf8");

describe("布局默认值与数据迁移", () => {
  it("Schema 版本号为 13 且已注册对应的迁移函数", () => {
    assert.equal(CURRENT_SETTING_SCHEMA_VERSION, 13);
    assert.equal(typeof settingMigrations[13], "function");
  });

  describe("迁移纯函数行为（settingMigrations[13]）", () => {
    const migrate = (state: Parameters<NonNullable<typeof settingMigrations[13]>>[0]) =>
      settingMigrations[13]!(state);

    it("旧默认组合迁移：(70, 2, 100, 'large') 迁移为 (50, 3, 80, 'custom')", () => {
      const updates = migrate({
        schemaVersion: 12,
        navHeight: 70,
        mobileCardColumns: 2,
        homeCardScale: 100,
        layoutMode: "large",
      });
      assert.deepEqual(updates, {
        navHeight: 50,
        mobileCardColumns: 3,
        homeCardScale: 80,
        layoutMode: "custom",
      });
    });

    it("自定义值保留：(65, 3, 120, 'custom') 保持原样不产生更新", () => {
      const updates = migrate({
        schemaVersion: 12,
        navHeight: 65,
        mobileCardColumns: 3,
        homeCardScale: 120,
        layoutMode: "custom",
      });
      assert.deepEqual(updates, {});
    });

    it("小比例预设用户不受影响：(50, 3, 60, 'small') 保持原样不产生更新", () => {
      const updates = migrate({
        schemaVersion: 12,
        navHeight: 50,
        mobileCardColumns: 3,
        homeCardScale: 60,
        layoutMode: "small",
      });
      assert.deepEqual(updates, {});
    });

    it("全新安装默认值补齐：未设置版本号时直接产出新默认布局", () => {
      const updates = migrate({});
      assert.deepEqual(updates, {
        navHeight: 50,
        mobileCardColumns: 3,
        homeCardScale: 80,
        layoutMode: "custom",
      });
    });
  });

  describe("store 端到端 checkAndMigrate 行为", () => {
    beforeEach(() => {
      setActivePinia(createPinia());
    });

    it("全新安装默认值：navHeight 50、mobileCardColumns 3、homeCardScale 80、layoutMode 'custom'", () => {
      const store = useSettingStore();
      store.checkAndMigrate();
      assert.equal(store.schemaVersion, 13);
      assert.equal(store.navHeight, 50);
      assert.equal(store.mobileCardColumns, 3);
      assert.equal(store.homeCardScale, 80);
      assert.equal(store.layoutMode, "custom");
    });

    it("旧默认组合端到端迁移：输入 schemaVersion 12 迁移后全部更新为新默认值", () => {
      const store = useSettingStore();
      store.$patch({
        schemaVersion: 12,
        navHeight: 70,
        mobileCardColumns: 2,
        homeCardScale: 100,
        layoutMode: "large",
      });
      store.checkAndMigrate();
      assert.equal(store.schemaVersion, 13);
      assert.equal(store.navHeight, 50);
      assert.equal(store.mobileCardColumns, 3);
      assert.equal(store.homeCardScale, 80);
      assert.equal(store.layoutMode, "custom");
    });

    it("自定义值端到端保留：输入 (65, 3, 120, 'custom') 迁移后数值与模式均不变", () => {
      const store = useSettingStore();
      store.$patch({
        schemaVersion: 12,
        navHeight: 65,
        mobileCardColumns: 3,
        homeCardScale: 120,
        layoutMode: "custom",
      });
      store.checkAndMigrate();
      assert.equal(store.schemaVersion, 13);
      assert.equal(store.navHeight, 65);
      assert.equal(store.mobileCardColumns, 3);
      assert.equal(store.homeCardScale, 120);
      assert.equal(store.layoutMode, "custom");
    });

    it("小比例预设端到端保留：输入 (50, 3, 60, 'small') 迁移后数值与小比例模式不变", () => {
      const store = useSettingStore();
      store.$patch({
        schemaVersion: 12,
        navHeight: 50,
        mobileCardColumns: 3,
        homeCardScale: 60,
        layoutMode: "small",
      });
      store.checkAndMigrate();
      assert.equal(store.schemaVersion, 13);
      assert.equal(store.navHeight, 50);
      assert.equal(store.mobileCardColumns, 3);
      assert.equal(store.homeCardScale, 60);
      assert.equal(store.layoutMode, "small");
    });
  });

  describe("源码静态断言", () => {
    it("AppLayoutSetting.vue 中菜单栏高度滑杆 :min 为 '30'", () => {
      const vueContent = readSource("src/components/Setting/groups/AppLayoutSetting.vue");
      assert.match(
        vueContent,
        /:value="settingStore\.navHeight"[\s\S]*?:min="30"[\s\S]*?:max="70"/,
        "菜单栏高度滑杆应配置 :min=\"30\" 与 :max=\"70\"",
      );
    });

    it("setting.ts 默认值与新规范一致", () => {
      const storeContent = readSource("src/stores/setting.ts");
      assert.match(
        storeContent,
        /mobileCardColumns:\s*3,[\s\S]*?navHeight:\s*50,[\s\S]*?layoutMode:\s*"custom",[\s\S]*?homeCardScale:\s*80,/,
        "setting.ts 的初始状态默认值应为 3 列、50px 高度、custom 模式与 80% 比例",
      );
    });
  });
});
