/**
 * @file HKSpot.jsx
 * @description 港股实时行情组件
 * - 调用 /api/hk/spot 接口获取实时行情列表
 * - 支持代码/名称模糊搜索过滤
 * - 每 60 秒自动刷新一次
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import './HKSpot.css';

// ─────────────────────────────────────────────────────────────────────────────
// 工具函数
// ─────────────────────────────────────────────────────────────────────────────

/** 格式化涨跌幅，返回 "+1.23%" / "-0.55%" 形式 */
function formatChangePct(val) {
  if (val === null || val === undefined || isNaN(Number(val))) return '--';
  const num = Number(val);
  const sign = num >= 0 ? '+' : '';
  return `${sign}${num.toFixed(2)}%`;
}

/** 格式化价格，保留2位小数 */
function formatPrice(val) {
  if (val === null || val === undefined || isNaN(Number(val))) return '--';
  return Number(val).toFixed(2);
}

// ─────────────────────────────────────────────────────────────────────────────
// 主组件
// ─────────────────────────────────────────────────────────────────────────────

const REFRESH_INTERVAL_MS = 60 * 1000; // 60 秒自动刷新

export default function HKSpot() {
  const [stocks, setStocks]     = useState([]);   // 全量数据
  const [keyword, setKeyword]   = useState('');   // 搜索关键词
  const [loading, setLoading]   = useState(true); // 加载状态
  const [error, setError]       = useState(null); // 错误信息
  const [lastUpdate, setLastUpdate] = useState(null); // 最后刷新时间
  const [countdown, setCountdown]   = useState(60);   // 倒计时（秒）

  const timerRef     = useRef(null); // 自动刷新定时器
  const countdownRef = useRef(null); // 倒计时定时器

  // ─── 拉取数据 ───────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const resp = await fetch('/api/hk/spot', { credentials: 'include' });
      if (!resp.ok) throw new Error(`接口返回 HTTP ${resp.status}`);
      const json = await resp.json();
      // 兼容 { data: [...] } 或直接数组两种格式
      const list = Array.isArray(json) ? json : (json.data || json.stocks || []);
      setStocks(list);
      setLastUpdate(new Date());
      setCountdown(60);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // ─── 初始加载 + 60s 自动刷新 ────────────────────────────────────────────
  useEffect(() => {
    fetchData();

    // 每60s刷新
    timerRef.current = setInterval(fetchData, REFRESH_INTERVAL_MS);

    // 倒计时（每秒减1）
    countdownRef.current = setInterval(() => {
      setCountdown(prev => (prev <= 1 ? 60 : prev - 1));
    }, 1000);

    return () => {
      clearInterval(timerRef.current);
      clearInterval(countdownRef.current);
    };
  }, [fetchData]);

  // ─── 搜索过滤 ────────────────────────────────────────────────────────────
  const filtered = stocks.filter(s => {
    if (!keyword.trim()) return true;
    const kw = keyword.trim().toLowerCase();
    return (
      (s.code  && s.code.toLowerCase().includes(kw)) ||
      (s.name  && s.name.toLowerCase().includes(kw)) ||
      (s.symbol && s.symbol.toLowerCase().includes(kw))
    );
  });

  // ─── 渲染 ────────────────────────────────────────────────────────────────
  return (
    <div className="hk-spot-container">
      {/* 头部：标题 + 搜索框 + 刷新状态 */}
      <div className="hk-spot-header">
        <span className="hk-spot-title">🇭🇰 港股实时行情</span>
        <input
          className="hk-spot-search"
          type="text"
          placeholder="搜索代码/名称..."
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
        />
        <div className="hk-spot-meta">
          {lastUpdate && (
            <span className="hk-spot-update-time">
              更新于 {lastUpdate.toLocaleTimeString('zh-CN')}
            </span>
          )}
          <span className="hk-spot-countdown" title="距下次自动刷新">
            🔄 {countdown}s
          </span>
          <button
            className="hk-spot-refresh-btn"
            onClick={fetchData}
            disabled={loading}
          >
            {loading ? '加载中...' : '立即刷新'}
          </button>
        </div>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="hk-spot-error">
          ⚠️ 数据加载失败：{error}
          <button onClick={fetchData} style={{ marginLeft: 8 }}>重试</button>
        </div>
      )}

      {/* 骨架屏 */}
      {loading && stocks.length === 0 && (
        <div className="hk-spot-loading">正在加载港股行情...</div>
      )}

      {/* 数据表格 */}
      {!loading && !error && filtered.length === 0 && (
        <div className="hk-spot-empty">
          {keyword ? `未找到 "${keyword}" 相关股票` : '暂无港股数据'}
        </div>
      )}

      {filtered.length > 0 && (
        <table className="hk-spot-table">
          <thead>
            <tr>
              <th>代码</th>
              <th>名称</th>
              <th>现价 (HKD)</th>
              <th>涨跌幅</th>
              <th>涨跌额</th>
              <th>成交量</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(s => {
              const pct = Number(s.change_pct ?? s.changePct ?? s.pct_chg ?? 0);
              const isUp   = pct > 0;
              const isDown = pct < 0;
              return (
                <tr key={s.code || s.symbol} className={isUp ? 'row-up' : isDown ? 'row-down' : ''}>
                  <td className="col-code">{s.code || s.symbol || '--'}</td>
                  <td className="col-name">{s.name || s.display_name || '--'}</td>
                  <td className="col-price">{formatPrice(s.price ?? s.current_price)}</td>
                  <td className={`col-change-pct ${isUp ? 'text-up' : isDown ? 'text-down' : ''}`}>
                    {formatChangePct(pct)}
                  </td>
                  <td className={`col-change ${isUp ? 'text-up' : isDown ? 'text-down' : ''}`}>
                    {formatPrice(s.change ?? s.price_change)}
                  </td>
                  <td className="col-volume">
                    {s.volume != null ? Number(s.volume).toLocaleString() : '--'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <div className="hk-spot-footer">
        共 {filtered.length} 条
        {keyword && stocks.length !== filtered.length && `（全部 ${stocks.length} 条）`}
      </div>
    </div>
  );
}
