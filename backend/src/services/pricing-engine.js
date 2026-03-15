/**
 * @file AI定价引擎
 * @description 根据模拟盘数据计算初始定价，以及净好评/差评触发的动态调价。
 *              同时管理平台抽成档位逻辑。
 */

const db = require('../db');

// ============================================================
// 定价常量配置
// ============================================================

/**
 * 资金档位对应的基础月费（元）
 * 档位根据策略要求的仓位资金大小划分
 */
const CAPITAL_TIER_BASE_PRICE = {
  micro:  29,   // 微型仓位（≤5万）
  small:  59,   // 小型仓位（5-20万）
  medium: 99,   // 中型仓位（20-50万）
  large:  149,  // 大型仓位（50-100万）
  xlarge: 199,  // 超大仓位（>100万）
};

/**
 * 平台抽成档位
 * 按发布者总收入累积区间划分
 * 格式：{ maxRevenue: 上限（Infinity表示无上限）, rate: 抽成比例 }
 */
const COMMISSION_TIERS = [
  { maxRevenue: 10000,    rate: 0.30 },  // 月总收入≤1万：30%
  { maxRevenue: 50000,    rate: 0.25 },  // 月总收入≤5万：25%
  { maxRevenue: 200000,   rate: 0.20 },  // 月总收入≤20万：20%
  { maxRevenue: Infinity, rate: 0.15 },  // 月总收入>20万：15%
];

// ============================================================
// 初始定价
// ============================================================

/**
 * 计算策略初始定价（模拟盘结束后调用）
 * @param {Object} simResult 模拟盘结果
 * @param {string} simResult.capitalTier    资金档位 micro/small/medium/large/xlarge
 * @param {number} simResult.avgCashUsageRate 平均资金使用率（0-1）
 * @param {number} simResult.monthReturn     月均收益率（如 0.08 = 8%）
 * @param {number} simResult.avgDailySignals 日均信号数
 * @param {number} simResult.missCount       模拟期间未响应次数
 * @param {number} simResult.gradeScore      综合评分（0-100）
 * @returns {{ monthly: number, annual: number, perSignal: number, risk_level: string, priority: string }}
 */
function calcInitialPrice(simResult) {
  const { capitalTier, avgCashUsageRate, monthReturn, avgDailySignals, missCount, gradeScore } = simResult;

  // 1. 基础价格（按资金档位）
  let baseMonthly = CAPITAL_TIER_BASE_PRICE[capitalTier] || CAPITAL_TIER_BASE_PRICE.small;

  // 2. 收益率加成：月均收益率每增加1%，月费加5元（上限+100元）
  const returnBonus = Math.min(Math.floor(monthReturn * 100) * 5, 100);

  // 3. 资金使用率加成：使用率越高代表信号越多，酌情加价
  //    使用率>60% 加10元；>80% 加20元
  let usageBonus = 0;
  if (avgCashUsageRate > 0.8) usageBonus = 20;
  else if (avgCashUsageRate > 0.6) usageBonus = 10;

  // 4. 未响应次数折扣：模拟期每次未响应扣2元（上限-20元）
  const missPenalty = Math.min(missCount * 2, 20);

  // 5. 综合评分调节：评分>80加10元；<60减10元
  let gradeBonus = 0;
  if (gradeScore >= 80) gradeBonus = 10;
  else if (gradeScore < 60) gradeBonus = -10;

  // 6. 最终月费（向上取整到5元倍数）
  const rawMonthly = baseMonthly + returnBonus + usageBonus - missPenalty + gradeBonus;
  const monthly = Math.ceil(rawMonthly / 5) * 5;

  // 7. 年费 = 月费 × 10（即打83折）
  const annual = monthly * 10;

  // 8. 单信号费 = 月费 / 预估月信号数（日均 × 20个交易日）
  const estimatedMonthlySignals = Math.max(avgDailySignals * 20, 1);
  const perSignal = parseFloat((monthly / estimatedMonthlySignals).toFixed(2));

  // 9. 风险等级（根据月均收益率和资金档位）
  let risk_level = 'medium';
  if (monthReturn > 0.15 || capitalTier === 'xlarge') risk_level = 'high';
  else if (monthReturn < 0.05 && capitalTier === 'micro') risk_level = 'low';

  // 10. 优先级（影响策略广场排名加权）
  let priority = 'normal';
  if (gradeScore >= 90 && missCount === 0) priority = 'top';
  else if (gradeScore >= 75) priority = 'high';

  return { monthly, annual, perSignal, risk_level, priority };
}

