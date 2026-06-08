import { registerPlugin } from "@capacitor/core";
import type { LyricConfig } from "@/types/desktop-lyric";
import type { AndroidDesktopLyricPayload } from "@/utils/androidDesktopLyric";

export interface DesktopLyricPermissionResult {
  granted: boolean;
}

export interface DesktopLyricResult {
  success: boolean;
}

export type DesktopLyricControlAction = "previous" | "playPause" | "next";

export interface DesktopLyricPlugin {
  checkPermission(): Promise<DesktopLyricPermissionResult>;
  requestPermission(): Promise<DesktopLyricPermissionResult>;
  show(): Promise<DesktopLyricResult>;
  hide(): Promise<DesktopLyricResult>;
  updateLyric(payload: AndroidDesktopLyricPayload): Promise<DesktopLyricResult>;
  updateConfig(config: LyricConfig): Promise<DesktopLyricResult>;
  setLocked(options: { locked: boolean }): Promise<DesktopLyricResult>;
  addListener(
    eventName: "close",
    listenerFunc: (data: { action: "close" }) => void,
  ): Promise<{ remove: () => void }>;
  addListener(
    eventName: "configChange",
    listenerFunc: (config: Partial<LyricConfig>) => void,
  ): Promise<{ remove: () => void }>;
  addListener(
    eventName: "control",
    listenerFunc: (data: { action: DesktopLyricControlAction }) => void,
  ): Promise<{ remove: () => void }>;
}

const DesktopLyric = registerPlugin<DesktopLyricPlugin>("DesktopLyric", {
  web: () => import("./DesktopLyricWeb").then((module) => new module.DesktopLyricWeb()),
});

export { DesktopLyric };
