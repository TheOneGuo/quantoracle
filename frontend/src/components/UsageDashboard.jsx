/**
 * @file UsageDashboard.jsx
 * @description Token 用量报表完整版仪表盘
 * 展示5个维度：
 *  1. 模型分布（按token消耗）
 *  2. 功能分布（按feature分组）
 *  3. 日趋势（近7天折线图）
 *  4. 成本估算（各模型单价计算）
 *  5. Top3 功能
 * 
 * 图表使用 ECharts（通过 echarts-for-react 引入）。
 * 若 ECharts 未安装，优雅降级为纯数字展示。
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// 工具函数
// ─────────────────────────────────────────────────────────────────────────────

/** 格式化大数字：超过1万显示"万" */
function fmtNum(n) {
  if (!n && n !== 0) return '--';
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  return n.toLocaleString();
}

/** 格式化美元金额 */
function fmtUSD(n) {
  if (!n && n !== 0) return '--';
  if (n < 0.0001) return '< $0.0001';
  return `$${n.toFixed(4)}`;
}

/** 颜色列表 */
const COLORS = ['#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de', '#3ba272', '#fc8452', '#9a60b4'];

// ─────────────────────────────────────────────────────────────────────────────
// 简易图表组件（纯 Canvas/DOM，不依赖 ECharts）
// 如果项目中已安装 echarts-for-react，可替换为 ReactECharts
// ─────────────────────────────────────────────────────────────────────────────

/** 横向条形图（用于模型/功能分布） */
function BarChart({ data, title, valueKey = 'tokens', labelKey = 'model_id', formatValue = fmtNum }) {
  if (!data || data.length === 0) return <div className="ud-empty">暂无数据</div>;
  const max = Math.max(...data.map(d => d[valueKey] || 0), 1);
  return (
    <div className="ud-barchart">
      {title && <div className="ud-chart-title">{title}</div>}
      {data.map((item, i) => {
        const pct = ((item[valueKey] || 0) / max) * 100;
        const color = COLORS[i % COLORS.length];
        return (
          <div key={item[labelKey] || i} className="ud-bar-row">
            <div className="ud-bar-label" title={item[labelKey]}>{item[labelKey] || '--'}</div>
            <div className="ud-bar-track">
              <div className="ud-bar-fill" style={{ width: `${pct}%`, background: color }} />
            </div>
            <div className="ud-bar-value">{formatValue(item[valueKey])}</div>
          </div>
        );
      })}
    </div>
  );
}

/** 折线图（近7天日趋势） */
function LineChart({ data }) {
  const svgRef = useRef(null);
  if (!data || data.length === 0) return <div className="ud-empty">暂无数据</div>;

  const values = data.map(d => d.tokens || 0);
  const maxVal = Math.max(...values, 1);
  const W = 460, H = 120, PAD = 30;
  const pts = data.map((d, i) => {
    const x = PAD + (i / (data.length - 1 || 1)) * (W - 2 * PAD);
    const y = H - PAD - ((d.tokens || 0) / maxVal) * (H - 2 * PAD);
    return { x, y, date: d.date, tokens: d.tokens };
  });

  const polyline = pts.map(p => `${p.x},${p.y}`).join(' ');
  const area = `${pts[0].x},${H - PAD} ${polyline} ${pts[pts.length - 1].x},${H - PAD}`;

  return (
    <div className="ud-linechart">
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 120 }}>
        <defs>
          <linearGradient id="lineGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#5470c6" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#5470c6" stopOpacity="0.05" />
          </linearGradient>
        </defs>
        {/* 面积 */}
        <polygon points={area} fill="url(#lineGrad)" />
        {/* 折线 */}
        <polyline points={polyline} fill="none" stroke="#5470c6" strokeWidth="2" strokeLinejoin="round" />
        {/* 数据点 */}
        {pts.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r={3} fill="#5470c6" />
            {/* X轴日期标签 */}
            <text x={p.x} y={H - 4} textAnchor="middle" fontSize="9" fill="#8b949e">
              {p.date?.slice(5) || ''}
            </text>
          </g>
        ))}
        {/* Y轴最大值 */}
        <text x={PAD} y={PAD - 4} fontSize="9" fill="#8b949e">{fmtNum(maxVal)}</text>
      </svg>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 主仪表盘组件
