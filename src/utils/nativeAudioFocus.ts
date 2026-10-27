import { isCapacitor } from "@/utils/env";
import { useStatusStore } from "@/stores";
import { usePlayerController } from "@/core/player/PlayerController";
import { AudioFocusPolicy, type AudioFocusAction } from "@/core/player/audioFocusPolicy";
import { AudioFocus } from "@/plugins/AudioFocusPlugin";

/**
 * 安卓音频焦点桥接处理
 *
 * 系统音频焦点的唯一持有者是 WebView 内部的媒体会话（Chromium MediaSession），
 * 来电/他人抢占的暂停、通知类抢占的压低音量、焦点回归后的按需恢复均由其原生仲裁，
 * 并通过元素 pause/play 事件自然同步到应用状态，此处无需重复申请焦点或转发焦点回调。
 *
 * 本模块仅处理原生层转发的耳机拔出广播（becomingNoisy）：
 * 用纯逻辑策略决策后驱动播放器暂停，且不自动恢复。
 */
export const initNativeAudioFocus = () => {
  if (!isCapacitor) return;

  const policy = new AudioFocusPolicy();
  const statusStore = useStatusStore();
  const playerCtrl = usePlayerController();

  /**
   * 依次执行策略产出的动作
   * @param actions 动作列表
   */
  const applyActions = async (actions: AudioFocusAction[]) => {
    for (const action of actions) {
      if (action.type === "pause") {
        console.log("[AudioFocus] becomingNoisy, pausing playback");
        await playerCtrl.pause();
      }
    }
  };

  AudioFocus.addListener("becomingNoisy", () => {
    const actions = policy.handleEvent("becomingNoisy", statusStore.playStatus);
    if (actions.length > 0) {
      applyActions(actions);
    }
  });
};
