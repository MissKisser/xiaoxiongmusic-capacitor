/**
 * 耳机拔出暂停策略（纯逻辑，无平台依赖，可单元测试）
 *
 * 职责边界：系统音频焦点的唯一持有者是 WebView 内部的媒体会话（Chromium MediaSession），
 * 来电/他人抢占的暂停、通知类抢占的压低音量、焦点回归后的按需恢复均由其原生仲裁：
 * - 永久抢占：媒体会话暂停并放弃焦点，不自动恢复，需用户手动继续
 * - 暂时抢占（如来电）：暂停，焦点回归后自动恢复；用户在抢占前手动暂停的不被顶掉
 * - 可压低抢占（如通知音）：媒体会话原生压低音量，焦点回归后还原
 *
 * WebView 侧仅剩耳机拔出（ACTION_AUDIO_BECOMING_NOISY）需要自行处理：
 * 播放中收到该事件立即暂停，且不自动恢复。
 */

/** 焦点桥接事件类型 */
export type AudioFocusEventType = "becomingNoisy";

/** 对播放器执行的动作 */
export type AudioFocusAction = { type: "pause" };

/**
 * 耳机拔出暂停策略
 * 将焦点桥接事件翻译为播放器动作
 */
export class AudioFocusPolicy {
  /**
   * 处理焦点桥接事件
   * @param event 事件类型
   * @param isPlaying 当前是否正在播放
   * @returns 应依次执行的动作列表
   */
  handleEvent(event: AudioFocusEventType, isPlaying: boolean): AudioFocusAction[] {
    if (event === "becomingNoisy") return this.handleBecomingNoisy(isPlaying);
    return [];
  }

  /**
   * 处理耳机拔出：播放中暂停且不自动恢复，需用户手动继续
   * @param isPlaying 当前是否正在播放
   * @returns 动作列表
   */
  private handleBecomingNoisy(isPlaying: boolean): AudioFocusAction[] {
    if (isPlaying) return [{ type: "pause" }];
    return [];
  }
}
