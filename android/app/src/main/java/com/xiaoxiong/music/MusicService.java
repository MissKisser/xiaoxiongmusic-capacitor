package com.xiaoxiong.music;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import android.util.Log;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.media.app.NotificationCompat.MediaStyle;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

public class MusicService extends Service {
    private static final String TAG = "MusicService";
    // 升级 Channel ID 以确保重要性设置生效
    private static final String CHANNEL_ID = "music_service_channel_v2";
    private static final int NOTIFICATION_ID = 1001;

    // 静态实例引用（供 AudioCachePlugin 访问）
    private static MusicService instance;

    public static MusicService getInstance() {
        return instance;
    }

    public AudioProxyServer getAudioProxyServer() {
        return audioProxyServer;
    }

    public static final String ACTION_INIT = "com.xiaoxiong.music.INIT";
    public static final String ACTION_UPDATE_METADATA = "com.xiaoxiong.music.UPDATE_METADATA";
    public static final String ACTION_UPDATE_STATE = "com.xiaoxiong.music.UPDATE_STATE";
    public static final String ACTION_UPDATE_POSITION = "com.xiaoxiong.music.UPDATE_POSITION";
    public static final String ACTION_DESTROY = "com.xiaoxiong.music.DESTROY";
    public static final String ACTION_SET_SLEEP_TIMER = "com.xiaoxiong.music.SET_SLEEP_TIMER";
    public static final String ACTION_CLEAR_SLEEP_TIMER = "com.xiaoxiong.music.CLEAR_SLEEP_TIMER";

    private MediaSessionCompat mediaSession;
    private AudioProxyServer audioProxyServer;

    // 当前状态
    private String currentTitle = "未知歌曲";
    private String currentArtist = "未知艺术家";
    private String currentAlbum = "";
    private Bitmap coverBitmap = null;
    private boolean isPlaying = false;
    private long currentDuration = -1; // 新增时长字段

    // ====== [SleepTimer] 睡眠定时器相关 ======
    private Handler sleepTimerHandler;
    private Runnable sleepTimerRunnable;
    private boolean sleepTimerWaitSongEnd = false;

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        Log.d(TAG, "onCreate: Service created");
        sleepTimerHandler = new Handler(Looper.getMainLooper());
        createNotificationChannel();
        createMediaSession();
        startAudioProxyServer();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // 关键修复：Android 8.0+ 要求前台服务启动后5秒内必须调用 startForeground
        if (intent != null && ACTION_INIT.equals(intent.getAction())) {
            startForegroundWithNotification();
        }

        if (intent == null)
            return START_NOT_STICKY;

        String action = intent.getAction();
        // Log.d(TAG, "onStartCommand: " + action);

        // 强制确保前台状态 (兜底)
        try {
            // startForegroundWithNotification();
        } catch (Exception e) {
            Log.e(TAG, "Quick fg error", e);
        }

        if (action != null) {
            switch (action) {
                case ACTION_INIT:
                    startForegroundWithNotification();
                    break;
                case ACTION_UPDATE_METADATA:
                    handleUpdateMetadata(intent);
                    break;
                case ACTION_UPDATE_STATE:
                    handleUpdateState(intent);
                    break;
                case ACTION_UPDATE_POSITION:
                    handleUpdatePosition(intent);
                    break;
                case ACTION_DESTROY:
                    stopForeground(true);
                    stopSelf();
                    break;
                case ACTION_SET_SLEEP_TIMER:
                    handleSetSleepTimer(intent);
                    break;
                case ACTION_CLEAR_SLEEP_TIMER:
                    handleClearSleepTimer();
                    break;
            }
        }

