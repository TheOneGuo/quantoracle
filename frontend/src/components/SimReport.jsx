/**
 * @file SimReport.jsx
 * @description 30天模拟盘评测报告展示组件
 *              包含：关键指标卡片 / 收益曲线回放 / 评分雷达图 / 定价建议面板 / 交易时间线
 */

import React, { useState, useEffect } from 'react';
import ReactECharts from 'echarts-for-react';

const API_BASE = '/api/sim';

// ─── 等级颜色配置 ─────────────────────────────────────────────────────────
const GRADE_CONFIG = {
  S: { color: '#f5222d', bg: 'linear-gradient(135deg, #f5222d, #fa541c)', label: '卓越策略 S级' },
  A: { color: '#fa8c16', bg: 'linear-gradient(135deg, #fa8c16, #fadb14)', label: '优质策略 A级' },
  B: { color: '#52c41a', bg: 'linear-gradient(135deg, #52c41a, #13c2c2)', label: '良好策略 B级' },
  C: { color: '#1890ff', bg: 'linear-gradient(135deg, #1890ff, #722ed1)', label: '普通策略 C级' },
  D: { color: '#8c8c8c', bg: 'linear-gradient(135deg, #8c8c8c, #bfbfbf)', label: '待优化策略 D级' },
};

export default function SimReport({ sessionId, onPublish }) {
  const [report, setReport]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [publishing, setPublishing] = useState(false);

  // ─── 加载报告数据 ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!sessionId) return;
    fetch(`${API_BASE}/${sessionId}/report`)
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          setReport(data.data);
        } else {
          setError(data.message || '报告加载失败');
        }
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [sessionId]);

  // ─── 一键上架按钮处理 ─────────────────────────────────────────────────
  const handlePublish = async () => {
    if (!report) return;
    setPublishing(true);
    try {
      if (onPublish) {
        await onPublish({ sessionId, report });
      } else {
        // 默认：跳转到上架流程页
        window.location.href = `/strategy/publish?sessionId=${sessionId}&grade=${report.grade}`;
      }
    } finally {
      setPublishing(false);
    }
  };

  if (loading) return <div style={{ padding: 60, textAlign: 'center', color: '#999' }}>报告生成中，请稍候...</div>;
  if (error) return <div style={{ padding: 60, textAlign: 'center', color: '#f5222d' }}>⚠️ {error}</div>;
  if (!report) return null;

  const gradeConf = GRADE_CONFIG[report.grade] || GRADE_CONFIG.D;
  const { metrics, dimensionScores, pricing, snapshots, trades } = report;

  // ─── 雷达图配置（5个评分维度） ────────────────────────────────────────
  const radarOption = {
    tooltip: { trigger: 'item' },
    radar: {
      indicator: [
        { name: `收益率\n(30%)`,  max: 100 },
        { name: `最大回撤\n(25%)`, max: 100 },
        { name: `夏普比率\n(20%)`, max: 100 },
        { name: `合规率\n(15%)`,   max: 100 },
        { name: `交易频次\n(10%)`, max: 100 },
      ],
      radius: 110,
      splitArea: { areaStyle: { color: ['rgba(24,144,255,0.02)', 'rgba(24,144,255,0.05)', 'rgba(24,144,255,0.08)', 'rgba(24,144,255,0.1)'] } },
    },
    series: [{
      type: 'radar',
      data: [{
        value: [
          dimensionScores.returnScore,
          dimensionScores.drawdownScore,
          dimensionScores.sharpeScore,
          dimensionScores.complianceScore,
          dimensionScores.frequencyScore,
        ],
        name: '维度评分',
        areaStyle: { color: 'rgba(245,34,45,0.15)' },
        lineStyle: { color: '#f5222d' },
        itemStyle: { color: '#f5222d' },
      }],
    }],
  };

  // ─── 收益曲线配置 ─────────────────────────────────────────────────────
  const chartOption = {
    tooltip: { trigger: 'axis', formatter: (params) =>
      params.map(p => `${p.seriesName}: ${(p.value * 100).toFixed(2)}%`).join('<br/>')
    },
    legend: { data: ['策略收益', '沪深300基准'] },
    xAxis: { type: 'category', data: snapshots.map(s => s.date), axisLabel: { fontSize: 11 } },
    yAxis: { type: 'value', axisLabel: { formatter: v => `${(v * 100).toFixed(1)}%` } },
    series: [
      { name: '策略收益', type: 'line', data: snapshots.map(s => s.cumulativeReturnPct), smooth: true, itemStyle: { color: '#f5222d' }, areaStyle: { color: 'rgba(245,34,45,0.1)' } },
      { name: '沪深300基准', type: 'line', data: snapshots.map(s => s.benchmarkReturnPct || 0), smooth: true, itemStyle: { color: '#1890ff' }, lineStyle: { type: 'dashed' } },
    ],
  };

  return (
    <div style={{ padding: 24, background: '#f0f2f5', minHeight: '100vh' }}>
      {/* ── 标题和等级徽章 ──────────────────────────────────────────── */}
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <div style={{ display: 'inline-block', padding: '10px 32px', background: gradeConf.bg, color: '#fff', borderRadius: 24, fontSize: 22, fontWeight: 800, boxShadow: '0 4px 16px rgba(245,34,45,0.3)' }}>
          {gradeConf.label}
        </div>
        <div style={{ fontSize: 40, fontWeight: 800, color: '#262626', marginTop: 12 }}>
          {report.finalScore} <span style={{ fontSize: 18, color: '#999', fontWeight: 400 }}>/ 100 分</span>
        </div>
        <div style={{ fontSize: 14, color: '#999', marginTop: 4 }}>
          {report.startDate} ～ {report.endDate} · 共 {report.tradingDays} 个交易日
        </div>
      </div>

      {/* ── 关键指标卡片（4个） ─────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
        <MetricCard
          label="30天累计收益"
          value={`${(metrics.cumReturnPct * 100).toFixed(2)}%`}
          valueColor={metrics.cumReturnPct >= 0 ? '#f5222d' : '#52c41a'}
          sub={`初始 ¥${report.initialCapital.toLocaleString()} → 终值 ¥${report.finalAssets.toLocaleString()}`}
        />
        <MetricCard
          label="最大回撤"
          value={`${(metrics.maxDrawdownPct * 100).toFixed(2)}%`}
          valueColor="#fa8c16"
          sub="风险控制能力指标"
        />
        <MetricCard
          label="夏普比率"
          value={metrics.sharpeRatio.toFixed(2)}
          valueColor="#1890ff"
          sub="风险调整后收益（年化）"
        />
        <MetricCard
          label="合规率"
          value={`${(metrics.complianceRate * 100).toFixed(1)}%`}
          valueColor={metrics.complianceRate >= 0.9 ? '#52c41a' : '#fa8c16'}
          sub={`违规 ${report.violationCount} 次 / 共 ${report.totalTrades + report.violationCount} 次操作`}
        />
      </div>

      {/* ── 收益曲线 + 雷达图 ───────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16, marginBottom: 24 }}>
        <div style={cardStyle}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>📈 30天收益回放</div>
          <ReactECharts option={chartOption} style={{ height: 280 }} />
        </div>
        <div style={cardStyle}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>🎯 维度评分雷达</div>
          <ReactECharts option={radarOption} style={{ height: 280 }} />
        </div>
      </div>

      {/* ── 智能定价建议面板 ─────────────────────────────────────────── */}
      <div style={{ ...cardStyle, marginBottom: 24, background: `linear-gradient(135deg, #fff, #fff8f0)`, border: `1px solid #ffd591` }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16, color: '#d46b08' }}>
          💰 智能定价建议（{report.grade}级策略）
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20, marginBottom: 20 }}>
          <PricingCard label="月订阅" price={`¥${pricing.monthly}`} sub="按月付费" highlight />
          <PricingCard label="年订阅" price={`¥${pricing.annual}`} sub={`相当于月均 ¥${Math.round(pricing.annual / 12)}`} />
          <PricingCard label="单信号" price={`¥${pricing.perSignal}`} sub="按信号计费" />
        </div>
        <div style={{ fontSize: 13, color: '#8c6914', marginBottom: 16 }}>
          {pricing.note}
        </div>
        <button
          onClick={handlePublish} disabled={publishing}
          style={{
            padding: '14px 40px', background: publishing ? '#ccc' : 'linear-gradient(135deg, #f5222d, #fa8c16)',
            color: '#fff', border: 'none', borderRadius: 10, fontSize: 16, fontWeight: 800,
            cursor: publishing ? 'not-allowed' : 'pointer', boxShadow: '0 4px 16px rgba(245,34,45,0.3)',
          }}
        >
          {publishing ? '提交中...' : '🚀 一键上架到策略广场'}
        </button>
      </div>

      {/* ── 完整交易时间线 ───────────────────────────────────────────── */}
      <div style={cardStyle}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>
          📋 完整交易记录（共 {report.totalTrades} 笔合规交易 · {report.violationCount} 次违规）
        </div>
        <div style={{ maxHeight: 400, overflowY: 'auto' }}>
          {trades.map((t, idx) => (
            <div key={t.id} style={{
              display: 'flex', alignItems: 'center', padding: '10px 14px', marginBottom: 6,
              borderRadius: 8, background: t.violation_flag ? '#fff1f0' : '#fafafa',
              border: `1px solid ${t.violation_flag ? '#ffa39e' : '#f0f0f0'}`,
            }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: t.violation_flag ? '#ffa39e' : '#e6f7ff', display: 'flex', alignItems: 'center', justifyContent: 'center', marginRight: 12, fontSize: 12, fontWeight: 700, color: t.violation_flag ? '#f5222d' : '#1890ff' }}>
                {t.violation_flag ? '⚠' : idx + 1}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: t.violation_flag ? '#f5222d' : '#262626' }}>
                  {t.violation_flag ? '【违规被拒】' : `【${t.action === 'buy' || t.action === 'add' ? '买入' : '卖出'}】`}
                  {t.stock_code} {t.stock_name} {!t.violation_flag && `${t.quantity}股 @ ¥${t.price}`}
                </div>
                {t.violation_flag ? (
                  <div style={{ fontSize: 11, color: '#ff7875' }}>{t.reject_reason}</div>
                ) : (
                  <div style={{ fontSize: 11, color: '#999' }}>
                    成交金额 ¥{(t.amount || 0).toFixed(2)} · 佣金 ¥{(t.commission || 0).toFixed(2)} · 净额 ¥{(t.net_amount || 0).toFixed(2)}
                  </div>
                )}
              </div>
              <div style={{ fontSize: 11, color: '#bfbfbf', marginLeft: 12 }}>
                {new Date(t.trade_time).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          ))}
          {trades.length === 0 && <div style={{ color: '#bfbfbf', textAlign: 'center', padding: '20px 0' }}>暂无交易记录</div>}
        </div>
      </div>
    </div>
  );
}

