import axios from 'axios';


// 创建 axios 实例
// 创建 axios 实例
const api = axios.create({
    baseURL: 'https://music.viaxv.top/api',
    timeout: 15000,
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
