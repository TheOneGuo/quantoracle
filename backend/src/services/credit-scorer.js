/**
 * @file 策略发布者信用评级计算
 * @description 综合执行率、风险控制、盈利表现、用户口碑计算信用评级。
 *              信用评级影响：策略广场排名权重、定价系数上限、平台展示优先级。
 *
 * 评级体系：S+ / S / A+ / A / B / C / D
 */

const db = require('../db');

// ============================================================
// 常量配置
// ============================================================

/** 各子维度权重（合计100%） */
const WEIGHTS = {
  execRate:    0.40, // 执行响应率
  riskControl: 0.25, // 风险控制
  returnPerf:  0.20, // 盈利表现
  reputation:  0.15, // 用户口碑
};

/** 综合得分 → 信用评级映射 */
const GRADE_MAP = [
  { minScore: 90, grade: 'S+' },
  { minScore: 80, grade: 'S'  },
  { minScore: 70, grade: 'A+' },
  { minScore: 60, grade: 'A'  },
  { minScore: 50, grade: 'B'  },
  { minScore: 40, grade: 'C'  },
  { minScore:  0, grade: 'D'  },
];

// ============================================================
// 各子维度评分函数
// ============================================================

/**
 * 维度1：执行响应率评分（权重40%）
 * 响应率100% → 100分；响应率75% → 0分；线性插值；低于75%仍得0分
 * @param {number} execRate 近3个月持仓信号响应率（0-1）
 * @returns {number} 0-100分
 */
function scoreExecRate(execRate) {
  // 75%以下直接0分；75%-100%线性映射到0-100分
  const clamped = Math.max(execRate, 0.75);
  return Math.round((clamped - 0.75) / 0.25 * 100);
}

/**
 * 维度2：风险控制评分（权重25%）
 * 资金使用率越低、止损执行率越高 → 得分越高
 * @param {number} avgCashUsage   近3个月平均资金使用率（0-1）
 * @param {number} stopLossRate   近3个月止损执行率（0-1）
 * @returns {number} 0-100分
 */
function scoreRiskControl(avgCashUsage, stopLossRate) {
  // 资金使用率评分：使用率越低越安全
  //   0-30% → 100分；30-60% → 线性降至60分；60-100% → 线性降至0分
  let usageScore;
  if (avgCashUsage <= 0.30) {
    usageScore = 100;
  } else if (avgCashUsage <= 0.60) {
    usageScore = 100 - (avgCashUsage - 0.30) / 0.30 * 40;
  } else {
    usageScore = 60 - (avgCashUsage - 0.60) / 0.40 * 60;
  }

  // 止损执行率评分：线性映射 0-1 → 0-100分
  const stopScore = stopLossRate * 100;

  // 综合：资金使用率60% + 止损执行率40%
  return Math.round(usageScore * 0.6 + stopScore * 0.4);
}

/**
 * 维度3：盈利表现评分（权重20%）
 * 与同期沪深300基准比较，超越基准越多得分越高
 * @param {number} strategyReturn 近3个月策略月均收益率（如 0.05 = 5%）
 * @param {number} benchmarkReturn 近3个月沪深300月均收益率
 * @returns {number} 0-100分
 */
function scoreReturnPerf(strategyReturn, benchmarkReturn) {
  const alpha = strategyReturn - benchmarkReturn; // 超额收益率

  // alpha <= -5% → 0分；alpha >= 10% → 100分；中间线性插值
  if (alpha <= -0.05) return 0;
  if (alpha >= 0.10)  return 100;
  return Math.round((alpha + 0.05) / 0.15 * 100);
}

/**
 * 维度4：用户口碑评分（权重15%）
 * 净好评比率 = 净好评数 / 总评价数，越高得分越高
 * @param {number} netPositiveRate 净好评比率（0-1）
 * @returns {number} 0-100分
 */
function scoreReputation(netPositiveRate) {
  return Math.round(Math.max(0, Math.min(1, netPositiveRate)) * 100);
}

/**
 * 综合得分 → 信用评级
 * @param {number} score 综合得分（0-100）
 * @returns {string} 信用评级
 */
function gradeFromScore(score) {
  for (const { minScore, grade } of GRADE_MAP) {
    if (score >= minScore) return grade;
  }
  return 'D';
}

// ============================================================
// 主函数：计算发布者信用评级
// ============================================================

/**
 * 计算发布者当前信用评级
 * @param {string} publisherId 发布者ID
 * @returns {Promise<{ grade: string, score: number, breakdown: Object }>}
 */
