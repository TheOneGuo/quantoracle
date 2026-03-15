/**
 * @file StrategyRuleSummary.jsx
 * @description 策略规则只读展示组件
 *   - 雷达图展示5维度权重（SVG实现，无需额外图表库）
 *   - 仓位规则表（S/A/B/C各级开仓/增仓比例）
 *   - 止盈止损规则说明
 */

import React from 'react';

// ===================== 雷达图（纯SVG） =====================

/**
 * 五维度权重雷达图
 * @param {Object} weights { technical, fundamental, sentiment, capital, chip }
 */
function RadarChart({ weights = {} }) {
  const size = 200;
  const center = size / 2;
  const radius = 80;

  const dimensions = [
    { key: 'technical', label: '技术面', color: '#1890ff' },
    { key: 'fundamental', label: '基本面', color: '#52c41a' },
    { key: 'sentiment', label: '舆情面', color: '#faad14' },
    { key: 'capital', label: '资金面', color: '#722ed1' },
    { key: 'chip', label: '筹码面', color: '#eb2f96' }
  ];

  const n = dimensions.length;
  // 各维度角度（顶点从正上方开始，顺时针）
  const angles = dimensions.map((_, i) => (i * 2 * Math.PI) / n - Math.PI / 2);

  // 计算多边形顶点坐标
  const toPoint = (angle, r) => ({
    x: center + r * Math.cos(angle),
    y: center + r * Math.sin(angle)
  });

  // 背景网格（5层）
  const gridLevels = [20, 40, 60, 80, 100];

  // 数据多边形
  const dataPoints = dimensions.map((d, i) => {
    const val = Math.min(100, Math.max(0, weights[d.key] || 0));
    return toPoint(angles[i], (val / 100) * radius);
  });

  // 标签位置（延伸到多边形外）
  const labelPoints = dimensions.map((d, i) => toPoint(angles[i], radius + 22));

  const pointsToStr = (pts) => pts.map(p => `${p.x},${p.y}`).join(' ');

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {/* 背景网格 */}
      {gridLevels.map(level => {
        const pts = angles.map(a => toPoint(a, (level / 100) * radius));
        return (
          <polygon
            key={level}
            points={pointsToStr(pts)}
            fill="none"
            stroke="#e8e8e8"
            strokeWidth={1}
          />
        );
      })}

      {/* 轴线 */}
      {angles.map((angle, i) => {
        const outer = toPoint(angle, radius);
        return (
          <line
            key={i}
            x1={center} y1={center}
            x2={outer.x} y2={outer.y}
            stroke="#e8e8e8" strokeWidth={1}
          />
        );
      })}

      {/* 数据区域 */}
      <polygon
        points={pointsToStr(dataPoints)}
        fill="rgba(24, 144, 255, 0.15)"
        stroke="#1890ff"
        strokeWidth={2}
      />

      {/* 数据点 */}
      {dataPoints.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={4} fill={dimensions[i].color} />
      ))}

      {/* 维度标签 */}
      {labelPoints.map((p, i) => (
        <text
          key={i}
          x={p.x}
          y={p.y}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={10}
          fill={dimensions[i].color}
          fontWeight={600}
        >
          {dimensions[i].label}
          {'\n'}
          {weights[dimensions[i].key] || 0}%
        </text>
      ))}

      {/* 中心点 */}
      <circle cx={center} cy={center} r={3} fill="#1890ff" />
    </svg>
  );
}

// ===================== 主组件 =====================

/**
 * StrategyRuleSummary - 策略规则只读展示
 * @param {Object} props
 * @param {Object} props.rule 从 /api/strategy/:id/rules 获取的规则对象（JSON字段已解析）
 * @param {string} [props.strategyName] 策略名称
 * @param {boolean} [props.compact] 是否紧凑模式
 */
