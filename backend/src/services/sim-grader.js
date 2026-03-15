/**
 * @file 30天模拟盘综合评测算法
 * @description 从5个维度对模拟盘进行量化评分，生成等级和智能定价建议
 *
 * 评分权重：
 *   收益率     30%  — 30天绝对收益，对比基准（沪深300）
 *   最大回撤   25%  — 风险控制能力，越小越好
 *   夏普比率   20%  — 风险调整后收益，衡量每单位风险的超额回报
 *   合规率     15%  — 严格按信号操作的比例（1 - 违规率）
 *   交易频次   10%  — 合理的交易频率（过高/过低均扣分）
 */

const db = require('../db');

// ─── 定价模型（按等级区间） ───────────────────────────────────────────────
const PRICING_TABLE = {
  S: { monthly: [999, 1999],   annual: [8888, 15888],  perSignal: 99 },
  A: { monthly: [499, 999],    annual: [3888, 8888],   perSignal: 49 },
  B: { monthly: [199, 499],    annual: [1588, 3888],   perSignal: 29 },
  C: { monthly: [99, 199],     annual: [788, 1588],    perSignal: 19 },
  D: { monthly: [29, 99],      annual: [288, 788],     perSignal: 9  },
};

// ─── 各维度评分标准 ───────────────────────────────────────────────────────

/** 收益率评分（满分100）：以30天累计收益率为基准 */
function scoreReturn(cumReturnPct) {
  // 累计收益率（绝对值）→ 分数映射
  if (cumReturnPct >= 0.30) return 100;   // ≥30% 满分
  if (cumReturnPct >= 0.20) return 85;    // 20-30%
  if (cumReturnPct >= 0.10) return 70;    // 10-20%
  if (cumReturnPct >= 0.05) return 55;    // 5-10%
  if (cumReturnPct >= 0)    return 40;    // 0-5%（保本）
  if (cumReturnPct >= -0.05) return 25;   // -5%-0%（小亏）
  if (cumReturnPct >= -0.15) return 10;   // -5%-15%（中亏）
  return 0;                               // <-15%（重亏）
}

/** 最大回撤评分（满分100）：回撤越小分数越高 */
function scoreMaxDrawdown(maxDrawdownPct) {
  const dd = Math.abs(maxDrawdownPct); // 取绝对值处理
  if (dd <= 0.03) return 100;   // ≤3%
  if (dd <= 0.05) return 85;    // 3-5%
  if (dd <= 0.08) return 70;    // 5-8%
  if (dd <= 0.12) return 55;    // 8-12%
  if (dd <= 0.20) return 35;    // 12-20%
  if (dd <= 0.30) return 15;    // 20-30%
  return 0;                     // >30%（重度回撤）
}

/**
 * 夏普比率评分（满分100）
 * 夏普 = (年化收益 - 无风险利率) / 年化波动率
 * A股无风险利率约2.5%（10年期国债）
 */
function scoreSharpe(sharpeRatio) {
  if (sharpeRatio >= 3.0) return 100;
  if (sharpeRatio >= 2.0) return 85;
  if (sharpeRatio >= 1.5) return 70;
  if (sharpeRatio >= 1.0) return 55;
  if (sharpeRatio >= 0.5) return 35;
  if (sharpeRatio >= 0)   return 15;
  return 0; // 负夏普（亏损）
}

/** 合规率评分（满分100）：严格按信号操作比例 */
function scoreCompliance(complianceRate) {
  if (complianceRate >= 1.0)   return 100;  // 100%合规
  if (complianceRate >= 0.95)  return 85;
  if (complianceRate >= 0.90)  return 70;
  if (complianceRate >= 0.80)  return 50;
  if (complianceRate >= 0.70)  return 30;
  return 10;                               // <70%合规
}

/**
 * 交易频次评分（满分100）
 * 30天内适宜频次：5-20笔（均值约0.5笔/天）
 * 过少可能策略无效，过多可能频繁换手
 */
