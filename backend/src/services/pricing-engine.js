/**
 * @file AI定价引擎
 * @description 根据模拟盘数据计算初始定价，以及净好评/差评触发的动态调价。
 *              同时管理平台抽成档位逻辑。
 */

const db = require('../db');

/**
 * 从环境变量加载权重配置
 * 生产环境必须在 .env 中配置真实权重，否则使用混淆默认值
 * 权重精确值属于平台核心机密，不出现在代码仓库中
 */
function loadWeights() {
  return {
    // 调价维度权重（从环境变量读取，默认值为占位值）
    price:       parseFloat(process.env.COEFF_A || '0.25'),
    subCount:    parseFloat(process.env.COEFF_B || '0.25'),
    subSpeed:    parseFloat(process.env.COEFF_C || '0.25'),
    reviewSpeed: parseFloat(process.env.COEFF_D || '0.25'),
    // 调价曲线形态参数
    adjMin:      parseFloat(process.env.CURVE_GAMMA || '3'),
    adjRange:    parseFloat(process.env.CURVE_DELTA || '7'),
    adjPower:    parseFloat(process.env.CURVE_ALPHA || '1.5'),
    dimPower:    parseFloat(process.env.CURVE_BETA  || '0.5'),
  };
}

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
// 动态调价（三层平滑曲线算法）
// ============================================================

/**
 * 计算单个维度得分（边际递减开方函数）
 * @param {number} p 分位值 0-1（0=最差，1=最优）
 * @param {'up'|'down'} direction 涨价/降价方向
 * @returns {number} 0-10分
 */
function dimScore(p, direction) {
  // 涨价方向：分位越高得分越高；降价方向：分位越低（越差）得分越高
  const v = direction === 'up' ? p : (1 - p);
  return 10 * Math.pow(v, 0.5); // 开方体现边际递减
}

/**
 * 计算AI调价幅度（三层平滑曲线）
 *
 * 第一层：各维度分位值 → 维度得分（开方函数，边际递减）
 * 第二层：4维加权合成综合得分（各维度权重不同）
 * 第三层：综合得分 → 调价幅度（1.5次幂平滑曲线，高分段上翘）
 *
 * @param {Object} percentiles 各维度在同档次策略中的百分位数（0-1）
 *   pricePct:       原始定价分位（0=最低定价，1=最高定价）
 *   subCountPct:    当前总订阅数排名分位（0=最少，1=最多）
 *   subSpeedPct:    近30天订阅增速分位（0=最慢，1=最快）
 *   reviewSpeedPct: 评价达成速度分位（0=最慢，1=最快）
 * @param {'up'|'down'} direction 涨价/降价
 * @returns {number} 调价幅度（%，保留1位小数，范围3%-10%）
 */
function calcAdjustmentPct(percentiles, direction) {
  // 从环境变量加载权重配置（各维度权重合计100%）
  const w = loadWeights();
  const weights = {
    price:       w.price,       // 原始定价分位
    subCount:    w.subCount,    // 总订阅数分位
    subSpeed:    w.subSpeed,    // 近30天增速分位
    reviewSpeed: w.reviewSpeed, // 评价达成速度分位
  };

  // 第一层：各维度得分（0-10分，边际递减，幂次从环境变量读取）
  const dp = w.dimPower;
  const scores = {
    price:       10 * Math.pow(direction === 'up' ? percentiles.pricePct       : (1 - percentiles.pricePct),       dp),
    subCount:    10 * Math.pow(direction === 'up' ? percentiles.subCountPct    : (1 - percentiles.subCountPct),    dp),
    subSpeed:    10 * Math.pow(direction === 'up' ? percentiles.subSpeedPct    : (1 - percentiles.subSpeedPct),    dp),
    reviewSpeed: 10 * Math.pow(direction === 'up' ? percentiles.reviewSpeedPct : (1 - percentiles.reviewSpeedPct), dp),
  };

  // 第二层：加权合成综合得分（0-10分）
  const composite =
    scores.price       * weights.price +
    scores.subCount    * weights.subCount +
    scores.subSpeed    * weights.subSpeed +
    scores.reviewSpeed * weights.reviewSpeed;

  // 第三层：平滑曲线映射调价幅度（从环境变量读取参数）
  const pct = w.adjMin + w.adjRange * Math.pow(composite / 10, w.adjPower);

  return Math.round(pct * 10) / 10; // 保留1位小数
}

