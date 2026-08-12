import { defineStore } from 'pinia';
import api from '@/utils/api';
import { mask } from '@/utils/mask';

// 生成设备 ID (持久化存储)
const getDeviceId = (): string => {
    const key = 'xiaoxiong_device_id';
    let deviceId = localStorage.getItem(key);
    if (!deviceId) {
        deviceId = 'device_' + Math.random().toString(36).substring(2, 15) +
            Math.random().toString(36).substring(2, 15) +
            '_' + Date.now().toString(36);
        localStorage.setItem(key, deviceId);
    }
    return deviceId;
};

interface AuthState {
    // 是否已授权（持久化，作为网络抖动时的兜底状态）
    isAuthorized: boolean;
    authCode: string | null;
    deviceId: string;
    isChecking: boolean;
    errorMessage: string | null;
    // 服务端是否要求授权（对应后台授权开关：false=该端免授权）
    // 会话级状态，不持久化。开关关闭时 GlobalAuthModal 永不弹窗。
    authRequired: boolean;
    // 本次检查是否为网络/服务器错误（区别于"确实未授权"）
    // 会话级状态，不持久化。true 时弹"网络重试"而非授权码输入框。
    networkError: boolean;
}

export const useAuthStore = defineStore('auth', {
    state: (): AuthState => ({
        isAuthorized: false,
        authCode: null,
        deviceId: getDeviceId(),
        isChecking: false,
        errorMessage: null,
        // 默认 true（保守策略：未知服务端行为时按需授权处理）
        authRequired: true,
        networkError: false,
    }),

    persist: {
        key: 'xiaoxiong_auth',
        // 仅持久化稳定状态，会话级字段（authRequired/networkError）每次启动重置
        pick: ['isAuthorized', 'authCode', 'deviceId'],
    },

    actions: {
        // 检查授权状态
        async checkAuth(): Promise<boolean> {
            this.isChecking = true;
            this.errorMessage = null;
            // 进入新一轮检查，重置会话级标志（由本次结果重新判定）
            this.networkError = false;

            try {
                // api 实例会自动处理 baseURL (Capacitor 下为 https://music.viaxv.top)
                const response = await api.get('/auth/check', {
                    params: { deviceId: this.deviceId, platform: 'android' },
                });

                // 兼容旧版服务端（无 authRequired 字段时默认 true）
                const authRequired = response.data.authRequired !== false;
                this.authRequired = authRequired;

                if (response.data.success && response.data.authorized) {
                    this.isAuthorized = true;
                    return true;
                } else {
                    // 确实未授权（服务端明确返回未通过），清空授权态
                    this.isAuthorized = false;
                    this.errorMessage = response.data.message || '授权验证失败';
                    return false;
                }
            } catch (error: any) {
                console.error('CheckAuth Error:', error);
                // 服务端明确拒绝（401 未授权 / 403 封禁）：属业务性拒绝，不是网络错误
                // 此时应展示授权码输入框，而非"网络异常"重试视图
                const status = error.response?.status;
                if (status === 401 || status === 403) {
                    this.networkError = false;
                    this.isAuthorized = false;
                    this.errorMessage = error.response.data?.message || '授权验证失败';
                    return false;
                }
                // 网络/服务器错误不应等同于"未授权"
                // 保留持久化的 isAuthorized（上次成功状态作为兜底），
                // 避免瞬态错误触发 GlobalAuthModal 弹窗
                this.networkError = true;
                if (error.response) {
                    this.errorMessage = error.response.data?.message || '授权验证失败';
                } else {
                    this.errorMessage = '无法连接到服务器，请检查网络';
                }
                return false;
            } finally {
                this.isChecking = false;
            }
        },

        // 验证授权码
        async verifyCode(code: string): Promise<{ success: boolean; message: string }> {
            this.isChecking = true;
            this.errorMessage = null;
            this.networkError = false;

            console.log('AppAuth: 开始验证授权码', mask(code), this.deviceId);

            try {
                const response = await api.post('/auth/verify', {
                    code: code.trim(),
                    deviceId: this.deviceId,
                    platform: 'android',
                });

                if (response.data.success) {
                    this.isAuthorized = true;
                    this.authCode = code.trim();
                    return { success: true, message: '授权成功' };
                } else {
                    this.errorMessage = response.data.message || '授权码验证失败';
                    return { success: false, message: this.errorMessage || '未知错误' };
                }
            } catch (error: any) {
                console.error('AppAuth: 验证出错', error);
                // 服务端明确拒绝（401 授权码无效 / 403 封禁）：展示输入框内联错误，可重新输入
                const status = error.response?.status;
                if (status === 401 || status === 403) {
                    this.networkError = false;
                    this.errorMessage = error.response.data?.message || '授权码验证失败';
                    return { success: false, message: this.errorMessage || '未知错误' };
                }
                // 网络错误不改变 isAuthorized，仅标记 networkError 让 UI 切换到重试视图
                this.networkError = true;
                if (error.response) {
                    this.errorMessage = error.response.data?.message || '授权码验证失败';
                } else {
                    this.errorMessage = '网络连接失败，请检查网络';
                }
                return { success: false, message: this.errorMessage || '未知错误' };
            } finally {
                this.isChecking = false;
            }
        },

        // 清除授权
        clearAuth() {
            this.isAuthorized = false;
            this.authCode = null;
        },
    },
});
