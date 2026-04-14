/**
 * WebView 缓存清除插件接口
 *
 * 用于在应用更新后清除 WebView 缓存，确保加载最新资源
 */
import { registerPlugin } from '@capacitor/core';

export interface WebViewCachePlugin {
  /**
   * 清除 WebView 缓存
   */
  clearCache(): Promise<{ success: boolean }>;

  /**
   * 清除 WebView 历史记录
   */
  clearHistory(): Promise<{ success: boolean }>;

  /**
   * 清除所有缓存（WebView缓存 + 历史记录 + 应用缓存目录）
   */
  clearAll(): Promise<{ success: boolean }>;

  /**
   * 检查版本变化并自动清除缓存
   * 如果当前版本与上次记录版本不同，自动清除缓存
   */
  checkVersionAndClear(): Promise<{
    cleared: boolean;
    previousVersion: string;
    currentVersion: string;
  }>;

  /**
   * 强制保存当前版本号（用于首次安装）
   */
  saveCurrentVersion(): Promise<{ success: boolean; version: string }>;
}

export const WebViewCache = registerPlugin<WebViewCachePlugin>('WebViewCache');