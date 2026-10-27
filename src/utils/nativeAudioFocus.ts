import { nextTick, watch } from "vue";
import { isCapacitor } from "@/utils/env";
import { useStatusStore } from "@/stores";
import { usePlayerController } from "@/core/player/PlayerController";
import { useAudioManager } from "@/core/player/AudioManager";
import {
  AudioFocusPolicy,
  type AudioFocusAction,
  type AudioFocusEventType,
} from "@/core/player/audioFocusPolicy";
import { AudioFocus } from "@/plugins/AudioFocusPlugin";

/**
 * 安卓原生音频焦点事件处理
 *
 * 原生层收到系统焦点回调（focusChange）与耳机拔出广播（becomingNoisy）后
 * 转发到 WebView，这里用纯逻辑状态机 audioFocusPolicy 决策，
 * 再驱动真实播放暂停/恢复/压低音量，与 PC 端音频焦点行为对齐。
 */
export const initNativeAudioFocus = () => {
  if (!isCapacitor) return;

  const policy = new AudioFocusPolicy();
  const statusStore = useStatusStore();
  const playerCtrl = usePlayerController();
  const audioManager = useAudioManager();

  /** 标记当前正在执行的暂停由焦点事件代劳（区别于用户手动暂停） */
  let systemPausePending = false;

  /**
   * 依次执行状态机产出的动作
   * @param actions 动作列表
   */
  const applyActions = async (actions: AudioFocusAction[]) => {
    for (const action of actions) {
      switch (action.type) {
        case "pause":
          systemPausePending = true;
          await playerCtrl.pause();
          // 等待 watch 消费代劳标记后兜底清除，避免 pause 早退（无 src）时标记残留
          await nextTick();
          systemPausePending = false;
          break;
        case "resume":
          systemPausePending = false;
          await playerCtrl.play();
          break;
        case "duck":
        case "unduck":
          audioManager.setVolume(action.volume);
          break;
      }
    }
  };

  /**
   * 按当前播放状态处理一次焦点事件
   * 音量以引擎实际输出值为准（含静音/渐变状态），保证压低与还原不跳变
   * @param event 焦点事件类型
   */
  const handleFocusEvent = (event: AudioFocusEventType) => {
    const actions = policy.handleEvent(event, statusStore.playStatus, audioManager.getVolume());
    if (actions.length > 0) {
      console.log("[AudioFocus] event:", event, "actions:", actions.map((a) => a.type));
      applyActions(actions);
    }
  };

  AudioFocus.addListener("focusChange", (data) => {
    handleFocusEvent((data?.type ?? "loss") as AudioFocusEventType);
  });

  AudioFocus.addListener("becomingNoisy", () => {
    handleFocusEvent("becomingNoisy");
  });

  // 播放状态变化时维护自动恢复资格：
  // - 变为播放：清除资格（若为焦点代劳的恢复，资格已被状态机提前消费，此处为幂等兜底）
  // - 变为暂停：焦点事件代劳的暂停保留资格（gain 回归后恢复）；用户手动暂停则清除资格
  watch(
    () => statusStore.playStatus,
    (playing) => {
      if (playing) {
        systemPausePending = false;
        policy.onUserPlay();
      } else if (systemPausePending) {
        systemPausePending = false;
      } else {
        policy.onUserPause();
      }
    },
  );
};
