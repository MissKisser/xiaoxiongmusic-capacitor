import { WebPlugin } from '@capacitor/core';
import type { AudioFocusPluginInterface } from './AudioFocusPlugin';

/**
 * 音频焦点桥接插件 Web 平台空实现
 * Web 平台不存在系统音频焦点仲裁，事件监听由 WebPlugin 基类提供
 */
export class AudioFocusWeb extends WebPlugin implements AudioFocusPluginInterface {
    async isNoisyMonitorReady(): Promise<{ noisySupported: boolean }> {
        return { noisySupported: false };
    }
}
