/**
 * 音频焦点事件处理状态机（纯逻辑，无平台依赖，可单元测试）
 *
 * 依据系统音频焦点回调类型与当前播放状态，产出对播放器应执行的动作序列：
 * - loss（永久抢占）：暂停且不自动恢复，需用户手动继续
 * - transientLoss（暂时抢占，如来电）：暂停，焦点回归后自动恢复
 * - canDuck（可压低抢占，如通知音/其他应用短暂出声）：压低音量，焦点回归后还原
 * - gain（焦点回归）：还原音量并恢复由焦点事件引起的暂停
 * - becomingNoisy（耳机拔出）：暂停且不自动恢复
 */

/** 音频焦点事件类型 */
export type AudioFocusEventType =
  | "gain"
  | "loss"
  | "transientLoss"
  | "canDuck"
  | "becomingNoisy";

/** 对播放器执行的动作 */
export type AudioFocusAction =
  | { type: "pause" }
  | { type: "resume" }
  | { type: "duck"; volume: number }
  | { type: "unduck"; volume: number };

/** 压低音量系数：抢占期间保留原音量的 20% */
export const DUCK_VOLUME_FACTOR = 0.2;

/**
 * 音频焦点状态机
 * 记录暂停来源与压低音量状态，将焦点事件翻译为播放器动作
 */
export class AudioFocusPolicy {
  /** 是否因焦点暂时被抢占而暂停（gain 时凭此恢复） */
  private pausedByTransientLoss = false;
  /** 是否处于压低音量状态 */
  private ducked = false;
  /** 压低前的音量，用于还原 */
  private volumeBeforeDuck = 0;

  /**
   * 处理音频焦点事件
   * @param event 焦点事件类型
   * @param isPlaying 当前是否正在播放
   * @param currentVolume 当前音量（0-1），用于压低与还原计算
   * @returns 应依次执行的动作列表
   */
  handleEvent(
    event: AudioFocusEventType,
    isPlaying: boolean,
    currentVolume: number,
  ): AudioFocusAction[] {
    switch (event) {
      case "loss":
        return this.handleLoss(isPlaying);
      case "transientLoss":
        return this.handleTransientLoss(isPlaying);
      case "canDuck":
        return this.handleCanDuck(isPlaying, currentVolume);
      case "gain":
        return this.handleGain();
      case "becomingNoisy":
        return this.handleBecomingNoisy(isPlaying);
      default:
        return [];
    }
  }

  /**
   * 用户手动播放：清除自动恢复资格，避免焦点回归时与用户意图冲突
   */
  onUserPlay(): void {
    this.pausedByTransientLoss = false;
  }

  /**
   * 用户手动暂停：清除自动恢复资格，避免焦点回归时打断用户意图
   */
  onUserPause(): void {
    this.pausedByTransientLoss = false;
  }

  /**
   * 处理永久抢占：暂停并终止一切自动恢复/还原资格
   * @param isPlaying 当前是否正在播放
   * @returns 动作列表
   */
  private handleLoss(isPlaying: boolean): AudioFocusAction[] {
    this.pausedByTransientLoss = false;
    const actions: AudioFocusAction[] = [];
    const unduck = this.buildUnduck();
    if (unduck) actions.push(unduck);
    if (isPlaying) actions.push({ type: "pause" });
    return actions;
  }

  /**
   * 处理暂时抢占：仅播放中暂停并记录恢复资格
   * @param isPlaying 当前是否正在播放
   * @returns 动作列表
   */
  private handleTransientLoss(isPlaying: boolean): AudioFocusAction[] {
    if (isPlaying) {
      this.pausedByTransientLoss = true;
      return [{ type: "pause" }];
    }
    return [];
  }

  /**
   * 处理可压低抢占：仅播放中压低音量，不暂停
   * @param isPlaying 当前是否正在播放
   * @param currentVolume 当前音量
   * @returns 动作列表
   */
  private handleCanDuck(isPlaying: boolean, currentVolume: number): AudioFocusAction[] {
    if (isPlaying) {
      this.ducked = true;
      this.volumeBeforeDuck = currentVolume;
      return [{ type: "duck", volume: currentVolume * DUCK_VOLUME_FACTOR }];
    }
    return [];
  }

  /**
   * 处理焦点回归：还原音量，并仅恢复由本次焦点事件引起的暂停
   * @returns 动作列表
   */
  private handleGain(): AudioFocusAction[] {
    const actions: AudioFocusAction[] = [];
    const unduck = this.buildUnduck();
    if (unduck) actions.push(unduck);
    if (this.pausedByTransientLoss) {
      this.pausedByTransientLoss = false;
      actions.push({ type: "resume" });
    }
    return actions;
  }

  /**
   * 处理耳机拔出：暂停且不自动恢复，同时终止自动恢复资格
   * @param isPlaying 当前是否正在播放
   * @returns 动作列表
   */
  private handleBecomingNoisy(isPlaying: boolean): AudioFocusAction[] {
    this.pausedByTransientLoss = false;
    const actions: AudioFocusAction[] = [];
    const unduck = this.buildUnduck();
    if (unduck) actions.push(unduck);
    if (isPlaying) actions.push({ type: "pause" });
    return actions;
  }

  /**
   * 生成音量还原动作并结束压低状态
   * @returns 还原动作，未处于压低状态时返回 null
   */
  private buildUnduck(): AudioFocusAction | null {
    if (!this.ducked) return null;
    this.ducked = false;
    return { type: "unduck", volume: this.volumeBeforeDuck };
  }
}
