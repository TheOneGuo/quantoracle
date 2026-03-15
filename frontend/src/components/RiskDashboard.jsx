/**
 * @file 风险仪表盘组件
 * @description 展示策略近30天资金使用率折线图 + 核心风险指标卡。
 *              包含：月均使用率/最高仓位/高仓位天数占比/风险徽章。
 */

import React, { useState, useEffect, useRef } from 'react';
import './RiskDashboard.css';

// ============================================================
// 常量配置
// ============================================================

/** 风险徽章配置 */
const RISK_BADGE_CONFIG = {
  green:  { text: '低风险',  color: '#10b981', bg: '#ecfdf5', icon: '🟢' },
  yellow: { text: '中风险',  color: '#f59e0b', bg: '#fffbeb', icon: '🟡' },
  orange: { text: '偏高风险', color: '#f97316', bg: '#fff7ed', icon: '🟠' },
  red:    { text: '高风险',  color: '#ef4444', bg: '#fef2f2', icon: '🔴' },
};

// ============================================================
// 简易折线图（Canvas绘制，无需引入图表库）
// ============================================================

/**
 * 折线图组件（纯 Canvas 渲染）
 * @param {Array} data 数据点 [{date, usageRate}]
 */
function LineChart({ data }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!data || !data.length || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx    = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    const padL = 40, padR = 20, padT = 15, padB = 30;

    ctx.clearRect(0, 0, W, H);

    const values = data.map(d => d.usageRate);
    const maxVal = Math.max(...values, 80);
    const minVal = 0;

    // 坐标映射
    const toX = (i) => padL + i * (W - padL - padR) / (data.length - 1 || 1);
    const toY = (v) => H - padB - (v - minVal) / (maxVal - minVal) * (H - padT - padB);

    // 警戒线（80%）
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = '#fca5a5';
    ctx.lineWidth = 1;
    const y80 = toY(80);
    ctx.beginPath();
    ctx.moveTo(padL, y80);
    ctx.lineTo(W - padR, y80);
    ctx.stroke();
    ctx.fillStyle = '#ef4444';
    ctx.font = '10px sans-serif';
    ctx.fillText('80%', padL - 30, y80 + 4);
    ctx.restore();

    // Y轴标签
    ctx.fillStyle = '#9ca3af';
    ctx.font = '10px sans-serif';
    [0, 40, 80].forEach(v => {
      const y = toY(v);
      ctx.fillText(`${v}%`, 0, y + 4);
    });

    // 折线
    ctx.beginPath();
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 2;
    data.forEach((d, i) => {
      const x = toX(i);
      const y = toY(d.usageRate);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();

    // 渐变填充
    const gradient = ctx.createLinearGradient(0, padT, 0, H - padB);
    gradient.addColorStop(0, 'rgba(59, 130, 246, 0.3)');
    gradient.addColorStop(1, 'rgba(59, 130, 246, 0)');
    ctx.beginPath();
    data.forEach((d, i) => {
      const x = toX(i);
      const y = toY(d.usageRate);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.lineTo(toX(data.length - 1), H - padB);
    ctx.lineTo(toX(0), H - padB);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    // X轴日期标签（每5天显示一个）
    ctx.fillStyle = '#9ca3af';
    ctx.font = '9px sans-serif';
    data.forEach((d, i) => {
      if (i % 5 === 0) {
        ctx.fillText(d.date.slice(5), toX(i) - 12, H - 5);
      }
    });
  }, [data]);

  return (
    <canvas
      ref={canvasRef}
      width={560}
      height={180}
      className="risk-chart-canvas"
    />
  );
}

// ============================================================
// 主组件：风险仪表盘
// ============================================================

/**
 * 风险仪表盘
 * @param {string} props.strategyId 策略ID
 */
export default function RiskDashboard({ strategyId }) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  useEffect(() => {
    if (!strategyId) return;
    setLoading(true);
    setError(null);

    fetch(`/api/marketplace/${strategyId}/risk-dashboard`)
      .then(r => r.json())
      .then(json => {
        if (json.success) setData(json.data);
        else setError(json.error || '加载失败');
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [strategyId]);

  if (loading) return <div className="risk-loading">加载风险数据中...</div>;
  if (error)   return <div className="risk-error">加载失败：{error}</div>;
  if (!data)   return null;

  const { dailyUsage, summary } = data;
  const badgeConfig = RISK_BADGE_CONFIG[summary.riskBadge] || RISK_BADGE_CONFIG.yellow;

  return (
    <div className="risk-dashboard">
      <h3 className="risk-title">📊 风险仪表盘</h3>

      {/* 风险徽章 */}
      <div
        className="risk-badge-main"
        style={{ color: badgeConfig.color, backgroundColor: badgeConfig.bg }}
      >
        {badgeConfig.icon} {badgeConfig.text}
      </div>

      {/* 折线图：近30天每日15:05资金使用率 */}
      <div className="chart-container">
        <div className="chart-label">近30天每日15:05 资金使用率（%）</div>
        <LineChart data={dailyUsage} />
      </div>

      {/* 指标卡：4个核心指标 */}
      <div className="metrics-row">
        <div className="risk-metric-card">
          <div className="metric-value">{summary.avgUsagePct}%</div>
          <div className="metric-label">月均使用率</div>
        </div>
        <div className="risk-metric-card">
          <div className="metric-value">{summary.maxUsagePct}%</div>
          <div className="metric-label">最高仓位</div>
        </div>
        <div className="risk-metric-card">
          <div
            className="metric-value"
            style={{ color: summary.highUsageDayPct > 30 ? '#ef4444' : '#10b981' }}
          >
            {summary.highUsageDayPct}%
          </div>
          <div className="metric-label">高仓位天数占比</div>
          <div className="metric-hint">（使用率≥80%）</div>
        </div>
        <div className="risk-metric-card">
          <div className="metric-value" style={{ color: badgeConfig.color }}>
            {badgeConfig.icon}
          </div>
          <div className="metric-label">风险等级</div>
        </div>
      </div>
    </div>
  );
}
