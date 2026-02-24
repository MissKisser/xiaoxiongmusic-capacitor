import { defineStore } from 'pinia';
import api from '@/utils/api';

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
    isAuthorized: boolean;
    authCode: string | null;
    deviceId: string;
    isChecking: boolean;
    errorMessage: string | null;
}

export const useAuthStore = defineStore('auth', {
    state: (): AuthState => ({
        isAuthorized: false,
        authCode: null,
        deviceId: getDeviceId(),
        isChecking: false,
        errorMessage: null,
    }),

    persist: {
        key: 'xiaoxiong_auth',
        pick: ['isAuthorized', 'authCode', 'deviceId'],
    },

    actions: {
        // 检查授权状态
        async checkAuth(): Promise<boolean> {
            this.isChecking = true;
            this.errorMessage = null;

            try {
                // api 实例会自动处理 baseURL (Capacitor 下为 https://music.viaxv.top)
                const response = await api.get('/auth/check', {
                    params: { deviceId: this.deviceId },
                });

                if (response.data.success && response.data.authorized) {
                    this.isAuthorized = true;
                    return true;
                } else {
                    this.isAuthorized = false;
                    this.errorMessage = response.data.message || '授权验证失败';
                    return false;
                }
            } catch (error: any) {
                console.error('CheckAuth Error:', error);
                this.isAuthorized = false;
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

            console.log('AppAuth: 开始验证授权码', code, this.deviceId);

            try {
                const response = await api.post('/auth/verify', {
                    code: code.trim(),
                    deviceId: this.deviceId,
                    platform: 'android',
                });

                console.log('AppAuth: 验证响应', response.data);

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
