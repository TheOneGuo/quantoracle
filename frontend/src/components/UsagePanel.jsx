/**
 * @file components/UsagePanel.jsx
 * @description 用量面板组件 —— 展示当前用户的 Token 余额、消耗统计、Top 功能及模型分布
 */

import React, { useState, useEffect, useCallback } from 'react';

const API_BASE = 'http://localhost:3001/api';

/** 进度条颜色列表，按索引轮换 */
const BAR_COLORS = ['#7c8cf8', '#48bb78', '#f6ad55', '#fc8181', '#76e4f7'];

/**
 * 简单 CSS 进度条
 * @param {{ value: number, max: number, color: string }} props
 */
function ProgressBar({ value, max, color = '#7c8cf8' }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div style={{ background: '#2d3748', borderRadius: 6, height: 10, overflow: 'hidden' }}>
      <div style={{ width: `${pct}%`, background: color, height: '100%', borderRadius: 6, transition: 'width 0.4s ease' }} />
    </div>
  );
}

/**
 * 格式化大数字，超过万时显示"万"
 * @param {number} n
 * @returns {string}
 */
function fmt(n) {
  if (!n && n !== 0) return '—';
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  return n.toLocaleString();
}

/**
 * UsagePanel 组件
 * @param {{ onClose: () => void }} props
 */
export default function UsagePanel({ onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  /**
   * 从后端获取用量汇总数据
   */
  const fetchSummary = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const token = localStorage.getItem('auth_token');
      const res = await fetch(`${API_BASE}/usage/summary`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      const json = await res.json();
      if (json.success) {
        setData(json);
      } else {
        setError(json.error || '获取用量数据失败');
      }
    } catch (e) {
      setError('网络错误，无法获取用量数据');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  const maxFeature = data?.top_features?.[0]?.tokens || 1;
  const maxModel = data?.model_breakdown?.[0]?.tokens || 1;

  return (
    <div
      style={{
        position: 'absolute',
        top: 48,
        right: 0,
        width: 320,
        background: '#1a1a2e',
        border: '1px solid #4a5568',
        borderRadius: 12,
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        zIndex: 9999,
        padding: '1rem',
        color: '#e2e8f0',
        fontFamily: 'inherit'
      }}
    >
      {/* 标题行 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <span style={{ fontWeight: 700, fontSize: '0.95rem', color: '#7c8cf8' }}>⚡ Token 用量</span>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: '#718096', cursor: 'pointer', fontSize: '1.1rem' }}
          title="关闭"
        >✕</button>
      </div>

      {loading && (
        <div style={{ textAlign: 'center', color: '#718096', padding: '1.5rem 0' }}>加载中…</div>
      )}

      {error && (
        <div style={{ color: '#fc8181', fontSize: '0.85rem', textAlign: 'center', padding: '1rem 0' }}>{error}</div>
      )}

      {data && !loading && (
        <>
          {/* Token 余额大数字 */}
          <div style={{ textAlign: 'center', margin: '0.5rem 0 1rem' }}>
            <div style={{ fontSize: '2.2rem', fontWeight: 800, color: '#7c8cf8', lineHeight: 1 }}>
              {fmt(data.token_balance)}
            </div>
            <div style={{ fontSize: '0.75rem', color: '#718096', marginTop: 4 }}>剩余 Token</div>
          </div>

          {/* 今日 / 总消耗 */}
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
            {[
              { label: '今日消耗', val: data.today_consumed, color: '#f6ad55' },
              { label: '累计消耗', val: data.total_consumed, color: '#fc8181' }
            ].map(({ label, val, color }) => (
              <div key={label} style={{ flex: 1, background: '#2d3748', borderRadius: 8, padding: '0.5rem 0.75rem', textAlign: 'center' }}>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color }}>{fmt(val)}</div>
                <div style={{ fontSize: '0.7rem', color: '#718096', marginTop: 2 }}>{label}</div>
              </div>
            ))}
          </div>

          {/* Top3 功能 */}
          {data.top_features?.length > 0 && (
            <div style={{ marginBottom: '0.9rem' }}>
              <div style={{ fontSize: '0.78rem', color: '#a0aec0', marginBottom: '0.4rem', fontWeight: 600 }}>🏆 消耗最多的功能</div>
              {data.top_features.map((f, i) => (
                <div key={f.name} style={{ marginBottom: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', marginBottom: 2 }}>
                    <span style={{ color: '#e2e8f0' }}>{f.name || '未知'}</span>
                    <span style={{ color: BAR_COLORS[i] }}>{fmt(f.tokens)}</span>
                  </div>
                  <ProgressBar value={f.tokens} max={maxFeature} color={BAR_COLORS[i]} />
                </div>
              ))}
            </div>
          )}

          {/* 模型分布 */}
          {data.model_breakdown?.length > 0 && (
            <div>
              <div style={{ fontSize: '0.78rem', color: '#a0aec0', marginBottom: '0.4rem', fontWeight: 600 }}>🤖 模型使用分布</div>
              {data.model_breakdown.slice(0, 4).map((m, i) => (
                <div key={m.model_id} style={{ marginBottom: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: 2 }}>
                    <span style={{ color: '#cbd5e0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>
                      {m.model_id}
                    </span>
                    <span style={{ color: BAR_COLORS[i + 1] }}>{fmt(m.tokens)}</span>
                  </div>
                  <ProgressBar value={m.tokens} max={maxModel} color={BAR_COLORS[i + 1]} />
                </div>
              ))}
            </div>
          )}

          {/* 刷新按钮 */}
          <div style={{ textAlign: 'right', marginTop: '0.75rem' }}>
            <button
              onClick={fetchSummary}
              style={{ background: 'none', border: '1px solid #4a5568', color: '#a0aec0', borderRadius: 6, padding: '0.2rem 0.6rem', cursor: 'pointer', fontSize: '0.75rem' }}
            >
              🔄 刷新
            </button>
          </div>
        </>
      )}
    </div>
  );
}
