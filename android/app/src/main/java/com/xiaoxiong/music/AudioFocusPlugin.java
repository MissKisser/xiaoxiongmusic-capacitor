package com.xiaoxiong.music;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
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
 * 音频焦点插件
 * 负责向系统申请/释放音频焦点，监听焦点变化与耳机拔出广播（ACTION_AUDIO_BECOMING_NOISY），
 * 并将系统事件以 focusChange / becomingNoisy 事件形式转发给 WebView 侧的焦点状态机处理。
 */
@CapacitorPlugin(name = "AudioFocus")
public class AudioFocusPlugin extends Plugin {
    private static final String TAG = "AudioFocusPlugin";

    /** 焦点变化事件名，附带 type: gain | loss | transientLoss | canDuck */
    public static final String EVENT_FOCUS_CHANGE = "focusChange";
    /** 耳机拔出等输出设备即将变嘈杂的事件名 */
    public static final String EVENT_BECOMING_NOISY = "becomingNoisy";

    /** 静态实例引用（供 MusicService 等原生组件调用） */
    private static AudioFocusPlugin instance;

    public static AudioFocusPlugin getInstance() {
        return instance;
    }

    private AudioManager audioManager;
    private AudioFocusRequest focusRequest;
    private Handler mainHandler;
    private BecomingNoisyReceiver noisyReceiver;
    private boolean receiverRegistered = false;
    /** 当前是否持有已申请的焦点（永久丢失时由回调复位） */
    private boolean focusRequested = false;

    /**
     * 系统焦点变化监听器，将焦点回调结果转换为插件事件
     */
    private final AudioManager.OnAudioFocusChangeListener focusListener =
            new AudioManager.OnAudioFocusChangeListener() {
                @Override
                public void onAudioFocusChange(int focusChange) {
                    String type;
                    switch (focusChange) {
                        case AudioManager.AUDIOFOCUS_GAIN:
                            type = "gain";
                            break;
                        case AudioManager.AUDIOFOCUS_LOSS:
                            type = "loss";
                            focusRequested = false;
                            break;
                        case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT:
                            type = "transientLoss";
                            break;
                        case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK:
                            type = "canDuck";
                            break;
                        default:
                            return;
                    }
                    Log.d(TAG, "onAudioFocusChange: " + type);
                    notifyFocusChange(type);
                }
            };

    @Override
    public void load() {
        super.load();
        instance = this;
        audioManager = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        mainHandler = new Handler(Looper.getMainLooper());
        registerNoisyReceiver();
        Log.d(TAG, "AudioFocusPlugin loaded");
    }

    /**
     * 申请音频焦点（播放开始时由原生层调用）
     * @return true 表示已持有焦点，false 表示申请失败或插件未就绪
     */
    public boolean requestForPlayback() {
        if (audioManager == null) return false;
        if (focusRequested) return true;
        int result;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            AudioAttributes attributes = new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                    .build();
            focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                    .setAudioAttributes(attributes)
                    .setOnAudioFocusChangeListener(focusListener, mainHandler)
                    .build();
            result = audioManager.requestAudioFocus(focusRequest);
        } else {
            result = audioManager.requestAudioFocus(focusListener,
                    AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN);
        }
        focusRequested = result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
        Log.d(TAG, "requestForPlayback result=" + result);
        return focusRequested;
    }

    /**
     * 释放音频焦点（服务销毁或播放终止时由原生层调用）
     */
    public void abandonPlaybackFocus() {
        if (audioManager == null || !focusRequested) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && focusRequest != null) {
            audioManager.abandonAudioFocusRequest(focusRequest);
            focusRequest = null;
        } else {
            audioManager.abandonAudioFocus(focusListener);
        }
        focusRequested = false;
        Log.d(TAG, "abandonPlaybackFocus");
    }

    /**
     * 申请音频焦点（JS 侧调用入口）
     * @param call 插件调用，结果返回 granted 表示是否获得焦点
     */
    @PluginMethod
    public void requestFocus(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", requestForPlayback());
        call.resolve(ret);
    }

    /**
     * 释放音频焦点（JS 侧调用入口）
     * @param call 插件调用
     */
    @PluginMethod
    public void abandonFocus(PluginCall call) {
        abandonPlaybackFocus();
        call.resolve();
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
     * 向 WebView 侧转发焦点变化事件
     * @param type 焦点事件类型：gain | loss | transientLoss | canDuck
     */
    private void notifyFocusChange(final String type) {
        mainHandler.post(() -> {
            JSObject ret = new JSObject();
            ret.put("type", type);
            notifyListeners(EVENT_FOCUS_CHANGE, ret);
        });
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

    @Override
    protected void handleOnDestroy() {
        unregisterNoisyReceiver();
        abandonPlaybackFocus();
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
