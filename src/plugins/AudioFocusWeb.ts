import { WebPlugin } from '@capacitor/core';
import type { AudioFocusPluginInterface } from './AudioFocusPlugin';

/**
 * 音频焦点插件 Web 平台空实现
 * Web 平台不存在系统音频焦点仲裁，仅返回占位结果
 */
export class AudioFocusWeb extends WebPlugin implements AudioFocusPluginInterface {
    async requestFocus(): Promise<{ granted: boolean }> {
        console.log('[AudioFocus] Web platform - no implementation');
        return { granted: false };
    }

    async abandonFocus(): Promise<void> {
        console.log('[AudioFocus] Web platform - no implementation');
    }
}
