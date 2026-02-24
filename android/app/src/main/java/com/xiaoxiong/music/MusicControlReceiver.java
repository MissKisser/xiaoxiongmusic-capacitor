package com.xiaoxiong.music;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

/**
 * 音乐控制广播接收器
 * 处理通知栏按钮点击事件
 */
public class MusicControlReceiver extends BroadcastReceiver {
    private static final String TAG = "MusicService"; // 统一 TAG 方便调试

    public static final String ACTION_PLAY = "com.xiaoxiong.music.ACTION_PLAY";
    public static final String ACTION_PAUSE = "com.xiaoxiong.music.ACTION_PAUSE";
    public static final String ACTION_NEXT = "com.xiaoxiong.music.ACTION_NEXT";
    public static final String ACTION_PREVIOUS = "com.xiaoxiong.music.ACTION_PREVIOUS";
    public static final String ACTION_SEEK = "com.xiaoxiong.music.ACTION_SEEK";


    private static MusicNotificationPlugin pluginInstance;

    public static void setPluginInstance(MusicNotificationPlugin plugin) {
        pluginInstance = plugin;
    }



    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || intent.getAction() == null) {
            return;
        }

        String action = intent.getAction();
        Log.d(TAG, "Received action: " + action);

        if (pluginInstance == null) {
            Log.w(TAG, "Plugin instance is null");
            return;
        }

        switch (action) {
            case ACTION_PLAY:
                pluginInstance.notifyPlayEvent();
                break;
            case ACTION_PAUSE:
                pluginInstance.notifyPauseEvent();
                break;
            case ACTION_NEXT:
                pluginInstance.notifyNextEvent();
                break;
            case ACTION_PREVIOUS:
                pluginInstance.notifyPreviousEvent();
                break;
            case ACTION_SEEK:
                long position = intent.getLongExtra("position", 0);
                Log.d(TAG, "Seek to position: " + position + "ms");
                pluginInstance.notifySeekEvent(position);
                break;
            default:
                Log.w(TAG, "Unknown action: " + action);
        }
    }
}
