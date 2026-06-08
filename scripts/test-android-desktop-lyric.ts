import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

type TestedModule = typeof import("../src/utils/androidDesktopLyric");

const loadModule = async (): Promise<TestedModule> => {
  try {
    return await import("../src/utils/androidDesktopLyric");
  } catch (error) {
    assert.fail(`androidDesktopLyric 模块尚未实现: ${(error as Error).message}`);
  }
};

const line = (word: string, startTime = 0, endTime = startTime + 1000, translatedLyric = "") => ({
  startTime,
  endTime,
  words: [{ word, startTime, endTime, romanWord: "" }],
  translatedLyric,
  romanLyric: "",
  isBG: false,
  isDuet: false,
});

const yrcLine = (
  words: { word: string; startTime: number; endTime: number }[],
  startTime = words[0]?.startTime ?? 0,
  endTime = words.at(-1)?.endTime ?? startTime,
) => ({
  startTime,
  endTime,
  words: words.map((word) => ({ ...word, romanWord: "" })),
  translatedLyric: "",
  romanLyric: "",
  isBG: false,
  isDuet: false,
});

const { buildAndroidDesktopLyricPayload } = await loadModule();

{
  const playerRightMenu = readFileSync(
    new URL("../src/components/Player/PlayerRightMenu.vue", import.meta.url),
    "utf8",
  );

  assert.match(playerRightMenu, /player\.toggleDesktopLyric\(\)/);
  assert.match(playerRightMenu, />\s*词\s*</);
  assert.doesNotMatch(
    playerRightMenu,
    /class="[^"]*\bhidden\b[^"]*"[^>]*@click\.stop="player\.toggleDesktopLyric\(\)"/s,
    "Android 桌面歌词快捷开关不应使用移动端会隐藏的 hidden 类",
  );
}

