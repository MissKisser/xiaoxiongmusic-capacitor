import { defineStore } from 'pinia';
import axios from 'axios';
import packageJson from '@/../package.json';

interface VersionInfo {
    version: string;
    buildNumber: number;
    apkUrl: string;
    description: string;
    isForce: boolean;
}

interface VersionState {
    hasUpdate: boolean;
    isChecking: boolean;
    isDownloading: boolean;
    downloadProgress: number;
    versionInfo: VersionInfo | null;
    errorMessage: string | null;
    currentVersion: string; // 当前应用版本
}

export const useVersionStore = defineStore('version', {
    state: (): VersionState => ({
        hasUpdate: false,
        isChecking: false,
        isDownloading: false,
        downloadProgress: 0,
        versionInfo: null,
        errorMessage: null,
        currentVersion: packageJson.version || '3.9.0',
    }),

    actions: {
        // 设置当前版本号 (由 updateChecker 调用)
        setCurrentVersion(ver: string) {
            this.currentVersion = ver;
        },

        // 检查更新
        async checkUpdate(): Promise<boolean> {
            this.isChecking = true;
            this.errorMessage = null;

            try {
                const response = await axios.get('/api/version/check', {
                    params: {
                        platform: 'android',
                        version: this.currentVersion,
                    },
                    timeout: 10000,
                });

                console.log('[VersionCheck] API Response:', response.data);

                if (response.data.success && response.data.hasUpdate && response.data.data) {
                    this.hasUpdate = true;
                    this.versionInfo = response.data.data;
                    return true;
                } else {
                    this.hasUpdate = false;
                    this.versionInfo = null;
                    return false;
                }
            } catch (error: any) {
                console.warn('[VersionCheck] Version check failed:', error);
                this.hasUpdate = false;
                return false;
            } finally {
                this.isChecking = false;
            }
        },

        // 开始下载更新 (调用浏览器)
        async downloadUpdate(): Promise<boolean> {
            if (!this.versionInfo?.apkUrl) {
                this.errorMessage = '下载链接无效';
                return false;
            }

            try {
                console.log(`[VersionCheck] 调用浏览器下载: ${this.versionInfo.apkUrl}`);

                // 使用 window.open 打开系统浏览器下载
                // _system 目标确保即使在 WebView 中也能唤起外部浏览器
                window.open(this.versionInfo.apkUrl, '_system');

                return true;
            } catch (error: any) {
                console.error('[VersionCheck] Open browser failed:', error);
                this.errorMessage = '无法打开浏览器';
                return false;
            }
        },

        // 打开安装器 (已弃用，保留存根)
        async openInstaller(uri: string) {
            console.warn('[VersionCheck] openInstaller is deprecated');
        },

        // 重置状态
        reset() {
            this.hasUpdate = false;
            this.isDownloading = false;
            this.downloadProgress = 0;
            this.versionInfo = null;
            this.errorMessage = null;
        },
    },
});