// ============================================================
// 动态调价
// ============================================================

/**
 * 调价评估（净好评满10个 / 净差评满5个后调用）
 * @param {string} strategyId 策略ID
 * @param {'up'|'down'} direction 调价方向（好评→up，差评→down）
 * @returns {Promise<{ direction: string, change_pct: number, reasons: string[], new_price_monthly: number, comparison_scores: Object }>}
 */
async function calcPriceAdjustment(strategyId, direction) {
  // 查询当前策略定价
  const currentPricing = await new Promise((resolve, reject) => {
    const dbConn = db.getInstance ? db.getInstance() : db;
    dbConn.get(
      `SELECT * FROM strategy_pricing WHERE strategy_id=? ORDER BY created_at DESC LIMIT 1`,
      [strategyId],
      (err, row) => err ? reject(err) : resolve(row)
    );
  });

  if (!currentPricing) throw new Error(`策略 ${strategyId} 无定价记录`);

  // 获取同档位策略均价
  const tierAvg = await new Promise((resolve, reject) => {
    const dbConn = db.getInstance ? db.getInstance() : db;
    dbConn.get(`
      SELECT AVG(sp.price_monthly) AS avg_price
      FROM strategy_pricing sp
      JOIN strategies s ON sp.strategy_id = s.id
      WHERE s.capital_tier = (SELECT capital_tier FROM strategies WHERE id=?)
        AND sp.effective_from = (SELECT MAX(effective_from) FROM strategy_pricing WHERE strategy_id = sp.strategy_id)
    `, [strategyId], (err, row) => err ? reject(err) : resolve(row));
  });

  // 查询总订阅数排名（百分位）
  const subRank = await new Promise((resolve, reject) => {
    const dbConn = db.getInstance ? db.getInstance() : db;
    dbConn.get(`
      SELECT
        (SELECT COUNT(*) FROM strategies WHERE total_subscribers <= s.total_subscribers) * 1.0 /
        (SELECT COUNT(*) FROM strategies) AS rank_pct
      FROM strategies s WHERE s.id=?
    `, [strategyId], (err, row) => err ? reject(err) : resolve(row));
  });

  // 查询订阅增速分位（近30天增量排名）
  const growthRank = await new Promise((resolve, reject) => {
    const dbConn = db.getInstance ? db.getInstance() : db;
    dbConn.get(`
      SELECT
        (SELECT COUNT(*) FROM strategies s2
          JOIN (SELECT strategy_id, COUNT(*) AS cnt FROM subscriptions WHERE created_at > date('now', '-30 days') GROUP BY strategy_id) g2
          ON s2.id = g2.strategy_id
          WHERE g2.cnt <= g.cnt) * 1.0 /
        (SELECT COUNT(DISTINCT strategy_id) FROM subscriptions WHERE created_at > date('now', '-30 days')) AS growth_pct
      FROM strategies s
      LEFT JOIN (SELECT strategy_id, COUNT(*) AS cnt FROM subscriptions WHERE created_at > date('now', '-30 days') GROUP BY strategy_id) g
        ON s.id = g.strategy_id
      WHERE s.id=?
    `, [strategyId], (err, row) => err ? reject(err) : resolve(row));
  });

  // 4个横向对比维度评分（0-100）
  const avgPrice = tierAvg?.avg_price || currentPricing.price_monthly;
  const rankPct = subRank?.rank_pct || 0.5;
  const growthPct = growthRank?.growth_pct || 0.5;

  const comparison_scores = {
    // 维度1：原价 vs 同档均价（低于均价 → 有上调空间，评分高）
    price_vs_avg: currentPricing.price_monthly <= avgPrice ? 80 : 40,
    // 维度2：总订阅数排名（前20% → 高评分）
    sub_rank: rankPct >= 0.8 ? 90 : rankPct >= 0.5 ? 60 : 30,
    // 维度3：订阅增速分位（超90% → 高评分）
    growth_rank: growthPct >= 0.9 ? 95 : growthPct >= 0.7 ? 70 : 40,
    // 维度4：达成周期分位（暂用固定中等分，M5补充实际数据）
    achieve_speed: 60,
  };

  const avgScore = Object.values(comparison_scores).reduce((a, b) => a + b, 0) / 4;

  // 根据综合评分和调价方向决定调价幅度（3%-10%）
  let change_pct;
  if (direction === 'up') {
    // 评分越高，涨价幅度越大
    change_pct = avgScore >= 80 ? 10 : avgScore >= 60 ? 7 : 3;
  } else {
    // 差评降价：评分越低，降价幅度越大
    change_pct = avgScore <= 40 ? 10 : avgScore <= 60 ? 7 : 3;
  }

  const multiplier = direction === 'up' ? (1 + change_pct / 100) : (1 - change_pct / 100);
  const new_price_monthly = Math.ceil(currentPricing.price_monthly * multiplier / 5) * 5;

  const reasons = [];
  if (direction === 'up') {
    if (comparison_scores.price_vs_avg >= 80) reasons.push('当前定价低于同档位均价，有上调空间');
    if (comparison_scores.sub_rank >= 80) reasons.push('订阅数位于前20%，用户认可度高');
    if (comparison_scores.growth_rank >= 90) reasons.push('近期订阅增速超过90%分位');
  } else {
    reasons.push('差评数量触发阈值，竞争力需提升');
    if (comparison_scores.price_vs_avg < 60) reasons.push('当前定价高于同档位均价');
  }

  return {
    direction,
    change_pct,
    reasons,
    new_price_monthly,
    comparison_scores,
    old_price_monthly: currentPricing.price_monthly,
  };
}

