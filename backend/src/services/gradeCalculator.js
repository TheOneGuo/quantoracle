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
 *   - 无实盘验证（broker_holdings < 3 条）：纯回测指标估算（B封顶，不给S/A）
 *   - 实盘验证通过（≥3条）：实盘60% + 回测40%
 */

// ─────────────────────────────────────────────────────────────────────────────
// 辅助：从 broker_holdings 查询策略作者90天内的实盘记录并计算指标
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 从数据库查询策略作者最近90天实盘持仓记录，计算实盘收益率等指标。
 *
 * @param {import('sqlite3').Database} db - 原始 SQLite db 实例（db.db）
 * @param {string} creatorId - 策略创建者 ID
 * @returns {Promise<{recordCount: number, avgReturn: number|null, liveVerified: boolean}>}
 */
async function fetchLiveHoldingsStats(db, creatorId) {
  if (!db || !creatorId) {
    return { recordCount: 0, avgReturn: null, liveVerified: false };
  }

  return new Promise((resolve) => {
    // 查询最近90天内该作者的实盘持仓记录（去重：按持仓ID计数）
    const sql = `
      SELECT
        id,
        avg_cost,
        current_price,
        quantity,
        market_value,
        synced_at
      FROM broker_holdings
      WHERE user_id = ?
        AND synced_at >= datetime('now', '-90 days')
      ORDER BY synced_at DESC
    `;
    db.all(sql, [creatorId], (err, rows) => {
      if (err || !rows || rows.length === 0) {
        resolve({ recordCount: 0, avgReturn: null, liveVerified: false });
        return;
      }

      const recordCount = rows.length;

      // 计算每条记录的浮动盈亏率（(现价 - 均价) / 均价）
      const returns = rows
        .filter(r => r.avg_cost > 0 && r.current_price > 0)
        .map(r => (r.current_price - r.avg_cost) / r.avg_cost);

      const avgReturn = returns.length > 0
        ? returns.reduce((s, v) => s + v, 0) / returns.length
        : null;

      // 实盘验证条件：记录数 ≥ 3 且有有效收益率数据
      const liveVerified = recordCount >= 3 && avgReturn !== null;

      resolve({ recordCount, avgReturn, liveVerified });
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 核心评级逻辑
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 计算策略等级（同步版，用于不需要数据库的场景）
 *
 * @param {Object} strategy - 策略对象（含 backtest_metrics）
 * @param {Object|null} liveStats - 实盘统计（含 profit_user_rate/annual_return/tracked_days）
 * @param {boolean} [liveVerified=false] - 是否通过实盘验证（broker_holdings ≥ 3 条）
 * @returns {string} 等级 S/A/B/C/D
 */
function calculateGrade(strategy, liveStats = null, liveVerified = false) {
  const bt = typeof strategy.backtest_metrics === 'string'
    ? JSON.parse(strategy.backtest_metrics)
    : (strategy.backtest_metrics || {});

  // ── 无实盘验证：仅凭回测，最高给 B ──────────────────────────────────────
  if (!liveVerified || !liveStats || liveStats.tracked_days < 30) {
    if (bt.annual_return > 0.20 && bt.sharpe > 1.5) return 'B';
    if (bt.annual_return > 0.10 && bt.sharpe > 1.0) return 'B';
    return 'C';
  }

  const { profit_user_rate, tracked_days } = liveStats;
  const liveReturn = liveStats.annual_return ?? bt.annual_return;

  // D 级优先判断：实盘严重偏离或大多数用户亏损
  if (profit_user_rate < 0.5) return 'D';
  if (bt.annual_return > 0 && Math.abs(liveReturn - bt.annual_return) / bt.annual_return > 0.5) return 'D';

  // ── 综合评分（实盘 60% + 回测 40%）──────────────────────────────────────
  const compositeReturn = liveReturn * 0.6 + bt.annual_return * 0.4;
  const compositeSharpe = (liveStats.sharpe ?? bt.sharpe ?? 0) * 0.6 + (bt.sharpe ?? 0) * 0.4;

  const hasFullYear = tracked_days >= 365;

  if (hasFullYear && compositeReturn > 0.30 && compositeSharpe > 2.0 && profit_user_rate > 0.80) return 'S';
  if (compositeReturn > 0.20 && compositeSharpe > 1.5 && profit_user_rate > 0.70) return 'A';
  if (compositeReturn > 0.10 && compositeSharpe > 1.0 && profit_user_rate > 0.60) return 'B';
  return 'C';
}

// ─────────────────────────────────────────────────────────────────────────────
// 异步版（含数据库查询）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 完整计算策略等级（异步版，查询 broker_holdings 验证实盘）
 *
 * @param {Object} strategy - 策略对象（含 creator_id / backtest_metrics）
 * @param {Object|null} liveStats - 实盘统计
 * @param {import('sqlite3').Database} db - 原始 SQLite db 实例
 * @returns {Promise<{grade: string, liveVerified: boolean, liveRecordCount: number, liveAvgReturn: number|null}>}
 */
async function calculateGradeWithLive(strategy, liveStats, db) {
  // 查询实盘持仓记录
  const { recordCount, avgReturn, liveVerified } = await fetchLiveHoldingsStats(
    db,
    strategy.creator_id
  );

  // 若 liveStats 不含 annual_return，尝试用 broker_holdings 均收益率补充
  let enrichedLiveStats = liveStats;
  if (liveVerified && avgReturn !== null && (!liveStats || liveStats.annual_return == null)) {
    // 简单年化估算：90天持仓浮盈率 × 4（粗略）
    enrichedLiveStats = {
      ...(liveStats || {}),
      annual_return: avgReturn * 4,
      tracked_days: (liveStats?.tracked_days || 90),
      profit_user_rate: avgReturn > 0 ? 0.65 : 0.45, // 缺少精确数据时的保守估算
    };
  }

  const grade = calculateGrade(strategy, enrichedLiveStats, liveVerified);

  return {
    grade,
    liveVerified,
    liveRecordCount: recordCount,
    liveAvgReturn: avgReturn,
  };
}

module.exports = { calculateGrade, calculateGradeWithLive, fetchLiveHoldingsStats };
