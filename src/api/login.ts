import request from "@/utils/request";

/**
 * 生成二维码 key
 * @returns 二维码 key 请求 Promise
 */
export const qrKey = () => {
  return request({
    url: "/login/qr/key",
    params: {
      noCookie: true,
      timestamp: Date.now(),
    },
  });
};

/**
 * 生成二维码
 * @param key 二维码 key
 * @param qrimg 是否返回二维码图片
 * @returns 二维码数据请求 Promise
 */
export const qrCreate = (key: string, qrimg: boolean = true) => {
  return request({
    url: "/login/qr/create",
    params: {
      key,
      qrimg,
      noCookie: true,
      timestamp: Date.now(),
    },
  });
};

/**
 * 检查二维码状态
 * @param key 二维码 key
 * @returns 二维码状态请求 Promise
 */
export const checkQr = (key: string) => {
  return request({
    url: "/login/qr/check",
    params: {
      key,
      noCookie: true,
      timestamp: Date.now(),
    },
  });
};


/**
 * 获取登录状态
 * @returns 登录状态请求 Promise
 */
export const getLoginState = () => {
  return request({
    url: "/login/status",
    params: {
      timestamp: Date.now(),
    },
  });
};

/**
 * 刷新登录
 * @returns 刷新登录请求 Promise
 */
export const refreshLogin = () => {
  return request({
    url: "/login/refresh",
    params: {
      timestamp: Date.now(),
    },
  });
};

/**
 * 退出登录
 * @returns 退出登录请求 Promise
 */
export const logout = () => {
  return request({
    url: "/logout",
    params: {
      timestamp: Date.now(),
    },
  });
};

/**
 * 国家码列表
 * @returns 国家码列表请求 Promise
 */
export const countryList = () => {
  return request({
    url: "/countries/code/list",
  });
};