{
  const lyricsSetting = readFileSync(
    new URL("../src/components/Setting/LyricsSetting.vue", import.meta.url),
    "utf8",
  );
  const playerSettings = readFileSync(
    new URL("../src/components/Player/PlayerSettingsModal.vue", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(lyricsSetting, /<n-h3[^>]*>\s*桌面歌词/s);
  assert.match(playerSettings, /DesktopLyricSettingsModal/);
}

{
  const overlay = readFileSync(
    new URL("../android/app/src/main/java/com/xiaoxiong/music/DesktopLyricOverlay.java", import.meta.url),
    "utf8",
  );
  const controlIndex = overlay.indexOf("rootView.addView(controlBar");
  const lyricIndex = overlay.indexOf("rootView.addView(lyricArea");

  assert.ok(controlIndex >= 0, "桌面歌词浮窗应包含工具条");
  assert.ok(lyricIndex >= 0, "桌面歌词浮窗应包含歌词区域");
  assert.ok(controlIndex < lyricIndex, "工具条应显示在歌词上方");
  assert.match(overlay, /private static final String LOCK_ICON/);
  assert.doesNotMatch(overlay, /createTextButton\("锁定"/);
  assert.match(overlay, /Toast\.makeText/);
  assert.match(overlay, /controlsVisible\s*\?\s*parseColor\(backgroundMaskColor/);
  assert.doesNotMatch(overlay, /if \(textBackgroundMask\)/);
  assert.match(
    overlay,
    /private void setControlsVisible\(boolean visible\) \{[\s\S]*controlsVisible = !locked && visible;[\s\S]*applyConfig\(\);[\s\S]*if \(controlsVisible\)/,
    "点击未锁定歌词后必须立即刷新浮窗背景，不能只切换工具栏可见性",
  );
  assert.match(
    overlay,
    /handler\.postDelayed\(\(\) -> \{[\s\S]*controlsVisible = false;[\s\S]*applyConfig\(\);[\s\S]*\}, 3500\);/,
    "工具栏自动隐藏时必须同步移除遮罩背景",
  );
  assert.match(overlay, /getPrimaryTopInset\(controlsVisible,\s*colorPanelVisible\)/);
  assert.match(overlay, /layoutParams\.y -= afterInset - beforeInset/);
  assert.match(
    overlay,
    /setControlsVisible\(boolean visible\) \{[\s\S]*int beforeInset = getPrimaryTopInset\(controlsVisible,\s*colorPanelVisible\);[\s\S]*int afterInset = getPrimaryTopInset\(controlsVisible,\s*colorPanelVisible\);[\s\S]*keepPrimaryPosition\(beforeInset,\s*afterInset\);[\s\S]*applyConfig\(\);/,
    "点击展示工具栏时必须让主歌词锚点保持原位，歌曲名和工具栏只能向上展开",
  );
  assert.match(overlay, /notifyControlAction\("previous"\)/);
  assert.match(overlay, /notifyControlAction\("playPause"\)/);
  assert.match(overlay, /notifyControlAction\("next"\)/);
  assert.match(overlay, /colorPanelVisible/);
  assert.match(overlay, /toggleColorPanel\(\)/);
  assert.match(overlay, /createTextButton\("色"/);
}

{
  const desktopSettings = readFileSync(
    new URL(
      "../src/components/Player/SettingsModals/DesktopLyricSettingsModal.vue",
      import.meta.url,
    ),
    "utf8",
  );

  assert.doesNotMatch(desktopSettings, /文本遮罩/);
  assert.doesNotMatch(desktopSettings, /交互遮罩颜色/);
  assert.doesNotMatch(desktopSettings, /backgroundMaskColor/);
}

{
  const musicService = readFileSync(
    new URL("../android/app/src/main/java/com/xiaoxiong/music/MusicService.java", import.meta.url),
    "utf8",
  );
  const musicReceiver = readFileSync(
    new URL(
      "../android/app/src/main/java/com/xiaoxiong/music/MusicControlReceiver.java",
      import.meta.url,
    ),
    "utf8",
  );
  const notificationPlugin = readFileSync(
    new URL(
      "../android/app/src/main/java/com/xiaoxiong/music/MusicNotificationPlugin.java",
      import.meta.url,
    ),
    "utf8",
  );
  const initTs = readFileSync(new URL("../src/utils/init.ts", import.meta.url), "utf8");
  const desktopPlugin = readFileSync(
    new URL("../android/app/src/main/java/com/xiaoxiong/music/DesktopLyricPlugin.java", import.meta.url),
    "utf8",
  );
  const desktopPluginTs = readFileSync(
    new URL("../src/plugins/DesktopLyricPlugin.ts", import.meta.url),
    "utf8",
  );
  const desktopBridge = readFileSync(
    new URL("../src/utils/androidDesktopLyricBridge.ts", import.meta.url),
    "utf8",
  );

  assert.match(musicService, /ACTION_TOGGLE_DESKTOP_LYRIC/);
  assert.match(musicService, /createAction\(R\.drawable\.ic_lyrics,\s*"词"/);
  assert.match(musicService, /setShowActionsInCompactView\(0,\s*1,\s*3\)/);
  assert.match(musicReceiver, /ACTION_TOGGLE_DESKTOP_LYRIC/);
  assert.match(notificationPlugin, /notifyDesktopLyricEvent/);
  assert.match(initTs, /onMusicControlEvent\('desktopLyric'/);
  assert.match(desktopPlugin, /notifyListeners\("control"/);
  assert.match(desktopPluginTs, /eventName: "control"/);
  assert.match(desktopBridge, /DesktopLyric\.addListener\("control"/);
  assert.match(desktopBridge, /player\.playOrPause\(\)/);
  assert.match(desktopBridge, /player\.nextOrPrev\("prev"\)/);
  assert.match(desktopBridge, /player\.nextOrPrev\("next"\)/);
}

{
  const payload = buildAndroidDesktopLyricPayload({
    playName: "",
    artistName: "",
    playStatus: false,
    currentTime: 0,
    lyricLoading: false,
    songId: 0,
    songOffset: 0,
    lyricIndex: -1,
    lrcData: [],
    yrcData: [],
  });

  assert.equal(payload.primaryText, "小熊音乐桌面歌词");
  assert.equal(payload.secondaryText, "");
}

{
  const payload = buildAndroidDesktopLyricPayload({
    playName: "一首歌",
    artistName: "Hackerdallas",
    playStatus: true,
    currentTime: 0,
    lyricLoading: true,
    songId: 1,
    songOffset: 0,
    lyricIndex: 0,
    lrcData: [line("第一句")],
    yrcData: [],
  });

  assert.equal(payload.primaryText, "歌词加载中...");
  assert.equal(payload.secondaryText, "");
}

{
  const payload = buildAndroidDesktopLyricPayload({
    playName: "一首歌",
    artistName: "Hackerdallas",
    playStatus: true,
    currentTime: 1000,
    lyricLoading: false,
    songId: 1,
    songOffset: 0,
    lyricIndex: 0,
    lrcData: [line("第一句", 0, 2000, "First line")],
    yrcData: [],
  });

  assert.equal(payload.primaryText, "第一句");
  assert.equal(payload.secondaryText, "First line");
}

{
  const payload = buildAndroidDesktopLyricPayload({
    playName: "一首歌",
    artistName: "Hackerdallas",
    playStatus: true,
    currentTime: 1000,
    lyricLoading: false,
    songId: 1,
    songOffset: 0,
    lyricIndex: 0,
    lrcData: [line("第一句", 0, 2000), line("第二句", 2000, 4000)],
    yrcData: [],
  }, {
    showTran: false,
    isDoubleLine: true,
  });

  assert.equal(payload.primaryText, "第一句");
  assert.equal(payload.secondaryText, "第二句");
}

{
  const payload = buildAndroidDesktopLyricPayload({
    playName: "逐字歌",
    artistName: "Hackerdallas",
    playStatus: true,
    currentTime: 1250,
    lyricLoading: false,
    songId: 2,
    songOffset: 250,
    lyricIndex: 0,
    lrcData: [],
    yrcData: [
      yrcLine([
        { word: "你", startTime: 1000, endTime: 1400 },
        { word: "好", startTime: 1400, endTime: 1800 },
      ]),
    ],
  });

  assert.equal(payload.primaryText, "你好");
  assert.equal("primaryWords" in payload, false);
  assert.equal("currentTime" in payload, false);
}

{
  const payload = buildAndroidDesktopLyricPayload({
    playName: "优先普通歌词",
    artistName: "Hackerdallas",
    playStatus: true,
    currentTime: 1250,
    lyricLoading: false,
    songId: 3,
    songOffset: 0,
    lyricIndex: 0,
    lrcData: [line("普通歌词", 1000, 2000)],
    yrcData: [
      yrcLine([
        { word: "逐", startTime: 1000, endTime: 1400 },
        { word: "字", startTime: 1400, endTime: 1800 },
      ]),
    ],
  });

  assert.equal(payload.primaryText, "普通歌词");
}

console.log("android desktop lyric payload tests passed");
