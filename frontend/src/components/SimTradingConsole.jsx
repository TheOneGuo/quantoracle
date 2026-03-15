/**
 * @file SimTradingConsole.jsx
 * @description 模拟盘交易控制台
 *              四栏布局：账户概览 / 收益曲线+今日信号 / 实时持仓+交易记录
 *              核心交互：按信号执行交易，违规操作被拒绝并显示红色警告
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import ReactECharts from 'echarts-for-react';

const API_BASE = '/api/sim';

// ─── Mock数据（无快照时的初始展示数据） ───────────────────────────────────
const MOCK_SNAPSHOTS = Array.from({ length: 10 }, (_, i) => ({
  date: new Date(Date.now() - (9 - i) * 86400000).toISOString().split('T')[0],
  cumulativeReturnPct: (Math.random() * 0.1 - 0.02) * (i + 1) / 10,
  benchmarkReturnPct: (Math.random() * 0.05 - 0.01) * (i + 1) / 10,
}));

// ─── 信号类型标签样式 ─────────────────────────────────────────────────────
const SIGNAL_TYPE_CONFIG = {
  buy:         { label: '买入',   color: '#f5222d', bg: '#fff1f0' },
  add:         { label: '加仓',   color: '#fa541c', bg: '#fff2e8' },
  reduce:      { label: '减仓',   color: '#1890ff', bg: '#e6f7ff' },
  sell:        { label: '卖出',   color: '#096dd9', bg: '#e6f7ff' },
  stop_loss:   { label: '止损',   color: '#722ed1', bg: '#f9f0ff' },
  stop_profit: { label: '止盈',   color: '#13c2c2', bg: '#e6fffb' },
  clear:       { label: '清仓',   color: '#595959', bg: '#f5f5f5' },
};

export default function SimTradingConsole({ sessionId }) {
  // ─── 状态管理 ──────────────────────────────────────────────────────────
  const [session, setSession]       = useState(null);
  const [signals, setSignals]       = useState([]);
  const [trades, setTrades]         = useState([]);
  const [holdings, setHoldings]     = useState([]);
  const [snapshots, setSnapshots]   = useState(MOCK_SNAPSHOTS);
  const [loading, setLoading]       = useState(true);
  const [alert, setAlert]           = useState(null); // { type: 'success'|'error'|'warn', msg }

  // 交易弹窗状态
  const [tradeModal, setTradeModal] = useState(null); // { signal }
  const [tradeQty, setTradeQty]     = useState(100);
  const [tradePrice, setTradePrice] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // ─── 数据加载 ──────────────────────────────────────────────────────────
  const fetchAll = useCallback(async () => {
    if (!sessionId) return;
    try {
      const [sesRes, sigRes, trdRes, snapRes] = await Promise.all([
        fetch(`${API_BASE}/${sessionId}`),
        fetch(`${API_BASE}/${sessionId}/signals`),
        fetch(`${API_BASE}/${sessionId}/trades?pageSize=20`),
        fetch(`${API_BASE}/${sessionId}/snapshots`),
      ]);
      const [sesData, sigData, trdData, snapData] = await Promise.all([
        sesRes.json(), sigRes.json(), trdRes.json(), snapRes.json(),
      ]);

      if (sesData.success)  setSession(sesData.data);
      if (sigData.success)  setSignals(sigData.data);
      if (trdData.success)  setTrades(trdData.data);
      if (snapData.success && snapData.data.length > 0) setSnapshots(snapData.data);
    } catch (err) {
      console.error('[SimConsole] 数据加载失败:', err);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  // 首次加载 + 每30秒刷新
  useEffect(() => {
    fetchAll();
    const timer = setInterval(fetchAll, 30000);
    return () => clearInterval(timer);
  }, [fetchAll]);

  // ─── 执行交易 ─────────────────────────────────────────────────────────
  const handleTrade = async () => {
    if (!tradeModal || !tradeQty || !tradePrice) return;
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/${sessionId}/trade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stockCode: tradeModal.signal.stock_code,
          stockName: tradeModal.signal.stock_name,
          action: tradeModal.signal.signal_type,
          quantity: Number(tradeQty),
          price: Number(tradePrice),
        }),
      });
      const data = await res.json();

      if (data.success) {
        setAlert({ type: 'success', msg: data.message });
        setTradeModal(null);
        await fetchAll(); // 刷新数据
      } else if (data.violationFlag) {
        // 违规操作 — 显示红色警告
        setAlert({ type: 'error', msg: `⛔ ${data.message}` });
        setTradeModal(null);
      } else {
        setAlert({ type: 'warn', msg: data.message });
      }
    } catch (err) {
      setAlert({ type: 'error', msg: `请求失败：${err.message}` });
    } finally {
      setSubmitting(false);
      // 3秒后自动清除提示
      setTimeout(() => setAlert(null), 5000);
    }
  };

  // ─── ECharts 收益曲线配置 ─────────────────────────────────────────────
  const chartOption = {
    tooltip: { trigger: 'axis', formatter: (params) => {
      return params.map(p => `${p.seriesName}: ${(p.value * 100).toFixed(2)}%`).join('<br/>');
    }},
    legend: { data: ['策略收益', '沪深300基准'], top: 8 },
    grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
    xAxis: {
      type: 'category',
      data: snapshots.map(s => s.date),
      axisLabel: { fontSize: 11 },
    },
    yAxis: {
      type: 'value',
      axisLabel: { formatter: v => `${(v * 100).toFixed(1)}%` },
    },
    series: [
      {
        name: '策略收益',
        type: 'line',
        data: snapshots.map(s => s.cumulativeReturnPct),
        smooth: true,
        itemStyle: { color: '#f5222d' },
        areaStyle: { color: 'rgba(245,34,45,0.08)' },
      },
      {
        name: '沪深300基准',
        type: 'line',
        data: snapshots.map(s => s.benchmarkReturnPct || 0),
        smooth: true,
        itemStyle: { color: '#1890ff' },
        lineStyle: { type: 'dashed' },
      },
    ],
  };

  // ─── 渲染 ─────────────────────────────────────────────────────────────
  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>加载模拟盘数据中...</div>;
  }

  if (!session) {
    return <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>会话不存在或已结束</div>;
  }

  const returnPct = session.returnPct || 0;
  const returnColor = returnPct >= 0 ? '#f5222d' : '#52c41a';
  const tradingDays = session.tradingDays || 0;
  const progressPct = Math.min(100, (tradingDays / 30) * 100);
  const isCompleted = session.status === 'completed';

  return (
    <div style={{ display: 'flex', gap: 16, padding: 16, background: '#f0f2f5', minHeight: '100vh' }}>
      {/* ── 全局提示横幅 ─────────────────────────────────────────────── */}
      {alert && (
        <div style={{
          position: 'fixed', top: 20, left: '50%', transform: 'translateX(-50%)',
          zIndex: 9999, padding: '12px 24px', borderRadius: 8, fontWeight: 600,
          background: alert.type === 'success' ? '#f6ffed' : alert.type === 'error' ? '#fff1f0' : '#fffbe6',
          border: `1px solid ${alert.type === 'success' ? '#b7eb8f' : alert.type === 'error' ? '#ffa39e' : '#ffe58f'}`,
          color: alert.type === 'success' ? '#52c41a' : alert.type === 'error' ? '#f5222d' : '#faad14',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          maxWidth: 600, textAlign: 'center',
        }}>
          {alert.msg}
        </div>
      )}

      {/* ── 左侧：账户概览 ──────────────────────────────────────────── */}
      <div style={{ width: 220, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={cardStyle}>
          <div style={{ fontSize: 13, color: '#999', marginBottom: 4 }}>总资产</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: '#262626' }}>
            ¥{(session.total_assets || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: 18, fontWeight: 600, color: returnColor, marginTop: 4 }}>
            {returnPct >= 0 ? '+' : ''}{(returnPct * 100).toFixed(2)}%
          </div>
        </div>

        <StatCard label="可用现金" value={`¥${(session.current_cash || 0).toFixed(2)}`} />
        <StatCard label="持仓市值" value={`¥${(session.current_holdings_value || 0).toFixed(2)}`} />
        <StatCard label="最大回撤" value={`${((snapshots[snapshots.length-1]?.max_drawdown_pct || 0) * 100).toFixed(2)}%`} valueColor="#52c41a" />
        <StatCard label="合规率" value={`${session.total_trades + session.violation_count > 0 ? ((session.total_trades / (session.total_trades + session.violation_count)) * 100).toFixed(1) : 100}%`} />
        <StatCard label="违规次数" value={`${session.violation_count || 0} 次`} valueColor={session.violation_count > 0 ? '#f5222d' : '#52c41a'} />
        <StatCard label="交易笔数" value={`${session.total_trades || 0} 笔`} />

        {/* Day X/30 进度条 */}
        <div style={cardStyle}>
          <div style={{ fontSize: 13, color: '#999', marginBottom: 8 }}>
            进度 Day <span style={{ fontSize: 16, fontWeight: 700, color: '#262626' }}>{tradingDays}</span>/30
          </div>
          <div style={{ background: '#f0f0f0', borderRadius: 4, height: 8, overflow: 'hidden' }}>
            <div style={{ width: `${progressPct}%`, background: '#1890ff', height: '100%', borderRadius: 4, transition: 'width 0.5s' }} />
          </div>
          <div style={{ fontSize: 12, color: '#bfbfbf', marginTop: 4 }}>
            {session.start_date} 起
          </div>
        </div>

        {/* 完成时显示"查看评测报告"按钮 */}
        {isCompleted && (
          <button
            style={{ padding: '12px 0', background: 'linear-gradient(135deg, #f5222d, #fa8c16)', color: '#fff', border: 'none', borderRadius: 8, fontSize: 15, fontWeight: 700, cursor: 'pointer' }}
            onClick={() => window.location.href = `/sim/report/${sessionId}`}
          >
            📊 查看评测报告
          </button>
        )}
      </div>

      {/* ── 中部：收益曲线 + 今日信号 ─────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* 收益曲线 */}
        <div style={cardStyle}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12, color: '#262626' }}>
            📈 收益曲线（vs 沪深300基准）
          </div>
          <ReactECharts option={chartOption} style={{ height: 260 }} />
        </div>

        {/* 今日信号列表 */}
        <div style={cardStyle}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12, color: '#262626' }}>
            📡 今日策略信号
            {signals.length === 0 && <span style={{ fontSize: 12, color: '#999', fontWeight: 400, marginLeft: 8 }}>暂无信号，策略引擎将于下个交易日09:25生成</span>}
          </div>
          {signals.length === 0 ? (
            <div style={{ color: '#bfbfbf', textAlign: 'center', padding: '20px 0' }}>
              今日暂无策略信号
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {signals.map(sig => {
                const cfg = SIGNAL_TYPE_CONFIG[sig.signal_type] || { label: sig.signal_type, color: '#595959', bg: '#f5f5f5' };
                const isExpired = new Date(sig.expires_at) < new Date();
                const isExecuted = sig.is_executed === 1;
                return (
                  <div key={sig.id} style={{
                    display: 'flex', alignItems: 'center', padding: '10px 14px',
                    background: '#fafafa', borderRadius: 8, border: '1px solid #f0f0f0',
                    opacity: isExpired || isExecuted ? 0.5 : 1,
                  }}>
                    <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 700, background: cfg.bg, color: cfg.color, marginRight: 10 }}>
                      {cfg.label}
                    </span>
                    <span style={{ fontWeight: 600, marginRight: 8 }}>{sig.stock_code}</span>
                    {sig.stock_name && <span style={{ color: '#999', marginRight: 8, fontSize: 12 }}>{sig.stock_name}</span>}
                    {sig.signal_price && <span style={{ color: '#262626', marginRight: 8 }}>参考价 ¥{sig.signal_price}</span>}
                    <span style={{ flex: 1 }} />
                    {isExecuted ? (
                      <span style={{ fontSize: 12, color: '#52c41a' }}>✅ 已执行</span>
                    ) : isExpired ? (
                      <span style={{ fontSize: 12, color: '#bfbfbf' }}>已过期</span>
                    ) : (
                      <button
                        style={{ padding: '4px 14px', background: '#f5222d', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer', fontWeight: 600 }}
                        onClick={() => { setTradeModal({ signal: sig }); setTradePrice(sig.signal_price || ''); setTradeQty(100); }}
                      >
                        执行
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── 右侧：实时持仓 + 交易记录 ────────────────────────────── */}
      <div style={{ width: 320, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* 实时持仓 */}
        <div style={{ ...cardStyle, flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12, color: '#262626' }}>💼 实时持仓</div>
          {holdings.length === 0 ? (
            <div style={{ color: '#bfbfbf', textAlign: 'center', padding: '20px 0' }}>暂无持仓</div>
          ) : (
            holdings.map(h => (
              <div key={h.stock_code} style={{ marginBottom: 12, paddingBottom: 12, borderBottom: '1px solid #f0f0f0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontWeight: 600 }}>{h.stock_code} {h.stock_name}</span>
                  <span style={{ color: h.unrealized_pnl >= 0 ? '#f5222d' : '#52c41a', fontWeight: 600 }}>
                    {h.unrealized_pnl >= 0 ? '+' : ''}{(h.unrealized_pnl || 0).toFixed(2)}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>
                  {h.quantity}股 · 均价¥{h.avg_cost} · 现价¥{h.current_price || '-'}
                </div>
                <div style={{ fontSize: 12, color: '#999' }}>
                  仓位 {((h.position_weight || 0) * 100).toFixed(1)}% · 持 {h.hold_days || 0} 天
                </div>
              </div>
            ))
          )}
          {/* 无信号时买入按钮置灰，tooltip说明原因 */}
          <div title="需等待策略信号，不可手动操作">
            <button disabled style={{ width: '100%', padding: '8px 0', background: '#f5f5f5', color: '#bfbfbf', border: '1px solid #d9d9d9', borderRadius: 6, cursor: 'not-allowed', fontSize: 13 }}>
              买入（需等待策略信号）
            </button>
          </div>
        </div>

        {/* 交易记录时间线 */}
        <div style={{ ...cardStyle, maxHeight: 300, overflowY: 'auto' }}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12, color: '#262626' }}>📋 交易记录</div>
          {trades.length === 0 ? (
            <div style={{ color: '#bfbfbf', textAlign: 'center', padding: '20px 0' }}>暂无交易记录</div>
          ) : (
            trades.map(t => (
              <div key={t.id} style={{
                marginBottom: 8, padding: '8px 10px', borderRadius: 6,
                background: t.violation_flag ? '#fff1f0' : '#fafafa',
                border: `1px solid ${t.violation_flag ? '#ffa39e' : '#f0f0f0'}`,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                  <span style={{ fontWeight: 600, color: t.violation_flag ? '#f5222d' : '#262626' }}>
                    {t.violation_flag ? '⚠️ 违规' : (t.action === 'buy' || t.action === 'add' ? '买' : '卖')} {t.stock_code}
                  </span>
                  <span style={{ color: '#999', fontSize: 11 }}>
                    {new Date(t.trade_time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                {t.violation_flag ? (
                  <div style={{ fontSize: 11, color: '#f5222d', marginTop: 2 }}>{t.reject_reason}</div>
                ) : (
                  <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>
                    {t.quantity}股 @ ¥{t.price} · 净额¥{(t.net_amount || 0).toFixed(2)}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── 交易确认弹窗 ──────────────────────────────────────────── */}
      {tradeModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 28, width: 380, boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}>
            <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 20 }}>
              确认执行 — {SIGNAL_TYPE_CONFIG[tradeModal.signal.signal_type]?.label} {tradeModal.signal.stock_code} {tradeModal.signal.stock_name}
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 13, color: '#666' }}>价格（元）</label>
              <input
                type="number" step="0.01" value={tradePrice}
                onChange={e => setTradePrice(e.target.value)}
                style={{ display: 'block', width: '100%', padding: '8px 12px', border: '1px solid #d9d9d9', borderRadius: 6, fontSize: 15, marginTop: 4 }}
              />
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 13, color: '#666' }}>数量（股，须为100的整数倍）</label>
              <input
                type="number" step="100" min="100" value={tradeQty}
                onChange={e => setTradeQty(Number(e.target.value))}
                style={{ display: 'block', width: '100%', padding: '8px 12px', border: '1px solid #d9d9d9', borderRadius: 6, fontSize: 15, marginTop: 4 }}
              />
            </div>
            <div style={{ fontSize: 13, color: '#999', marginBottom: 20 }}>
              预估金额：¥{(Number(tradeQty) * Number(tradePrice) || 0).toFixed(2)}（含佣金/印花税/滑点）
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <button
                onClick={() => setTradeModal(null)}
                style={{ flex: 1, padding: '10px 0', background: '#f5f5f5', border: '1px solid #d9d9d9', borderRadius: 8, cursor: 'pointer', fontSize: 14 }}
              >
                取消
              </button>
              <button
                onClick={handleTrade} disabled={submitting}
                style={{ flex: 1, padding: '10px 0', background: submitting ? '#ccc' : '#f5222d', color: '#fff', border: 'none', borderRadius: 8, cursor: submitting ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 700 }}
              >
                {submitting ? '提交中...' : '确认执行'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 通用统计卡片组件 ─────────────────────────────────────────────────────
function StatCard({ label, value, valueColor = '#262626' }) {
  return (
    <div style={cardStyle}>
      <div style={{ fontSize: 12, color: '#999' }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 600, color: valueColor, marginTop: 2 }}>{value}</div>
    </div>
  );
}

// ─── 共用卡片样式 ─────────────────────────────────────────────────────────
const cardStyle = {
  background: '#fff',
  borderRadius: 10,
  padding: '14px 16px',
  boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
};
