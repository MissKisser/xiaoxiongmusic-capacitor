import { defineStore } from 'pinia';
import axios from 'axios';
import packageJson from '@/../package.json';
import { isCapacitor, isIos } from '@/utils/env';

/**
 * 版本信息描述
 */
export interface VersionInfo {
    version: string;
    buildNumber: number;
    apkUrl: string;
    downloadUrl?: string;
    description: string;
    isForce: boolean;
}

/**
 * 下载状态机类型
 */
export type DownloadStatus = 'idle' | 'downloading' | 'completed' | 'error';

/**
 * 版本状态接口
 */
export interface VersionState {
    hasUpdate: boolean;
    isChecking: boolean;
    isDownloading: boolean;
    downloadProgress: number;
    downloadStatus: DownloadStatus;
    downloadedFilePath: string | null;
    versionInfo: VersionInfo | null;
    errorMessage: string | null;
    currentVersion: string;
}

export const useVersionStore = defineStore('version', {
    state: (): VersionState => ({
        hasUpdate: false,
        isChecking: false,
        isDownloading: false,
        downloadProgress: 0,
        downloadStatus: 'idle',
        downloadedFilePath: null,
        versionInfo: null,
        errorMessage: null,
        currentVersion: packageJson.version || '4.9.1',
    }),

    actions: {
        /**
         * 设置当前版本号
         * @param ver 版本号字符串
         */
        setCurrentVersion(ver: string) {
            this.currentVersion = ver;
        },

        /**
         * 检查版本更新
         * @returns 是否有可用更新
         */
        async checkUpdate(): Promise<boolean> {
            if (isIos) {
                return false;
            }
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

                if (response.data?.success && response.data?.hasUpdate && response.data?.data) {
                    this.hasUpdate = true;
                    this.versionInfo = response.data.data;
                    return true;
                } else {
                    this.hasUpdate = false;
                    this.versionInfo = null;
                    return false;
                }
            } catch (error: any) {
                this.hasUpdate = false;
                return false;
            } finally {
                this.isChecking = false;
            }
        },

        /**
         * 调起系统浏览器下载
         * @param url 下载直链，缺省时使用 versionInfo 中的下载链接
         * @returns 是否成功拉起浏览器
         */
        downloadViaBrowser(url?: string): boolean {
            const targetUrl = url || this.versionInfo?.apkUrl || this.versionInfo?.downloadUrl;
            if (!targetUrl) {
                this.errorMessage = '下载链接无效';
                return false;
            }

            try {
                window.open(targetUrl, '_system');
                return true;
            } catch (error: any) {
                this.errorMessage = '无法打开系统浏览器';
                return false;
            }
        },

        /**
         * 下载并安装应用更新
         * 原生环境通过 FileTransfer 下载到缓存目录并拉起安装器，非原生环境降级至浏览器下载
         * @returns 是否成功启动下载或拉起安装器
         */
        async downloadUpdate(): Promise<boolean> {
            const targetUrl = this.versionInfo?.apkUrl || this.versionInfo?.downloadUrl;
            if (!targetUrl) {
                this.errorMessage = '下载链接无效';
                this.downloadStatus = 'error';
                return false;
            }

            this.errorMessage = null;

            // 若之前已下载完成且本地文件依然有效，尝试直接拉起安装器
            if (this.downloadStatus === 'completed' && this.downloadedFilePath) {
                const opened = await this.openInstaller();
                if (opened) {
                    return true;
                }
            }

            // 非 Capacitor 环境直接走降级通道
            if (!isCapacitor) {
                return this.downloadViaBrowser(targetUrl);
            }

            this.isDownloading = true;
            this.downloadStatus = 'downloading';
            this.downloadProgress = 0;

            let progressListener: { remove: () => Promise<void> } | null = null;

            try {
                const { Filesystem, Directory } = await import('@capacitor/filesystem');
                const { FileTransfer } = await import('@capacitor/file-transfer');

                const newVersion = this.versionInfo?.version || 'latest';
                const fileName = `xiaoxiongmusic-${newVersion}.apk`;

                await Filesystem.deleteFile({
                    path: fileName,
                    directory: Directory.Cache,
                }).catch(() => undefined);

                const fileInfo = await Filesystem.getUri({
                    directory: Directory.Cache,
                    path: fileName,
                });

                progressListener = await FileTransfer.addListener('progress', (progress) => {
                    if (progress.type === 'download' && this.isDownloading) {
                        if (progress.lengthComputable && progress.contentLength > 0) {
                            const percent = Math.min(
                                100,
                                Math.max(0, Math.round((progress.bytes / progress.contentLength) * 100))
                            );
                            this.downloadProgress = percent;
                        }
                    }
                });

                const result = await FileTransfer.downloadFile({
                    url: targetUrl,
                    path: fileInfo.uri,
                    progress: true,
                });

                if (this.downloadStatus !== 'downloading') {
                    return false;
                }

                const filePath = result.path || fileInfo.uri;
                this.downloadProgress = 100;
                this.downloadStatus = 'completed';
                this.isDownloading = false;
                this.downloadedFilePath = filePath;

                await this.openInstaller(filePath);
                return true;
            } catch (error: any) {
                this.isDownloading = false;
                this.downloadStatus = 'error';
                const errorMsg = error?.message || '下载或拉起安装失败';
                this.errorMessage = `${errorMsg}，请重试或使用浏览器下载`;
                return false;
            } finally {
                if (progressListener) {
                    await progressListener.remove().catch(() => undefined);
                }
            }
        },

        /**
         * 取消当前下载
         */
        cancelDownload() {
            if (this.isDownloading) {
                this.isDownloading = false;
                this.downloadStatus = 'idle';
                this.downloadProgress = 0;
            }
        },

        /**
         * 拉起系统安装器
         * @param uri APK 文件路径，缺省时使用已下载文件路径
         * @returns 是否成功调起系统安装器
         */
        async openInstaller(uri?: string): Promise<boolean> {
            const targetPath = uri || this.downloadedFilePath;
            if (!targetPath) {
                this.errorMessage = '未找到已下载的安装包';
                return false;
            }

            try {
                const { FileOpener } = await import('@capacitor-community/file-opener');
                await FileOpener.open({
                    filePath: targetPath,
                    contentType: 'application/vnd.android.package-archive',
                });
                return true;
            } catch (error: any) {
                this.errorMessage = '拉起安装器失败，请检查安装权限或使用浏览器下载';
                return false;
            }
        },

        /**
         * 重置更新与下载状态
         */
        reset() {
            this.hasUpdate = false;
            this.isDownloading = false;
            this.downloadProgress = 0;
            this.downloadStatus = 'idle';
            this.downloadedFilePath = null;
            this.versionInfo = null;
            this.errorMessage = null;
        },
    },
});
