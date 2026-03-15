/**
 * @file 执行记录时间线组件
 * @description 展示策略最近30条信号执行记录，时间线样式。
 *              每条记录显示：日期/信号类型标签/标的代码/响应状态/是否计次。
 */

import React, { useState, useEffect } from 'react';
import './ExecutionTimeline.css';

// ============================================================
// 常量配置
// ============================================================

/** 信号类型 → 中文标签 & 颜色 */
const SIGNAL_TYPE_LABELS = {
  buy:       { text: '买入',  color: '#ef4444', bg: '#fef2f2' },
  sell:      { text: '卖出',  color: '#10b981', bg: '#ecfdf5' },
  add:       { text: '加仓',  color: '#f97316', bg: '#fff7ed' },
  reduce:    { text: '减仓',  color: '#06b6d4', bg: '#ecfeff' },
  stop_loss: { text: '止损',  color: '#6b7280', bg: '#f9fafb' },
};

/** 执行状态 → 图标 & 文字 & 颜色 */
const STATUS_INFO = {
  executed:    { icon: '✅', text: '已执行',   color: '#10b981' },
  skip:        { icon: '⏭️', text: '暂不执行', color: '#6b7280' },
  no_response: { icon: '⚠️', text: '未响应',   color: '#f59e0b' },
  pending:     { icon: '⏳', text: '待响应',   color: '#3b82f6' },
};

// ============================================================
// 主组件：执行记录时间线
// ============================================================

/**
 * 执行时间线组件
 * @param {string}  props.strategyId 策略ID
 * @param {number}  [props.limit=30] 最多显示条数
 */
export default function ExecutionTimeline({ strategyId, limit = 30 }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  useEffect(() => {
    if (!strategyId) return;
    setLoading(true);
    setError(null);

    fetch(`/api/marketplace/${strategyId}/execution-history?limit=${limit}`)
      .then(r => r.json())
      .then(json => {
        if (json.success) {
          setRecords(json.data);
        } else {
          setError(json.error || '加载失败');
        }
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [strategyId, limit]);

  if (loading) return <div className="timeline-loading">加载执行记录中...</div>;
  if (error)   return <div className="timeline-error">加载失败：{error}</div>;
  if (!records.length) return <div className="timeline-empty">暂无执行记录</div>;

  return (
    <div className="execution-timeline">
      <h3 className="timeline-title">📋 信号执行记录（近30天）</h3>
      <div className="timeline-list">
        {records.map((record, idx) => {
          const signalInfo = SIGNAL_TYPE_LABELS[record.signalType] || { text: record.signalType, color: '#6b7280', bg: '#f9fafb' };
          const statusInfo = STATUS_INFO[record.status] || { icon: '❓', text: record.status, color: '#6b7280' };

          return (
            <div
              key={record.id || idx}
              className={`timeline-item ${record.isCountedMiss ? 'is-miss' : ''}`}
            >
              {/* 时间线竖线 & 圆点 */}
              <div className="timeline-dot-wrap">
                <div className={`timeline-dot dot-${record.status}`} />
                {idx < records.length - 1 && <div className="timeline-line" />}
              </div>

              {/* 记录内容 */}
              <div className="timeline-content">
                {/* 日期 */}
                <div className="timeline-date">{record.date}</div>

                {/* 信号类型标签 */}
                <span
                  className="signal-type-tag"
                  style={{ color: signalInfo.color, backgroundColor: signalInfo.bg }}
                >
                  {signalInfo.text}
                </span>

                {/* 标的代码 */}
                <span className="stock-code">
                  {record.stockCode}
                  {record.stockName && <span className="stock-name">（{record.stockName}）</span>}
                </span>

                {/* 响应状态 */}
                <span className="status-tag" style={{ color: statusInfo.color }}>
                  {statusInfo.icon} {statusInfo.text}
                </span>

                {/* 响应时间（仅已执行/暂不执行显示） */}
                {record.responseTime && (
                  <span className="response-time">
                    {record.responseTime.slice(11, 16)} 响应
                  </span>
                )}

                {/* 是否计入未响应次数 */}
                {record.isCountedMiss && (
                  <span className="miss-counted-tag">计次</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
