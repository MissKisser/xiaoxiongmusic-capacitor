/**
 * 主题色来源迁移测试（settingMigrations v12）
 *
 * 验证旧字段组合（themeGlobalColor / themeFollowCover）到 themeColorSource 的映射，
 * 以及背景旋钮与背景图持久化标志默认值的补齐。
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import "./helpers/setup";
import { createPinia, setActivePinia } from "pinia";
import {
  CURRENT_SETTING_SCHEMA_VERSION,
  settingMigrations,
} from "../src/stores/migrations/settingMigrations";
import { useSettingStore } from "../src/stores/setting";

describe("主题色来源迁移 settingMigrations v12", () => {
  it("当前 Schema 版本号为 12 且注册了 v12 迁移", () => {
    assert.equal(CURRENT_SETTING_SCHEMA_VERSION, 12);
    assert.equal(typeof settingMigrations[12], "function");
  });

  describe("旧组合到 themeColorSource 的映射", () => {
    const migrate = (state: Parameters<NonNullable<typeof settingMigrations[12]>>[0]) =>
      settingMigrations[12]!(state);

    it("旧用户 themeFollowCover=true 且 themeGlobalColor=true → cover", () => {
      const updates = migrate({ schemaVersion: 11, themeFollowCover: true, themeGlobalColor: true });
      assert.equal(updates.themeColorSource, "cover");
    });

    it("旧用户 themeFollowCover=true 且 themeGlobalColor=false → cover", () => {
      const updates = migrate({ schemaVersion: 11, themeFollowCover: true, themeGlobalColor: false });
      assert.equal(updates.themeColorSource, "cover");
    });

    it("旧用户 themeFollowCover=false 且 themeGlobalColor=true → preset", () => {
      const updates = migrate({ schemaVersion: 11, themeFollowCover: false, themeGlobalColor: true });
      assert.equal(updates.themeColorSource, "preset");
    });

    it("旧用户 themeFollowCover=false 且 themeGlobalColor=false → preset", () => {
      const updates = migrate({ schemaVersion: 11, themeFollowCover: false, themeGlobalColor: false });
      assert.equal(updates.themeColorSource, "preset");
    });

    it("旧用户旧字段缺失时回退 preset", () => {
      const updates = migrate({ schemaVersion: 11 });
      assert.equal(updates.themeColorSource, "preset");
    });

    it("无历史版本号视为全新安装，直接落默认 cover", () => {
      const updates = migrate({});
      assert.equal(updates.themeColorSource, "cover");
    });
  });

  describe("新增字段默认值补齐", () => {
    it("迁移补齐背景模糊度、卡片透明度与背景图持久化标志默认值", () => {
      const updates = settingMigrations[12]!({});
      assert.equal(updates.backgroundBlur, 0);
      assert.equal(updates.cardTransparency, 85);
      assert.equal(updates.globalBackgroundSaved, false);
    });
  });

  describe("store 级 checkAndMigrate 端到端", () => {
    beforeEach(() => {
      setActivePinia(createPinia());
    });

    it("schemaVersion=11 + themeFollowCover=true 迁移后来源为 cover 且旧字段保留", () => {
      const settingStore = useSettingStore();
      settingStore.$patch({
        schemaVersion: 11,
        themeFollowCover: true,
        themeGlobalColor: true,
      });
      settingStore.checkAndMigrate();
      assert.equal(settingStore.schemaVersion, 12);
      assert.equal(settingStore.themeColorSource, "cover");
      assert.equal(settingStore.backgroundBlur, 0);
      assert.equal(settingStore.cardTransparency, 85);
      assert.equal(settingStore.globalBackgroundSaved, false);
      // 旧字段保留，兼容未迁移的消费方
      assert.equal(settingStore.themeFollowCover, true);
      assert.equal(settingStore.themeGlobalColor, true);
    });

    it("schemaVersion=11 + 未开启跟随封面迁移后来源为 preset", () => {
      const settingStore = useSettingStore();
      settingStore.$patch({
        schemaVersion: 11,
        themeFollowCover: false,
        themeGlobalColor: true,
      });
      settingStore.checkAndMigrate();
      assert.equal(settingStore.schemaVersion, 12);
      assert.equal(settingStore.themeColorSource, "preset");
    });

    it("全新安装（无历史版本）默认来源为 cover 且跳过迁移", () => {
      const settingStore = useSettingStore();
      settingStore.checkAndMigrate();
      assert.equal(settingStore.schemaVersion, 12);
      assert.equal(settingStore.themeColorSource, "cover");
    });
  });
});
