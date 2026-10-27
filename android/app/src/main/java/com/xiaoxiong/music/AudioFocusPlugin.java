package com.xiaoxiong.music;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.media.AudioManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 音频输出焦点广播桥插件
 *
 * 系统音频焦点的唯一持有者是 WebView 内部的媒体会话（Chromium MediaSession）：
 * 焦点申请/抢占/回归/压低音量均由其原生处理，本插件不得再向系统申请焦点，
 * 否则两份 AUDIOFOCUS_GAIN 请求会互相顶替，导致 Chromium 收到 LOSS 后暂停媒体元素。
 *
 * 本插件仅负责监听耳机拔出等输出设备即将变嘈杂的广播（ACTION_AUDIO_BECOMING_NOISY），
 * 并以 becomingNoisy 事件转发给 WebView 侧执行暂停。
 */
@CapacitorPlugin(name = "AudioFocus")
public class AudioFocusPlugin extends Plugin {
    private static final String TAG = "AudioFocusPlugin";

    /** 耳机拔出等输出设备即将变嘈杂的事件名 */
    public static final String EVENT_BECOMING_NOISY = "becomingNoisy";

    /** 静态实例引用（供 MusicService 等原生组件调用） */
    private static AudioFocusPlugin instance;

    public static AudioFocusPlugin getInstance() {
        return instance;
    }

    private Handler mainHandler;
    private BecomingNoisyReceiver noisyReceiver;
    private boolean receiverRegistered = false;

    @Override
    public void load() {
        super.load();
        instance = this;
        mainHandler = new Handler(Looper.getMainLooper());
        registerNoisyReceiver();
        Log.d(TAG, "AudioFocusPlugin loaded");
    }

    /**
     * 注册耳机拔出广播接收器
     */
    private void registerNoisyReceiver() {
        if (receiverRegistered) return;
        noisyReceiver = new BecomingNoisyReceiver();
        IntentFilter filter = new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY);
        if (Build.VERSION.SDK_INT >= 33) {
            getContext().registerReceiver(noisyReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            getContext().registerReceiver(noisyReceiver, filter);
        }
        receiverRegistered = true;
    }

    /**
     * 注销耳机拔出广播接收器
     */
    private void unregisterNoisyReceiver() {
        if (!receiverRegistered) return;
        try {
            getContext().unregisterReceiver(noisyReceiver);
        } catch (Exception e) {
            Log.w(TAG, "unregisterNoisyReceiver failed", e);
        }
        receiverRegistered = false;
    }

    /**
     * 向 WebView 侧转发耳机拔出事件
     */
    private void notifyBecomingNoisy() {
        mainHandler.post(() -> {
            JSObject ret = new JSObject();
            ret.put("reason", "audioBecomingNoisy");
            notifyListeners(EVENT_BECOMING_NOISY, ret);
        });
    }

    /**
     * 查询当前是否处于音频外放状态（JS 侧调用入口，仅作诊断用途）
     * @param call 插件调用，结果返回 noisySupported 表示广播监听是否就绪
     */
    @PluginMethod
    public void isNoisyMonitorReady(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("noisySupported", receiverRegistered);
        call.resolve(ret);
    }

    @Override
    protected void handleOnDestroy() {
        unregisterNoisyReceiver();
        if (instance == this) {
            instance = null;
        }
        super.handleOnDestroy();
    }

    /**
     * 耳机拔出广播接收器，收到 ACTION_AUDIO_BECOMING_NOISY 后转发给 WebView
     */
    private class BecomingNoisyReceiver extends BroadcastReceiver {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (intent != null && AudioManager.ACTION_AUDIO_BECOMING_NOISY.equals(intent.getAction())) {
                Log.d(TAG, "ACTION_AUDIO_BECOMING_NOISY");
                notifyBecomingNoisy();
            }
        }
    }
}
