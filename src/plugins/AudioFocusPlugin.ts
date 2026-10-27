import { registerPlugin } from '@capacitor/core';

/**
 * 耳机拔出事件数据
 */
export interface AudioBecomingNoisyEvent {
    /** 事件原因标识 */
    reason: string;
}

/**
 * 音频焦点桥接插件接口
 * 系统音频焦点由 WebView 内部媒体会话唯一持有，
 * 本插件仅转发原生层监听到的耳机拔出广播
 */
export interface AudioFocusPluginInterface {
    /**
     * 查询耳机拔出广播监听是否就绪
     */
    isNoisyMonitorReady(): Promise<{ noisySupported: boolean }>;

    /**
     * 添加事件监听器
     */
    addListener(
        eventName: 'becomingNoisy',
        listenerFunc: (data: AudioBecomingNoisyEvent) => void,
    ): Promise<{ remove: () => void }>;
}

const AudioFocus = registerPlugin<AudioFocusPluginInterface>('AudioFocus', {
    web: () => import('./AudioFocusWeb').then(m => new m.AudioFocusWeb()),
});

export { AudioFocus };
