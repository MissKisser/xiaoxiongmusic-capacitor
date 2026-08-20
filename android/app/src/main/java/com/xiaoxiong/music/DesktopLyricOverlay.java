package com.xiaoxiong.music;

import android.animation.ArgbEvaluator;
import android.animation.ValueAnimator;
import android.content.ComponentCallbacks;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.res.ColorStateList;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.text.TextUtils;
import android.util.Log;
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
    private static final String TAG = "DesktopLyricOverlay";
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

    private FrameLayout rootView;
    private LinearLayout lyricArea;
    private LinearLayout controlBar;
    private LinearLayout actionBar;
    private LinearLayout toolsPanel;
    private TextView titleView;
    private TextView primaryView;
    private TextView secondaryView;
    private ImageView playPauseButton;
    /** 锁定状态下的解锁按钮（独立小浮窗，点击歌词唤出、3 秒自动隐藏） */
    private ImageView unlockButton;
    /** 解锁按钮独立小浮窗容器与参数：窗口矩形仅按钮尺寸，四周透明区域可穿透触摸 */
    private FrameLayout unlockRootView;
    private WindowManager.LayoutParams unlockLayoutParams;
    private boolean unlockAdded = false;
    /** 解锁按钮钉住的屏幕坐标（主窗口顶部预留带内居中，与原窗口内位置一致） */
    private int unlockPinX = 0;
    private int unlockPinY = 0;
    /**
     * 歌词交互浮窗（锁定态）：主窗口整窗穿透后，仅覆盖歌词区的透明触摸层，
     * 保证锁定时歌词部分仍可点击（唤出解锁按钮），周围透明区域继续穿透。
     */
    private FrameLayout lyricTouchRootView;
    private WindowManager.LayoutParams lyricTouchLayoutParams;
    private boolean lyricTouchAdded = false;
    /** 最近一次计算的工具栏预留高度与歌词区高度，用于定位歌词交互浮窗 */
    private int lastControlBarHeight = 0;
    private int lastLyricHeight = 0;
    /** 解锁按钮自动隐藏定时器 */
    private final Handler unlockHandler = new Handler(Looper.getMainLooper());
    /** 解锁按钮自动隐藏任务：移除独立浮窗（在构造函数中初始化，避免引用未赋值的 windowManager） */
    private Runnable hideUnlockRunnable;
    /** 上一次屏幕方向，用于检测横竖屏切换 */
    private int lastOrientation = Configuration.ORIENTATION_UNDEFINED;
    /** 屏幕方向变化监听：横竖屏切换时校正浮窗位置，避免越界/偏差 */
    private final ComponentCallbacks rotationCallbacks = new ComponentCallbacks() {
        @Override
        public void onConfigurationChanged(Configuration newConfig) {
            if (newConfig.orientation != lastOrientation) {
                lastOrientation = newConfig.orientation;
                revalidatePositionForRotation();
            }
        }

        @Override
        public void onLowMemory() {
        }
    };
    /** 浮窗背景（持久 drawable，配合渐变动画避免瞬变闪烁） */
    private GradientDrawable backgroundDrawable;
    private int currentBackgroundColor = Color.TRANSPARENT;
    private ValueAnimator backgroundAnimator;
    /** 上次应用的窗口参数缓存：参数不变时跳过 updateViewLayout，避免回声触发 resize 弹跳 */
    private int lastWindowWidth = -1;
    private int lastWindowHeight = -1;
    private int lastWindowX = -1;
    private int lastWindowY = -1;
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
        this.hideUnlockRunnable = () -> {
            if (unlockAdded && unlockRootView != null) {
                try {
                    windowManager.removeView(unlockRootView);
                } catch (Exception ignored) {
                }
                unlockAdded = false;
            }
        };
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
        lastOrientation = context.getResources().getConfiguration().orientation;
        context.getApplicationContext().registerComponentCallbacks(rotationCallbacks);
        applyConfig();
        // 恢复显示时若处于锁定态：整窗穿透 + 歌词交互浮窗（解锁按钮等点击歌词唤出）
        if (locked) {
            applyTouchPassThrough();
            addLyricTouchFloat();
        }
    }

    void hide() {
        if (!showing || rootView == null) return;
        context.getApplicationContext().unregisterComponentCallbacks(rotationCallbacks);
        if (backgroundAnimator != null) {
            backgroundAnimator.cancel();
        }
        unlockHandler.removeCallbacks(hideUnlockRunnable);
        hideUnlockRunnable.run();
        removeLyricTouchFloat();
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
        // 副歌词行恒占位（空文本保留空白行），保证歌词区高度恒定
        secondaryView.setVisibility(View.VISIBLE);
        updateInfoVisibility();
        updateControlBarVisibility();
    }

    void updateConfig(JSObject config) {
        // locked 由 setLocked 统一管理，此处不修改，
        // 以保证 setLocked 能识别状态变化并执行主窗口 resize 与解锁浮窗联动
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
        boolean changed = this.locked != locked;
        this.locked = locked;
        if (locked) {
            controlsVisible = false;
            toolsPanelVisible = false;
        }
        updateControlBarVisibility();
        if (changed && showing && layoutParams != null) {
            // 锁定：主窗口整窗穿透 + 歌词交互浮窗（仅歌词区可点，唤出解锁按钮）；
            // 解锁：恢复主窗口可触摸，移除交互浮窗与解锁按钮
            applyTouchPassThrough();
            if (locked) {
                addLyricTouchFloat();
            } else {
                unlockHandler.removeCallbacks(hideUnlockRunnable);
                hideUnlockRunnable.run();
                removeLyricTouchFloat();
            }
        }
        int targetBackgroundColor = (!locked && controlsVisible)
                ? parseColor(backgroundMaskColor, 0x99000000) : Color.TRANSPARENT;
        if (targetBackgroundColor != currentBackgroundColor) {
            animateBackgroundColor(targetBackgroundColor);
        }
    }

    private void ensureView() {
        if (rootView != null) return;

        rootView = new FrameLayout(context);
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
        titleView.setIncludeFontPadding(false);
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

        // 歌词区固定在浮窗底部：工具栏显隐均不改变歌词位置
        FrameLayout.LayoutParams lyricParams = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.WRAP_CONTENT
        );
        lyricParams.gravity = Gravity.BOTTOM;
        rootView.addView(lyricArea, lyricParams);

        // 工具栏 overlay 叠放在浮窗顶部（窗口高度恒定预留，显隐不触发 resize）
        FrameLayout.LayoutParams controlParams = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.WRAP_CONTENT
        );
        controlParams.gravity = Gravity.TOP;
        rootView.addView(controlBar, controlParams);

        // 解锁按钮为独立小浮窗：锁定时主窗口整窗穿透，解锁按钮独立于主窗口之外，仍可点击；
        // 歌词交互浮窗（仅覆盖歌词区）保证锁定时歌词可点，周围区域继续穿透
        ensureUnlockView();
        ensureLyricTouchView();
        Log.d(TAG, "ensureView: fixed-height overlay layout");
    }

    /**
     * 构建解锁按钮独立浮窗容器（仅 30x30dp），锁定时 addView 显示、隐藏时 removeView，
     * 窗口矩形极小故其四周不拦截下层应用触摸。
     */
    private void ensureUnlockView() {
        if (unlockRootView != null) return;
        unlockRootView = new FrameLayout(context);
        unlockButton = new ImageView(context);
        unlockButton.setImageResource(R.drawable.ic_lock);
        // 半透明深灰圆底 + 白色图标，保证浅色/复杂背景下清晰可见
        unlockButton.setColorFilter(Color.WHITE);
        GradientDrawable unlockBackground = new GradientDrawable();
        unlockBackground.setShape(GradientDrawable.OVAL);
        unlockBackground.setColor(0x59000000);
        unlockButton.setBackground(unlockBackground);
        unlockButton.setScaleType(ImageView.ScaleType.CENTER);
        unlockButton.setContentDescription("解锁歌词");
        unlockButton.setOnClickListener(v -> {
            // 点击解锁：setLocked(false) 会移除解锁按钮浮窗并恢复主窗口可触摸
            setLocked(false);
            notifyConfigChanged();
        });
        unlockRootView.addView(unlockButton, new FrameLayout.LayoutParams(dp(30), dp(30)));
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
            setLocked(true);
            notifyConfigChanged();
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
        playedColor = primary;
        unplayedColor = secondary;
        shadowColor = "rgba(0, 0, 0, 0.65)";
        toolsPanelVisible = false;
        updateControlBarVisibility();
        notifyConfigChanged();
        applyConfig();
        showToast("已切换桌面歌词颜色");
    }

    private void toggleToolsPanel() {
        toolsPanelVisible = !toolsPanelVisible;
        updateControlBarVisibility();
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
        // 无条件校验持久化坐标是否在屏幕范围内（不受 limitBounds 开关限制），
        // 防止屏幕分辨率变化后坐标越界导致悬浮窗"丢失"（超界时回落默认居中位置）
        int screenHeight = context.getResources().getDisplayMetrics().heightPixels;
        int maxX = Math.max(0, screenWidth - width);
        int maxY = Math.max(0, screenHeight - dp(96));
        if (layoutParams.x < 0 || layoutParams.x > maxX || layoutParams.y < 0 || layoutParams.y > maxY) {
            layoutParams.x = defaultX;
            layoutParams.y = dp(96);
        }
        applyFixedSize();
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
        // 锁定不再禁用触摸：锁定时点击/拖动歌词可唤出解锁按钮
        return flags;
    }

    private void applyConfig() {
        ensureView();
        ensureLayoutParams();
        applyFixedSize();

        if (locked) controlsVisible = false;
        // 穿透 flags 由 applyTouchPassThrough 统一计算（锁定时含 FLAG_NOT_TOUCHABLE）

        int targetBackgroundColor = controlsVisible ? parseColor(backgroundMaskColor, 0x99000000) : Color.TRANSPARENT;
        if (backgroundDrawable == null) {
            backgroundDrawable = new GradientDrawable();
            backgroundDrawable.setCornerRadius(dp(8));
        }
        if (targetBackgroundColor == currentBackgroundColor) {
            backgroundDrawable.setColor(targetBackgroundColor);
        } else {
            animateBackgroundColor(targetBackgroundColor);
        }
        rootView.setBackground(backgroundDrawable);

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
            // 窗口恒定尺寸，仅校正位置；穿透 flags 与锁定态附属浮窗位置随状态同步
            clampToScreen();
            updateWindowIfChanged();
            applyTouchPassThrough();
            syncLyricTouchFloat();
            syncUnlockFloat();
        }
    }

    /**
     * 背景色渐变过渡，避免工具栏显隐时背景瞬变闪烁。
     * 频繁点击先取消旧动画，从当前实际色平滑过渡到目标色。
     */
    private void animateBackgroundColor(int targetColor) {
        if (backgroundAnimator != null) {
            backgroundAnimator.cancel();
        }
        int from = currentBackgroundColor;
        Log.d(TAG, "animateBackgroundColor " + from + "->" + targetColor);
        backgroundAnimator = ValueAnimator.ofArgb(from, targetColor);
        backgroundAnimator.setDuration(150);
        backgroundAnimator.setEvaluator(new ArgbEvaluator());
        backgroundAnimator.addUpdateListener(animation -> {
            currentBackgroundColor = (int) animation.getAnimatedValue();
            if (backgroundDrawable != null) {
                backgroundDrawable.setColor(currentBackgroundColor);
            }
        });
        backgroundAnimator.start();
    }

    /**
     * 仅当窗口参数实际变化时才 updateViewLayout。
     * web 配置回声等重复调用若参数未变则直接跳过，避免无谓 resize 引发弹跳。
     */
    private void updateWindowIfChanged() {
        if (!showing || layoutParams == null) return;
        if (layoutParams.width == lastWindowWidth && layoutParams.height == lastWindowHeight
                && layoutParams.x == lastWindowX && layoutParams.y == lastWindowY) return;
        windowManager.updateViewLayout(rootView, layoutParams);
        lastWindowWidth = layoutParams.width;
        lastWindowHeight = layoutParams.height;
        lastWindowX = layoutParams.x;
        lastWindowY = layoutParams.y;
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
        // 恒定显示策略：不随工具栏显隐变化，保证歌词区高度稳定
        boolean showInfo = alwaysShowPlayInfo && titleText != null && !titleText.isEmpty();
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
     * 工具栏为窗口内 overlay，显隐仅切换可见性与背景渐变，窗口尺寸/位置恒定，无 resize 弹跳。
     */
    private void setControlsVisible(boolean visible) {
        controlsVisible = !locked && visible;
        if (!controlsVisible) toolsPanelVisible = false;
        updateControlBarVisibility();
        int targetBackgroundColor = controlsVisible
                ? parseColor(backgroundMaskColor, 0x99000000) : Color.TRANSPARENT;
        if (targetBackgroundColor != currentBackgroundColor) {
            animateBackgroundColor(targetBackgroundColor);
        }
        Log.d(TAG, "setControlsVisible visible=" + controlsVisible + " fixed-size");
    }

    /**
     * 切换主窗口触摸穿透（对齐主流桌面歌词实现）：
     * 锁定时加 FLAG_NOT_TOUCHABLE 整窗穿透（歌词变只读水印），解锁时移除恢复可拖可点。
     * 仅切换触摸属性，不改窗口尺寸/位置/背景，无 resize 弹跳。
     */
    private void applyTouchPassThrough() {
        if (layoutParams == null || !showing) return;
        int targetFlags = baseFlags();
        if (locked) targetFlags |= WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE;
        if (layoutParams.flags == targetFlags) return;
        layoutParams.flags = targetFlags;
        try {
            windowManager.updateViewLayout(rootView, layoutParams);
            Log.d(TAG, "applyTouchPassThrough locked=" + locked);
        } catch (Exception ignored) {
        }
    }

    /**
     * 同步解锁按钮独立浮窗的屏幕位置（主窗口移动/尺寸变化后调用）。
     */
    private void syncUnlockFloat() {
        if (!unlockAdded || unlockRootView == null) return;
        computeUnlockPin();
        if (unlockLayoutParams != null
                && (unlockLayoutParams.x != unlockPinX || unlockLayoutParams.y != unlockPinY)) {
            unlockLayoutParams.x = unlockPinX;
            unlockLayoutParams.y = unlockPinY;
            try {
                windowManager.updateViewLayout(unlockRootView, unlockLayoutParams);
            } catch (Exception ignored) {
            }
        }
    }

    /**
     * 构建歌词交互浮窗：透明触摸层，仅覆盖主窗口底部歌词区，
     * 挂 handleLyricTouch 处理锁定态的点击（唤出解锁按钮），不响应拖动。
     */
    private void ensureLyricTouchView() {
        if (lyricTouchRootView != null) return;
        lyricTouchRootView = new FrameLayout(context);
        lyricTouchRootView.setOnTouchListener(this::handleLyricTouch);
    }

    /** 添加歌词交互浮窗（锁定态），矩形精确覆盖歌词区：顶部透明带继续穿透 */
    private void addLyricTouchFloat() {
        if (layoutParams == null) return;
        ensureLyricTouchView();
        if (lyricTouchAdded) {
            syncLyricTouchFloat();
            return;
        }
        lyricTouchLayoutParams = new WindowManager.LayoutParams(
                layoutParams.width,
                Math.max(0, lastLyricHeight),
                windowType(),
                baseFlags(),
                PixelFormat.TRANSLUCENT
        );
        lyricTouchLayoutParams.gravity = Gravity.TOP | Gravity.START;
        lyricTouchLayoutParams.x = computeLyricTouchX();
        lyricTouchLayoutParams.y = computeLyricTouchY();
        try {
            windowManager.addView(lyricTouchRootView, lyricTouchLayoutParams);
            lyricTouchAdded = true;
        } catch (Exception e) {
            Log.e(TAG, "添加歌词交互浮窗失败", e);
        }
    }

    /** 移除歌词交互浮窗 */
    private void removeLyricTouchFloat() {
        if (lyricTouchAdded && lyricTouchRootView != null) {
            try {
                windowManager.removeView(lyricTouchRootView);
            } catch (Exception ignored) {
            }
            lyricTouchAdded = false;
        }
    }

    /** 歌词交互浮窗 X 坐标：与主窗口水平对齐 */
    private int computeLyricTouchX() {
        return layoutParams.x;
    }

    /** 歌词交互浮窗 Y 坐标：主窗口底部向上 lastLyricHeight（与 lyricArea 区域一致） */
    private int computeLyricTouchY() {
        return layoutParams.y + layoutParams.height
                - rootView.getPaddingBottom() - lastLyricHeight;
    }

    /** 主窗口位置/尺寸变化后同步歌词交互浮窗位置 */
    private void syncLyricTouchFloat() {
        if (!lyricTouchAdded || lyricTouchLayoutParams == null) return;
        int targetX = computeLyricTouchX();
        int targetY = computeLyricTouchY();
        if (lyricTouchLayoutParams.x == targetX && lyricTouchLayoutParams.y == targetY) return;
        lyricTouchLayoutParams.x = targetX;
        lyricTouchLayoutParams.y = targetY;
        try {
            windowManager.updateViewLayout(lyricTouchRootView, lyricTouchLayoutParams);
        } catch (Exception ignored) {
        }
    }

    /**
     * 浮窗恒定高度：顶部工具栏预留 + 底部歌词区。
     * 窗口尺寸保持恒定，工具栏显隐仅切换 overlay 可见性，不触发 resize，
     * 避免 BLAST 缓冲拉伸的"弹跳"视觉效果；锁定穿透只切 flags，同样不动尺寸。
     */
    private void applyFixedSize() {
        ensureView();
        ensureLayoutParams();
        // 仅预留 actionBar 与歌词区的小间隔；toolsPanel 展开时向下叠放覆盖（FrameLayout），不再预留其高度
        int controlBarHeight = measureViewHeight(actionBar) + dp(4);
        int lyricHeight = dp(6);
        if (alwaysShowPlayInfo && titleText != null && !titleText.isEmpty()) {
            lyricHeight += measureViewHeight(titleView);
        }
        lyricHeight += measureViewHeight(primaryView) + measureViewHeight(secondaryView);
        lastControlBarHeight = controlBarHeight;
        lastLyricHeight = lyricHeight;
        layoutParams.height = rootView.getPaddingTop() + rootView.getPaddingBottom()
                + controlBarHeight + lyricHeight;
        Log.d(TAG, "applyFixedSize control=" + controlBarHeight + " lyric=" + lyricHeight
                + " total=" + layoutParams.height);
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

    private boolean handleLyricTouch(View view, MotionEvent event) {
        if (layoutParams == null) return false;
        Log.d(TAG, "handleLyricTouch action=" + event.getAction() + " locked=" + locked);
        // 锁定时：主窗口整窗穿透，触摸由歌词交互浮窗（仅覆盖歌词区）转入本处理；
        // 点击唤出解锁按钮（3 秒自动隐藏），不响应拖动、不切换控制栏
        if (locked) {
            if (event.getAction() == MotionEvent.ACTION_DOWN) {
                showUnlockButton();
            }
            return true;
        }
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
                    // 限制边界开启时拖拽全程整窗保持在屏幕内；关闭时可自由拖到任意位置，
                    // 若超出屏幕边界由松手回弹兜底
                    if (limitBounds) clampToScreen();
                    updateWindowIfChanged();
                    // 解锁按钮浮窗（若显示）跟随主窗口移动
                    syncUnlockFloat();
                }
                return true;
            case MotionEvent.ACTION_UP:
            case MotionEvent.ACTION_CANCEL:
                if (dragging) {
                    // 松手回弹：浮窗若未完整处于屏幕内（被拖出边界），自动回到完整可见的水平位置
                    clampToScreen();
                    // 立即重绘窗口位置，避免坐标只在内存生效、屏幕上仍滞留在界外
                    updateWindowIfChanged();
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

    /**
     * 计算解锁按钮钉住的屏幕坐标：主窗口顶部预留带（工具栏区域）内、水平居中，
     * 与原窗口内布局（gravity TOP|CENTER_HORIZONTAL + topMargin 2dp）位置一致。
     */
    private void computeUnlockPin() {
        if (layoutParams == null) return;
        int paddingTop = rootView.getPaddingTop();
        int buttonSize = dp(30);
        unlockPinX = layoutParams.x + (layoutParams.width - buttonSize) / 2;
        unlockPinY = layoutParams.y + paddingTop + dp(2);
        Log.d(TAG, "computeUnlockPin x=" + unlockPinX + " y=" + unlockPinY);
    }

    /**
     * 显示解锁按钮独立浮窗（钉在 computeUnlockPin 计算的屏幕位置）。
     * 锁定期间常驻显示：主窗口已整窗穿透，无法通过点击歌词唤出，故不再 3 秒自动隐藏。
     */
    private void showUnlockButton() {
        if (unlockRootView == null) return;
        computeUnlockPin();
        Log.d(TAG, "showUnlockButton pinX=" + unlockPinX + " pinY=" + unlockPinY);
        unlockHandler.removeCallbacks(hideUnlockRunnable);
        if (!unlockAdded) {
            unlockLayoutParams = new WindowManager.LayoutParams(
                    dp(30),
                    dp(30),
                    windowType(),
                    baseFlags(),
                    PixelFormat.TRANSLUCENT
            );
            unlockLayoutParams.gravity = Gravity.TOP | Gravity.START;
            unlockLayoutParams.x = unlockPinX;
            unlockLayoutParams.y = unlockPinY;
            try {
                windowManager.addView(unlockRootView, unlockLayoutParams);
                unlockAdded = true;
            } catch (Exception e) {
                Log.e(TAG, "添加解锁按钮浮窗失败", e);
            }
        } else if (unlockLayoutParams != null) {
            // 已显示：跟随主窗口移动更新位置
            if (unlockLayoutParams.x != unlockPinX || unlockLayoutParams.y != unlockPinY) {
                unlockLayoutParams.x = unlockPinX;
                unlockLayoutParams.y = unlockPinY;
                try {
                    windowManager.updateViewLayout(unlockRootView, unlockLayoutParams);
                } catch (Exception ignored) {
                }
            }
        }
        unlockHandler.postDelayed(hideUnlockRunnable, 3000);
    }

    /**
     * 将浮窗完整钳制到屏幕可视范围内（松手回弹、旋转校正等场景统一使用），
     * 保证浮窗始终处于完整可见的水平位置，不会因越界而无法找回。
     */
    private void clampToScreen() {
        if (layoutParams == null) return;
        int screenWidth = context.getResources().getDisplayMetrics().widthPixels;
        int screenHeight = context.getResources().getDisplayMetrics().heightPixels;
        int viewHeight = layoutParams.height > 0 ? layoutParams.height : dp(96);
        int maxX = Math.max(0, screenWidth - layoutParams.width);
        int maxY = Math.max(0, screenHeight - viewHeight);
        layoutParams.x = clamp(layoutParams.x, 0, maxX);
        layoutParams.y = clamp(layoutParams.y, 0, maxY);
    }

    /**
     * 横竖屏切换后校正浮窗位置：更新宽度、clamp 坐标到新屏幕范围，
     * 确保整个浮窗（含歌词）不超出边界、位置不偏差。
     */
    private void revalidatePositionForRotation() {
        if (layoutParams == null || !showing || rootView == null) return;
        Log.d(TAG, "revalidatePositionForRotation");
        int screenWidth = context.getResources().getDisplayMetrics().widthPixels;
        int screenHeight = context.getResources().getDisplayMetrics().heightPixels;
        int newWidth = Math.round(screenWidth * 0.92f);
        layoutParams.width = newWidth;
        applyFixedSize();
        int maxX = Math.max(0, screenWidth - newWidth);
        int maxY = Math.max(0, screenHeight - layoutParams.height);
        layoutParams.x = clamp(layoutParams.x, 0, maxX);
        layoutParams.y = clamp(layoutParams.y, 0, maxY);
        try {
            updateWindowIfChanged();
        } catch (Exception ignored) {
        }
        prefs.edit()
                .putInt(KEY_X, layoutParams.x)
                .putInt(KEY_Y, layoutParams.y)
                .apply();
        // 旋转后主窗口位置变化，同步锁定态附属浮窗（歌词交互层/解锁按钮）
        syncLyricTouchFloat();
        syncUnlockFloat();
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
