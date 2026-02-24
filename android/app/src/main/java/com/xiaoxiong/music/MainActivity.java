package com.xiaoxiong.music;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.provider.Settings;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private PowerManager.WakeLock wakeLock;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 在 super.onCreate() 之前注册自定义插件
        // 这样 Capacitor 在初始化时就能找到我们的插件
        registerPlugin(MusicNotificationPlugin.class);
        registerPlugin(AudioCachePlugin.class);
        android.util.Log.d("MainActivity", "✅ MusicNotificationPlugin registered");
        android.util.Log.d("MainActivity", "✅ AudioCachePlugin registered");

        super.onCreate(savedInstanceState);

        // 初始化 WakeLock 用于熄屏播放
        initWakeLock();

        // 不主动请求电池优化权限,通过前台服务(通知)来保持后台播放
        // 这样更符合主流音乐软件的做法,不会让用户担心
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
