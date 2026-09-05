import { Capacitor } from '@capacitor/core';
import { isCapacitor } from './env';

/**
 * 检查并请求通知权限
 * Android 13+ 与 iOS 需要通知权限才能显示通知栏与锁屏播放控制
 */
export async function checkAndRequestNotificationPermission(): Promise<boolean> {
  if (!isCapacitor || !Capacitor.isNativePlatform()) {
    return true; // Web 环境不需要权限
  }

  try {
    // 原生平台请求通知权限
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      
      const permissionStatus = await LocalNotifications.checkPermissions();
      
      if (permissionStatus.display === 'granted') {
        console.log('[NotificationPermission] 通知权限已授予');
        return true;
      }

      console.log('[NotificationPermission] 请求通知权限...');
      const requestResult = await LocalNotifications.requestPermissions();
      
      if (requestResult.display === 'granted') {
        console.log('[NotificationPermission] 通知权限已授予');
        return true;
      } else {
        console.warn('[NotificationPermission] 通知权限被拒绝');
        return false;
      }
    } catch (importError) {
      console.log('[NotificationPermission] 权限检查异常或插件缺失，回退放行');
      return true;
    }
  } catch (error) {
    console.error('[NotificationPermission] 检查通知权限失败:', error);
    // 如果出错，尝试继续（可能不需要权限或插件未安装）
    return true;
  }
}
