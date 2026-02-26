import { WebPlugin } from '@capacitor/core';
import type { MusicNotificationPlugin } from './MusicNotificationPlugin';

/**
 * Web 平台空实现
 */
export class MusicNotificationWeb extends WebPlugin implements MusicNotificationPlugin {
    async initialize(): Promise<void> {
        console.log('[MusicNotification] Web platform - no implementation');
    }

    async updateMetadata(): Promise<void> {
        // Web 平台不需要实现
    }

    async updatePlaybackState(): Promise<void> {
        // Web 平台不需要实现
    }

    async updatePosition(): Promise<void> {
        // Web 平台不需要实现
    }

    async destroy(): Promise<void> {
        // Web 平台不需要实现
    }

    async setSleepTimer(): Promise<void> {
        // Web 平台不需要实现
    }

    async clearSleepTimer(): Promise<void> {
        // Web 平台不需要实现
    }
}