/**
 * 调价评估（净好评满10个 / 净差评满5个后调用）
 * @param {string} strategyId 策略ID
 * @param {'up'|'down'} direction 调价方向（好评→up，差评→down）
 * @returns {Promise<{ direction: string, change_pct: number, reasons: string[], new_price_monthly: number, comparison_scores: Object, dim_scores: Object }>}
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

  // 查询评价达成速度分位（订单从下单到首次好评的时长排名）
  const reviewSpeedRank = await new Promise((resolve, reject) => {
    const dbConn = db.getInstance ? db.getInstance() : db;
    dbConn.get(`
      SELECT
        (SELECT COUNT(*) FROM strategies s2
          LEFT JOIN (
            SELECT strategy_id,
              AVG(julianday(r.created_at) - julianday(sub.created_at)) AS avg_days
            FROM strategy_reviews r
            JOIN subscriptions sub ON r.strategy_id = sub.strategy_id AND r.reviewer_id = sub.user_id
            WHERE r.rating >= 4
            GROUP BY strategy_id
          ) rs2 ON s2.id = rs2.strategy_id
          WHERE COALESCE(rs2.avg_days, 999) >= COALESCE(rs.avg_days, 999)
        ) * 1.0 /
        (SELECT COUNT(*) FROM strategies) AS review_speed_pct
      FROM strategies s
      LEFT JOIN (
        SELECT strategy_id,
          AVG(julianday(r.created_at) - julianday(sub.created_at)) AS avg_days
        FROM strategy_reviews r
        JOIN subscriptions sub ON r.strategy_id = sub.strategy_id AND r.reviewer_id = sub.user_id
        WHERE r.rating >= 4
        GROUP BY strategy_id
      ) rs ON s.id = rs.strategy_id
      WHERE s.id=?
    `, [strategyId], (err, row) => err ? reject(err) : resolve(row));
  });

  // 组装各维度分位值（0-1）
  const avgPrice = tierAvg?.avg_price || currentPricing.price_monthly;
  const rankPct    = subRank?.rank_pct              || 0.5;
  const growthPct  = growthRank?.growth_pct         || 0.5;
  const reviewSpeedPct = reviewSpeedRank?.review_speed_pct || 0.5;

  // 原始定价分位：当前价格 vs 同档均价，低于均价 → 分位高（有上调空间）
  const pricePct = currentPricing.price_monthly <= avgPrice
    ? Math.min(0.5 + (avgPrice - currentPricing.price_monthly) / avgPrice, 1.0)
    : Math.max(0.5 - (currentPricing.price_monthly - avgPrice) / avgPrice, 0.0);

  const percentiles = {
    pricePct,
    subCountPct:    rankPct,
    subSpeedPct:    growthPct,
    reviewSpeedPct,
  };

  // 调用三层平滑曲线算法计算调价幅度
  const change_pct = calcAdjustmentPct(percentiles, direction);

  // 各维度得分明细（供调价报告展示）
  const dim_scores = {
    price:       dimScore(pricePct,       direction),
    subCount:    dimScore(rankPct,        direction),
    subSpeed:    dimScore(growthPct,      direction),
    reviewSpeed: dimScore(reviewSpeedPct, direction),
  };

  // 保留兼容字段 comparison_scores（旧接口兼容）
  const comparison_scores = {
    price_vs_avg:  Math.round(dim_scores.price       * 10),
    sub_rank:      Math.round(dim_scores.subCount    * 10),
    growth_rank:   Math.round(dim_scores.subSpeed    * 10),
    achieve_speed: Math.round(dim_scores.reviewSpeed * 10),
  };

  const multiplier = direction === 'up' ? (1 + change_pct / 100) : (1 - change_pct / 100);
  const new_price_monthly = Math.ceil(currentPricing.price_monthly * multiplier / 5) * 5;

  const reasons = [];
  if (direction === 'up') {
    if (pricePct >= 0.6) reasons.push('当前定价低于同档位均价，有上调空间');
    if (rankPct >= 0.8)  reasons.push('订阅数位于前20%，用户认可度高');
    if (growthPct >= 0.9) reasons.push('近期订阅增速超过90%分位');
  } else {
    reasons.push('差评数量触发阈值，竞争力需提升');
    if (pricePct < 0.4) reasons.push('当前定价高于同档位均价');
  }

  return {
    direction,
    change_pct,
    reasons,
    new_price_monthly,
    old_price_monthly: currentPricing.price_monthly,
    comparison_scores,  // 兼容旧接口
    dim_scores,         // 各维度得分明细（0-10分，供调价报告展示）
    percentiles,        // 各维度分位值（0-1）
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
