package com.xiaoxiong.music;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
import android.os.Build;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.ImageView;
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
    /** 颜色预设：{已播放色, 未播放色} */
    private static final String[][] COLOR_PRESETS = {
            {"#fe7971", "#f2f2f2"},
            {"#4fc3ff", "#f2f2f2"},
            {"#ffd166", "#f2f2f2"},
            {"#ffffff", "#dddddd"},
    };

    private final Context context;
    private final WindowManager windowManager;
    private final SharedPreferences prefs;
    private final Callback callback;

    private LinearLayout rootView;
    private LinearLayout lyricArea;
    private LinearLayout controlBar;
    private LinearLayout actionBar;
    private LinearLayout toolsPanel;
    private TextView titleView;
    private TextView primaryView;
    private TextView secondaryView;
    private ImageView playPauseButton;
    private final FrameLayout[] colorPresetContainers = new FrameLayout[COLOR_PRESETS.length];
    private WindowManager.LayoutParams layoutParams;

    private boolean showing = false;
    private boolean locked = false;
    private boolean controlsVisible = false;
    private boolean toolsPanelVisible = false;
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
        windowManager.removeView(rootView);
        showing = false;
        controlsVisible = false;
        toolsPanelVisible = false;
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

        setTextIfChanged(titleView, titleText);
        setTextIfChanged(primaryView, primary);
        setTextIfChanged(secondaryView, secondary);
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
            toolsPanelVisible = false;
        }
        applyConfig();
    }

    void setLocked(boolean locked) {
        this.locked = locked;
        if (locked) {
            controlsVisible = false;
            toolsPanelVisible = false;
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
        textView.setHorizontallyScrolling(true);
        textView.setEllipsize(TextUtils.TruncateAt.MARQUEE);
        textView.setMarqueeRepeatLimit(-1);
        textView.setSelected(true);
        textView.setIncludeFontPadding(false);
        textView.setPadding(0, dp(3), 0, dp(3));
        return textView;
    }

    private void setTextIfChanged(TextView textView, String nextText) {
        String safeText = nextText == null ? "" : nextText;
        if (TextUtils.equals(textView.getText(), safeText)) return;

        textView.setText(safeText);
        if (textView.getEllipsize() == TextUtils.TruncateAt.MARQUEE) {
            restartMarquee(textView);
        }
    }

    private void restartMarquee(TextView textView) {
        textView.setSelected(false);
        textView.post(() -> textView.setSelected(true));
    }

    private LinearLayout createControlBar() {
        LinearLayout bar = new LinearLayout(context);
        bar.setOrientation(LinearLayout.VERTICAL);
        bar.setGravity(Gravity.CENTER);

        // 主工具栏：单行图标，无背景，Material 线性图标
        actionBar = new LinearLayout(context);
        actionBar.setOrientation(LinearLayout.HORIZONTAL);
        actionBar.setGravity(Gravity.CENTER);
        actionBar.setPadding(dp(4), dp(2), dp(4), dp(2));

        actionBar.addView(createIconView(R.drawable.ic_skip_previous, () -> notifyControlAction("previous")));
        playPauseButton = createIconView(R.drawable.ic_play, () -> notifyControlAction("playPause"));
        actionBar.addView(playPauseButton);
        actionBar.addView(createIconView(R.drawable.ic_skip_next, () -> notifyControlAction("next")));
        actionBar.addView(createDivider());
        actionBar.addView(createIconView(R.drawable.ic_text_decrease, () -> adjustFontSize(-2)));
        actionBar.addView(createIconView(R.drawable.ic_text_increase, () -> adjustFontSize(2)));
        actionBar.addView(createIconView(R.drawable.ic_palette, this::toggleToolsPanel));
        actionBar.addView(createDivider());
        actionBar.addView(createIconView(R.drawable.ic_lock, () -> {
            int beforeInset = getPrimaryTopInset(controlsVisible, toolsPanelVisible);
            locked = true;
            controlsVisible = false;
            toolsPanelVisible = false;
            int afterInset = getPrimaryTopInset(controlsVisible, toolsPanelVisible);
            keepPrimaryPosition(beforeInset, afterInset);
            notifyConfigChanged();
            applyConfig();
            showToast("桌面歌词已锁定");
        }));
        actionBar.addView(createIconView(R.drawable.ic_close, () -> {
            hide();
            if (callback != null) callback.onClose();
            showToast("桌面歌词已关闭");
        }));

        // 展开面板：颜色预设（无背景）
        toolsPanel = new LinearLayout(context);
        toolsPanel.setOrientation(LinearLayout.HORIZONTAL);
        toolsPanel.setGravity(Gravity.CENTER);
        toolsPanel.setPadding(dp(6), dp(4), dp(6), dp(4));

        for (int i = 0; i < COLOR_PRESETS.length; i++) {
            String primary = COLOR_PRESETS[i][0];
            String secondary = COLOR_PRESETS[i][1];
            toolsPanel.addView(createColorButton(i, () -> applyColorPreset(primary, secondary)));
        }

        LinearLayout.LayoutParams toolsPanelParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
        );
        toolsPanelParams.topMargin = dp(4);
        toolsPanel.setLayoutParams(toolsPanelParams);

        bar.addView(actionBar, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
        ));
        bar.addView(toolsPanel, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
        ));
        return bar;
    }

    /**
     * 创建图标按钮：Material 线性图标 + 圆形涟漪反馈。
     */
    private ImageView createIconView(int drawableRes, Runnable action) {
        ImageView icon = new ImageView(context);
        icon.setImageResource(drawableRes);
        icon.setColorFilter(Color.WHITE);
        icon.setScaleType(ImageView.ScaleType.CENTER);

        GradientDrawable mask = new GradientDrawable();
        mask.setShape(GradientDrawable.OVAL);
        mask.setColor(Color.WHITE);
        RippleDrawable ripple = new RippleDrawable(
                ColorStateList.valueOf(0x33FFFFFF), null, mask);
        icon.setBackground(ripple);
        icon.setOnClickListener((view) -> action.run());

        int size = dp(30);
        icon.setLayoutParams(new LinearLayout.LayoutParams(size, size));
        return icon;
    }

    /**
     * 创建竖向分隔线，用于工具栏分组。
     */
    private View createDivider() {
        View divider = new View(context);
        divider.setBackgroundColor(0x33FFFFFF);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(dp(1), dp(14));
        params.setMargins(dp(3), 0, dp(3), 0);
        divider.setLayoutParams(params);
        return divider;
    }

    /**
     * 创建颜色预设按钮：外环容器 + 内部色圆，选中时外环白圈高亮。
     */
    private FrameLayout createColorButton(int index, Runnable action) {
        FrameLayout container = new FrameLayout(context);
        colorPresetContainers[index] = container;
        container.setBackground(createSelectionRing(false));

        TextView dot = new TextView(context);
        dot.setGravity(Gravity.CENTER);
        dot.setOnClickListener((view) -> action.run());

        GradientDrawable circle = new GradientDrawable();
        circle.setShape(GradientDrawable.OVAL);
        circle.setColor(parseColor(COLOR_PRESETS[index][0], Color.WHITE));
        dot.setBackground(circle);

        FrameLayout.LayoutParams dotParams = new FrameLayout.LayoutParams(dp(18), dp(18));
        dotParams.gravity = Gravity.CENTER;
        dot.setLayoutParams(dotParams);

        FrameLayout.LayoutParams containerParams = new FrameLayout.LayoutParams(dp(26), dp(26));
        containerParams.setMargins(dp(1), 0, dp(1), 0);
        container.setLayoutParams(containerParams);

        container.addView(dot);
        return container;
    }

    /**
     * 颜色预设选中环：选中时白色外圈高亮，未选中时半透明细边。
     */
    private GradientDrawable createSelectionRing(boolean selected) {
        GradientDrawable ring = new GradientDrawable();
        ring.setShape(GradientDrawable.OVAL);
        if (selected) {
            ring.setColor(0x26FFFFFF);
            ring.setStroke(dp(2), 0xFFFFFFFF);
        } else {
            ring.setColor(Color.TRANSPARENT);
            ring.setStroke(dp(1), 0x33FFFFFF);
        }
        return ring;
    }

    /**
     * 刷新颜色预设选中态：与当前已播放色匹配的圆点高亮。
     */
    private void updateColorPanelSelection() {
        for (int i = 0; i < COLOR_PRESETS.length; i++) {
            FrameLayout container = colorPresetContainers[i];
            if (container == null) continue;
            boolean selected = COLOR_PRESETS[i][0].equalsIgnoreCase(playedColor);
            container.setBackground(createSelectionRing(selected));
        }
    }

    private void adjustFontSize(int delta) {
        fontSize = clamp(fontSize + delta, 16, 72);
        notifyConfigChanged();
        applyConfig();
        showToast("桌面歌词字号 " + fontSize + "px");
    }

    private void applyColorPreset(String primary, String secondary) {
        int beforeInset = getPrimaryTopInset(controlsVisible, toolsPanelVisible);
        playedColor = primary;
        unplayedColor = secondary;
        shadowColor = "rgba(0, 0, 0, 0.65)";
        toolsPanelVisible = false;
        int afterInset = getPrimaryTopInset(controlsVisible, toolsPanelVisible);
        keepPrimaryPosition(beforeInset, afterInset);
        notifyConfigChanged();
        applyConfig();
        showToast("已切换桌面歌词颜色");
    }

    private void toggleToolsPanel() {
        int beforeInset = getPrimaryTopInset(controlsVisible, toolsPanelVisible);
        toolsPanelVisible = !toolsPanelVisible;
        int afterInset = getPrimaryTopInset(controlsVisible, toolsPanelVisible);
        keepPrimaryPosition(beforeInset, afterInset);
        applyConfig();
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
        updateColorPanelSelection();

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
        if (toolsPanel != null) {
            toolsPanel.setVisibility(!locked && controlsVisible && toolsPanelVisible ? View.VISIBLE : View.GONE);
        }
        if (playPauseButton != null) {
            playPauseButton.setImageResource(isPlaying ? R.drawable.ic_pause : R.drawable.ic_play);
        }
    }

    /**
     * 切换工具栏显示状态。
     * 工具栏保持显示，不自动收缩；再次点击歌词区域时收缩。
     */
    private void setControlsVisible(boolean visible) {
        int beforeInset = getPrimaryTopInset(controlsVisible, toolsPanelVisible);
        controlsVisible = !locked && visible;
        if (!controlsVisible) toolsPanelVisible = false;
        int afterInset = getPrimaryTopInset(controlsVisible, toolsPanelVisible);
        keepPrimaryPosition(beforeInset, afterInset);
        applyConfig();
    }

    private int getPrimaryTopInset(boolean controlsVisible, boolean toolsPanelVisible) {
        ensureView();
        ensureLayoutParams();

        int inset = rootView.getPaddingTop();
        if (!locked && controlsVisible) {
            inset += measureViewHeight(actionBar);
            if (toolsPanelVisible) inset += measureViewHeight(toolsPanel) + dp(4);
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
