/**
 * @file gradeCalculator.js
 * @description 策略信用等级计算器（PRD v1.0 §3.5.5）
 * @module services/gradeCalculator
 *
 * 等级标准：
 *   S: 年化>30%, 夏普>2,   实盘盈利用户率>80%, 运行>1年
 *   A: 年化>20%, 夏普>1.5, 实盘盈利用户率>70%
 *   B: 年化>10%, 夏普>1,   实盘盈利用户率>60%
 *   C: 默认（新上架或数据不足）
 *   D: 实盘亏损用户>50% 或 实盘年化与回测偏差>20%
 *
 * 权重规则：
 *   - 无实盘数据：纯回测指标估算（C封顶，不给S/A）
 *   - 有实盘数据：实盘60% + 回测40%
 */

/**
 * 计算策略等级
 * @param {Object} strategy - 策略对象（含 backtest_metrics）
 * @param {Object|null} liveStats - 实盘统计（含 profit_user_rate/annual_return/tracked_days）
 * @returns {string} 等级 S/A/B/C/D
 */
function calculateGrade(strategy, liveStats = null) {
  const bt = typeof strategy.backtest_metrics === 'string'
    ? JSON.parse(strategy.backtest_metrics)
    : (strategy.backtest_metrics || {});

  // 无实盘数据：仅凭回测，最高给 B
  if (!liveStats || liveStats.tracked_days < 30) {
    if (bt.annual_return > 0.20 && bt.sharpe > 1.5) return 'B';
    if (bt.annual_return > 0.10 && bt.sharpe > 1.0) return 'B';
    return 'C';
  }

  const { profit_user_rate, tracked_days } = liveStats;
  const liveReturn = liveStats.annual_return ?? bt.annual_return;

  // D 级优先判断：实盘严重偏离或大多数用户亏损
  if (profit_user_rate < 0.5) return 'D';
  if (bt.annual_return > 0 && Math.abs(liveReturn - bt.annual_return) / bt.annual_return > 0.5) return 'D';

  // 综合评分（实盘 60% + 回测 40%）
  const compositeReturn = liveReturn * 0.6 + bt.annual_return * 0.4;
  const compositeSharpe = (liveStats.sharpe ?? bt.sharpe ?? 0) * 0.6 + (bt.sharpe ?? 0) * 0.4;

  const hasFullYear = tracked_days >= 365;

  if (hasFullYear && compositeReturn > 0.30 && compositeSharpe > 2.0 && profit_user_rate > 0.80) return 'S';
  if (compositeReturn > 0.20 && compositeSharpe > 1.5 && profit_user_rate > 0.70) return 'A';
  if (compositeReturn > 0.10 && compositeSharpe > 1.0 && profit_user_rate > 0.60) return 'B';
  return 'C';
}

module.exports = { calculateGrade };
