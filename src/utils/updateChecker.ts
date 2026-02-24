/**
 * 独立的版本更新检查服务
 * 专为 Capacitor 环境设计,提供可靠的版本检测和日志输出
 */

import api from '@/utils/api';
import { useVersionStore } from '@/stores';
import packageJson from '@/../package.json';
import { App } from '@capacitor/app';

const LOG_TAG = '[UpdateChecker]';

export interface VersionInfo {
    version: string;
    buildNumber: number;
    apkUrl: string;
    description: string;
    isForce: boolean;
}

export interface CheckResult {
    hasUpdate: boolean;
    versionInfo: VersionInfo | null;
}

/**
 * 获取当前应用版本
 * 优先尝试从 Capacitor 原生层获取，失败则回退到 package.json
 */
export async function getCurrentVersion(): Promise<string> {
    try {
        const info = await App.getInfo();
        console.log(`${LOG_TAG} 原生应用版本: ${info.version}`);
        return info.version;
    } catch (e) {
        console.warn(`${LOG_TAG} 获取原生版本失败，回退到 package.json`, e);
        const version = packageJson.version || '3.9.0';
        console.log(`${LOG_TAG} package.json 版本: ${version}`);
        return version;
    }
}

/**
 * 检查更新 (核心函数)
 */
export async function checkForUpdates(): Promise<CheckResult> {
    console.log(`${LOG_TAG} ========== 开始检查更新 ==========`);

    try {
        // 使用 await 获取版本
        const currentVersion = await getCurrentVersion();
        const platform = 'android'; // 目前只支持 Android

        console.log(`${LOG_TAG} 请求参数: platform=${platform}, version=${currentVersion}`);

        const url = '/api/version/check';
        console.log(`${LOG_TAG} 请求 URL: ${url}`);

        const response = await api.get('/version/check', {
            params: {
                platform,
                version: currentVersion
            },
            timeout: 10000
        });

        console.log(`${LOG_TAG} 服务器响应:`, JSON.stringify(response.data));

        if (!response.data) {
            console.error(`${LOG_TAG} 响应数据为空`);
            return { hasUpdate: false, versionInfo: null };
        }

        const { success, hasUpdate, data } = response.data;

        if (!success) {
            console.warn(`${LOG_TAG} API 返回失败:`, response.data.message);
            return { hasUpdate: false, versionInfo: null };
        }

        if (hasUpdate && data) {
            console.log(`${LOG_TAG} ✅ 发现新版本!`);
            console.log(`${LOG_TAG}   - 版本号: ${data.version}`);
            console.log(`${LOG_TAG}   - Build: ${data.buildNumber}`);
            console.log(`${LOG_TAG}   - 强制更新: ${data.isForce ? '是' : '否'}`);
            console.log(`${LOG_TAG}   - 下载地址: ${data.apkUrl}`);

            return {
                hasUpdate: true,
                versionInfo: {
                    version: data.version,
                    buildNumber: data.buildNumber,
                    apkUrl: data.apkUrl,
                    description: data.description || '',
                    isForce: !!data.isForce
                }
            };
        } else {
            console.log(`${LOG_TAG} ✅ 已是最新版本`);
            return { hasUpdate: false, versionInfo: null };
        }

    } catch (error: any) {
        console.error(`${LOG_TAG} ❌ 检查更新失败:`, error);
        if (error.response) {
            console.error(`${LOG_TAG}   HTTP ${error.response.status}:`, error.response.data);
        } else if (error.request) {
            console.error(`${LOG_TAG}   网络请求失败 (无响应)`);
        } else {
            console.error(`${LOG_TAG}   错误信息:`, error.message);
        }
        return { hasUpdate: false, versionInfo: null };
    } finally {
        console.log(`${LOG_TAG} ========== 检查更新结束 ==========`);
    }
}

/**
 * 执行版本检查并更新 store
 * 返回是否发现新版本
 */
export async function performVersionCheck(): Promise<boolean> {
    console.log(`${LOG_TAG} 🚀 执行版本检查任务...`);

    const versionStore = useVersionStore();

    // 1. 获取并同步当前版本到 Store (解决弹窗显示 3.9.0 的问题)
    const currentVersion = await getCurrentVersion();
    versionStore.setCurrentVersion(currentVersion);

    // 2. 检查更新
    const result = await checkForUpdates();

    if (result.hasUpdate && result.versionInfo) {
        versionStore.hasUpdate = true;
        versionStore.versionInfo = result.versionInfo;
        console.log(`${LOG_TAG} ✅ Store 已更新,准备显示更新弹窗`);
        return true;
    } else {
        versionStore.hasUpdate = false;
        versionStore.versionInfo = null;
        console.log(`${LOG_TAG} ℹ️ 无更新,Store 状态已重置`);
        return false;
    }
}
