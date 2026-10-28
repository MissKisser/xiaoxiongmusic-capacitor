import { keywords, regexes } from "@/assets/data/exclude";
import { SongUnlockServer } from "@/types/shared";
import { defaultAMLLDbServer } from "@/utils/meta";
import type { SettingState } from "../setting";

/**
 * 当前设置 Schema 版本号
 */
export const CURRENT_SETTING_SCHEMA_VERSION = 13;

/**
 * 迁移函数类型
 * 迁移函数只需返回需要更新的字段，系统会自动合并到原有状态
 */
export type MigrationFunction = (state: Partial<SettingState>) => Partial<SettingState>;

/**
 * 迁移脚本映射表
 * key: 目标版本号
 * value: 从上一版本迁移到该版本的函数
 */
export const settingMigrations: Record<number, MigrationFunction> = {
  3: () => {
    return {
      // ttml 同步
      enableTTMLLyric: false,
      amllDbServer: defaultAMLLDbServer,
    };
  },
  4: () => {
    return {
      songUnlockServer: [
        { key: SongUnlockServer.BODIAN, enabled: true },
        { key: SongUnlockServer.GEQUBAO, enabled: true },
        { key: SongUnlockServer.NETEASE, enabled: true },
        { key: SongUnlockServer.KUWO, enabled: true },
      ],
    };
  },
  5: (state) => {
    // 迁移排除歌词关键字和正则表达式到用户自定义字段
    // 如果旧字段存在且不为空，则迁移到新字段
    // 定义旧版本的设置状态类型（包含已废弃的字段）
    interface OldSettingState extends Partial<SettingState> {
      excludeKeywords?: string[];
      excludeRegexes?: string[];
    }

    const oldState = state as OldSettingState;
    const oldKeywords = oldState.excludeKeywords;
    const oldRegexes = oldState.excludeRegexes;

    // 如果旧字段包含默认值，则只保留用户自定义的部分
    const userKeywords: string[] = [];
    const userRegexes: string[] = [];

    if (oldKeywords && Array.isArray(oldKeywords)) {
      // 过滤掉默认关键字，只保留用户自定义的
      oldKeywords.forEach((keyword) => {
        if (!keywords.includes(keyword)) {
          userKeywords.push(keyword);
        }
      });
    }

    if (oldRegexes && Array.isArray(oldRegexes)) {
      // 过滤掉默认正则，只保留用户自定义的
      oldRegexes.forEach((regex) => {
        if (!regexes.includes(regex)) {
          userRegexes.push(regex);
        }
      });
    }

    return {
      excludeUserKeywords: userKeywords,
      excludeUserRegexes: userRegexes,
    };
  },
  6: (state) => {
    interface OldSettingState extends Partial<SettingState> {
      enableTTMLLyric?: boolean;

      hideDiscover?: boolean;
      hidePersonalFM?: boolean;
      hideRadioHot?: boolean;
      hideLike?: boolean;
      hideCloud?: boolean;
      hideDownload?: boolean;
      hideLocal?: boolean;
      hideHistory?: boolean;
      hideUserPlaylists?: boolean;
      hideLikedPlaylists?: boolean;
      hideHeartbeatMode?: boolean;
    }
    const oldState = state as OldSettingState;

    return {
      enableOnlineTTMLLyric: oldState.enableTTMLLyric,

      sidebarHide: {
        hideDiscover: oldState.hideDiscover || false,
        hidePersonalFM: oldState.hidePersonalFM || false,
        hideRadioHot: oldState.hideRadioHot || false,
        hideLike: oldState.hideLike || false,
        hideCloud: oldState.hideCloud || false,
        hideDownload: oldState.hideDownload || false,
        hideLocal: oldState.hideLocal || false,
        hideHistory: oldState.hideHistory || false,
        hideUserPlaylists: oldState.hideUserPlaylists || false,
        hideLikedPlaylists: oldState.hideLikedPlaylists || false,
        hideHeartbeatMode: oldState.hideHeartbeatMode || false,
      },
    };
  },
  7: (state) => {
    interface OldSettingState extends Omit<Partial<SettingState>, "discordRpc"> {
      discordRpc?: {
        enabled: boolean;
        showWhenPaused: boolean;
        displayMode: string;
      };
    }

    const oldState = state as OldSettingState;
    const oldRpc = oldState.discordRpc;

    if (!oldRpc || !oldRpc.displayMode) {
      return {};
    }

    const modeMap: Record<string, "Name" | "State" | "Details"> = {
      name: "Name",
      state: "State",
      details: "Details",
    };

    const currentMode = oldRpc.displayMode;

    if (Object.prototype.hasOwnProperty.call(modeMap, currentMode)) {
      return {
        discordRpc: {
          enabled: oldRpc.enabled,
          showWhenPaused: oldRpc.showWhenPaused,
          displayMode: modeMap[currentMode],
        },
      };
    }

    return {};
  },
  8: () => {
    // 此版本无需迁移
    return {};
  },
  9: () => {
    // 新增手机端卡片列数设置，默认 2 列
    return {
      mobileCardColumns: 2,
    };
  },
  10: () => {
    // 新增顶栏高度设置，默认 70px
    return {
      navHeight: 70,
    };
  },
  11: (state) => {
    // 新增布局模式：若用户手动调整过顶栏高度或卡片列数则视为自定义，否则默认大比例
    const custom =
      (state.navHeight !== undefined && state.navHeight !== 70) ||
      (state.mobileCardColumns !== undefined && state.mobileCardColumns !== 2);
    return {
      layoutMode: custom ? "custom" : "large",
      homeCardScale: 100,
      listRowHeight: 90,
    };
  },
  12: (state) => {
    // 主题色来源重构：
    // - themeFollowCover 的语义并入 themeColorSource：开启过跟随封面则映射为 cover，否则为 preset
    // - themeGlobalColor 仅为兼容旧数据保留，不再参与主题着色与背景图渲染判定
    // - 补齐背景模糊度、卡片透明度与背景图持久化标志的默认值
    // - 无历史版本号（schemaVersion=0）视为全新安装，直接落默认值 cover
    const oldState = state as Partial<SettingState> & { themeFollowCover?: boolean };
    const isLegacyInstall = (state.schemaVersion ?? 0) > 0;
    return {
      themeColorSource: isLegacyInstall
        ? oldState.themeFollowCover
          ? "cover"
          : "preset"
        : "cover",
      backgroundBlur: 0,
      cardTransparency: 85,
      globalBackgroundSaved: false,
    };
  },
  13: (state) => {
    // 布局默认值换代：把旧默认值整体迁到新默认，自定义值不受影响
    // - 旧默认值（顶栏高度 70px、卡片 2 列、大卡片比例 100%、布局模式 large）迁至新默认（50px、3 列、80%、custom）
    // - 用户自定义值与小比例预设保持不变
    // - 无历史版本号视为全新安装，直接落新默认值
    const isLegacyInstall = (state.schemaVersion ?? 0) > 0;
    if (!isLegacyInstall) {
      return {
        navHeight: 50,
        mobileCardColumns: 3,
        homeCardScale: 80,
        layoutMode: "custom",
      };
    }

    const updates: Partial<SettingState> = {};
    if (state.navHeight === 70) {
      updates.navHeight = 50;
    }
    if (state.mobileCardColumns === 2) {
      updates.mobileCardColumns = 3;
    }
    if (state.homeCardScale === 100) {
      updates.homeCardScale = 80;
    }
    if (state.layoutMode === "large") {
      updates.layoutMode = "custom";
    }
    return updates;
  },
};
