import { registerPlugin } from '@capacitor/core';

/**
 * 音频焦点事件数据
 */
export interface AudioFocusChangeEvent {
    /** 焦点事件类型：gain 焦点回归 | loss 永久抢占 | transientLoss 暂时抢占 | canDuck 可压低抢占 */
    type: 'gain' | 'loss' | 'transientLoss' | 'canDuck';
}

/**
 * 耳机拔出事件数据
 */
export interface AudioBecomingNoisyEvent {
    /** 事件原因标识 */
    reason: string;
}

/**
 * 音频焦点插件接口
 * 由原生层申请/释放音频焦点，并转发系统焦点变化与耳机拔出事件
 */
export interface AudioFocusPluginInterface {
    /**
     * 申请音频焦点
     */
    requestFocus(): Promise<{ granted: boolean }>;

    /**
     * 释放音频焦点
     */
    abandonFocus(): Promise<void>;

    /**
     * 添加事件监听器
     */
    addListener(
        eventName: 'focusChange' | 'becomingNoisy',
        listenerFunc: (data: any) => void,
    ): Promise<{ remove: () => void }>;
}

const AudioFocus = registerPlugin<AudioFocusPluginInterface>('AudioFocus', {
    web: () => import('./AudioFocusWeb').then(m => new m.AudioFocusWeb()),
});

export { AudioFocus };
