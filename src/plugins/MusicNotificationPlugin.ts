import { registerPlugin } from '@capacitor/core';

/**
 * 音乐通知插件接口
 */
export interface MusicNotificationPlugin {
    /**
     * 初始化插件
     */
    initialize(): Promise<void>;

    /**
     * 更新歌曲元数据
     */
    updateMetadata(options: {
        title: string;
        artist: string;
        album?: string;
        coverUrl?: string;
        duration?: number;
    }): Promise<void>;

    /**
     * 更新播放状态
     */
    updatePlaybackState(options: {
        isPlaying: boolean;
    }): Promise<void>;

    /**
     * 更新播放进度
     */
    updatePosition(options: {
        position: number;
        duration: number;
    }): Promise<void>;

    /**
     * 写入设备侧诊断日志（沙盒 Documents/diag.log）
     */
    diag(options: { line: string }): Promise<void>;

    /**
     * 返回运行环境信息（是否模拟器二进制）
     */
    runtimeInfo(): Promise<{ simulator: boolean }>;

    /**
     * 销毁通知
     */
    destroy(): Promise<void>;

    /**
     * [睡眠定时器] 设置睡眠定时器
     */
    setSleepTimer(options: {
        timeMs: number;
        waitSongEnd: boolean;
    }): Promise<void>;

    /**
     * [睡眠定时器] 清除睡眠定时器
     */
    clearSleepTimer(): Promise<void>;



    /**
     * 添加事件监听器
     */
    addListener(
        eventName: 'play' | 'pause' | 'next' | 'previous' | 'seek' | 'sleepTimerFinished' | 'desktopLyric',
        listenerFunc: (data: any) => void
    ): Promise<{ remove: () => void }>;
}

const MusicNotification = registerPlugin<MusicNotificationPlugin>('MusicNotification', {
    web: () => import('./MusicNotificationWeb').then(m => new m.MusicNotificationWeb()),
});

export { MusicNotification };
