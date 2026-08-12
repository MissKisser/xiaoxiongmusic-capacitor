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
    // 原生媒体集成扩展字段（Electron 端 EMITypes 协议）
    songName?: string;
    authorName?: string;
    albumName?: string;
    originalCoverUrl?: string;
    coverData?: Uint8Array;
    ncmId?: number;
}

export interface DiscordConfigPayload {
    enabled: boolean;
    clientId?: string;
    details?: string;
    state?: string;
    /** 暂停时是否显示 */
    showWhenPaused?: boolean;
    /** 显示模式 */
    displayMode?: string;
}

/**
 * 系统媒体事件（Electron 主进程通过 media-event 通道下发）
 */
export interface SystemMediaEvent {
    type: "Play" | "Pause" | "Stop" | "NextSong" | "PreviousSong" | "Seek" | "ToggleShuffle" | "ToggleRepeat";
    /** Seek 事件的目标位置（毫秒） */
    positionMs?: number;
}

// 桩实现 - 在 web 环境下不执行任何操作
export const init = () => {
    console.log("[EMI Stub] Initialized in web environment");
};

export const updateMetadata = (metadata: MetadataParam) => {
    // 每次切歌都会调用且 payload 较大，仅开发环境输出，避免生产日志刷屏
    if (import.meta.env.DEV) {
        console.log("[EMI Stub] Update metadata:", metadata);
    }
};

export const updatePlaybackStatus = (status: PlaybackStatus) => {
    // 播放状态切换频繁，仅开发环境输出
    if (import.meta.env.DEV) {
        console.log("[EMI Stub] Update playback status:", status);
    }
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
};
