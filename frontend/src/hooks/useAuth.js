/**
 * @file hooks/useAuth.js
 * @description 用户认证状态管理 Hook
 * 提供：user, token, login, register, logout
 * token 存储在 localStorage（key: qo_token）
 * 用户信息从 /api/auth/me 获取
 */

import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const API_BASE = 'http://localhost:3001/api';
const TOKEN_KEY = 'qo_token';

// 全局 Axios 拦截器：自动附加 Bearer Token
axios.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) {
    config.headers['Authorization'] = `Bearer ${token}`;
  }
  return config;
});

/**
 * 认证 Hook
 * @returns {{
 *   user: Object|null,
 *   token: string|null,
 *   loading: boolean,
 *   login: Function,
 *   register: Function,
 *   logout: Function
 * }}
 */
export function useAuth() {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));
  const [loading, setLoading] = useState(true);

  // 从 /api/auth/me 获取用户信息
  const fetchMe = useCallback(async (t) => {
    if (!t) {
      setLoading(false);
      return;
    }
    try {
      const res = await axios.get(`${API_BASE}/auth/me`, {
        headers: { Authorization: `Bearer ${t}` }
      });
      if (res.data.success) {
        setUser(res.data.user);
      } else {
        // Token 无效，清除
        localStorage.removeItem(TOKEN_KEY);
        setToken(null);
        setUser(null);
      }
    } catch {
      // 401 或网络错误，清除 token
      localStorage.removeItem(TOKEN_KEY);
      setToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // 初始化时验证本地 token
  useEffect(() => {
    fetchMe(token);
  }, []);

  /**
   * 登录
   * @param {string} username
   * @param {string} password
   */
  const login = useCallback(async (username, password) => {
    const res = await axios.post(`${API_BASE}/auth/login`, { username, password });
    if (!res.data.success) throw new Error(res.data.error || '登录失败');
    const { token: newToken, user: newUser } = res.data;
    localStorage.setItem(TOKEN_KEY, newToken);
    setToken(newToken);
    setUser(newUser);
    return newUser;
  }, []);

  /**
   * 注册
   * @param {string} username
   * @param {string} password
   */
  const register = useCallback(async (username, password) => {
    const res = await axios.post(`${API_BASE}/auth/register`, { username, password });
    if (!res.data.success) throw new Error(res.data.error || '注册失败');
    const { token: newToken, user: newUser } = res.data;
    localStorage.setItem(TOKEN_KEY, newToken);
    setToken(newToken);
    setUser(newUser);
    return newUser;
  }, []);

  /**
   * 登出
   */
  const logout = useCallback(async () => {
    try {
      await axios.post(`${API_BASE}/auth/logout`);
    } catch { /* 忽略错误，前端清除即可 */ }
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
  }, []);

  return { user, token, loading, login, register, logout };
}
