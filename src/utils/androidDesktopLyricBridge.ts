import { App } from "@capacitor/app";
import { cloneDeep, throttle } from "lodash-es";
import { toRaw, watch, type WatchStopHandle } from "vue";
import { DesktopLyric } from "@/plugins/DesktopLyricPlugin";
import { useMusicStore } from "@/stores/music";
import { useSettingStore } from "@/stores/setting";
import { useStatusStore } from "@/stores/status";
import type { LyricData } from "@/types/desktop-lyric";
import { isCapacitor } from "@/utils/env";
import { getPlayerInfoObj } from "@/utils/format";
import { buildAndroidDesktopLyricPayload } from "./androidDesktopLyric";

let initialized = false;
let pendingShowAfterPermission = false;
let appStateListener: { remove: () => Promise<void> | void } | null = null;
let closeListener: { remove: () => Promise<void> | void } | null = null;
let configChangeListener: { remove: () => Promise<void> | void } | null = null;
let controlListener: { remove: () => Promise<void> | void } | null = null;
const stopHandles: WatchStopHandle[] = [];

const getLyricData = (): LyricData => {
  const musicStore = useMusicStore();
  const statusStore = useStatusStore();
  const info = getPlayerInfoObj();
  const songId = Number(musicStore.playSong?.id || 0);

  return {
    playName: info?.name ?? "",
    artistName: info?.artist ?? "",
    playStatus: statusStore.playStatus,
    currentTime: statusStore.currentTime,
    lyricLoading: statusStore.lyricLoading,
    songId,
    songOffset: statusStore.getSongOffset(songId),
    lrcData: toRaw(musicStore.songLyric.lrcData ?? []),
    yrcData: toRaw(musicStore.songLyric.yrcData ?? []),
    lyricIndex: statusStore.lyricIndex,
  };
};

const pushConfig = async () => {
  if (!isCapacitor) return;
  const settingStore = useSettingStore();
  await DesktopLyric.updateConfig(cloneDeep(settingStore.desktopLyricConfig));
};

const pushLyric = async () => {
  if (!isCapacitor) return;
  const settingStore = useSettingStore();
  const payload = buildAndroidDesktopLyricPayload(
    getLyricData(),
    settingStore.desktopLyricConfig,
  );
  await DesktopLyric.updateLyric(payload);
};

const pushLyricThrottled = throttle(
  () => {
    void pushLyric().catch((error) => {
      console.warn("[DesktopLyric] 同步歌词失败:", error);
    });
  },
  250,
  { leading: true, trailing: true },
);

const ensurePermission = async (): Promise<boolean> => {
  const permission = await DesktopLyric.checkPermission();
  if (permission.granted) return true;
  pendingShowAfterPermission = true;
  await DesktopLyric.requestPermission();
  window.$message?.warning("请在系统设置中允许小熊音乐显示在其他应用上层");
  return false;
};

export const setAndroidDesktopLyricShow = async (show: boolean): Promise<boolean> => {
  if (!isCapacitor) return show;

  if (!show) {
    pendingShowAfterPermission = false;
    await DesktopLyric.hide();
    return false;
  }

  const hasPermission = await ensurePermission();
  if (!hasPermission) return false;

  await pushConfig();
  await pushLyric();
  await DesktopLyric.show();
  return true;
};

export const syncAndroidDesktopLyricNow = async () => {
  const statusStore = useStatusStore();
  if (!isCapacitor || !statusStore.showDesktopLyric) return;
  await pushConfig();
  await pushLyric();
};

export const initAndroidDesktopLyricBridge = () => {
  if (!isCapacitor || initialized) return;
  initialized = true;

  const musicStore = useMusicStore();
  const statusStore = useStatusStore();
  const settingStore = useSettingStore();

  void DesktopLyric.addListener("close", () => {
    statusStore.showDesktopLyric = false;
    void DesktopLyric.hide();
  }).then((listener) => {
    closeListener = listener;
  });

  void DesktopLyric.addListener("configChange", (config) => {
    settingStore.desktopLyricConfig = {
      ...settingStore.desktopLyricConfig,
      ...cloneDeep(config),
    };
  }).then((listener) => {
    configChangeListener = listener;
  });

  void DesktopLyric.addListener("control", async ({ action }) => {
    const { usePlayerController } = await import("@/core/player/PlayerController");
    const player = usePlayerController();
    if (action === "previous") {
      await player.nextOrPrev("prev");
    } else if (action === "next") {
      await player.nextOrPrev("next");
    } else {
      await player.playOrPause();
    }
  }).then((listener) => {
    controlListener = listener;
  });

  void App.addListener("appStateChange", async ({ isActive }) => {
    if (!isActive || !pendingShowAfterPermission) return;
    pendingShowAfterPermission = false;
    const permission = await DesktopLyric.checkPermission();
    if (!permission.granted) return;
    statusStore.showDesktopLyric = true;
    await setAndroidDesktopLyricShow(true);
    window.$message?.success("已开启桌面歌词");
  }).then((listener) => {
    appStateListener = listener;
  });

  stopHandles.push(
    watch(
      () => [
        musicStore.playSong?.id,
        musicStore.playSong?.name,
        musicStore.playSong?.artists,
        statusStore.playStatus,
        statusStore.currentTime,
        statusStore.lyricIndex,
        statusStore.lyricLoading,
        statusStore.showDesktopLyric,
        musicStore.songLyric.lrcData,
        musicStore.songLyric.yrcData,
      ],
      () => {
        if (statusStore.showDesktopLyric) pushLyricThrottled();
      },
      { deep: true },
    ),
  );

  stopHandles.push(
    watch(
      () => settingStore.desktopLyricConfig,
      async (config) => {
        if (!statusStore.showDesktopLyric) return;
        await DesktopLyric.updateConfig(cloneDeep(config));
        await DesktopLyric.setLocked({ locked: config.isLock });
      },
      { deep: true },
    ),
  );

  if (statusStore.showDesktopLyric) {
    void setAndroidDesktopLyricShow(true).then((shown) => {
      statusStore.showDesktopLyric = shown;
    });
  }
};

export const disposeAndroidDesktopLyricBridge = () => {
  stopHandles.splice(0).forEach((stop) => stop());
  void appStateListener?.remove();
  void closeListener?.remove();
  void configChangeListener?.remove();
  void controlListener?.remove();
  appStateListener = null;
  closeListener = null;
  configChangeListener = null;
  controlListener = null;
  initialized = false;
};
