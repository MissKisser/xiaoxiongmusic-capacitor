package com.xiaoxiong.music;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 桌面歌词插件，负责 Android 悬浮窗权限与浮窗生命周期。
 */
@CapacitorPlugin(name = "DesktopLyric")
public class DesktopLyricPlugin extends Plugin {
    private static final String TAG = "DesktopLyric";

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private DesktopLyricOverlay overlay;

    @Override
    public void load() {
        super.load();
        overlay = new DesktopLyricOverlay(getContext(), new DesktopLyricOverlay.Callback() {
            @Override
            public void onClose() {
                notifyClose();
            }

            @Override
            public void onConfigChanged(JSObject config) {
                notifyConfigChanged(config);
            }

            @Override
            public void onControlAction(String action) {
                notifyControlAction(action);
            }
        });
        Log.d(TAG, "DesktopLyricPlugin loaded");
    }

    @PluginMethod
    public void checkPermission(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", canDrawOverlays());
        call.resolve(ret);
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (!canDrawOverlays() && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            Intent intent = new Intent(
                    Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:" + getContext().getPackageName())
            );
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
        }

        JSObject ret = new JSObject();
        ret.put("granted", canDrawOverlays());
        call.resolve(ret);
    }

    @PluginMethod
    public void show(PluginCall call) {
        if (!canDrawOverlays()) {
            call.reject("桌面歌词需要显示在其他应用上层权限");
            return;
        }

        runOnMain(() -> {
            ensureOverlay().show();
            resolveSuccess(call);
        });
    }

    @PluginMethod
    public void hide(PluginCall call) {
        runOnMain(() -> {
            ensureOverlay().hide();
            resolveSuccess(call);
        });
    }

    @PluginMethod
    public void updateLyric(PluginCall call) {
        JSObject data = call.getData();
        runOnMain(() -> {
            ensureOverlay().updateLyric(data);
            resolveSuccess(call);
        });
    }

    @PluginMethod
    public void updateConfig(PluginCall call) {
        JSObject config = call.getData();
        runOnMain(() -> {
            ensureOverlay().updateConfig(config);
            resolveSuccess(call);
        });
    }

    @PluginMethod
    public void setLocked(PluginCall call) {
        boolean locked = call.getBoolean("locked", false);
        runOnMain(() -> {
            ensureOverlay().setLocked(locked);
            resolveSuccess(call);
        });
    }

    @Override
    protected void handleOnDestroy() {
        if (overlay != null) {
            runOnMain(() -> overlay.hide());
        }
        super.handleOnDestroy();
    }

    private DesktopLyricOverlay ensureOverlay() {
        if (overlay == null) {
            overlay = new DesktopLyricOverlay(getContext(), new DesktopLyricOverlay.Callback() {
                @Override
                public void onClose() {
                    notifyClose();
                }

                @Override
                public void onConfigChanged(JSObject config) {
                    notifyConfigChanged(config);
                }

                @Override
                public void onControlAction(String action) {
                    notifyControlAction(action);
                }
            });
        }
        return overlay;
    }

    private boolean canDrawOverlays() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(getContext());
    }

    private void notifyClose() {
        JSObject ret = new JSObject();
        ret.put("action", "close");
        notifyListeners("close", ret);
    }

    private void notifyConfigChanged(JSObject config) {
        notifyListeners("configChange", config);
    }

    private void notifyControlAction(String action) {
        JSObject ret = new JSObject();
        ret.put("action", action);
        notifyListeners("control", ret);
    }

    private void runOnMain(Runnable runnable) {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            runnable.run();
        } else {
            mainHandler.post(runnable);
        }
    }

    private void resolveSuccess(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("success", true);
        call.resolve(ret);
    }
}