function scoreTradingFrequency(totalTrades, tradingDays) {
  if (tradingDays <= 0) return 0;
  const avgPerDay = totalTrades / tradingDays;
  if (avgPerDay >= 0.2 && avgPerDay <= 1.0) return 100;  // 理想区间
  if (avgPerDay >= 0.1 && avgPerDay <= 1.5) return 75;
  if (avgPerDay >= 0.05 && avgPerDay <= 2.0) return 50;
  if (avgPerDay > 2.0) return 25;                        // 频繁换手
  return 20;                                             // 几乎不交易
}

/**
 * 计算夏普比率
 * @param {Array<number>} dailyReturns 每日收益率数组
 * @param {number} riskFreeAnnual 年化无风险利率（默认2.5%）
 * @returns {number} 夏普比率（年化）
 */
function calcSharpeRatio(dailyReturns, riskFreeAnnual = 0.025) {
  if (!dailyReturns || dailyReturns.length < 2) return 0;

  const n = dailyReturns.length;
  const mean = dailyReturns.reduce((s, r) => s + r, 0) / n;
  const variance = dailyReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / (n - 1);
  const stdDev = Math.sqrt(variance);

  if (stdDev === 0) return mean > 0 ? 99 : 0; // 无波动时特殊处理

  // 日化无风险利率（252个交易日/年）
  const riskFreeDaily = riskFreeAnnual / 252;
  // 年化夏普比率
  const sharpe = ((mean - riskFreeDaily) / stdDev) * Math.sqrt(252);
  return +sharpe.toFixed(4);
}

/**
 * 根据综合评分确定等级
 * @param {number} score 0-100分
 * @returns {string} S/A/B/C/D
 */
function getGrade(score) {
  if (score >= 90) return 'S';
  if (score >= 75) return 'A';
  if (score >= 60) return 'B';
  if (score >= 45) return 'C';
  return 'D';
}

/**
 * 根据等级和实际表现生成定价建议
 * 在定价区间内，根据收益率偏向高端或低端
 * @param {string} grade 等级
 * @param {number} cumReturnPct 累计收益率
 * @returns {{ monthly: number, annual: number, perSignal: number }}
 */
function suggestPricing(grade, cumReturnPct) {
  const table = PRICING_TABLE[grade];
  // 收益率越高，定价越接近区间上限
  const ratio = Math.min(1, Math.max(0, cumReturnPct / 0.30)); // 0-30%映射到0-1

  const monthly  = Math.round(table.monthly[0]  + (table.monthly[1]  - table.monthly[0])  * ratio);
  const annual   = Math.round(table.annual[0]   + (table.annual[1]   - table.annual[0])   * ratio);
  const perSignal = table.perSignal;
  return { monthly, annual, perSignal };
}

/**
 * 30天模拟盘综合评测（主函数）
 * @param {string} sessionId 会话ID
 * @returns {Promise<Object>} 完整评测报告
 */
