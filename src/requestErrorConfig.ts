import type { RequestOptions } from '@@/plugin-request/request';
import type { RequestConfig } from '@umijs/max';
import { request as umiRequest } from '@umijs/max';
import { message, notification } from 'antd';

// 错误处理方案： 错误类型
enum ErrorShowType {
  SILENT = 0,
  WARN_MESSAGE = 1,
  ERROR_MESSAGE = 2,
  NOTIFICATION = 3,
  REDIRECT = 9,
}

// 与后端约定的响应数据格式
interface ResponseStructure {
  // Legacy format
  success?: boolean;
  errorCode?: number;
  errorMessage?: string;
  showType?: ErrorShowType;
  // New API format (API.ApiResponse)
  status?: string;
  msg?: string;
  // Shared
  data: any;
}

// 生产环境后端地址（开发环境使用代理，留空即可）
const PRODUCTION_API_BASE =
  process.env.NODE_ENV === 'production'
    ? 'https://alzheimer.dianchuang.club'
    : '';

// ============ Token 刷新机制 ============

// 刷新状态管理
let isRefreshing = false;
let refreshSubscribers: ((token: string) => void)[] = [];

// 订阅刷新完成
function subscribeTokenRefresh(callback: (token: string) => void) {
  refreshSubscribers.push(callback);
}

// 通知所有订阅者
function onTokenRefreshed(newToken: string) {
  refreshSubscribers.forEach((callback) => {
    callback(newToken);
  });
  refreshSubscribers = [];
}

// 清除认证存储
function clearAuthStorage() {
  try {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('user_role');
    localStorage.removeItem('currentUser');
  } catch {
    // localStorage 可能在某些环境下不可用
  }
}

// 执行 token 刷新
async function refreshToken(): Promise<string | null> {
  try {
    const refreshTokenValue = localStorage.getItem('refresh_token');
    const role = localStorage.getItem('user_role');

    // 早返回：无 refresh_token
    if (!refreshTokenValue) return null;

    // 根据角色选择刷新接口
    const endpoint =
      role === 'admin'
        ? '/api/doctor-admin/auth/refresh'
        : '/api/doctor/auth/refresh';

    // 直接使用 fetch 避免循环依赖
    const response = await fetch(`${PRODUCTION_API_BASE}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshTokenValue }),
    });

    // 早返回：刷新请求失败
    if (!response.ok) return null;

    const res = await response.json();

    // 早返回：业务状态非 OK
    if (res.status !== 'OK') return null;

    // 更新存储
    localStorage.setItem('access_token', res.data.access_token);
    localStorage.setItem('refresh_token', res.data.refresh_token);

    return res.data.access_token;
  } catch {
    return null;
  }
}

// 重试请求
async function retryRequest(
  config: RequestOptions,
  newToken: string,
): Promise<any> {
  const url = config.url;
  if (!url) {
    throw new Error('Request URL is required');
  }
  const newConfig = {
    ...config,
    headers: {
      ...config.headers,
      Authorization: `Bearer ${newToken}`,
    },
  };
  return umiRequest(url, newConfig);
}

/**
 * @name 错误处理
 * pro 自带的错误处理， 可以在这里做自己的改动
 * @doc https://umijs.org/docs/max/request#配置
 */
export const errorConfig: RequestConfig = {
  // 错误处理： umi@3 的错误处理方案。
  errorConfig: {
    // 错误抛出
    errorThrower: (res) => {
      const { success, data, errorCode, errorMessage, showType, status, msg } =
        res as unknown as ResponseStructure;

      // Check both formats: legacy (!success) and new (status !== 'OK')
      const isError =
        success === false || (status !== undefined && status !== 'OK');

      if (isError) {
        const error: any = new Error(errorMessage || msg || '请求失败');
        error.name = 'BizError';
        error.info = {
          errorCode,
          errorMessage: errorMessage || msg,
          showType,
          data,
        };
        throw error; // 抛出自制的错误
      }
    },
    // 错误接收及处理
    errorHandler: (error: any, opts: any) => {
      if (opts?.skipErrorHandler) throw error;

      // 跳过 401/403 错误的默认处理（由响应拦截器处理刷新逻辑）
      if (error.response?.status === 401 || error.response?.status === 403) {
        return;
      }

      // 我们的 errorThrower 抛出的错误。
      if (error.name === 'BizError') {
        const errorInfo: ResponseStructure | undefined = error.info;
        if (errorInfo) {
          const { errorMessage, errorCode } = errorInfo;
          switch (errorInfo.showType) {
            case ErrorShowType.SILENT:
              // do nothing
              break;
            case ErrorShowType.WARN_MESSAGE:
              message.warning(errorMessage);
              break;
            case ErrorShowType.ERROR_MESSAGE:
              message.error(errorMessage);
              break;
            case ErrorShowType.NOTIFICATION:
              notification.open({
                description: errorMessage,
                message: errorCode,
              });
              break;
            case ErrorShowType.REDIRECT:
              // TODO: redirect
              break;
            default:
              message.error(errorMessage);
          }
        }
      } else if (error.response) {
        // Axios 的错误
        // 请求成功发出且服务器也响应了状态码，但状态代码超出了 2xx 的范围
        message.error(`请求失败，状态码：${error.response.status}`);
      } else if (error.request) {
        // 请求已经成功发起，但没有收到响应
        message.error('服务器无响应，请重试');
      } else {
        // 发送请求时出了点问题
        message.error('请求发送失败，请重试');
      }
    },
  },

  // 请求拦截器 - 添加 Bearer Token
  requestInterceptors: [
    (config: RequestOptions) => {
      try {
        const token = localStorage.getItem('access_token');
        if (token) {
          config.headers = {
            ...config.headers,
            Authorization: `Bearer ${token}`,
          };
        }
      } catch {
        // localStorage 可能在某些环境下不可用
      }
      return config;
    },
  ],

  // 响应拦截器 - 处理 401/403 并自动刷新 token
  responseInterceptors: [
    [
      (response) => response,
      async (error: any) => {
        const { response, config } = error;

        // 早返回：非 401/403 错误
        if (response?.status !== 401 && response?.status !== 403) {
          throw error;
        }

        // 跳过登录接口的 401 错误，显示提示后让页面处理
        if (config?.url?.includes('/auth/login')) {
          const errorMsg = response?.data?.msg || '登录失败，请检查账号或密码';
          message.error(errorMsg);
          throw error;
        }

        // 跳过刷新接口本身的错误，避免无限循环
        if (config?.url?.includes('/auth/refresh')) {
          clearAuthStorage();
          window.location.href = '/user/login';
          throw error;
        }

        // 如果已经在刷新，等待刷新完成后重试
        if (isRefreshing) {
          return new Promise((resolve, reject) => {
            subscribeTokenRefresh((newToken: string) => {
              retryRequest(config, newToken).then(resolve).catch(reject);
            });
          });
        }

        // 开始刷新 token
        isRefreshing = true;

        const newToken = await refreshToken();

        if (newToken) {
          // 刷新成功，通知所有等待的请求
          onTokenRefreshed(newToken);
          isRefreshing = false;

          // 重试当前请求
          return retryRequest(config, newToken);
        }

        // 刷新失败，清除存储并跳转登录
        isRefreshing = false;
        refreshSubscribers = [];
        clearAuthStorage();
        window.location.href = '/user/login';
        throw error;
      },
    ],
  ],
};
