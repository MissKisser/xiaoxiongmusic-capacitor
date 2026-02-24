// Web fallback for MusicControls plugin
// 在 Web 环境下提供一个空的实现，避免错误

export default {
    create: async () => {
        console.warn('[MusicControls] Web 环境不支持通知栏播放器');
    },
    updateIsPlaying: async () => {},
    updateMetadata: async () => {},
    updateElapsed: async () => {},
    listen: async () => {},
    destroy: async () => {},
    addListener: () => ({ remove: () => {} }),
};
