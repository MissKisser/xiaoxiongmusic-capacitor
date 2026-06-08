package com.xiaoxiong.music;

import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import com.getcapacitor.JSObject;

/**
 * Android 桌面歌词浮窗视图管理。
 */
class DesktopLyricOverlay {
    interface Callback {
        void onClose();

        void onConfigChanged(JSObject config);

        void onControlAction(String action);
    }

    private static final String PREFS_NAME = "desktop_lyric_overlay";
    private static final String KEY_X = "x";
    private static final String KEY_Y = "y";
    private static final String LOCK_ICON = "\uD83D\uDD12";

    private final Context context;
    private final WindowManager windowManager;
    private final SharedPreferences prefs;
    private final Callback callback;
    private final Handler handler = new Handler(Looper.getMainLooper());

    private LinearLayout rootView;
    private LinearLayout lyricArea;
    private LinearLayout controlBar;
    private LinearLayout actionBar;
    private LinearLayout colorPanel;
    private TextView titleView;
    private TextView primaryView;
    private TextView secondaryView;
    private TextView lockButton;
    private TextView playPauseButton;
    private WindowManager.LayoutParams layoutParams;

    private boolean showing = false;
    private boolean locked = false;
    private boolean controlsVisible = false;
    private boolean colorPanelVisible = false;
    private boolean limitBounds = false;
    private boolean alwaysShowPlayInfo = false;
    private boolean isPlaying = false;
    private boolean dragging = false;

    private int downX = 0;
    private int downY = 0;
    private int startX = 0;
    private int startY = 0;

    private String titleText = "";
    private String playedColor = "#fe7971";
    private String unplayedColor = "#cccccc";
    private String shadowColor = "rgba(0, 0, 0, 0.5)";
    private String backgroundMaskColor = "rgba(0, 0, 0, 0.5)";
    private int fontSize = 24;
    private int fontWeight = 400;
    private String position = "both";

    DesktopLyricOverlay(Context context, Callback callback) {
        this.context = context.getApplicationContext();
        this.windowManager = (WindowManager) this.context.getSystemService(Context.WINDOW_SERVICE);
        this.prefs = this.context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        this.callback = callback;
    }

    void show() {
        if (showing) {
            applyConfig();
            return;
        }
        ensureView();
        ensureLayoutParams();
        windowManager.addView(rootView, layoutParams);
        showing = true;
        applyConfig();
    }

    void hide() {
        if (!showing || rootView == null) return;
        handler.removeCallbacksAndMessages(null);
        windowManager.removeView(rootView);
        showing = false;
        controlsVisible = false;
        colorPanelVisible = false;
    }

    boolean isShowing() {
        return showing;
    }

    void updateLyric(JSObject data) {
        ensureView();
        String title = data.optString("title", "");
        String artist = data.optString("artist", "");
        String primary = data.optString("primaryText", "");
        String secondary = data.optString("secondaryText", "");
        isPlaying = data.optBoolean("isPlaying", isPlaying);

        titleText = title;
        if (!artist.isEmpty()) {
            titleText = title.isEmpty() ? artist : title + " - " + artist;
        }

        titleView.setText(titleText);
        primaryView.setText(primary);
        secondaryView.setText(secondary);
        secondaryView.setVisibility(secondary.isEmpty() ? View.GONE : View.VISIBLE);
        updateInfoVisibility();
        updateControlBarVisibility();
    }

    void updateConfig(JSObject config) {
        locked = config.optBoolean("isLock", locked);
        playedColor = config.optString("playedColor", playedColor);
        unplayedColor = config.optString("unplayedColor", unplayedColor);
        shadowColor = config.optString("shadowColor", shadowColor);
        backgroundMaskColor = config.optString("backgroundMaskColor", backgroundMaskColor);
        fontSize = clamp(config.optInt("fontSize", fontSize), 16, 72);
        fontWeight = clamp(config.optInt("fontWeight", fontWeight), 100, 900);
        position = config.optString("position", position);
        limitBounds = config.optBoolean("limitBounds", limitBounds);
        alwaysShowPlayInfo = config.optBoolean("alwaysShowPlayInfo", alwaysShowPlayInfo);
        if (locked) {
            controlsVisible = false;
            colorPanelVisible = false;
        }
        applyConfig();
    }

    void setLocked(boolean locked) {
        this.locked = locked;
        if (locked) {
            controlsVisible = false;
            colorPanelVisible = false;
        }
        applyConfig();
    }

