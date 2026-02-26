package com.xiaoxiong.music;

import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Capacitor 插件：音频缓存管理
 *
 * 提供前端与 AudioProxyServer 缓存交互的接口
 */
@CapacitorPlugin(name = "AudioCache")
public class AudioCachePlugin extends Plugin {
    private static final String TAG = "AudioCachePlugin";

    private AudioProxyServer getProxyServer() {
        MusicService service = MusicService.getInstance();
        if (service != null) {
            return service.getAudioProxyServer();
        }
        return null;
    }

    @PluginMethod
    public void getCacheSize(PluginCall call) {
        AudioProxyServer server = getProxyServer();
        if (server == null) {
            JSObject ret = new JSObject();
            ret.put("size", 0);
            ret.put("count", 0);
            call.resolve(ret);
            return;
        }

        long[] stat = server.getCacheSize();
        long sizeBytes = stat[0];
        long count = stat[1];
        double sizeMB = sizeBytes / (1024.0 * 1024.0);

        JSObject ret = new JSObject();
        ret.put("size", Math.round(sizeMB * 100.0) / 100.0); // 保留两位小数
        ret.put("count", count);
        call.resolve(ret);
    }

    @PluginMethod
    public void clearCache(PluginCall call) {
        AudioProxyServer server = getProxyServer();
        if (server != null) {
            server.clearCache();
        }

        JSObject ret = new JSObject();
        ret.put("success", true);
        call.resolve(ret);
        Log.d(TAG, "Cache cleared by user");
    }

    @PluginMethod
    public void setCacheConfig(PluginCall call) {
        boolean enabled = call.getBoolean("enabled", true);
        int maxSizeMB = call.getInt("maxSize", 500);
        String strategy = call.getString("strategy", "all");

        AudioProxyServer server = getProxyServer();
        if (server != null) {
            server.setCacheEnabled(enabled);
            server.setMaxCacheSize((long) maxSizeMB * 1024 * 1024);
            server.setCacheStrategy(strategy);
        }

        JSObject ret = new JSObject();
        ret.put("success", true);
        call.resolve(ret);
        Log.d(TAG, "缓存配置已更新: 开关=" + (enabled ? "开" : "关") + ", 上限=" + maxSizeMB + "MB, 策略=" + strategy);
    }

    @PluginMethod
    public void getCacheStatus(PluginCall call) {
        AudioProxyServer server = getProxyServer();

        JSObject ret = new JSObject();
        if (server != null) {
            ret.put("enabled", server.isCacheEnabled());
            ret.put("maxSize", server.getMaxCacheSize() / (1024 * 1024));
            long[] stat = server.getCacheSize();
            long sizeBytes = stat[0];
            ret.put("currentSize", Math.round(sizeBytes / (1024.0 * 1024.0) * 100.0) / 100.0);
            ret.put("strategy", server.getCacheStrategy());
        } else {
            ret.put("enabled", false);
            ret.put("maxSize", 500);
            ret.put("currentSize", 0);
            ret.put("strategy", "all");
        }
        call.resolve(ret);
    }
}
