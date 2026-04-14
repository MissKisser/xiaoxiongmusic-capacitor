package com.xiaoxiong.music;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;
import android.webkit.WebView;

import com.getcapacitor.Bridge;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

/**
 * Capacitor 插件：WebView 缓存清除
 *
 * 在应用版本更新时自动清除 WebView 缓存，确保加载最新资源
 */
@CapacitorPlugin(name = "WebViewCache")
public class WebViewCachePlugin extends Plugin {
    private static final String TAG = "WebViewCachePlugin";
    private static final String PREFS_NAME = "webview_cache_prefs";
    private static final String KEY_LAST_VERSION = "last_version";

    /**
     * 清除 WebView 缓存
     */
    @PluginMethod
    public void clearCache(PluginCall call) {
        try {
            Bridge bridge = getBridge();
            if (bridge != null) {
                WebView webView = bridge.getWebView();
                if (webView != null) {
                    webView.clearCache(true);
                    Log.d(TAG, "WebView 缓存已清除");
                }
            }

            JSObject ret = new JSObject();
            ret.put("success", true);
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "清除缓存失败", e);
            call.reject("清除缓存失败: " + e.getMessage());
        }
    }

    /**
     * 清除 WebView 历史记录
     */
    @PluginMethod
    public void clearHistory(PluginCall call) {
        try {
            Bridge bridge = getBridge();
            if (bridge != null) {
                WebView webView = bridge.getWebView();
                if (webView != null) {
                    webView.clearHistory();
                    Log.d(TAG, "WebView 历史记录已清除");
                }
            }

            JSObject ret = new JSObject();
            ret.put("success", true);
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "清除历史记录失败", e);
            call.reject("清除历史记录失败: " + e.getMessage());
        }
    }

    /**
     * 清除所有缓存（WebView缓存 + 历史记录 + 应用缓存目录）
     */
    @PluginMethod
    public void clearAll(PluginCall call) {
        try {
            Context context = getContext();

            // 清除 WebView 缓存和历史
            Bridge bridge = getBridge();
            if (bridge != null) {
                WebView webView = bridge.getWebView();
                if (webView != null) {
                    webView.clearCache(true);
                    webView.clearHistory();
                    Log.d(TAG, "WebView 缓存和历史已清除");
                }
            }

            // 清除 WebView 数据库缓存（旧版Android）
            context.deleteDatabase("webview.db");
            context.deleteDatabase("webviewCache.db");

            // 清除应用缓存目录
            File cacheDir = context.getCacheDir();
            if (cacheDir != null && cacheDir.exists()) {
                deleteRecursive(cacheDir);
                Log.d(TAG, "应用缓存目录已清除: " + cacheDir.getAbsolutePath());
            }

            // 清除 WebView 缓存目录（保留用户数据）
            File webviewCacheDir = new File(context.getApplicationInfo().dataDir, "app_webview");
            if (webviewCacheDir.exists()) {
                deleteRecursiveSafe(webviewCacheDir, PRESERVE_DIRS);
                Log.d(TAG, "WebView 缓存目录已清除（保留用户数据）: " + webviewCacheDir.getAbsolutePath());
            }

            JSObject ret = new JSObject();
            ret.put("success", true);
            call.resolve(ret);
            Log.d(TAG, "所有缓存已清除完成");
        } catch (Exception e) {
            Log.e(TAG, "清除所有缓存失败", e);
            call.reject("清除所有缓存失败: " + e.getMessage());
        }
    }

    /**
     * 检查版本变化并自动清除缓存
     * 如果当前版本与上次记录版本不同，自动清除缓存
     */
    @PluginMethod
    public void checkVersionAndClear(PluginCall call) {
        try {
            Context context = getContext();
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);

            // 获取当前应用版本
            String currentVersion = getCurrentAppVersion();
            String lastVersion = prefs.getString(KEY_LAST_VERSION, "");

            Log.d(TAG, "当前版本: " + currentVersion + ", 上次版本: " + lastVersion);

            boolean cleared = false;

            // 版本发生变化，清除缓存
            if (!currentVersion.equals(lastVersion)) {
                Log.d(TAG, "检测到版本更新，开始清除缓存...");

                // 执行缓存清除
                Bridge bridge = getBridge();
                if (bridge != null) {
                    WebView webView = bridge.getWebView();
                    if (webView != null) {
                        webView.clearCache(true);
                        webView.clearHistory();
                    }
                }

                // 清除缓存目录
                File cacheDir = context.getCacheDir();
                if (cacheDir != null && cacheDir.exists()) {
                    deleteRecursive(cacheDir);
                }

                // 清除 WebView 缓存目录（保留用户数据）
                File webviewCacheDir = new File(context.getApplicationInfo().dataDir, "app_webview");
                if (webviewCacheDir.exists()) {
                    deleteRecursiveSafe(webviewCacheDir, PRESERVE_DIRS);
                }

                // 保存新版本号
                prefs.edit().putString(KEY_LAST_VERSION, currentVersion).apply();

                cleared = true;
                Log.d(TAG, "缓存清除完成，新版本号已保存");
            } else {
                Log.d(TAG, "版本未变化，无需清除缓存");
            }

            JSObject ret = new JSObject();
            ret.put("cleared", cleared);
            ret.put("previousVersion", lastVersion);
            ret.put("currentVersion", currentVersion);
            call.resolve(ret);

        } catch (Exception e) {
            Log.e(TAG, "检查版本清除缓存失败", e);
            call.reject("检查版本清除缓存失败: " + e.getMessage());
        }
    }

    /**
     * 强制保存当前版本号（用于首次安装）
     */
    @PluginMethod
    public void saveCurrentVersion(PluginCall call) {
        try {
            Context context = getContext();
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);

            String currentVersion = getCurrentAppVersion();
            prefs.edit().putString(KEY_LAST_VERSION, currentVersion).apply();

            Log.d(TAG, "当前版本号已保存: " + currentVersion);

            JSObject ret = new JSObject();
            ret.put("success", true);
            ret.put("version", currentVersion);
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "保存版本号失败", e);
            call.reject("保存版本号失败: " + e.getMessage());
        }
    }

    /**
     * 获取当前应用版本号
     */
    private String getCurrentAppVersion() {
        try {
            android.content.pm.PackageInfo pInfo = getContext().getPackageManager()
                    .getPackageInfo(getContext().getPackageName(), 0);
            if (pInfo.versionName == null || pInfo.versionName.isEmpty()) {
                Log.w(TAG, "版本号为空，使用 buildNumber");
                return String.valueOf(pInfo.versionCode);
            }
            return pInfo.versionName;
        } catch (Exception e) {
            Log.e(TAG, "获取版本号失败，返回空字符串避免误触发清除", e);
            return "";
        }
    }

    /**
     * 需要保留的用户数据目录（不删除）
     */
    private static final Set<String> PRESERVE_DIRS = new HashSet<>(Arrays.asList(
        "Local Storage", "Session Storage", "IndexedDB", "Cookies", "databases"
    ));

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
        // 不删除目录本身，只清空内容，避免影响应用正常运行
        if (!file.isDirectory()) {
            file.delete();
        }
    }

    /**
     * 安全递归删除目录，保留指定的用户数据目录
     *
     * @param file 要删除的文件或目录
     * @param preserveDirs 需要保留的目录名称集合（如 Local Storage, Cookies 等）
     */
    private void deleteRecursiveSafe(File file, Set<String> preserveDirs) {
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children != null) {
                for (File child : children) {
                    // 跳过需要保留的目录
                    if (preserveDirs.contains(child.getName())) {
                        Log.d(TAG, "保留用户数据目录: " + child.getName());
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
}