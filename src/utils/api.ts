import axios from 'axios';
import axiosRetry from 'axios-retry';


// 创建 axios 实例
const api = axios.create({
    baseURL: 'https://music.viaxv.top/api',
    timeout: 15000,
});

// 请求重试：授权接口（/auth/check 是 GET）在网络抖动时自动重试，
// 克服冷启动 / 弱网下单次请求失败导致 GlobalAuthModal 误弹窗
axiosRetry(api, {
    // 重试次数
    retries: 3,
    // 重试条件：仅网络错误与幂等请求的 5xx；业务性 401（未授权/授权码无效）不重试，
    // 避免 POST /auth/verify 重复提交且延迟错误反馈
    retryCondition: (error) => {
        if (axiosRetry.isNetworkError(error)) return true;
        if (axiosRetry.isIdempotentRequestError(error) && (error.response?.status === 401 || (error.response?.status ?? 0) >= 500)) return true;
        return false;
    },
    // 指数退避（base ~100ms）
    retryDelay: axiosRetry.exponentialDelay,
    // 重试时重置超时计时器，避免重试请求被累计的超时误杀
    shouldResetTimeout: true,
});

// 请求拦截器
api.interceptors.request.use(
    (config) => {
        // 统一日志标识: AUTH_LOG（敏感字段脱敏，不打印 code/params 原文）
        if (config.url?.includes('auth')) {
            console.log(`AUTH_LOG: Request [${config.method?.toUpperCase()}] ${config.url}`);
        }
        return config;
    },
    (error) => {
        console.error('AUTH_LOG: Request Error', error);
        return Promise.reject(error);
    }
);

// 响应拦截器
api.interceptors.response.use(
    (response) => {
        if (response.config.url?.includes('auth')) {
            console.log(`AUTH_LOG: Response [${response.status}] ${response.config.url}`);
        }
        return response;
    },
    (error) => {
        if (error.config?.url?.includes('auth')) {
            console.error(`AUTH_LOG: Response Error [${error.response?.status}] ${error.config.url}`, error.response?.data?.message || error.message);
        }
        return Promise.reject(error);
    }
);

export default api;
