import {
  AUDIO_EVENTS,
  AudioErrorCode,
  BaseAudioPlayer,
  type AudioEventType,
} from "./BaseAudioPlayer";
import type { EngineCapabilities } from "./IPlaybackEngine";

/**
 * 基于 HTMLAudioElement 的播放器实现
 *
 * 使用原生 HTML5 Audio 元素进行音频播放，支持大多数常见格式
 * 通过 MediaElementAudioSourceNode 连接到 Web Audio API 音频图谱
 */
export class AudioElementPlayer extends BaseAudioPlayer {
  /** 内部 Audio 元素 */
  private audioElement: HTMLAudioElement;
  /** MediaElementAudioSourceNode 用于连接 Web Audio API */
  private sourceNode: MediaElementAudioSourceNode | null = null;

  /** Seek 锁，用于在 seek 过程中返回稳定的 currentTime */
  private isInternalSeeking = false;
  /** 目标时间缓存，用于在 seek 过程中返回稳定的 currentTime */
  private targetSeekTime = 0;

  /** 引擎能力描述 */
  public override readonly capabilities: EngineCapabilities = {
    supportsRate: true,
    supportsSinkId: true,
    supportsEqualizer: true,
    supportsSpectrum: true,
  };

  constructor() {
    super();
    this.audioElement = new Audio();
    this.audioElement.crossOrigin = "anonymous";
    this.audioElement.preload = "metadata"; // 优化预加载，减少缓冲
    this.bindInternalEvents();

    this.audioElement.addEventListener("seeked", () => {
      this.isInternalSeeking = false;
    });
  }

  /**
   * 当音频图谱初始化完成时调用
   * 创建 MediaElementAudioSourceNode 并连接到输入节点
   */
  protected onGraphInitialized(): void {
    if (!this.audioCtx || !this.inputNode) return;

    try {
      this.sourceNode = this.audioCtx.createMediaElementSource(this.audioElement);

      this.sourceNode.connect(this.inputNode);
    } catch (error) {
      console.error("[AudioElementPlayer] SourceNode 创建失败", error);
    }
  }

  /**
   * 加载音频资源
   * @param url 音频地址
   */
  public async load(url: string): Promise<void> {
    // 先清空旧的音频源，防止切换时产生刺耳声音
    this.audioElement.pause();
    this.audioElement.src = "";
    this.audioElement.load();

    // 设置新的音频源
    this.audioElement.src = url;
    this.audioElement.load();
  }

  /**
   * 执行底层播放
   * @returns 播放 Promise
   */
  protected async doPlay(): Promise<void> {
    // 播放时重置 seek 状态，防止卡在 seeking 状态
    this.isInternalSeeking = false;
    return this.audioElement.play();
  }

  /**
   * 执行底层暂停
   */
  protected doPause(): void {
    this.audioElement.pause();
  }

  /**
   * 跳转到指定时间
   * @param time 目标时间（秒）
   */
  public async seek(time: number): Promise<void> {
    this.isInternalSeeking = true;
    this.targetSeekTime = time;

    this.cancelPendingPause();
    this.doSeek(time);

    // 在移动端，seeked 事件可能不触发，添加超时重置
    setTimeout(() => {
      if (this.isInternalSeeking) {
        this.isInternalSeeking = false;
      }
    }, 200);
  }

  /**
   * 执行底层 Seek
   * @param time 目标时间（秒）
   */
  protected doSeek(time: number): void {
    if (Number.isFinite(time)) {
      this.audioElement.currentTime = time;
    }
  }

  /**
   * 设置播放速率
   * @param value 速率值 (0.5 - 2.0)
   */
  public setRate(value: number): void {
    this.audioElement.playbackRate = value;
    this.audioElement.defaultPlaybackRate = value;
  }

  /**
   * 获取当前播放速率
   * @returns 当前速率值
   */
  public getRate(): number {
    return this.audioElement.playbackRate;
  }

  /**
   * 设置音频输出设备
   * @param deviceId 设备 ID
   */
  protected async doSetSinkId(deviceId: string): Promise<void> {
    if (typeof this.audioElement.setSinkId === "function") {
      await this.audioElement.setSinkId(deviceId);
    }
  }

  /** 获取当前音频源地址 */
  public get src(): string {
    return this.audioElement.src || "";
  }

  /** 获取音频总时长（秒） */
  public get duration(): number {
    return this.audioElement.duration || 0;
  }

  /**
   * 获取当前播放时间（秒）
   * 如果正在 Seek，返回目标时间以避免进度跳回
   */
  public get currentTime(): number {
    const time = this.audioElement.currentTime || 0;
    if (this.isInternalSeeking) {
      return this.targetSeekTime;
    }
    return time;
  }

  /** 获取是否暂停状态 */
  public get paused(): boolean {
    return this.audioElement.paused;
  }

  /**
   * 获取错误码
   * @returns 错误码 (0: 无错误, 1: ABORTED, 2: NETWORK, 3: DECODE, 4: SRC_NOT_SUPPORTED)
   */
  public getErrorCode(): number {
    if (!this.audioElement.error) return 0;
    switch (this.audioElement.error.code) {
      case MediaError.MEDIA_ERR_ABORTED:
        return AudioErrorCode.ABORTED;
      case MediaError.MEDIA_ERR_NETWORK:
        return AudioErrorCode.NETWORK;
      case MediaError.MEDIA_ERR_DECODE:
        return AudioErrorCode.DECODE;
      case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
        return AudioErrorCode.SRC_NOT_SUPPORTED;
      default:
        return 0;
    }
  }

  /**
   * 监听原生 DOM 事件并转发为标准事件
   * 将 HTMLAudioElement 的事件转换为 BaseAudioPlayer 的统一事件格式
   */
  private bindInternalEvents() {
    const events: AudioEventType[] = Object.values(AUDIO_EVENTS);

    events.forEach((eventType) => {
      this.audioElement.addEventListener(eventType, (e) => {
        if (eventType === AUDIO_EVENTS.ERROR) {
          this.emit(AUDIO_EVENTS.ERROR, {
            originalEvent: e,
            errorCode: this.getErrorCode(),
          });
        } else {
          this.emit(eventType);
        }
      });
    });
  }
}
