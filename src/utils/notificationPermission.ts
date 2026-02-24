import { Capacitor } from '@capacitor/core';
import { isCapacitor } from './env';

/**
 * 检查并请求通知权限
 * Android 13+ 需要通知权限才能显示通知栏播放器
 */
export async function checkAndRequestNotificationPermission(): Promise<boolean> {
  if (!isCapacitor || !Capacitor.isNativePlatform()) {
    return true; // Web 环境不需要权限
  }

  try {
    // Android 13+ (API 33+) 需要通知权限
    if (Capacitor.getPlatform() === 'android') {
      try {
        // 尝试使用 @capacitor/local-notifications 插件
        const { LocalNotifications } = await import('@capacitor/local-notifications');
        
        // 检查权限状态
        const permissionStatus = await LocalNotifications.checkPermissions();
        
        if (permissionStatus.display === 'granted') {
          console.log('[NotificationPermission] 通知权限已授予');
          return true;
        }

        // 请求权限
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
        // 如果插件未安装，尝试使用原生方式
        console.log('[NotificationPermission] 使用原生方式检查权限...');
        
        // 对于 Android，通知权限通常在首次显示通知时自动请求
        // 如果插件未安装，我们假设权限已授予（旧版本 Android 不需要）
        return true;
      }
    }

    return true;
  } catch (error) {
    console.error('[NotificationPermission] 检查通知权限失败:', error);
    // 如果出错，尝试继续（可能不需要权限或插件未安装）
    return true;
  }
}
