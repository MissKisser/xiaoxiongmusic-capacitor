import axios from 'axios';
import axiosRetry from 'axios-retry';


// 创建 axios 实例
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
    // 重试条件：网络错误 / 5xx（默认幂等判定保留），额外覆盖 401
    // 注意：axios-retry 默认只重试幂等方法（GET/HEAD/OPTIONS/PUT/DELETE），
    // /auth/verify 是 POST，不会被重试（验证码不应自动重试，符合预期）
    retryCondition: (error) =>
        axiosRetry.isNetworkOrIdempotentRequestError(error) || error.response?.status === 401,
    // 指数退避（base ~100ms）
    retryDelay: axiosRetry.exponentialDelay,
    // 重试时重置超时计时器，避免重试请求被累计的超时误杀
    shouldResetTimeout: true,
});

// 请求拦截器
api.interceptors.request.use(
    (config) => {
        // 统一日志标识: AUTH_LOG
        if (config.url?.includes('auth')) {
            console.log(`AUTH_LOG: Request [${config.method?.toUpperCase()}] ${config.url}`, config.data || config.params);
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
            console.log(`AUTH_LOG: Response [${response.status}] ${response.config.url}`, response.data);
        }
        return response;
    },
    (error) => {
        if (error.config?.url?.includes('auth')) {
            console.error(`AUTH_LOG: Response Error [${error.response?.status}] ${error.config.url}`, error.response?.data || error.message);
        }
        return Promise.reject(error);
    }
);

export default api;
