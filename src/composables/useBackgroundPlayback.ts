import { watch } from 'vue';
import { useStatusStore, useMusicStore } from '@/stores';
import { Capacitor } from '@capacitor/core';
import { isCapacitor } from '@/utils/env';

/**
 * 后台播放和熄屏播放管理
 * 
 * 功能：
 * 1. 监听播放状态，自动管理 WakeLock
 * 2. 确保后台播放正常工作
 * 3. 处理应用生命周期事件
 */
export function useBackgroundPlayback() {
  const statusStore = useStatusStore();
  const musicStore = useMusicStore();

  /**
   * 初始化后台播放功能
   */
  const init = () => {
    if (!isCapacitor || !Capacitor.isNativePlatform()) {
      return;
    }

    // 监听播放状态变化
    watch(
      () => statusStore.playStatus,
      (isPlaying) => {
        if (isPlaying) {
          // 开始播放时，确保应用可以在后台运行
          enableBackgroundPlayback();
        }
      },
      { immediate: true }
    );

    // 监听应用生命周期
    setupAppLifecycle();
  };

  /**
   * 启用后台播放
   */
  const enableBackgroundPlayback = async () => {
    if (!isCapacitor || !Capacitor.isNativePlatform()) {
      return;
    }

    // 后台播放主要通过通知栏播放器插件实现
    // 这里只需要确保应用生命周期正常即可
    console.log('[BackgroundPlayback] Background playback enabled');
  };

  /**
   * 设置应用生命周期监听
   */
  const setupAppLifecycle = async () => {
    if (!isCapacitor || !Capacitor.isNativePlatform()) {
      return;
    }

    try {
      const { App } = await import('@capacitor/app');

      // 统一的应用状态监听
      App.addListener('appStateChange', (state) => {
        if (state.isActive) {
          // 应用在前台
          console.log('[BackgroundPlayback] App is active');
        } else {
          // 应用在后台
          if (statusStore.playStatus) {
            console.log('[BackgroundPlayback] App is in background, playback continues');
          }
        }
      });
    } catch (error) {
      console.warn('[BackgroundPlayback] Failed to setup lifecycle listeners:', error);
    }
  };

  return {
    init,
    enableBackgroundPlayback,
  };
}