// ─────────────────────────────────────────────────────────────────────────────

const API_BASE = '/api';

export default function UsageDashboard() {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [refreshAt, setRefreshAt] = useState(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const resp = await fetch(`${API_BASE}/usage/summary`, { credentials: 'include' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = await resp.json();
      setData(json);
      setRefreshAt(new Date());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading && !data) return <div className="ud-loading">⏳ 加载用量数据...</div>;
  if (error && !data) return (
    <div className="ud-error">❌ 加载失败：{error} <button onClick={fetchData}>重试</button></div>
  );
  if (!data) return null;

  return (
    <div className="ud-container">
      <div className="ud-header">
        <span className="ud-title">📊 Token 用量报表</span>
        <div className="ud-header-meta">
          {refreshAt && <span className="ud-update">更新于 {refreshAt.toLocaleTimeString('zh-CN')}</span>}
          <button className="ud-refresh-btn" onClick={fetchData} disabled={loading}>
            {loading ? '刷新中...' : '刷新'}
          </button>
        </div>
      </div>

      {/* ── 顶部统计卡片 ───────────────────────────────────────────────── */}
      <div className="ud-cards">
        <div className="ud-card">
          <div className="ud-card-label">Token 余额</div>
          <div className="ud-card-value">{fmtNum(data.token_balance)}</div>
        </div>
        <div className="ud-card">
          <div className="ud-card-label">今日消耗</div>
          <div className="ud-card-value ud-card-warn">{fmtNum(data.today_consumed)}</div>
        </div>
        <div className="ud-card">
          <div className="ud-card-label">账户累计消耗</div>
          <div className="ud-card-value">{fmtNum(data.total_consumed)}</div>
        </div>
        <div className="ud-card">
          <div className="ud-card-label">30天估算成本</div>
          <div className="ud-card-value ud-card-cost">{fmtUSD(data.estimated_cost_usd_30d)}</div>
          <div className="ud-card-note">{data.cost_note}</div>
        </div>
      </div>

      {/* ── Top3 功能 ───────────────────────────────────────────────────── */}
      {data.top_features?.length > 0 && (
        <div className="ud-section">
          <div className="ud-section-title">🏆 Top 3 功能（Token消耗）</div>
          <div className="ud-top3">
            {data.top_features.map((f, i) => (
              <div key={f.name} className="ud-top3-item">
                <span className="ud-top3-rank">#{i + 1}</span>
                <span className="ud-top3-name">{f.name || '未知'}</span>
                <span className="ud-top3-tokens">{fmtNum(f.tokens)} tokens</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="ud-grid">
        {/* ── 日趋势 ──────────────────────────────────────────────────── */}
        <div className="ud-section ud-section-wide">
          <div className="ud-section-title">📈 近7天 Token 消耗趋势</div>
          <LineChart data={data.daily_trend} />
        </div>

        {/* ── 模型分布 ─────────────────────────────────────────────────── */}
        <div className="ud-section">
          <div className="ud-section-title">🤖 模型分布</div>
          <BarChart
            data={data.model_breakdown || []}
            labelKey="model_id"
            valueKey="tokens"
            formatValue={fmtNum}
          />
          {/* 成本明细 */}
          {data.model_breakdown?.some(m => m.estimated_cost_usd > 0) && (
            <div className="ud-cost-table">
              <div className="ud-cost-header">
                <span>模型</span><span>Token</span><span>调用次数</span><span>估算成本</span>
              </div>
              {data.model_breakdown.map(m => (
                <div key={m.model_id} className="ud-cost-row">
                  <span className="ud-cost-model" title={m.model_id}>
                    {m.model_id?.split('/').pop() || m.model_id}
                  </span>
                  <span>{fmtNum(m.tokens)}</span>
                  <span>{m.call_count}</span>
                  <span>{fmtUSD(m.estimated_cost_usd)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── 功能分布 ─────────────────────────────────────────────────── */}
        <div className="ud-section">
          <div className="ud-section-title">⚙️ 功能分布</div>
          <BarChart
            data={data.feature_breakdown || []}
            labelKey="feature"
            valueKey="tokens"
            formatValue={fmtNum}
          />
        </div>
      </div>
    </div>
  );
}