async function gradeSimSession(sessionId) {
  // ── 1. 获取会话基础信息 ──────────────────────────────────────────────
  const session = await db.get(`SELECT * FROM sim_trading_sessions WHERE id = ?`, [sessionId]);
  if (!session) throw new Error(`会话 ${sessionId} 不存在`);

  // ── 2. 获取30天快照数据 ──────────────────────────────────────────────
  const snapshots = await db.all(
    `SELECT * FROM sim_daily_snapshots WHERE session_id = ? ORDER BY snapshot_date ASC`,
    [sessionId]
  );
  const tradingDays = snapshots.length;
  if (tradingDays === 0) {
    throw new Error('暂无快照数据，无法生成评测报告');
  }

  // ── 3. 提取关键指标 ──────────────────────────────────────────────────
  const lastSnapshot = snapshots[tradingDays - 1];
  const cumReturnPct = lastSnapshot.cumulative_return_pct || 0;
  const maxDrawdownPct = lastSnapshot.max_drawdown_pct || 0;

  // 每日收益率序列（用于夏普计算）
  const dailyReturns = snapshots.map(s => s.daily_return_pct || 0);
  const sharpeRatio = calcSharpeRatio(dailyReturns);

  // ── 4. 合规率计算 ────────────────────────────────────────────────────
  // 合规率 = 合规交易笔数 / 总操作次数（含被拒绝的违规操作）
  const totalOps = (session.total_trades || 0) + (session.violation_count || 0);
  const complianceRate = totalOps > 0 ? session.total_trades / totalOps : 1.0;

  // ── 5. 各维度评分 ────────────────────────────────────────────────────
  const scoreR  = scoreReturn(cumReturnPct);
  const scoreD  = scoreMaxDrawdown(maxDrawdownPct);
  const scoreS  = scoreSharpe(sharpeRatio);
  const scoreC  = scoreCompliance(complianceRate);
  const scoreF  = scoreTradingFrequency(session.total_trades || 0, tradingDays);

  // ── 6. 加权综合评分 ──────────────────────────────────────────────────
  // 权重：收益率30% + 最大回撤25% + 夏普比率20% + 合规率15% + 交易频次10%
  const finalScore = +(
    scoreR  * 0.30 +
    scoreD  * 0.25 +
    scoreS  * 0.20 +
    scoreC  * 0.15 +
    scoreF  * 0.10
  ).toFixed(2);

  // ── 7. 等级判定和定价建议 ────────────────────────────────────────────
  const grade = getGrade(finalScore);
  const pricing = suggestPricing(grade, cumReturnPct);

  // ── 8. 持久化评测结果到数据库 ────────────────────────────────────────
  await db.run(
    `UPDATE sim_trading_sessions
     SET final_score = ?, suggested_grade = ?,
         suggested_price_monthly = ?, suggested_price_annual = ?,
         suggested_price_per_signal = ?
     WHERE id = ?`,
    [finalScore, grade, pricing.monthly, pricing.annual, pricing.perSignal, sessionId]
  );

  // ── 9. 获取完整交易记录（用于报告展示） ─────────────────────────────
  const trades = await db.all(
    `SELECT * FROM sim_trades WHERE session_id = ? ORDER BY trade_time ASC`,
    [sessionId]
  );

  // ── 10. 构建完整评测报告 ─────────────────────────────────────────────
  return {
    sessionId,
    strategyId: session.strategy_id,
    userId: session.user_id,
    // 基础数据
    initialCapital: session.initial_capital,
    finalAssets: session.total_assets,
    totalTrades: session.total_trades,
    violationCount: session.violation_count,
    tradingDays,
    startDate: session.start_date,
    endDate: session.end_date,
    // 关键指标
    metrics: {
      cumReturnPct: +cumReturnPct.toFixed(4),
      maxDrawdownPct: +maxDrawdownPct.toFixed(4),
      sharpeRatio: +sharpeRatio.toFixed(4),
      complianceRate: +complianceRate.toFixed(4),
      avgTradesPerDay: tradingDays > 0 ? +((session.total_trades || 0) / tradingDays).toFixed(4) : 0,
    },
    // 各维度评分（用于雷达图）
    dimensionScores: {
      returnScore: scoreR,
      drawdownScore: scoreD,
      sharpeScore: scoreS,
      complianceScore: scoreC,
      frequencyScore: scoreF,
    },
    // 综合评测
    finalScore,
    grade,
    gradeDesc: { S: '卓越策略', A: '优质策略', B: '良好策略', C: '普通策略', D: '待优化策略' }[grade],
    // 智能定价建议
    pricing: {
      monthly: pricing.monthly,
      annual: pricing.annual,
      perSignal: pricing.perSignal,
      note: `基于您的 ${grade} 级评分（${finalScore}分），建议定价区间如上`,
    },
    // 历史快照数据（用于图表）
    snapshots: snapshots.map(s => ({
      date: s.snapshot_date,
      totalAssets: s.total_assets,
      cumulativeReturnPct: s.cumulative_return_pct,
      benchmarkReturnPct: s.benchmark_return_pct,
      dailyReturnPct: s.daily_return_pct,
      maxDrawdownPct: s.max_drawdown_pct,
    })),
    // 交易时间线摘要
    trades: trades.slice(-50), // 最近50笔，防止数据量过大
  };
}

module.exports = { gradeSimSession, PRICING_TABLE, calcSharpeRatio };
