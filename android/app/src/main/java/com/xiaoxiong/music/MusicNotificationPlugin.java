package com.xiaoxiong.music;

import android.util.Log;
import android.content.Intent;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 音乐通知插件
 * 提供通知栏播放器功能
 */
@CapacitorPlugin(name = "MusicNotification")
public class MusicNotificationPlugin extends Plugin {
    private static final String TAG = "MusicService"; // 统一 TAG

    // 静态实例引用（供 MusicService 回调访问）
    private static MusicNotificationPlugin instance;

    public static MusicNotificationPlugin getInstance() {
        return instance;
    }

    @Override
    public void load() {
        super.load();
        instance = this;
        MusicControlReceiver.setPluginInstance(this); // 保持 Receiver 以便接收回调
        Log.e(TAG, "Plugin: loaded");
    }

    @PluginMethod
    public void initialize(PluginCall call) {
        startServiceCommand(MusicService.ACTION_INIT, null);
        call.resolve();
    }

    @PluginMethod
    public void updateMetadata(PluginCall call) {
        String title = call.getString("title");
        long duration = call.getLong("duration", -1L);
        Log.d(TAG, "Plugin: updateMetadata called. Title: " + title + ", Duration: " + duration);

        Intent intent = new Intent(getContext(), MusicService.class);
        intent.setAction(MusicService.ACTION_UPDATE_METADATA);
        intent.putExtra("title", title);
        intent.putExtra("artist", call.getString("artist"));
        intent.putExtra("album", call.getString("album"));
        intent.putExtra("coverUrl", call.getString("coverUrl"));
        intent.putExtra("duration", duration);
        getContext().startService(intent);
        call.resolve();
    }

    @PluginMethod
    public void updatePlaybackState(PluginCall call) {
        // Log.d(TAG, "Plugin: updatePlaybackState");
        Intent intent = new Intent(getContext(), MusicService.class);
        intent.setAction(MusicService.ACTION_UPDATE_STATE);
        intent.putExtra("isPlaying", call.getBoolean("isPlaying", false));
        getContext().startService(intent);
        call.resolve();
    }

    @PluginMethod
    public void updatePosition(PluginCall call) {
        int position = call.getInt("position", 0);
        long duration = call.getLong("duration", -1L);
        // 如果 getLong 失败，尝试 getInt
        if (duration == -1L) {
            int d = call.getInt("duration", -1);
            if (d != -1)
                duration = d;
        }

        // 不打印频繁的位置更新日志

        Intent intent = new Intent(getContext(), MusicService.class);
        intent.setAction(MusicService.ACTION_UPDATE_POSITION);
        intent.putExtra("position", position);
        intent.putExtra("duration", duration);
        getContext().startService(intent);
        call.resolve();
    }

    @PluginMethod
    public void destroy(PluginCall call) {
        startServiceCommand(MusicService.ACTION_DESTROY, null);
        call.resolve();
    }

    private void startServiceCommand(String action, JSObject data) {
        Intent intent = new Intent(getContext(), MusicService.class);
        intent.setAction(action);
        getContext().startService(intent);
    }

    // ====== [SleepTimer] 睡眠定时器接口 ======

    @PluginMethod
    public void setSleepTimer(PluginCall call) {
        // Capacitor 的 getLong 可能因 JS 传递的数字类型为 int 而返回 0，需兜底
        long timeMs = call.getLong("timeMs", 0L);
        if (timeMs == 0L) {
            int timeMsInt = call.getInt("timeMs", 0);
            if (timeMsInt > 0) timeMs = timeMsInt;
        }
        boolean waitSongEnd = call.getBoolean("waitSongEnd", false);

        Log.d(TAG, "[SleepTimer] Plugin: setSleepTimer, timeMs=" + timeMs + ", waitSongEnd=" + waitSongEnd);

        Intent intent = new Intent(getContext(), MusicService.class);
        intent.setAction(MusicService.ACTION_SET_SLEEP_TIMER);
        intent.putExtra("timeMs", timeMs);
        intent.putExtra("waitSongEnd", waitSongEnd);
        getContext().startService(intent);
        call.resolve();
    }

    @PluginMethod
    public void clearSleepTimer(PluginCall call) {
        Log.d(TAG, "[SleepTimer] Plugin: clearSleepTimer");

        Intent intent = new Intent(getContext(), MusicService.class);
        intent.setAction(MusicService.ACTION_CLEAR_SLEEP_TIMER);
        getContext().startService(intent);
        call.resolve();
    }

    /**
     * 通知前端睡眠定时器已触发
     * 由 MusicService 在定时器到期时调用
     */
    public void notifySleepTimerFinished() {
        Log.d(TAG, "[SleepTimer] Plugin: notifySleepTimerFinished -> 发送事件到前端");
        JSObject ret = new JSObject();
        ret.put("action", "sleepTimerFinished");
        notifyListeners("sleepTimerFinished", ret);
    }

    // 保持原来的事件通知方法不变 (notifyPlayEvent 等)，因为 Receiver 还会调用它们
    public void notifyPlayEvent() {
        JSObject ret = new JSObject();
        ret.put("action", "play");
        notifyListeners("play", ret);
    }

    public void notifyPauseEvent() {
        JSObject ret = new JSObject();
        ret.put("action", "pause");
        notifyListeners("pause", ret);
    }

    public void notifyNextEvent() {
        JSObject ret = new JSObject();
        ret.put("action", "next");
        notifyListeners("next", ret);
    }

    public void notifyPreviousEvent() {
        JSObject ret = new JSObject();
        ret.put("action", "previous");
        notifyListeners("previous", ret);
    }

    public void notifySeekEvent(long positionMs) {
        Log.d(TAG, "Plugin: notifySeekEvent - " + positionMs + "ms");
        JSObject ret = new JSObject();
        ret.put("action", "seek");
        ret.put("position", positionMs); // 毫秒
        notifyListeners("seek", ret);
    }

    @Override
    protected void handleOnDestroy() {
        startServiceCommand(MusicService.ACTION_DESTROY, null);
        super.handleOnDestroy();
    }
}