async function calcCreditGrade(publisherId) {
  // 近3个月起止时间
  const now = new Date();
  const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1)
    .toISOString().slice(0, 10);

  // ---- 维度1：执行响应率 ----
  // 统计近3个月该发布者所有策略的持仓信号响应率
  const execData = await db.get(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN confirm_status IN ('executed','skip') THEN 1 ELSE 0 END) AS responded
    FROM signals sg
    JOIN strategies s ON sg.strategy_id = s.id
    WHERE s.publisher_id = ?
      AND sg.scheduled_date >= ?
      AND sg.signal_type IN ('buy','sell','add','reduce','stop_loss')
  `, [publisherId, threeMonthsAgo]);

  const total = execData?.total || 0;
  const responded = execData?.responded || 0;
  const execRate = total > 0 ? responded / total : 1.0; // 无信号时默认满分

  // ---- 维度2：风险控制 ----
  // 近3个月平均资金使用率（来自每日快照，15:05采集）
  const riskData = await db.get(`
    SELECT
      AVG(cash_usage_rate) AS avg_usage,
      AVG(CASE WHEN stop_loss_triggered THEN stop_loss_executed * 1.0 ELSE NULL END) AS stop_rate
    FROM position_snapshots ps
    JOIN strategies s ON ps.strategy_id = s.id
    WHERE s.publisher_id = ? AND ps.snapshot_date >= ?
  `, [publisherId, threeMonthsAgo]);

  const avgCashUsage = riskData?.avg_usage ?? 0.5;
  const stopLossRate = riskData?.stop_rate  ?? 0.8;

  // ---- 维度3：盈利表现 ----
  // 近3个月策略月均收益率（取所有策略平均）
  const returnData = await db.get(`
    SELECT AVG(monthly_return) AS avg_return
    FROM strategy_monthly_returns smr
    JOIN strategies s ON smr.strategy_id = s.id
    WHERE s.publisher_id = ?
      AND smr.stat_month >= ?
  `, [publisherId, threeMonthsAgo.slice(0, 7)]);

  const strategyReturn = returnData?.avg_return ?? 0;

  // 同期沪深300基准（从宏观数据表取，无数据时默认0.3%月均）
  const benchData = await db.get(`
    SELECT AVG(monthly_return) AS bench_return
    FROM market_benchmark
    WHERE index_code = 'CSI300' AND stat_month >= ?
  `, [threeMonthsAgo.slice(0, 7)]).catch(() => null);

  const benchmarkReturn = benchData?.bench_return ?? 0.003;

  // ---- 维度4：用户口碑 ----
  // 净好评数 / 总评价数（好评rating>=4，差评rating<=2，净好评=好评数-差评数）
  const reviewData = await db.get(`
    SELECT
      COUNT(*) AS total_reviews,
      SUM(CASE WHEN r.rating >= 4 THEN 1 ELSE 0 END) AS positive_count,
      SUM(CASE WHEN r.rating <= 2 THEN 1 ELSE 0 END) AS negative_count
    FROM strategy_reviews r
    JOIN strategies s ON r.strategy_id = s.id
    WHERE s.publisher_id = ? AND r.created_at >= ?
  `, [publisherId, threeMonthsAgo]);

  const totalReviews = reviewData?.total_reviews || 0;
  const positiveCount = reviewData?.positive_count || 0;
  const negativeCount = reviewData?.negative_count || 0;
  const netPositiveRate = totalReviews > 0
    ? Math.max(0, (positiveCount - negativeCount)) / totalReviews
    : 0.7; // 无评价时默认70%

  // ---- 各维度得分计算 ----
  const execScore    = scoreExecRate(execRate);
  const riskScore    = scoreRiskControl(avgCashUsage, stopLossRate);
  const returnScore  = scoreReturnPerf(strategyReturn, benchmarkReturn);
  const reputeScore  = scoreReputation(netPositiveRate);

  // ---- 加权综合得分 ----
  const compositeScore = Math.round(
    execScore    * WEIGHTS.execRate +
    riskScore    * WEIGHTS.riskControl +
    returnScore  * WEIGHTS.returnPerf +
    reputeScore  * WEIGHTS.reputation
  );

  const grade = gradeFromScore(compositeScore);

  // ---- 返回结果 ----
  return {
    grade,
    score: compositeScore,
    breakdown: {
      execRate: {
        score:    execScore,
        weight:   WEIGHTS.execRate,
        rawValue: execRate,
        label:    '执行响应率',
      },
      riskControl: {
        score:        riskScore,
        weight:       WEIGHTS.riskControl,
        rawAvgUsage:  avgCashUsage,
        rawStopRate:  stopLossRate,
        label:        '风险控制',
      },
      returnPerf: {
        score:          returnScore,
        weight:         WEIGHTS.returnPerf,
        rawReturn:      strategyReturn,
        rawBenchmark:   benchmarkReturn,
        rawAlpha:       strategyReturn - benchmarkReturn,
        label:          '盈利表现',
      },
      reputation: {
        score:           reputeScore,
        weight:          WEIGHTS.reputation,
        rawPositiveRate: netPositiveRate,
        totalReviews,
        label:           '用户口碑',
      },
    },
  };
}

module.exports = { calcCreditGrade };
