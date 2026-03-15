/**
 * @file SignalConfirmPage.jsx
 * @description 信号执行确认页
 *   - 显示30分钟倒计时（红色警示）
 *   - 信号摘要（只读）
 *   - 持仓状态（仅减仓类信号显示）
 *   - 执行/暂不执行选项
 *   - 提交后展示结果（是否计入未响应、T+1顺延提示）
 */

import React, { useState, useEffect, useCallback } from 'react';
import MissCountBadge from './MissCountBadge';

// 信号类型中文映射
const SIGNAL_TYPE_LABELS = {
  open: '开仓',
  add: '增仓',
  reduce: '减仓',
  stop_profit: '止盈',
  stop_loss: '止损',
};

// 不执行原因选项
const NOT_EXECUTED_REASONS = [
  { code: 'limit_up', label: '涨停无法买入' },
  { code: 'limit_down', label: '跌停无法卖出' },
  { code: 't1_lock', label: 'T+1锁定，今日无法操作' },
  { code: 'position_limit', label: '持仓上限限制' },
  { code: 'tech_issue', label: '技术/系统问题' },
  { code: 'other', label: '其他原因' },
];

/**
 * 格式化倒计时显示
 * @param {number} secondsLeft 剩余秒数
 * @returns {string} 格式化字符串 MM:SS
 */
