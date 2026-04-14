package com.xiaoxiong.music;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.provider.Settings;
import android.util.Log;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

import java.io.File;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

public class MainActivity extends BridgeActivity {
    private PowerManager.WakeLock wakeLock;

    private static final String PREFS_NAME = "webview_cache_prefs";
    private static final String KEY_LAST_VERSION = "last_version";

    /**
     * 需要保留的用户数据目录（不删除）
     */
    private static final Set<String> PRESERVE_DIRS = new HashSet<>(Arrays.asList(
        "Local Storage", "Session Storage", "IndexedDB", "Cookies", "databases"
    ));

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 在 super.onCreate() 之前检查版本并清除缓存
        // 这确保在 WebView 初始化之前就清除了旧缓存
        checkVersionAndClearCacheBeforeWebViewInit();

        // 在 super.onCreate() 之前注册自定义插件
        // 这样 Capacitor 在初始化时就能找到我们的插件
        registerPlugin(MusicNotificationPlugin.class);
        registerPlugin(AudioCachePlugin.class);
        registerPlugin(WebViewCachePlugin.class);
        Log.d("MainActivity", "✅ MusicNotificationPlugin registered");
        Log.d("MainActivity", "✅ AudioCachePlugin registered");
        Log.d("MainActivity", "✅ WebViewCachePlugin registered");

        super.onCreate(savedInstanceState);

        // 初始化 WakeLock 用于熄屏播放
        initWakeLock();
    }

    /**
     * 在 WebView 初始化之前检查版本并清除缓存
     * 这是关键的时机，确保 WebView 加载最新的资源
     */
    private void checkVersionAndClearCacheBeforeWebViewInit() {
        try {
            SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);

            // 获取当前应用版本
            String currentVersion = getCurrentAppVersion();
            String lastVersion = prefs.getString(KEY_LAST_VERSION, "");

            Log.d("MainActivity", "🔍 版本检查: 当前=" + currentVersion + ", 上次=" + lastVersion);

            // 版本发生变化，清除缓存
            if (!currentVersion.equals(lastVersion) && !currentVersion.isEmpty()) {
                Log.d("MainActivity", "📦 检测到版本更新，开始清除 WebView 缓存...");

                // 清除应用缓存目录
                File cacheDir = getCacheDir();
                if (cacheDir != null && cacheDir.exists()) {
                    deleteRecursive(cacheDir);
                    Log.d("MainActivity", "✅ 应用缓存目录已清除");
                }

                // 清除 WebView 缓存目录（保留用户数据）
                File webviewCacheDir = new File(getApplicationInfo().dataDir, "app_webview");
                if (webviewCacheDir.exists()) {
                    deleteRecursiveSafe(webviewCacheDir, PRESERVE_DIRS);
                    Log.d("MainActivity", "✅ WebView 缓存目录已清除（保留用户数据）");
                }

                // 保存新版本号
                prefs.edit().putString(KEY_LAST_VERSION, currentVersion).apply();
                Log.d("MainActivity", "✅ 新版本号已保存: " + currentVersion);
            } else {
                Log.d("MainActivity", "ℹ️ 版本未变化或首次安装，无需清除缓存");
            }
        } catch (Exception e) {
            Log.e("MainActivity", "❌ 版本检查或缓存清除失败", e);
        }
    }

    /**
     * 获取当前应用版本号
     */
    private String getCurrentAppVersion() {
        try {
            PackageInfo pInfo = getPackageManager().getPackageInfo(getPackageName(), 0);
            if (pInfo.versionName == null || pInfo.versionName.isEmpty()) {
                Log.w("MainActivity", "版本号为空，使用 versionCode");
                return String.valueOf(pInfo.versionCode);
            }
            return pInfo.versionName;
        } catch (Exception e) {
            Log.e("MainActivity", "获取版本号失败", e);
            return "";
        }
    }

    /**
     * 递归删除目录及其内容
     */
    private void deleteRecursive(File file) {
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children != null) {
                for (File child : children) {
                    deleteRecursive(child);
                }
            }
        }
        // 不删除目录本身，只清空内容
        if (!file.isDirectory()) {
            file.delete();
        }
    }

    /**
     * 安全递归删除，保留指定的用户数据目录
     */
    private void deleteRecursiveSafe(File file, Set<String> preserveDirs) {
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children != null) {
                for (File child : children) {
                    // 跳过需要保留的目录
                    if (preserveDirs.contains(child.getName())) {
                        Log.d("MainActivity", "🔒 保留用户数据目录: " + child.getName());
                        continue;
                    }
                    deleteRecursiveSafe(child, preserveDirs);
                }
            }
        }
        // 不删除目录本身，只清空内容
        if (!file.isDirectory()) {
            file.delete();
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        // 应用恢复时，如果正在播放，获取 WakeLock
        // 注意：WakeLock 的实际管理应该由播放状态控制
        // 这里只是确保应用在前台时能够保持播放
    }

    @Override
    public void onPause() {
        super.onPause();
        // 应用进入后台时，不释放 WakeLock
        // 这样可以确保后台播放和熄屏播放正常工作
        // WakeLock 会在播放停止或应用销毁时释放
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        // 销毁时释放 WakeLock
        releaseWakeLock();
    }

    /**
     * 初始化 WakeLock
     */
    private void initWakeLock() {
        try {
            PowerManager powerManager = (PowerManager) getSystemService(POWER_SERVICE);
            if (powerManager != null) {
                wakeLock = powerManager.newWakeLock(
                        PowerManager.PARTIAL_WAKE_LOCK,
                        "XiaoxiongMusic::WakeLock");
                wakeLock.setReferenceCounted(false);
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    /**
     * 获取 WakeLock（用于熄屏播放）
     */
    public void acquireWakeLock() {
        try {
            if (wakeLock != null && !wakeLock.isHeld()) {
                wakeLock.acquire(10 * 60 * 1000L /* 10 minutes */);
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    /**
     * 释放 WakeLock
     */
    public void releaseWakeLock() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) {
                wakeLock.release();
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

}