export default function StrategyRuleSummary({ rule, strategyName, compact = false }) {
  if (!rule) {
    return <div style={styles.empty}>暂无规则配置</div>;
  }

  const weights = rule.dimension_weights || {};
  const ca = rule.capital_allocation || {};
  const stopLoss = rule.stop_loss_rules || {};
  const takeProfits = rule.take_profit_rules || [];
  const reduceRules = rule.reduce_rules || [];
  const triggerRules = rule.trigger_rules || [];
  const pushChannels = rule.push_channels || [];

  const gradeColors = { S: '#f5222d', A: '#fa8c16', B: '#1890ff', C: '#52c41a' };

  return (
    <div style={styles.container}>
      {/* 策略基本信息 */}
      {strategyName && (
        <div style={styles.header}>
          <h3 style={styles.title}>{strategyName}</h3>
          <span style={styles.versionBadge}>v{rule.version || 1}</span>
          {rule.ai_template && (
            <span style={styles.templateBadge}>
              {rule.ai_template === 'conservative' ? '保守型' :
               rule.ai_template === 'balanced' ? '均衡型' : '激进型'}
            </span>
          )}
        </div>
      )}

      <div style={compact ? styles.compactGrid : styles.grid}>
        {/* 左栏：雷达图 */}
        {!compact && (
          <div style={styles.section}>
            <h4 style={styles.sectionTitle}>📊 选股维度权重</h4>
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <RadarChart weights={weights} />
            </div>
            {/* 权重列表 */}
            <div style={styles.weightList}>
              {[
                { key: 'technical', label: '技术面', color: '#1890ff' },
                { key: 'fundamental', label: '基本面', color: '#52c41a' },
                { key: 'sentiment', label: '舆情面', color: '#faad14' },
                { key: 'capital', label: '资金面', color: '#722ed1' },
                { key: 'chip', label: '筹码面', color: '#eb2f96' }
              ].map(({ key, label, color }) => (
                <div key={key} style={styles.weightItem}>
                  <div style={{ ...styles.weightDot, background: color }} />
                  <span style={{ flex: 1 }}>{label}</span>
                  <span style={{ fontWeight: 600, color }}>
                    {weights[key] || 0}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 右栏 */}
        <div>
          {/* 仓位规则表 */}
          <div style={styles.section}>
            <h4 style={styles.sectionTitle}>💰 仓位规则</h4>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>评级</th>
                  <th style={styles.th}>开仓%</th>
                  <th style={styles.th}>增仓%</th>
                </tr>
              </thead>
              <tbody>
                {['s', 'a', 'b', 'c'].map(g => (
                  <tr key={g}>
                    <td style={{ ...styles.td, fontWeight: 700, color: gradeColors[g.toUpperCase()] }}>
                      {g.toUpperCase()}级
                    </td>
                    <td style={styles.td}>{ca[`${g}_open`] || 0}%</td>
                    <td style={styles.td}>{ca[`${g}_add`] || '-'}{ca[`${g}_add`] ? '%' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={styles.hint}>
              单股上限 {ca.max_single_pct || 20}% · 总仓位 {ca.max_total_pct || 80}% · 最多增仓 {ca.max_add_times || 2} 次
            </div>
          </div>

          {/* 评级阈值 */}
          <div style={styles.section}>
            <h4 style={styles.sectionTitle}>🏆 评级阈值</h4>
            <div style={styles.thresholdBar}>
              {[
                { grade: 'S', threshold: rule.grade_s_threshold || 90, color: '#f5222d' },
                { grade: 'A', threshold: rule.grade_a_threshold || 75, color: '#fa8c16' },
                { grade: 'B', threshold: rule.grade_b_threshold || 60, color: '#1890ff' },
                { grade: 'C', threshold: rule.grade_c_threshold || 45, color: '#52c41a' },
                { grade: 'D', threshold: 0, color: '#999' }
              ].map(({ grade, threshold, color }) => (
                <div key={grade} style={{ ...styles.thresholdItem, borderColor: color }}>
                  <span style={{ color, fontWeight: 700 }}>{grade}</span>
                  <span style={styles.hint}>≥{threshold}</span>
                </div>
              ))}
            </div>
          </div>

          {/* 止损规则 */}
          <div style={styles.section}>
            <h4 style={styles.sectionTitle}>🛡️ 止损规则</h4>
            <div style={styles.ruleCard}>
              <div>📉 固定止损：亏损 <strong>{stopLoss.fixed_pct || 8}%</strong> 触发，卖出 <strong>{stopLoss.sell_pct || 100}%</strong> 持仓</div>
              {stopLoss.tech_stop && (
                <div>📊 技术止损：价格跌破 <strong>{stopLoss.tech_stop}</strong></div>
              )}
              {stopLoss.time_stop_days && (
                <div>⏰ 时间止损：持仓超 <strong>{stopLoss.time_stop_days}</strong> 天未达目标则止损</div>
              )}
            </div>
          </div>

          {/* 止盈规则 */}
          {takeProfits.length > 0 && (
            <div style={styles.section}>
              <h4 style={styles.sectionTitle}>🎯 止盈规则</h4>
              <div style={styles.ruleCard}>
                {takeProfits.map((rule, i) => (
                  <div key={i}>
                    {rule.type === 'fixed'
                      ? `📈 盈利达 ${rule.trigger_pct}% 时，减仓 ${rule.sell_pct}%`
                      : `🔄 追踪止盈：从高点回落 ${rule.drawdown_pct}%，减仓 ${rule.sell_pct}%`}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 减仓规则 */}
          {reduceRules.length > 0 && (
            <div style={styles.section}>
              <h4 style={styles.sectionTitle}>📤 减仓规则</h4>
              <div style={styles.ruleCard}>
                {reduceRules.map((rule, i) => {
                  const triggerMap = {
                    grade_s_to_a: 'S→A评级下降', grade_a_to_b: 'A→B评级下降',
                    grade_b_to_c: 'B→C评级下降', grade_c_to_d: 'C→D评级下降'
                  };
                  return (
                    <div key={i}>
                      ⬇️ {triggerMap[rule.trigger] || rule.trigger}：减仓 <strong>{rule.pct}%</strong>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 推送渠道 */}
          {pushChannels.length > 0 && (
            <div style={styles.section}>
              <h4 style={styles.sectionTitle}>📡 推送渠道</h4>
              <div style={styles.ruleCard}>
                {pushChannels.map((ch, i) => {
                  const icons = { telegram: '📨', wecom: '💼', feishu: '🪄' };
                  return (
                    <div key={i}>
                      {icons[ch.type] || '📣'} {ch.type}
                      {ch.enabled === false && ' （已禁用）'}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ===================== 样式 =====================

const styles = {
  container: {
    fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
    background: '#fff', borderRadius: 10, padding: 20
  },
  empty: { color: '#999', textAlign: 'center', padding: 40 },
  header: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 },
  title: { margin: 0, fontSize: 18, fontWeight: 700, color: '#333' },
  versionBadge: {
    background: '#e6f7ff', color: '#1890ff', padding: '2px 8px',
    borderRadius: 12, fontSize: 12, fontWeight: 600
  },
  templateBadge: {
    background: '#f6ffed', color: '#52c41a', padding: '2px 8px',
    borderRadius: 12, fontSize: 12, border: '1px solid #b7eb8f'
  },
  grid: { display: 'grid', gridTemplateColumns: '220px 1fr', gap: 20 },
  compactGrid: {},
  section: { marginBottom: 18 },
  sectionTitle: { margin: '0 0 10px', fontSize: 14, fontWeight: 600, color: '#444' },
  weightList: { marginTop: 8 },
  weightItem: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, fontSize: 13 },
  weightDot: { width: 10, height: 10, borderRadius: '50%' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: {
    background: '#f5f5f5', padding: '6px 10px', textAlign: 'center',
    border: '1px solid #e8e8e8', fontWeight: 600
  },
  td: { padding: '6px 10px', textAlign: 'center', border: '1px solid #e8e8e8' },
  hint: { fontSize: 11, color: '#999', marginTop: 4 },
  thresholdBar: { display: 'flex', gap: 8 },
  thresholdItem: {
    flex: 1, border: '2px solid', borderRadius: 8, padding: '6px 4px',
    textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2
  },
  ruleCard: {
    background: '#fafafa', borderRadius: 8, padding: '10px 14px',
    fontSize: 13, color: '#555', lineHeight: '1.8'
  }
};
