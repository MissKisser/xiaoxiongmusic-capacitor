export { useShortcutStore } from "./shortcut";
export { useSettingStore } from "./setting";
export { useStatusStore } from "./status";
export { useMusicStore } from "./music";
export { useDataStore } from "./data";

// local-localforage
export { useLocalStore } from "./local";

// streaming-localforage
export { useStreamingStore } from "./streaming";

// auth & version
export { useAuthStore } from "./auth";
export { useVersionStore } from "./version";

// platform
export {
  usePlatformStore,
  PLATFORM_META,
  SUPPORTED_PLATFORMS,
  THIRD_PARTY_PLATFORMS,
  onPlatformChange,
  onAccountChange,
} from "./platform";
export { usePlatformScopeStore, initPlatformScope } from "./platformScope";