    private void ensureView() {
        if (rootView != null) return;

        rootView = new LinearLayout(context);
        rootView.setOrientation(LinearLayout.VERTICAL);
        rootView.setPadding(dp(12), dp(10), dp(12), dp(10));

        lyricArea = new LinearLayout(context);
        lyricArea.setOrientation(LinearLayout.VERTICAL);
        lyricArea.setPadding(0, 0, 0, dp(6));
        lyricArea.setOnTouchListener(this::handleLyricTouch);

        titleView = new TextView(context);
        titleView.setSingleLine(true);
        titleView.setTextColor(Color.WHITE);
        titleView.setTextSize(12);
        titleView.setAlpha(0.78f);
        titleView.setPadding(0, 0, 0, dp(4));

        primaryView = createLyricTextView();
        secondaryView = createLyricTextView();

        lyricArea.addView(titleView, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
        ));
        lyricArea.addView(primaryView, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
        ));
        lyricArea.addView(secondaryView, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
        ));

        controlBar = createControlBar();

        rootView.addView(controlBar, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
        ));
        rootView.addView(lyricArea, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
        ));
    }

    private TextView createLyricTextView() {
        TextView textView = new TextView(context);
        textView.setSingleLine(true);
        textView.setEllipsize(TextUtils.TruncateAt.MARQUEE);
        textView.setMarqueeRepeatLimit(-1);
        textView.setSelected(true);
        textView.setIncludeFontPadding(false);
        textView.setPadding(0, dp(3), 0, dp(3));
        return textView;
    }

    private LinearLayout createControlBar() {
        LinearLayout bar = new LinearLayout(context);
        bar.setOrientation(LinearLayout.VERTICAL);
        bar.setGravity(Gravity.CENTER);
        bar.setPadding(dp(6), dp(5), dp(6), dp(5));
        bar.setBackgroundColor(Color.TRANSPARENT);

        actionBar = new LinearLayout(context);
        actionBar.setOrientation(LinearLayout.HORIZONTAL);
        actionBar.setGravity(Gravity.CENTER);

        actionBar.addView(createTextButton("⏮", () -> notifyControlAction("previous")));
        playPauseButton = createTextButton("⏯", () -> notifyControlAction("playPause"));
        actionBar.addView(playPauseButton);
        actionBar.addView(createTextButton("⏭", () -> notifyControlAction("next")));
        actionBar.addView(createTextButton("A-", () -> adjustFontSize(-2)));
        actionBar.addView(createTextButton("A+", () -> adjustFontSize(2)));
        actionBar.addView(createTextButton("色", this::toggleColorPanel));

        lockButton = createTextButton(LOCK_ICON, () -> {
            int beforeInset = getPrimaryTopInset(controlsVisible, colorPanelVisible);
            locked = true;
            controlsVisible = false;
            colorPanelVisible = false;
            int afterInset = getPrimaryTopInset(controlsVisible, colorPanelVisible);
            keepPrimaryPosition(beforeInset, afterInset);
            notifyConfigChanged();
            applyConfig();
            showToast("桌面歌词已锁定");
        });
        actionBar.addView(lockButton);
        actionBar.addView(createTextButton("×", () -> {
            hide();
            if (callback != null) callback.onClose();
            showToast("桌面歌词已关闭");
        }));

        colorPanel = new LinearLayout(context);
        colorPanel.setOrientation(LinearLayout.HORIZONTAL);
        colorPanel.setGravity(Gravity.CENTER);
        colorPanel.setPadding(0, dp(6), 0, 0);
        colorPanel.addView(createColorButton("#fe7971", () -> applyColorPreset("#fe7971", "#f2f2f2")));
        colorPanel.addView(createColorButton("#4fc3ff", () -> applyColorPreset("#4fc3ff", "#f2f2f2")));
        colorPanel.addView(createColorButton("#ffd166", () -> applyColorPreset("#ffd166", "#f2f2f2")));
        colorPanel.addView(createColorButton("#ffffff", () -> applyColorPreset("#ffffff", "#dddddd")));

        bar.addView(actionBar, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
        ));
        bar.addView(colorPanel, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
        ));
        return bar;
    }

    private TextView createTextButton(String text, Runnable action) {
        TextView button = new TextView(context);
        button.setText(text);
        button.setTextColor(Color.WHITE);
        button.setTextSize(13);
        button.setGravity(Gravity.CENTER);
        button.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        button.setPadding(dp(7), dp(5), dp(7), dp(5));
        button.setOnClickListener((view) -> action.run());
        button.setMinWidth(dp(34));

        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
        );
        params.setMargins(dp(1), 0, dp(1), 0);
        button.setLayoutParams(params);
        return button;
    }

    private TextView createColorButton(String color, Runnable action) {
        TextView button = new TextView(context);
        button.setText("");
        button.setGravity(Gravity.CENTER);
        button.setOnClickListener((view) -> action.run());

        GradientDrawable background = new GradientDrawable();
        background.setShape(GradientDrawable.OVAL);
        background.setColor(parseColor(color, Color.WHITE));
        background.setStroke(dp(1), 0x99FFFFFF);
        button.setBackground(background);

        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(dp(24), dp(24));
        params.setMargins(dp(5), 0, dp(5), 0);
        button.setLayoutParams(params);
        return button;
    }

    private void adjustFontSize(int delta) {
        fontSize = clamp(fontSize + delta, 16, 72);
        notifyConfigChanged();
        applyConfig();
        showToast("桌面歌词字号 " + fontSize + "px");
    }

    private void applyColorPreset(String primary, String secondary) {
        int beforeInset = getPrimaryTopInset(controlsVisible, colorPanelVisible);
        playedColor = primary;
        unplayedColor = secondary;
        shadowColor = "rgba(0, 0, 0, 0.65)";
        colorPanelVisible = false;
        int afterInset = getPrimaryTopInset(controlsVisible, colorPanelVisible);
        keepPrimaryPosition(beforeInset, afterInset);
        notifyConfigChanged();
        applyConfig();
        showToast("已切换桌面歌词颜色");
    }

    private void toggleColorPanel() {
        int beforeInset = getPrimaryTopInset(controlsVisible, colorPanelVisible);
        colorPanelVisible = !colorPanelVisible;
        int afterInset = getPrimaryTopInset(controlsVisible, colorPanelVisible);
        keepPrimaryPosition(beforeInset, afterInset);
        applyConfig();
        showToast(colorPanelVisible ? "已展开颜色预设" : "已收起颜色预设");
    }

    private void notifyControlAction(String action) {
        if (callback != null) callback.onControlAction(action);
        if ("previous".equals(action)) {
            showToast("上一曲");
        } else if ("next".equals(action)) {
            showToast("下一曲");
        } else {
            showToast("已切换播放状态");
        }
    }

    private void notifyConfigChanged() {
        if (callback == null) return;
        JSObject config = new JSObject();
        config.put("isLock", locked);
        config.put("playedColor", playedColor);
        config.put("unplayedColor", unplayedColor);
        config.put("shadowColor", shadowColor);
        config.put("fontSize", fontSize);
        callback.onConfigChanged(config);
    }

    private void ensureLayoutParams() {
        if (layoutParams != null) return;

        int screenWidth = context.getResources().getDisplayMetrics().widthPixels;
        int width = Math.round(screenWidth * 0.92f);
        int defaultX = Math.max(0, (screenWidth - width) / 2);

        layoutParams = new WindowManager.LayoutParams(
                width,
                WindowManager.LayoutParams.WRAP_CONTENT,
                windowType(),
                baseFlags(),
                PixelFormat.TRANSLUCENT
        );
        layoutParams.gravity = Gravity.TOP | Gravity.START;
        layoutParams.x = prefs.getInt(KEY_X, defaultX);
        layoutParams.y = prefs.getInt(KEY_Y, dp(96));
    }

    private int windowType() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            return WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY;
        }
        return WindowManager.LayoutParams.TYPE_PHONE;
    }

    private int baseFlags() {
        int flags = WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
                | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS;
        if (locked) flags |= WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE;
        return flags;
    }

    private void applyConfig() {
        ensureView();
        ensureLayoutParams();

        if (locked) controlsVisible = false;
        layoutParams.flags = baseFlags();

        GradientDrawable background = new GradientDrawable();
        background.setCornerRadius(dp(8));
        int backgroundColor = controlsVisible ? parseColor(backgroundMaskColor, 0x99000000) : Color.TRANSPARENT;
        background.setColor(backgroundColor);
        rootView.setBackground(background);

        int primaryColor = parseColor(playedColor, Color.WHITE);
        int secondaryColor = parseColor(unplayedColor, Color.LTGRAY);
        int parsedShadowColor = parseColor(shadowColor, 0x99000000);
        int style = fontWeight >= 600 ? Typeface.BOLD : Typeface.NORMAL;

        primaryView.setTextColor(primaryColor);
        primaryView.setTextSize(fontSize);
        primaryView.setTypeface(Typeface.DEFAULT, style);
        primaryView.setShadowLayer(dp(2), 0, 0, parsedShadowColor);

        secondaryView.setTextColor(secondaryColor);
        secondaryView.setTextSize(Math.max(12, Math.round(fontSize * 0.72f)));
        secondaryView.setTypeface(Typeface.DEFAULT, style);
        secondaryView.setShadowLayer(dp(2), 0, 0, parsedShadowColor);

        titleView.setShadowLayer(dp(2), 0, 0, parsedShadowColor);
        applyGravity();
        updateInfoVisibility();
        updateControlBarVisibility();

        if (showing) {
            clampToScreen();
            windowManager.updateViewLayout(rootView, layoutParams);
        }
    }

    private void applyGravity() {
        int primaryGravity = Gravity.START;
        int secondaryGravity = Gravity.START;

        if ("center".equals(position)) {
            primaryGravity = Gravity.CENTER;
            secondaryGravity = Gravity.CENTER;
        } else if ("right".equals(position)) {
            primaryGravity = Gravity.END;
            secondaryGravity = Gravity.END;
        } else if ("both".equals(position)) {
            primaryGravity = Gravity.START;
            secondaryGravity = Gravity.END;
        }

        titleView.setGravity(primaryGravity);
        primaryView.setGravity(primaryGravity);
        secondaryView.setGravity(secondaryGravity);
    }

    private void updateInfoVisibility() {
        if (titleView == null) return;
        boolean showInfo = (alwaysShowPlayInfo || controlsVisible) && titleText != null && !titleText.isEmpty();
        titleView.setVisibility(showInfo ? View.VISIBLE : View.GONE);
    }

    private void updateControlBarVisibility() {
        if (controlBar == null) return;
        controlBar.setVisibility(!locked && controlsVisible ? View.VISIBLE : View.GONE);
        if (colorPanel != null) {
            colorPanel.setVisibility(!locked && controlsVisible && colorPanelVisible ? View.VISIBLE : View.GONE);
        }
        if (lockButton != null) lockButton.setText(LOCK_ICON);
        if (playPauseButton != null) playPauseButton.setText(isPlaying ? "⏸" : "▶");
    }

    private void setControlsVisible(boolean visible) {
        int beforeInset = getPrimaryTopInset(controlsVisible, colorPanelVisible);
        controlsVisible = !locked && visible;
        if (!controlsVisible) colorPanelVisible = false;
        int afterInset = getPrimaryTopInset(controlsVisible, colorPanelVisible);
        keepPrimaryPosition(beforeInset, afterInset);
        handler.removeCallbacksAndMessages(null);
        applyConfig();
        if (controlsVisible) {
            handler.postDelayed(() -> {
                int hideBeforeInset = getPrimaryTopInset(controlsVisible, colorPanelVisible);
                controlsVisible = false;
                colorPanelVisible = false;
                int hideAfterInset = getPrimaryTopInset(controlsVisible, colorPanelVisible);
                keepPrimaryPosition(hideBeforeInset, hideAfterInset);
                applyConfig();
            }, 3500);
        }
    }

    private int getPrimaryTopInset(boolean controlsVisible, boolean colorPanelVisible) {
        ensureView();
        ensureLayoutParams();

        int inset = rootView.getPaddingTop();
        if (!locked && controlsVisible) {
            inset += measureViewHeight(actionBar);
            if (colorPanelVisible) inset += measureViewHeight(colorPanel);
        }
        if (shouldShowInfo(controlsVisible)) inset += measureViewHeight(titleView);
        return inset;
    }

    private boolean shouldShowInfo(boolean controlsVisible) {
        return (alwaysShowPlayInfo || controlsVisible) && titleText != null && !titleText.isEmpty();
    }

    private int measureViewHeight(View view) {
        if (view == null || rootView == null) return 0;
        int width = layoutParams == null
                ? Math.round(context.getResources().getDisplayMetrics().widthPixels * 0.92f)
                : layoutParams.width;
        int contentWidth = Math.max(0, width - rootView.getPaddingLeft() - rootView.getPaddingRight());
        int originalVisibility = view.getVisibility();
        view.setVisibility(View.VISIBLE);
        view.measure(
                View.MeasureSpec.makeMeasureSpec(contentWidth, View.MeasureSpec.AT_MOST),
                View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED)
        );
        view.setVisibility(originalVisibility);
        return view.getMeasuredHeight();
    }

    private void keepPrimaryPosition(int beforeInset, int afterInset) {
        ensureLayoutParams();
        layoutParams.y -= afterInset - beforeInset;
    }

    private boolean handleLyricTouch(View view, MotionEvent event) {
        if (locked || layoutParams == null) return false;
        switch (event.getAction()) {
            case MotionEvent.ACTION_DOWN:
                downX = Math.round(event.getRawX());
                downY = Math.round(event.getRawY());
                startX = layoutParams.x;
                startY = layoutParams.y;
                dragging = false;
                return true;
            case MotionEvent.ACTION_MOVE:
                int deltaX = Math.round(event.getRawX()) - downX;
                int deltaY = Math.round(event.getRawY()) - downY;
                if (Math.abs(deltaX) > dp(5) || Math.abs(deltaY) > dp(5)) {
                    dragging = true;
                    layoutParams.x = startX + deltaX;
                    layoutParams.y = startY + deltaY;
                    if (limitBounds) clampToScreen();
                    if (showing) windowManager.updateViewLayout(rootView, layoutParams);
                }
                return true;
            case MotionEvent.ACTION_UP:
            case MotionEvent.ACTION_CANCEL:
                if (dragging) {
                    if (limitBounds) clampToScreen();
                    prefs.edit()
                            .putInt(KEY_X, layoutParams.x)
                            .putInt(KEY_Y, layoutParams.y)
                            .apply();
                } else {
                    setControlsVisible(!controlsVisible);
                    if (controlsVisible) showToast("已显示桌面歌词工具栏");
                }
                return true;
            default:
                return false;
        }
    }

    private void clampToScreen() {
        if (!limitBounds || layoutParams == null) return;
        int screenWidth = context.getResources().getDisplayMetrics().widthPixels;
        int screenHeight = context.getResources().getDisplayMetrics().heightPixels;
        int viewHeight = rootView == null || rootView.getHeight() <= 0 ? dp(96) : rootView.getHeight();
        int maxX = Math.max(0, screenWidth - layoutParams.width);
        int maxY = Math.max(0, screenHeight - viewHeight);
        layoutParams.x = clamp(layoutParams.x, 0, maxX);
        layoutParams.y = clamp(layoutParams.y, 0, maxY);
    }

    private int parseColor(String value, int fallback) {
        if (value == null || value.trim().isEmpty()) return fallback;
        String color = value.trim();
        try {
            if (color.startsWith("rgba")) {
                String content = color.substring(color.indexOf('(') + 1, color.lastIndexOf(')'));
                String[] parts = content.split(",");
                if (parts.length >= 4) {
                    int r = clamp(Math.round(Float.parseFloat(parts[0].trim())), 0, 255);
                    int g = clamp(Math.round(Float.parseFloat(parts[1].trim())), 0, 255);
                    int b = clamp(Math.round(Float.parseFloat(parts[2].trim())), 0, 255);
                    int a = clamp(Math.round(Float.parseFloat(parts[3].trim()) * 255), 0, 255);
                    return Color.argb(a, r, g, b);
                }
            }
            if (color.startsWith("rgb")) {
                String content = color.substring(color.indexOf('(') + 1, color.lastIndexOf(')'));
                String[] parts = content.split(",");
                if (parts.length >= 3) {
                    int r = clamp(Math.round(Float.parseFloat(parts[0].trim())), 0, 255);
                    int g = clamp(Math.round(Float.parseFloat(parts[1].trim())), 0, 255);
                    int b = clamp(Math.round(Float.parseFloat(parts[2].trim())), 0, 255);
                    return Color.rgb(r, g, b);
                }
            }
            return Color.parseColor(color);
        } catch (Exception ignored) {
            return fallback;
        }
    }

    private int dp(int value) {
        return Math.round(value * context.getResources().getDisplayMetrics().density);
    }

    private int clamp(int value, int min, int max) {
        return Math.max(min, Math.min(max, value));
    }

    private void showToast(String message) {
        Toast.makeText(context, message, Toast.LENGTH_SHORT).show();
    }
}
