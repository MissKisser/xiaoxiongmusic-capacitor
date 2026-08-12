/**
 * decode-audio.js 类型声明
 * 该文件为 ffmpeg.wasm 官方工具生成的解码核心（Auto-generated），
 * 此处仅声明其对外接口，供 audio.worker.ts 类型安全调用
 */
declare module "@/assets/ffmpeg/decode-audio.js" {
  import type { AudioDecoderModule } from "@/core/audio-player/ffmpeg-engine/types";

  interface CreateAudioDecoderCoreOptions {
    /** 定位资源文件（wasm 等）的路径 */
    locateFile?: (path: string) => string;
    /** 标准输出回调 */
    print?: (text: string) => void;
    /** 错误输出回调 */
    printErr?: (text: string) => void;
  }

  /**
   * 创建音频解码器核心模块（Emscripten MODULARIZE 导出）
   * 可能同步返回模块或返回 Promise，异步形态下 await 后即得 Module
   */
  const createAudioDecoderCore: (
    options?: CreateAudioDecoderCoreOptions,
  ) => Promise<AudioDecoderModule> | AudioDecoderModule;

  export default createAudioDecoderCore;
}