        return START_NOT_STICKY;
    }

    private void handleUpdateMetadata(Intent intent) {
        String title = intent.getStringExtra("title");
        String artist = intent.getStringExtra("artist");
        String album = intent.getStringExtra("album");
        String coverUrl = intent.getStringExtra("coverUrl");
        long duration = intent.getLongExtra("duration", -1); // 获取时长

        this.currentTitle = title != null ? title : "未知歌曲";
        this.currentArtist = artist != null ? artist : "未知艺术家";
        this.currentAlbum = album != null ? album : "";

        if (duration > 0) {
            this.currentDuration = duration * 1000L; // 前端传的是秒，转毫秒
        }

        Log.d(TAG, "Service: handleUpdateMetadata. Title: " + currentTitle + ", Duration(ms): " + currentDuration);

        // 更新 MediaSession + Notification
        updateMediaSessionMetadata();
        updateNotification();

        // 异步加载封面
        if (coverUrl != null && !coverUrl.isEmpty()) {
            loadCoverAsync(coverUrl);
        } else {
            coverBitmap = null;
            updateNotification();
        }
    }

    private void handleUpdateState(Intent intent) {
        this.isPlaying = intent.getBooleanExtra("isPlaying", false);
        Log.d(TAG, "Updating state, isPlaying: " + isPlaying);
        updatePlaybackState(isPlaying);
        updateNotification();
    }

    private void handleUpdatePosition(Intent intent) {
        int position = intent.getIntExtra("position", 0);
        long duration = intent.getLongExtra("duration", -1);

        if (duration > 0) {
            long newDuration = duration * 1000L;
            if (newDuration != this.currentDuration) {
                Log.d(TAG, "Service: Updating duration from " + this.currentDuration + " to " + newDuration);
                this.currentDuration = newDuration;
                updateMediaSessionMetadata(); // 时长变了，刷新 Metadata
            }
        }

        // 更新 MediaSession 进度
        updatePlaybackState(this.isPlaying, position * 1000L);
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "音乐服务",
                    // 提升权重：从 LOW 改为 DEFAULT，以解决 OPPO/Vivo 等设备不显示通知的问题
                    NotificationManager.IMPORTANCE_DEFAULT);
            channel.setDescription("音乐播放服务通知");
            channel.setShowBadge(false);
            channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            // 设置静音，避免每次切歌都发出提示音，但保持高可见性
            channel.setSound(null, null);

            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }

    private void createMediaSession() {
        mediaSession = new MediaSessionCompat(this, "MusicService");
        mediaSession.setFlags(
                MediaSessionCompat.FLAG_HANDLES_MEDIA_BUTTONS |
                        MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS);

        mediaSession.setCallback(new MediaSessionCompat.Callback() {
            @Override
            public void onPlay() {
                Log.d(TAG, "MediaSession: onPlay");
                sendBroadcastCompat(MusicControlReceiver.ACTION_PLAY);
            }

            @Override
            public void onPause() {
                Log.d(TAG, "MediaSession: onPause");
                sendBroadcastCompat(MusicControlReceiver.ACTION_PAUSE);
            }

            @Override
            public void onSkipToNext() {
                Log.d(TAG, "MediaSession: onSkipToNext");
                sendBroadcastCompat(MusicControlReceiver.ACTION_NEXT);
            }

            @Override
            public void onSkipToPrevious() {
                Log.d(TAG, "MediaSession: onSkipToPrevious");
                sendBroadcastCompat(MusicControlReceiver.ACTION_PREVIOUS);
            }

            @Override
            public void onSeekTo(long posMs) {
                Log.d(TAG, "MediaSession: onSeekTo - " + posMs + "ms");
                sendSeekBroadcast(posMs);
            }
        });
        mediaSession.setActive(true);
    }

    private void sendBroadcastCompat(String action) {
        Intent intent = new Intent(this, MusicControlReceiver.class);
        intent.setAction(action);
        sendBroadcast(intent);
    }

    private void sendSeekBroadcast(long posMs) {
        Intent intent = new Intent(this, MusicControlReceiver.class);
        intent.setAction(MusicControlReceiver.ACTION_SEEK);
        intent.putExtra("position", posMs);
        sendBroadcast(intent);
    }

    private void updateMediaSessionMetadata() {
        MediaMetadataCompat.Builder builder = new MediaMetadataCompat.Builder()
                .putString(MediaMetadataCompat.METADATA_KEY_TITLE, currentTitle)
                .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, currentArtist)
                .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, currentAlbum);

        if (currentDuration > 0) {
            builder.putLong(MediaMetadataCompat.METADATA_KEY_DURATION, currentDuration);
            Log.d(TAG, "Service: putLong DURATION: " + currentDuration);
        } else {
            Log.d(TAG, "Service: DURATION is invalid: " + currentDuration);
        }

        if (coverBitmap != null) {
            builder.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, coverBitmap);
        }

        mediaSession.setMetadata(builder.build());
    }

    private void updatePlaybackState(boolean isPlaying) {
        updatePlaybackState(isPlaying, PlaybackStateCompat.PLAYBACK_POSITION_UNKNOWN);
    }

    private void updatePlaybackState(boolean isPlaying, long positionMs) {
        int state = isPlaying ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED;

        // 添加所有支持的播放控制动作，包括进度条跳转
        long actions = PlaybackStateCompat.ACTION_PLAY
                | PlaybackStateCompat.ACTION_PAUSE
                | PlaybackStateCompat.ACTION_SKIP_TO_NEXT
                | PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS
                | PlaybackStateCompat.ACTION_SEEK_TO; // 关键：添加 SEEK_TO 支持

        PlaybackStateCompat.Builder builder = new PlaybackStateCompat.Builder()
                .setActions(actions)
                .setState(state, positionMs, isPlaying ? 1.0f : 0.0f);

        mediaSession.setPlaybackState(builder.build());
    }

    private void startForegroundWithNotification() {
        Log.d(TAG, "Attempting startForeground...");
        Notification notification = buildNotification();
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ServiceCompat.startForeground(this, NOTIFICATION_ID, notification,
                        Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
                                ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
                                : 0);
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }
            Log.d(TAG, "✅ startForeground SUCCESS");
        } catch (Exception e) {
            Log.e(TAG, "❌ Failed to start foreground", e);
        }
    }

    private void updateNotification() {
        Log.d(TAG, "updateNotification called. Title: " + currentTitle);
        try {
            Notification notification = buildNotification();
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.notify(NOTIFICATION_ID, notification);
                Log.d(TAG, "✅ NotificationManager.notify called");
            } else {
                Log.e(TAG, "❌ NotificationManager is null");
            }
        } catch (Exception e) {
            Log.e(TAG, "❌ Failed to update notification", e);
        }
    }

    private Notification buildNotification() {
        Intent intent = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent contentIntent = PendingIntent.getActivity(this, 0, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        NotificationCompat.Action playPauseAction = isPlaying
                ? createAction(R.drawable.ic_pause, "暂停", MusicControlReceiver.ACTION_PAUSE)
                : createAction(R.drawable.ic_play, "播放", MusicControlReceiver.ACTION_PLAY);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(currentTitle)
                .setContentText(currentArtist)
                .setSubText(currentAlbum)
                .setContentIntent(contentIntent)
                .setOngoing(true)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
                .addAction(createAction(R.drawable.ic_skip_previous, "上一首", MusicControlReceiver.ACTION_PREVIOUS))
                .addAction(playPauseAction)
                .addAction(createAction(R.drawable.ic_skip_next, "下一首", MusicControlReceiver.ACTION_NEXT))
                .setStyle(new MediaStyle()
                        .setMediaSession(mediaSession.getSessionToken())
                        .setShowActionsInCompactView(0, 1, 2));

        if (coverBitmap != null) {
            builder.setLargeIcon(coverBitmap);
        }

        return builder.build();
    }

    private NotificationCompat.Action createAction(int icon, String title, String action) {
        Intent intent = new Intent(this, MusicControlReceiver.class);
        intent.setAction(action);
        PendingIntent pendingIntent = PendingIntent.getBroadcast(this, action.hashCode(), intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new NotificationCompat.Action.Builder(icon, title, pendingIntent).build();
    }

    private void loadCoverAsync(final String url) {
        new Thread(() -> {
            try {
                URL u = new URL(url);
                HttpURLConnection c = (HttpURLConnection) u.openConnection();
                c.setDoInput(true);
                c.connect();
                InputStream i = c.getInputStream();
                Bitmap bitmap = BitmapFactory.decodeStream(i);
                if (bitmap != null) {
                    coverBitmap = bitmap;
                    updateNotification();
                    updateMediaSessionMetadata();
                }
            } catch (Exception e) {
                Log.e(TAG, "Failed to load cover", e);
            }
        }).start();
    }

    @Override
    public void onDestroy() {
        instance = null;
        handleClearSleepTimer(); // 清理睡眠定时器
        stopAudioProxyServer();
        if (mediaSession != null) {
            mediaSession.setActive(false);
            mediaSession.release();
        }
        super.onDestroy();
    }

    // ====== [SleepTimer] 睡眠定时器处理 ======

    /**
     * 设置睡眠定时器
     * @param intent 携带 timeMs(long) 和 waitSongEnd(boolean) 参数
     */
    private void handleSetSleepTimer(Intent intent) {
        long timeMs = intent.getLongExtra("timeMs", 0);
        boolean waitSongEnd = intent.getBooleanExtra("waitSongEnd", false);

        if (timeMs <= 0) {
            Log.w(TAG, "[SleepTimer] 无效的定时时长: " + timeMs);
            return;
        }

        // 先清除已有的定时任务
        handleClearSleepTimer();

        this.sleepTimerWaitSongEnd = waitSongEnd;

        sleepTimerRunnable = () -> {
            Log.d(TAG, "[SleepTimer] ⏰ 定时时间到！waitSongEnd=" + sleepTimerWaitSongEnd);

            if (sleepTimerWaitSongEnd) {
                // 等待当前歌曲播放完：通知前端标记
                Log.d(TAG, "[SleepTimer] 通知前端等待当前歌曲播放完再暂停");
                MusicNotificationPlugin pluginInstance = MusicNotificationPlugin.getInstance();
                if (pluginInstance != null) {
                    pluginInstance.notifySleepTimerFinished();
                } else {
                    // 兜底：如果插件实例不可用，直接暂停
                    Log.w(TAG, "[SleepTimer] 插件实例不可用，直接执行暂停");
                    sendBroadcastCompat(MusicControlReceiver.ACTION_PAUSE);
                }
            } else {
                // 立即暂停
                Log.d(TAG, "[SleepTimer] 立即执行暂停播放");
                sendBroadcastCompat(MusicControlReceiver.ACTION_PAUSE);
                // 通知前端定时器已结束（用于清理 UI 状态）
                MusicNotificationPlugin pluginInstance = MusicNotificationPlugin.getInstance();
                if (pluginInstance != null) {
                    pluginInstance.notifySleepTimerFinished();
                }
            }

            // 清理自身引用
            sleepTimerRunnable = null;
        };

        sleepTimerHandler.postDelayed(sleepTimerRunnable, timeMs);
        Log.d(TAG, "[SleepTimer] ✅ 定时器已设置: " + (timeMs / 1000) + "秒后触发, waitSongEnd=" + waitSongEnd);
    }

    /**
     * 清除睡眠定时器
     */
    private void handleClearSleepTimer() {
        if (sleepTimerRunnable != null) {
            sleepTimerHandler.removeCallbacks(sleepTimerRunnable);
            sleepTimerRunnable = null;
            Log.d(TAG, "[SleepTimer] 🗑️ 定时器已清除");
        }
        sleepTimerWaitSongEnd = false;
    }

    /**
     * 启动本地音频代理服务器
     */
    private void startAudioProxyServer() {
        try {
            audioProxyServer = new AudioProxyServer(this);
            audioProxyServer.start();
            Log.d(TAG, "✅ 音频代理服务器已启动 (端口 18520)");
        } catch (Exception e) {
            Log.e(TAG, "❌ 音频代理服务器启动失败", e);
        }
    }

    /**
     * 停止本地音频代理服务器
     */
    private void stopAudioProxyServer() {
        if (audioProxyServer != null) {
            audioProxyServer.stop();
            audioProxyServer = null;
            Log.d(TAG, "音频代理服务器已停止");
        }
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
