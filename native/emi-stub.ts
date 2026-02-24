// Mobile 版本的 EMI 桩模块 - 不依赖 Electron 原生模块
// 在移动端，这些功能将通过 Capacitor 插件实现

export enum PlaybackStatus {
    Stopped = 0,
    Playing = 1,
    Paused = 2,
}

export enum RepeatMode {
    Off = 0,
    One = 1,
    All = 2,
}

export interface MetadataParam {
    title?: string;
    artist?: string;
    album?: string;
    albumArt?: string;
    duration?: number;
}

export interface DiscordConfigPayload {
    enabled: boolean;
    clientId?: string;
    details?: string;
    state?: string;
}

export enum SystemMediaEvent {
    Play = "play",
    Pause = "pause",
    Next = "next",
    Previous = "previous",
    Stop = "stop",
}

// 桩实现 - 在 web 环境下不执行任何操作
export const init = () => {
    console.log("[EMI Stub] Initialized in web environment");
};

export const updateMetadata = (metadata: MetadataParam) => {
    console.log("[EMI Stub] Update metadata:", metadata);
};

export const updatePlaybackStatus = (status: PlaybackStatus) => {
    console.log("[EMI Stub] Update playback status:", status);
};

export const setDiscordConfig = (config: DiscordConfigPayload) => {
    console.log("[EMI Stub] Discord config:", config);
};

export default {
    init,
    updateMetadata,
    updatePlaybackStatus,
    setDiscordConfig,
    PlaybackStatus,
    RepeatMode,
    SystemMediaEvent,
};