// ─── 指标卡片 ─────────────────────────────────────────────────────────────
function MetricCard({ label, value, valueColor, sub }) {
  return (
    <div style={{ ...cardStyle, textAlign: 'center' }}>
      <div style={{ fontSize: 13, color: '#999', marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 800, color: valueColor || '#262626' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#bfbfbf', marginTop: 6 }}>{sub}</div>}
    </div>
  );
}

// ─── 定价卡片 ─────────────────────────────────────────────────────────────
function PricingCard({ label, price, sub, highlight }) {
  return (
    <div style={{
      textAlign: 'center', padding: '16px 12px', borderRadius: 10,
      background: highlight ? 'linear-gradient(135deg, #fff2e8, #fff7e6)' : '#fafafa',
      border: `2px solid ${highlight ? '#ffd591' : '#f0f0f0'}`,
    }}>
      <div style={{ fontSize: 13, color: '#8c6914', fontWeight: 600, marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 30, fontWeight: 800, color: '#d46b08' }}>{price}</div>
      <div style={{ fontSize: 12, color: '#bfbfbf', marginTop: 4 }}>{sub}</div>
    </div>
  );
}

// ─── 共用卡片样式 ─────────────────────────────────────────────────────────
const cardStyle = {
  background: '#fff',
  borderRadius: 12,
  padding: '20px 24px',
  boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
};
