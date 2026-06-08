import { WebPlugin } from "@capacitor/core";
import type {
  DesktopLyricPermissionResult,
  DesktopLyricPlugin,
  DesktopLyricResult,
} from "./DesktopLyricPlugin";

const SUCCESS: DesktopLyricResult = { success: true };

/**
 * Web 平台空实现，桌面歌词仅在 Android 原生层显示浮窗。
 */
export class DesktopLyricWeb extends WebPlugin implements DesktopLyricPlugin {
  async checkPermission(): Promise<DesktopLyricPermissionResult> {
    return { granted: false };
  }

  async requestPermission(): Promise<DesktopLyricPermissionResult> {
    return { granted: false };
  }

  async show(): Promise<DesktopLyricResult> {
    return SUCCESS;
  }

  async hide(): Promise<DesktopLyricResult> {
    return SUCCESS;
  }

  async updateLyric(): Promise<DesktopLyricResult> {
    return SUCCESS;
  }

  async updateConfig(): Promise<DesktopLyricResult> {
    return SUCCESS;
  }

  async setLocked(): Promise<DesktopLyricResult> {
    return SUCCESS;
  }
}