function formatCountdown(secondsLeft) {
  if (secondsLeft <= 0) return '00:00';
  const m = Math.floor(secondsLeft / 60).toString().padStart(2, '0');
  const s = (secondsLeft % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

/**
 * 信号执行确认页
 * @param {Object} props
 * @param {Object} props.signal 信号对象
 * @param {string} props.strategyId 策略ID
 * @param {Function} props.onDone 提交完成回调
 */
export default function SignalConfirmPage({ signal, strategyId, onDone }) {
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [action, setAction] = useState(null);             // 'executed' | 'not_executed'
  const [actualPrice, setActualPrice] = useState('');
  const [actualQty, setActualQty] = useState('');
  const [reasonCode, setReasonCode] = useState('');
  const [reasonText, setReasonText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);             // 提交结果
  const [error, setError] = useState(null);

  // 计算倒计时
  useEffect(() => {
    if (!signal?.expires_at) return;
    const calcLeft = () => {
      const diff = Math.floor((new Date(signal.expires_at) - Date.now()) / 1000);
      setSecondsLeft(Math.max(0, diff));
    };
    calcLeft();
    const timer = setInterval(calcLeft, 1000);
    return () => clearInterval(timer);
  }, [signal?.expires_at]);

  const isExpired = secondsLeft <= 0;
  const isUrgent = secondsLeft > 0 && secondsLeft <= 300; // 剩余5分钟内红色警示
  const isReduceType = ['reduce', 'stop_profit', 'stop_loss'].includes(signal?.signal_type);

  // 提交确认
  const handleSubmit = useCallback(async () => {
    if (!action) return;
    if (action === 'executed' && (!actualPrice || !actualQty)) {
      setError('请填写实际成交价格和数量');
      return;
    }
    if (action === 'not_executed' && !reasonCode) {
      setError('请选择未执行原因');
      return;
    }
    if (action === 'not_executed' && reasonCode === 'other' && !reasonText.trim()) {
      setError('请填写其他原因的具体说明');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const resp = await fetch(`/api/signals/${signal.id}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          actual_price: action === 'executed' ? parseFloat(actualPrice) : undefined,
          actual_quantity: action === 'executed' ? parseInt(actualQty, 10) : undefined,
          reason_code: action === 'not_executed' ? reasonCode : undefined,
          reason_text: reasonCode === 'other' ? reasonText : undefined,
        }),
      });

      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || '提交失败');
      setResult(data);
      if (onDone) onDone(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }, [action, actualPrice, actualQty, reasonCode, reasonText, signal?.id, onDone]);

  // ── 提交成功展示结果 ──
  if (result) {
    return (
      <div style={styles.container}>
        <div style={styles.resultCard}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>
            {action === 'executed' ? '✅' : '⏭'}
          </div>
          <h2 style={{ margin: '0 0 8px' }}>
            {action === 'executed' ? '执行确认成功' : '未执行已记录'}
          </h2>
          {result.is_counted && (
            <div style={styles.alertBanner}>
              ⚠️ 本次已计入当月未响应统计
            </div>
          )}
          {result.warning && (
            <div style={{ ...styles.alertBanner, background: '#fff3cd', color: '#856404' }}>
              {result.warning}
            </div>
          )}
          {result.t1_followup_signal_id && (
            <div style={styles.infoBox}>
              📅 已生成T+1顺延信号（ID: {result.t1_followup_signal_id}）<br />
              <small>T+1锁定部分将于次日09:25推送</small>
            </div>
          )}
          {result.miss_stats && (
            <div style={{ marginTop: 16 }}>
              <MissCountBadge count={result.miss_stats.no_response_count} strategyId={strategyId} />
            </div>
          )}
        </div>
      </div>
    );
  }

  if (!signal) return <div style={styles.container}>加载中...</div>;

  return (
    <div style={styles.container}>
      {/* ── 倒计时区域 ── */}
      <div style={{
        ...styles.countdownBar,
        background: isUrgent ? '#dc3545' : isExpired ? '#6c757d' : '#1890ff',
      }}>
        {isExpired ? (
          <span>⛔ 响应窗口已关闭</span>
        ) : (
          <>
            <span>响应截止：</span>
            <span style={{ fontSize: 28, fontWeight: 'bold', letterSpacing: 2 }}>
              {formatCountdown(secondsLeft)}
            </span>
            {isUrgent && <span> ⚠️ 即将超时</span>}
          </>
        )}
      </div>

      {/* ── 信号摘要（只读）── */}
      <div style={styles.card}>
        <h3 style={styles.cardTitle}>📊 信号摘要</h3>
        <div style={styles.infoRow}>
          <span style={styles.label}>信号类型</span>
          <span style={{
            ...styles.value,
            color: signal.signal_type === 'stop_loss' ? '#dc3545' : '#333',
            fontWeight: 'bold',
          }}>
            {signal.signal_type === 'stop_loss' && '🔴 '}
            {SIGNAL_TYPE_LABELS[signal.signal_type] || signal.signal_type}
          </span>
        </div>
        <div style={styles.infoRow}>
          <span style={styles.label}>标的</span>
          <span style={styles.value}>{signal.stock_code} {signal.stock_name}</span>
        </div>
        <div style={styles.infoRow}>
          <span style={styles.label}>评级/评分</span>
          <span style={styles.value}>{signal.grade} / {signal.score}分</span>
        </div>
        <div style={styles.infoRow}>
          <span style={styles.label}>当前价</span>
          <span style={styles.value}>¥{signal.current_price}</span>
        </div>
        <div style={styles.infoRow}>
          <span style={styles.label}>建议数量</span>
          <span style={styles.value}>{signal.suggested_quantity}股</span>
        </div>
        {signal.cash_usage_rate && (
          <div style={styles.infoRow}>
            <span style={styles.label}>使用资金</span>
            <span style={styles.value}>{(signal.cash_usage_rate * 100).toFixed(1)}%</span>
          </div>
        )}
      </div>

      {/* ── 持仓状态（仅减仓类信号）── */}
      {isReduceType && (
        <div style={styles.card}>
          <h3 style={styles.cardTitle}>📦 持仓状态</h3>
          <div style={styles.infoRow}>
            <span style={styles.label}>总持仓</span>
            <span style={styles.value}>{signal.total_holding_qty || '-'} 股</span>
          </div>
          <div style={styles.infoRow}>
            <span style={styles.label}>今日可操作</span>
            <span style={{ ...styles.value, color: '#28a745' }}>
              {signal.available_qty || 0} 股
            </span>
          </div>
          <div style={styles.infoRow}>
            <span style={styles.label}>T+1锁定</span>
            <span style={{ ...styles.value, color: '#fd7e14' }}>
              {signal.t1_locked_qty || 0} 股（明日解锁）
            </span>
          </div>
          {signal.float_pnl_pct !== undefined && (
            <div style={styles.infoRow}>
              <span style={styles.label}>浮盈亏</span>
              <span style={{
                ...styles.value,
                color: signal.float_pnl_pct >= 0 ? '#28a745' : '#dc3545',
                fontWeight: 'bold',
              }}>
                {signal.float_pnl_pct >= 0 ? '+' : ''}{signal.float_pnl_pct?.toFixed(2)}%
              </span>
            </div>
          )}
        </div>
      )}

      {/* ── 执行操作选择 ── */}
      {!isExpired && (
        <div style={styles.card}>
          <h3 style={styles.cardTitle}>📝 执行操作</h3>

          {/* 操作切换按钮 */}
          <div style={styles.actionToggle}>
            <button
              style={{ ...styles.toggleBtn, ...(action === 'executed' ? styles.toggleBtnActive : {}) }}
              onClick={() => setAction('executed')}
            >
              ✅ 已执行
            </button>
            <button
              style={{ ...styles.toggleBtn, ...(action === 'not_executed' ? styles.toggleBtnActiveRed : {}) }}
              onClick={() => setAction('not_executed')}
            >
              ⏭ 暂不执行
            </button>
          </div>

          {/* 已执行：填写实际价格和数量 */}
          {action === 'executed' && (
            <div style={{ marginTop: 12 }}>
              <div style={styles.formRow}>
                <label style={styles.formLabel}>实际成交价（元）</label>
                <input
                  type="number"
                  step="0.01"
                  placeholder={`参考：¥${signal.current_price}`}
                  value={actualPrice}
                  onChange={e => setActualPrice(e.target.value)}
                  style={styles.input}
                />
              </div>
              <div style={styles.formRow}>
                <label style={styles.formLabel}>实际成交数量（股）</label>
                <input
                  type="number"
                  step="100"
                  placeholder={`建议：${signal.suggested_quantity}股`}
                  value={actualQty}
                  onChange={e => setActualQty(e.target.value)}
                  style={styles.input}
                />
              </div>
            </div>
          )}

          {/* 暂不执行：选择原因 */}
          {action === 'not_executed' && (
            <div style={{ marginTop: 12 }}>
              <p style={{ color: '#666', fontSize: 13, marginBottom: 8 }}>
                请选择未执行原因（系统将自动核验部分原因）
              </p>
              {NOT_EXECUTED_REASONS.map(r => (
                <label key={r.code} style={styles.radioRow}>
                  <input
                    type="radio"
                    name="reason_code"
                    value={r.code}
                    checked={reasonCode === r.code}
                    onChange={() => setReasonCode(r.code)}
                  />
                  <span style={{ marginLeft: 8 }}>{r.label}</span>
                  {['limit_up', 'limit_down', 't1_lock', 'position_limit'].includes(r.code) && (
                    <span style={styles.autoVerifyBadge}>系统自动核验</span>
                  )}
                </label>
              ))}
              {reasonCode === 'other' && (
                <textarea
                  placeholder="请说明原因（必填）"
                  value={reasonText}
                  onChange={e => setReasonText(e.target.value)}
                  style={styles.textarea}
                  rows={3}
                />
              )}
            </div>
          )}

          {error && <div style={styles.errorText}>{error}</div>}

          {action && (
            <button
              style={{ ...styles.submitBtn, opacity: submitting ? 0.6 : 1 }}
              disabled={submitting || isExpired}
              onClick={handleSubmit}
            >
              {submitting ? '提交中...' : '确认提交'}
            </button>
          )}
        </div>
      )}

      {/* ── 当月未响应进度条 ── */}
      {strategyId && (
        <div style={{ marginTop: 16 }}>
          <MissCountBadge strategyId={strategyId} />
        </div>
      )}
    </div>
  );
}

// ── 样式对象 ──
const styles = {
  container: {
    maxWidth: 480,
    margin: '0 auto',
    padding: '0 16px 32px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  countdownBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    color: '#fff',
    padding: '12px 16px',
    borderRadius: 8,
    margin: '16px 0',
    fontSize: 16,
  },
  card: {
    background: '#fff',
    border: '1px solid #e8e8e8',
    borderRadius: 8,
    padding: '16px',
    marginBottom: 12,
    boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
  },
  cardTitle: { margin: '0 0 12px', fontSize: 15, color: '#333' },
  infoRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '6px 0',
    borderBottom: '1px solid #f5f5f5',
  },
  label: { color: '#888', fontSize: 13 },
  value: { fontSize: 14, color: '#333' },
  actionToggle: { display: 'flex', gap: 12, marginBottom: 4 },
  toggleBtn: {
    flex: 1,
    padding: '10px 0',
    borderRadius: 6,
    border: '2px solid #d9d9d9',
    background: '#fafafa',
    cursor: 'pointer',
    fontSize: 14,
  },
  toggleBtnActive: { borderColor: '#1890ff', background: '#e6f7ff', color: '#1890ff', fontWeight: 'bold' },
  toggleBtnActiveRed: { borderColor: '#dc3545', background: '#fff5f5', color: '#dc3545', fontWeight: 'bold' },
  formRow: { marginBottom: 12 },
  formLabel: { display: 'block', fontSize: 13, color: '#666', marginBottom: 4 },
  input: {
    width: '100%',
    padding: '8px 12px',
    border: '1px solid #d9d9d9',
    borderRadius: 6,
    fontSize: 14,
    boxSizing: 'border-box',
  },
  textarea: {
    width: '100%',
    padding: '8px 12px',
    border: '1px solid #d9d9d9',
    borderRadius: 6,
    fontSize: 13,
    boxSizing: 'border-box',
    marginTop: 8,
    resize: 'vertical',
  },
  radioRow: {
    display: 'flex',
    alignItems: 'center',
    padding: '8px 0',
    cursor: 'pointer',
    fontSize: 14,
  },
  autoVerifyBadge: {
    marginLeft: 8,
    fontSize: 11,
    background: '#e6f7ff',
    color: '#1890ff',
    padding: '1px 6px',
    borderRadius: 4,
  },
  submitBtn: {
    width: '100%',
    padding: '12px 0',
    marginTop: 16,
    background: '#1890ff',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    fontSize: 16,
    cursor: 'pointer',
    fontWeight: 'bold',
  },
  errorText: { color: '#dc3545', fontSize: 13, marginTop: 8 },
  resultCard: {
    textAlign: 'center',
    background: '#fff',
    border: '1px solid #e8e8e8',
    borderRadius: 8,
    padding: '32px 20px',
    marginTop: 20,
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
  },
  alertBanner: {
    background: '#fff3cd',
    border: '1px solid #ffc107',
    borderRadius: 6,
    padding: '10px 14px',
    marginTop: 12,
    fontSize: 13,
    color: '#856404',
  },
  infoBox: {
    background: '#e6f7ff',
    border: '1px solid #91d5ff',
    borderRadius: 6,
    padding: '10px 14px',
    marginTop: 12,
    fontSize: 13,
    textAlign: 'left',
  },
};
