/**
 * @file components/AuthPanel.jsx
 * @description 登录/注册面板组件
 * - 支持登录/注册 Tab 切换
 * - 登录成功后 token 存 localStorage（key: qo_token）
 * - 通过 onSuccess 回调通知父组件
 */

import React, { useState } from 'react';

/**
 * @param {{ onSuccess: Function }} props
 */
export default function AuthPanel({ onSuccess }) {
  const [tab, setTab] = useState('login'); // 'login' | 'register'
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (tab === 'register' && password !== confirm) {
      setError('两次密码不一致');
      return;
    }

    setLoading(true);
    try {
      const endpoint = tab === 'login'
        ? 'http://localhost:3001/api/auth/login'
        : 'http://localhost:3001/api/auth/register';

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();

      if (!data.success) {
        setError(data.error || '操作失败');
        return;
      }

      // 存储 token
      localStorage.setItem('qo_token', data.token);
      setSuccess(tab === 'login' ? '登录成功！' : '注册成功！');
      setTimeout(() => onSuccess && onSuccess(data.user), 500);
    } catch (err) {
      setError('网络错误，请重试');
    } finally {
      setLoading(false);
    }
  };

  const styles = {
    overlay: {
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999
    },
    card: {
      background: '#1a1a2e', border: '1px solid #2a2a4e', borderRadius: 12,
      padding: '2rem', width: 360, boxShadow: '0 8px 32px rgba(0,0,0,0.5)'
    },
    title: { color: '#e0e0ff', textAlign: 'center', marginBottom: '1.5rem', fontSize: '1.4rem' },
    tabs: { display: 'flex', marginBottom: '1.5rem', borderBottom: '1px solid #2a2a4e' },
    tab: (active) => ({
      flex: 1, padding: '0.6rem', cursor: 'pointer', textAlign: 'center',
      color: active ? '#7c8cf8' : '#888',
      borderBottom: active ? '2px solid #7c8cf8' : '2px solid transparent',
      background: 'none', border: 'none', fontSize: '0.95rem', fontWeight: active ? 600 : 400
    }),
    input: {
      width: '100%', padding: '0.7rem 0.9rem', borderRadius: 6, border: '1px solid #2a2a4e',
      background: '#0f0f23', color: '#e0e0ff', fontSize: '0.95rem', marginBottom: '0.8rem',
      boxSizing: 'border-box', outline: 'none'
    },
    btn: {
      width: '100%', padding: '0.75rem', borderRadius: 6, border: 'none',
      background: loading ? '#4a5080' : '#7c8cf8', color: '#fff',
      fontSize: '1rem', fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer',
      marginTop: '0.5rem'
    },
    error: { color: '#ff6b6b', textAlign: 'center', marginBottom: '0.5rem', fontSize: '0.88rem' },
    success: { color: '#6bffb8', textAlign: 'center', marginBottom: '0.5rem', fontSize: '0.88rem' },
    logo: { textAlign: 'center', fontSize: '2rem', marginBottom: '0.5rem' }
  };

  return (
    <div style={styles.overlay}>
      <div style={styles.card}>
        <div style={styles.logo}>⚡</div>
        <h2 style={styles.title}>智盈云 QuantOracle</h2>
        <div style={styles.tabs}>
          <button style={styles.tab(tab === 'login')} onClick={() => { setTab('login'); setError(''); }}>
            登录
          </button>
          <button style={styles.tab(tab === 'register')} onClick={() => { setTab('register'); setError(''); }}>
            注册
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          {error && <div style={styles.error}>{error}</div>}
          {success && <div style={styles.success}>{success}</div>}
          <input
            style={styles.input}
            placeholder="用户名（3-20字符）"
            value={username}
            onChange={e => setUsername(e.target.value)}
            autoFocus
            required
          />
          <input
            style={styles.input}
            type="password"
            placeholder="密码（至少6字符）"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
          />
          {tab === 'register' && (
            <input
              style={styles.input}
              type="password"
              placeholder="确认密码"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              required
            />
          )}
          <button style={styles.btn} type="submit" disabled={loading}>
            {loading ? '处理中...' : tab === 'login' ? '登录' : '注册'}
          </button>
        </form>
      </div>
    </div>
  );
}
