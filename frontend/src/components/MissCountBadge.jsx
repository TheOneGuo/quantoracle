/**
 * @file MissCountBadge.jsx
 * @description 当月累计未响应次数进度条组件
 *   - 0-3次：绿色（正常）
 *   - 4-6次：黄色（警告）
 *   - 7-9次：橙色（严重警告）
 *   - 10次：红色（已暂停）
 */

import React, { useState, useEffect } from 'react';

// 颜色档位配置
const LEVEL_CONFIG = [
  { max: 3,  color: '#52c41a', bgColor: '#f6ffed', label: '正常',    borderColor: '#b7eb8f' },
  { max: 6,  color: '#faad14', bgColor: '#fffbe6', label: '警告',    borderColor: '#ffe58f' },
  { max: 9,  color: '#fa8c16', bgColor: '#fff7e6', label: '严重警告', borderColor: '#ffd591' },
  { max: 10, color: '#f5222d', bgColor: '#fff1f0', label: '已暂停',  borderColor: '#ffa39e' },
];

/**
 * 获取当前未响应次数对应的颜色档位配置
 * @param {number} count 未响应次数
 * @returns {Object} 档位配置
 */
function getLevelConfig(count) {
  for (const cfg of LEVEL_CONFIG) {
    if (count <= cfg.max) return cfg;
  }
  return LEVEL_CONFIG[LEVEL_CONFIG.length - 1];
}

/**
 * 当月未响应次数进度条
 * @param {Object} props
 * @param {string} props.strategyId 策略ID（用于API拉取数据）
 * @param {number} [props.count] 已知的未响应次数（可选，传入时跳过API请求）
 * @param {string} [props.month] 月份 YYYY-MM（默认当月）
 */
export default function MissCountBadge({ strategyId, count: propCount, month }) {
  const [count, setCount] = useState(propCount ?? null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(propCount === undefined);
  const [error, setError] = useState(null);

  // 若未传入count，从API拉取
  useEffect(() => {
    if (propCount !== undefined) {
      setCount(propCount);
      return;
    }
    if (!strategyId) return;

    const url = `/api/strategy/${strategyId}/miss-count${month ? `?month=${month}` : ''}`;
    setLoading(true);
    fetch(url)
      .then(r => r.json())
      .then(data => {
        setCount(data.no_response_count || 0);
        setTotal(data.total_position_signals || 0);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [strategyId, propCount, month]);

  if (loading) {
    return (
      <div style={styles.container}>
        <span style={{ color: '#999', fontSize: 13 }}>加载未响应统计...</span>
      </div>
    );
  }

  if (error || count === null) return null;

  const MAX_COUNT = 10;  // 最大未响应次数（超过即暂停）
  const cfg = getLevelConfig(count);
  const progressPct = Math.min((count / MAX_COUNT) * 100, 100);

  return (
    <div style={{ ...styles.container, background: cfg.bgColor, borderColor: cfg.borderColor }}>
      {/* 标题行 */}
      <div style={styles.headerRow}>
        <span style={styles.title}>当月未响应次数</span>
        <span style={{ ...styles.countBadge, background: cfg.color }}>
          {count} / {MAX_COUNT}
        </span>
      </div>

      {/* 进度条 */}
      <div style={styles.progressTrack}>
        <div
          style={{
            ...styles.progressBar,
            width: `${progressPct}%`,
            background: cfg.color,
          }}
        />
        {/* 刻度线（每3次一条警戒线） */}
        {[3, 6, 9].map(tick => (
          <div
            key={tick}
            style={{
              ...styles.tickMark,
              left: `${(tick / MAX_COUNT) * 100}%`,
            }}
          />
        ))}
      </div>

      {/* 刻度标注 */}
      <div style={styles.tickLabels}>
        <span style={{ color: '#52c41a' }}>0</span>
        <span style={{ color: '#faad14' }}>3</span>
        <span style={{ color: '#fa8c16' }}>6</span>
        <span style={{ color: '#f5222d' }}>9</span>
        <span style={{ color: '#f5222d', fontWeight: 'bold' }}>10</span>
      </div>

      {/* 状态说明 */}
      <div style={{ ...styles.statusText, color: cfg.color }}>
        {count === 0 && '✅ 本月暂无未响应记录'}
        {count > 0 && count <= 3 && `✅ 状态正常（${MAX_COUNT - count} 次余量）`}
        {count >= 4 && count <= 6 && `⚠️ 黄色警告：请提高响应率（还差 ${MAX_COUNT - count} 次触发暂停）`}
        {count >= 7 && count <= 9 && `🟠 橙色警告：请立即改善（仅剩 ${MAX_COUNT - count} 次余量）`}
        {count >= 10 && '🔴 策略已因未响应次数过多被暂停，请联系平台申诉'}
      </div>

      {/* 总信号参考 */}
      {total > 0 && (
        <div style={styles.subText}>
          本月共 {total} 次信号，未响应率 {((count / total) * 100).toFixed(1)}%
        </div>
      )}
    </div>
  );
}

const styles = {
  container: {
    border: '1px solid',
    borderRadius: 8,
    padding: '12px 14px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  headerRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  title: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#333',
  },
  countBadge: {
    color: '#fff',
    fontSize: 13,
    fontWeight: 'bold',
    padding: '2px 10px',
    borderRadius: 20,
  },
  progressTrack: {
    position: 'relative',
    height: 10,
    background: '#f0f0f0',
    borderRadius: 5,
    overflow: 'visible',
    marginBottom: 4,
  },
  progressBar: {
    height: '100%',
    borderRadius: 5,
    transition: 'width 0.4s ease',
  },
  tickMark: {
    position: 'absolute',
    top: -2,
    width: 2,
    height: 14,
    background: '#fff',
    borderRadius: 1,
    transform: 'translateX(-50%)',
    zIndex: 2,
  },
  tickLabels: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 11,
    color: '#999',
    marginBottom: 8,
  },
  statusText: {
    fontSize: 13,
    fontWeight: 500,
    marginBottom: 4,
  },
  subText: {
    fontSize: 12,
    color: '#999',
  },
};