// ============================================================
// 平台抽成档位
// ============================================================

/**
 * 获取平台当前抽成比例
 * 根据平台当月全部发布者总收入 / 总购买次数判断当前档位
 * @returns {Promise<number>} 抽成比例（小数，如 0.20 = 20%）
 */
async function getCurrentCommissionRate() {
  try {
    const dbConn = db.getInstance ? db.getInstance() : db;
    const currentMonth = new Date().toISOString().slice(0, 7);

    // 查询平台当月总收入
    const result = await new Promise((resolve, reject) => {
      dbConn.get(`
        SELECT COALESCE(SUM(amount), 0) AS total_revenue, COUNT(*) AS total_purchases
        FROM subscriptions
        WHERE month = ? AND status = 'active'
      `, [currentMonth], (err, row) => err ? reject(err) : resolve(row));
    });

    const totalRevenue = result?.total_revenue || 0;

    // 匹配抽成档位
    for (const tier of COMMISSION_TIERS) {
      if (totalRevenue <= tier.maxRevenue) {
        return tier.rate;
      }
    }

    // 兜底：最低档位
    return COMMISSION_TIERS[COMMISSION_TIERS.length - 1].rate;
  } catch (err) {
    console.error('[pricing-engine] getCurrentCommissionRate error:', err.message);
    return 0.20; // 出错时返回默认20%
  }
}

module.exports = { calcInitialPrice, calcPriceAdjustment, getCurrentCommissionRate };
