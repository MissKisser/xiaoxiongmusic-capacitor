import { Capacitor } from '@capacitor/core';
import { MusicNotification } from '@/plugins/MusicNotificationPlugin';
import { checkAndRequestNotificationPermission } from './notificationPermission';

// 检查是否为原生平台
const isNative = Capacitor.isNativePlatform();

/**
 * 音乐控制状态
 */
interface MusicControlsState {
    isInitialized: boolean;
    hasPermission: boolean;
}

const state: MusicControlsState = {
    isInitialized: false,
    hasPermission: false,
};

/**
 * 初始化音乐控制
 */
export const initMusicControls = async () => {
    if (!isNative) {
        console.log('[MusicControls] Not native platform, skipping initialization');
        return;
    }

    if (state.isInitialized) {
        console.log('[MusicControls] Already initialized, skipping');
        return;
    }

    try {
        console.log('[MusicControls] ========== INITIALIZING ==========');
        console.log('[MusicControls] Platform:', Capacitor.getPlatform());
        console.log('[MusicControls] isNativePlatform:', Capacitor.isNativePlatform());

        // 先检查并请求通知权限(Android 13+)
        console.log('[MusicControls] Checking notification permission...');
        const hasPermission = await checkAndRequestNotificationPermission();
        state.hasPermission = hasPermission;
        console.log('[MusicControls] Notification permission:', hasPermission);

        if (!hasPermission) {
            console.warn('[MusicControls] ⚠️ 通知权限未授予,通知栏播放器可能无法显示');
        }

        // 初始化插件
        console.log('[MusicControls] Calling MusicNotification.initialize()...');
        await MusicNotification.initialize();
        state.isInitialized = true;
        console.log('[MusicControls] ✅ Initialized successfully');
        console.log('[MusicControls] =====================================');
    } catch (error) {
        console.error('[MusicControls] ❌ Failed to initialize:', error);
        console.error('[MusicControls] Error details:', JSON.stringify(error));
    }
};

/**
 * 更新通知栏信息
 */
export const updateMusicControls = async (options: {
    track: string;
    artist: string;
    album?: string;
    cover?: string;
    isPlaying: boolean;
    duration?: number;
    elapsed?: number;
}) => {
    console.log('[MusicControls] ========== UPDATE CALLED ==========');
    console.log('[MusicControls] isNative:', isNative);
    console.log('[MusicControls] isInitialized:', state.isInitialized);
    console.log('[MusicControls] Track:', options.track);
    console.log('[MusicControls] Artist:', options.artist);
    console.log('[MusicControls] isPlaying:', options.isPlaying);

    if (!isNative) {
        console.log('[MusicControls] Not native platform, skipping update');
        return;
    }

    if (!state.isInitialized) {
        console.warn('[MusicControls] ⚠️ Not initialized, skipping update');
        return;
    }

    try {
        // 更新元数据
        console.log(`[MusicControls] Updating metadata... Title: ${options.track}, Duration: ${options.duration}`);
        await MusicNotification.updateMetadata({
            title: options.track,
            artist: options.artist,
            album: options.album || '',
            coverUrl: options.cover || '',
            duration: options.duration || -1,
        });
        console.log('[MusicControls] ✅ Metadata updated');

        // 更新播放状态
        console.log('[MusicControls] Updating playback state...');
        await MusicNotification.updatePlaybackState({
            isPlaying: options.isPlaying,
        });
        console.log('[MusicControls] ✅ Playback state updated');

        // 更新进度(如果提供)
        if (options.elapsed !== undefined && options.duration !== undefined) {
            console.log('[MusicControls] Updating position...');
            await MusicNotification.updatePosition({
                position: Math.floor(options.elapsed),
                duration: Math.floor(options.duration),
            });
            console.log('[MusicControls] ✅ Position updated');
        }

        console.log('[MusicControls] =====================================');
    } catch (error) {
        console.error('[MusicControls] ❌ Failed to update:', error);
        console.error('[MusicControls] Error details:', JSON.stringify(error));
    }
};

/**
 * 更新播放进度
 */
export const updateMusicProgress = async (elapsed: number, duration: number) => {
    if (!isNative || !state.isInitialized) return;

    try {
        await MusicNotification.updatePosition({
            position: Math.floor(elapsed),
            duration: Math.floor(duration),
        });
    } catch (error) {
        console.error('[MusicControls] Failed to update progress:', error);
    }
};

/**
 * 销毁音乐控制
 */
export const destroyMusicControls = async () => {
    if (!isNative || !state.isInitialized) return;

    try {
        await MusicNotification.destroy();
        state.isInitialized = false;
        console.log('[MusicControls] Destroyed');
    } catch (error) {
        console.error('[MusicControls] Failed to destroy:', error);
    }
};

/**
 * 监听音乐控制事件
 */
export const onMusicControlEvent = (
    event: 'play' | 'pause' | 'next' | 'previous' | 'seek',
    callback: (details?: any) => void
) => {
    if (!isNative) {
        return () => { };
    }

    // 注册事件监听器
    console.error(`[MusicService] [Controls] Adding listener for: ${event}`);
    MusicNotification.addListener(event, (data) => {
        console.error(`[MusicService] [Controls] Listener fired for ${event}`, JSON.stringify(data));
        callback(data);
    }).catch((error) => {
        console.error(`[MusicService] [Controls] Failed to add listener for ${event}:`, error);
    });

    // 返回移除监听器的函数
    return () => {
        // 插件会自动管理监听器
    };
};


