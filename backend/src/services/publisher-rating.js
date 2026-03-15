/**
 * @file 策略发布者综合评级服务
 * @description 5维度边际递减平滑曲线综合评级，结果影响每月可发布策略数量
 *
 * 维度权重（内部，不对外公开）：
 *   维度1：成功发布策略数量    20%
 *   维度2：策略初始定价水平    15%
 *   维度3：好评差评综合比率    25%
 *   维度4：调价方向与频率      20%
 *   维度5：评价返款速度        20%
 *
 * 评级与发布额度：
 *   S+（90-100）：不限
 *   S （75-89）：5个/月
 *   A （60-74）：2个/月
 *   B （45-59）：1个/月
 *   C （30-44）：当月禁止
 *   D （<30）：3个月禁止
 */

// 引入定价矩阵，用于评级变动时截断超出天花板的策略价格
const pricingCaps = require('../config/pricing-caps');

'use strict';

/**
 * 从环境变量加载发布者综合评级权重配置
 * 生产环境必须在 .env 中配置真实权重，否则使用混淆默认值
 * 权重精确值属于平台核心机密，不出现在代码仓库中
 */
function loadPubRatingWeights() {
  return {
    strategyCount: parseFloat(process.env.DIM_X1 || '0.20'),
    initialPrice:  parseFloat(process.env.DIM_X2 || '0.20'),
    reviewRatio:   parseFloat(process.env.DIM_X3 || '0.20'),
    pricingDir:    parseFloat(process.env.DIM_X4 || '0.20'),
    refundSpeed:   parseFloat(process.env.DIM_X5 || '0.20'),
  };
}

/** 评级与额度映射表（按得分从高到低排列，find() 返回第一个满足条件的）*/
const GRADE_MAP = [
  { min: 90, grade: 'S+', quota: -1 }, // -1 表示不限额
  { min: 75, grade: 'S',  quota: 5  },
  { min: 60, grade: 'A',  quota: 2  },
  { min: 45, grade: 'B',  quota: 1  },
  { min: 30, grade: 'C',  quota: 0  }, // 0 表示当月禁止
  { min: 0,  grade: 'D',  quota: 0  }, // D 级额外有时间禁令
];

/**
 * 边际递减维度得分（开方函数，体现高分区越来越难提升）
 * @param {number} p 分位值 0-1（在所有发布者中的排名百分位）
 * @returns {number} 0-10 分
 */
function dimScore(p) {
  // Math.pow(p, 0.5) 即 sqrt(p)：低分位快速增长，高分位增长放缓（边际递减）
  return 10 * Math.pow(Math.max(0, Math.min(1, p)), 0.5);
}

/**
 * 计算某个发布者在所有发布者中的排名分位（0-1）
 * 分位值 = (比该发布者差的人数) / (总人数 - 1)，最少为 0
 * @param {number} value 当前发布者的原始值
 * @param {number[]} allValues 所有发布者的原始值数组
 * @param {boolean} lowerIsBetter 是否越小越好（如返款天数）
 * @returns {number} 0-1 分位值
 */
function percentileOf(value, allValues, lowerIsBetter = false) {
  if (allValues.length <= 1) return 0.5; // 只有自己时取中位
  const sorted = [...allValues].sort((a, b) => a - b);
  const rank = sorted.filter(v => (lowerIsBetter ? v > value : v < value)).length;
  return rank / (allValues.length - 1);
}

/**
 * 计算发布者5个维度的分位值（横向对比所有发布者）
 * @param {object} db 数据库实例
 * @param {string} publisherId 当前发布者ID
 * @returns {Promise<{d1: number, d2: number, d3: number, d4: number, d5: number}>}
 */
async function calcPercentiles(db, publisherId) {
  // ─── 维度1：历史成功发布策略数量 ───────────────────────────────────────────
  // 更多成功发布 = 更有经验，得分更高
  const allD1 = await new Promise((resolve, reject) => {
    db.db.all(
      `SELECT publisher_id, COUNT(*) as cnt
       FROM strategies
       WHERE status = 'published'
       GROUP BY publisher_id`,
      [],
      (err, rows) => err ? reject(err) : resolve(rows)
    );
  });
  const d1Map = Object.fromEntries(allD1.map(r => [r.publisher_id, r.cnt]));
  const myD1 = d1Map[publisherId] || 0;
  const allD1Values = allD1.map(r => r.cnt);
  if (!d1Map[publisherId]) allD1Values.push(0); // 新发布者补0
  const d1 = percentileOf(myD1, allD1Values, false);

  // ─── 维度2：初始定价水平（相对同档位发布者） ─────────────────────────────
  // 定价越合理（中位偏上）越好；定价过高或过低均不利
  // 此处简化：取发布者所有策略初始价格的中位数，在同档位中排名
  const allD2 = await new Promise((resolve, reject) => {
    db.db.all(
      `SELECT s.publisher_id,
              AVG(sp.new_price) as avg_init_price,
              s.fund_level
       FROM strategy_pricing sp
       JOIN strategies s ON sp.strategy_id = s.id
       WHERE sp.change_reason = 'ai_initial'
       GROUP BY s.publisher_id, s.fund_level`,
      [],
      (err, rows) => err ? reject(err) : resolve(rows)
    );
  });
  // 按资金档位分组计算同档中位数，再看当前发布者偏离度
  const fundGroups = {};
  allD2.forEach(r => {
    if (!fundGroups[r.fund_level]) fundGroups[r.fund_level] = [];
    fundGroups[r.fund_level].push({ publisher_id: r.publisher_id, price: r.avg_init_price });
  });
  // 取当前发布者所属档位，计算其在档内的价格分位（价格适中为好，此处正向排名即取中间值附近）
  let d2 = 0.5; // 无数据时默认中位
  const myD2Row = allD2.find(r => r.publisher_id === publisherId);
  if (myD2Row) {
    const peers = (fundGroups[myD2Row.fund_level] || []).map(r => r.price);
    // 价格处于中位偏上（75分位附近）最优；此处简化为正向分位
    d2 = percentileOf(myD2Row.avg_init_price, peers, false);
  }

  // ─── 维度3：好评差评综合比率 ──────────────────────────────────────────────
  // 净好评比率 = (好评数 - 差评数) / max(总评价数, 1)，越高越好
  const allD3 = await new Promise((resolve, reject) => {
    db.db.all(
      `SELECT s.publisher_id,
              SUM(CASE WHEN sr.rating >= 4 THEN 1 ELSE 0 END) as positive,
              SUM(CASE WHEN sr.rating <= 2 THEN 1 ELSE 0 END) as negative,
              COUNT(*) as total
       FROM strategy_reviews sr
       JOIN strategies s ON sr.strategy_id = s.id
       GROUP BY s.publisher_id`,
      [],
      (err, rows) => err ? reject(err) : resolve(rows)
    );
  });
  const d3Map = Object.fromEntries(
    allD3.map(r => [r.publisher_id, (r.positive - r.negative) / Math.max(r.total, 1)])
  );
  const myD3 = d3Map[publisherId] ?? 0;
  const allD3Values = allD3.map(r => (r.positive - r.negative) / Math.max(r.total, 1));
  if (!d3Map[publisherId]) allD3Values.push(0);
  const d3 = percentileOf(myD3, allD3Values, false);

  // ─── 维度4：调价方向与频率 ────────────────────────────────────────────────
  // 上调=正向信号，下调=负向信号（权重1.5倍惩罚）
  // 调价得分 = (上调次数 × 1.0 - 下调次数 × 1.5) / max(总调价次数, 1)
  const allD4 = await new Promise((resolve, reject) => {
    db.db.all(
      `SELECT s.publisher_id,
              SUM(CASE WHEN sp.new_price > sp.old_price THEN 1 ELSE 0 END) as up_cnt,
              SUM(CASE WHEN sp.new_price < sp.old_price THEN 1 ELSE 0 END) as down_cnt,
              COUNT(*) as total
       FROM strategy_pricing sp
       JOIN strategies s ON sp.strategy_id = s.id
       WHERE sp.change_reason != 'ai_initial'
       GROUP BY s.publisher_id`,
      [],
      (err, rows) => err ? reject(err) : resolve(rows)
    );
  });
  const d4Map = Object.fromEntries(
    allD4.map(r => [r.publisher_id, (r.up_cnt * 1.0 - r.down_cnt * 1.5) / Math.max(r.total, 1)])
  );
  const myD4 = d4Map[publisherId] ?? 0;
  const allD4Values = allD4.map(r => (r.up_cnt * 1.0 - r.down_cnt * 1.5) / Math.max(r.total, 1));
  if (!d4Map[publisherId]) allD4Values.push(0);
  const d4 = percentileOf(myD4, allD4Values, false);

  // ─── 维度5：评价返款速度（越快越好，以天为单位） ─────────────────────────
  // 平均返款天数 = AVG(julianday(refund_paid_at) - julianday(created_at))
  // 超过3天触发罚金，视为最慢；lowerIsBetter=true 让快的发布者分位接近1
  const allD5 = await new Promise((resolve, reject) => {
    db.db.all(
      `SELECT ps.publisher_id,
              AVG(
                CASE
                  WHEN ps.refund_paid_at IS NOT NULL
                  THEN julianday(ps.refund_paid_at) - julianday(ps.created_at)
                  ELSE 30  -- 未返款按30天最差处理
                END
              ) as avg_days
       FROM publisher_settlements ps
       GROUP BY ps.publisher_id`,
      [],
      (err, rows) => err ? reject(err) : resolve(rows)
    );
  });
  const d5Map = Object.fromEntries(allD5.map(r => [r.publisher_id, r.avg_days]));
  const myD5 = d5Map[publisherId] ?? 30; // 无记录默认30天（最差）
  const allD5Values = allD5.map(r => r.avg_days);
  if (!d5Map[publisherId]) allD5Values.push(30);
  const d5 = percentileOf(myD5, allD5Values, true); // 越小越好，反转分位

  return { d1, d2, d3, d4, d5 };
}

/**
 * 计算并持久化发布者综合评级
 * @param {object} db 数据库实例
 * @param {string} publisherId 发布者用户ID
 * @returns {Promise<{grade: string, score: number, monthly_quota: number, breakdown: object}>}
 */
async function calcAndSaveRating(db, publisherId) {
  // 计算各维度分位值
  const percentiles = await calcPercentiles(db, publisherId);

  // 内部权重从环境变量加载（不对外公开）
  const pw = loadPubRatingWeights();
  const weights = { d1: pw.strategyCount, d2: pw.initialPrice, d3: pw.reviewRatio, d4: pw.pricingDir, d5: pw.refundSpeed };

  // 边际递减得分：每个维度 0-10 分
  const scores = {
    d1: dimScore(percentiles.d1),
    d2: dimScore(percentiles.d2),
    d3: dimScore(percentiles.d3),
    d4: dimScore(percentiles.d4),
    d5: dimScore(percentiles.d5),
  };

  // 加权合成得分 0-10，乘以10转为0-100
  const composite =
    scores.d1 * weights.d1 +
    scores.d2 * weights.d2 +
    scores.d3 * weights.d3 +
    scores.d4 * weights.d4 +
    scores.d5 * weights.d5;
  const totalScore = composite * 10; // 最终得分 0-100

  // 匹配评级（GRADE_MAP 从高到低，find 返回第一个满足的）
  const gradeInfo = GRADE_MAP.find(g => totalScore >= g.min) || GRADE_MAP[GRADE_MAP.length - 1];

  // D级：额外记录3个月解禁日期
  let dGradeUnbanDate = null;
  if (gradeInfo.grade === 'D') {
    const unban = new Date();
    unban.setMonth(unban.getMonth() + 3);
    dGradeUnbanDate = unban.toISOString().split('T')[0];
  }

  // 下月1日为额度重置日期
  const now = new Date();
  const resetDate = new Date(now.getFullYear(), now.getMonth() + 1, 1)
    .toISOString().split('T')[0];

  // UPSERT 写入 publisher_ratings 表
  await new Promise((resolve, reject) => {
    db.db.run(
      `INSERT INTO publisher_ratings
         (publisher_id, grade, score, dim_percentiles, dim_scores,
          monthly_quota, quota_reset_date, d_grade_unban_date, calculated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(publisher_id) DO UPDATE SET
         grade = excluded.grade,
         score = excluded.score,
         dim_percentiles = excluded.dim_percentiles,
         dim_scores = excluded.dim_scores,
         monthly_quota = excluded.monthly_quota,
         quota_reset_date = excluded.quota_reset_date,
         d_grade_unban_date = CASE
           WHEN excluded.grade = 'D' THEN excluded.d_grade_unban_date
           ELSE NULL
         END,
         calculated_at = CURRENT_TIMESTAMP`,
      [
        publisherId,
        gradeInfo.grade,
        Math.round(totalScore * 10) / 10,
        JSON.stringify(percentiles),
        JSON.stringify(scores),
        gradeInfo.quota,
        resetDate,
        dGradeUnbanDate,
      ],
      (err) => err ? reject(err) : resolve()
    );
  });

  // 评级保存成功后，处理评级变动对已有策略价格的影响
  // 若新评级天花板低于当前策略价格，自动截断并退还订阅者差价
  try {
    await handleGradeDowngrade(db, publisherId, gradeInfo.grade);
  } catch (e) {
    // 价格截断失败不阻断评级保存结果，仅记录日志
    console.error(`[publisher-rating] handleGradeDowngrade 失败: publisherId=${publisherId}`, e.message);
  }

  return {
    grade: gradeInfo.grade,
    score: Math.round(totalScore * 10) / 10,
    monthly_quota: gradeInfo.quota,
    breakdown: { percentiles, scores, weights },
  };
}

// handleGradeDowngrade 定义于文件末尾，async function 声明在运行时已完成初始化

/**
 * 检查发布者是否可以新建策略（额度检查）
 * @param {object} db 数据库实例
 * @param {string} publisherId 发布者用户ID
 * @returns {Promise<{allowed: boolean, reason: string, remaining: number}>}
 */
async function checkPublishQuota(db, publisherId) {
  // 查询当前评级记录
  const rating = await new Promise((resolve, reject) => {
    db.db.get(
      `SELECT * FROM publisher_ratings WHERE publisher_id = ?`,
      [publisherId],
      (err, row) => err ? reject(err) : resolve(row)
    );
  });

  // 首次发布者，尚无评级记录时，默认允许（视为B级初始额度）
  if (!rating) {
    return { allowed: true, reason: '首次发布，享受初始额度', remaining: 1 };
  }

  const today = new Date().toISOString().split('T')[0];

  // ─── D级：检查3个月解禁日期 ──────────────────────────────────────────────
  if (rating.grade === 'D') {
    if (rating.d_grade_unban_date && today < rating.d_grade_unban_date) {
      return {
        allowed: false,
        reason: `您的综合评级为D级，禁止发布至 ${rating.d_grade_unban_date}，请于解禁后重新提交。`,
        remaining: 0,
      };
    }
  }

  // ─── C级：当月禁止 ────────────────────────────────────────────────────────
  if (rating.grade === 'C') {
    return {
      allowed: false,
      reason: '您的综合评级为C级，本月暂停发布资格。提升评级后下月恢复。',
      remaining: 0,
    };
  }

  // ─── S+级：不限额 ─────────────────────────────────────────────────────────
  if (rating.monthly_quota === -1) {
    return { allowed: true, reason: '您为S+评级，发布不限额度。', remaining: -1 };
  }

  // ─── 其他等级：检查本月已用额度 ──────────────────────────────────────────
  const published = rating.monthly_published || 0;
  const remaining = rating.monthly_quota - published;

  if (remaining <= 0) {
    return {
      allowed: false,
      reason: `您本月发布额度（${rating.monthly_quota}个）已用完，请下月再试。`,
      remaining: 0,
    };
  }

  return {
    allowed: true,
    reason: `本月还可发布 ${remaining} 个策略。`,
    remaining,
  };
}

/**
 * 发布策略成功后，递增当月已发布计数
 * @param {object} db 数据库实例
 * @param {string} publisherId 发布者用户ID
 */
async function incrementPublishedCount(db, publisherId) {
  await new Promise((resolve, reject) => {
    db.db.run(
      `UPDATE publisher_ratings
       SET monthly_published = monthly_published + 1
       WHERE publisher_id = ?`,
      [publisherId],
      (err) => err ? reject(err) : resolve()
    );
  });
}

/**
 * 每月1日重置所有发布者的月度发布计数，并重新计算评级
 * 在定时任务中调用
 * @param {object} db 数据库实例
 */
async function monthlyReset(db) {
  // 重置所有发布者的当月已发布计数
  await new Promise((resolve, reject) => {
    db.db.run(
      `UPDATE publisher_ratings SET monthly_published = 0, quota_reset_date = DATE('now', 'start of month', '+1 month')`,
      [],
      (err) => err ? reject(err) : resolve()
    );
  });

  // 获取所有发布者ID，重新计算评级
  const publishers = await new Promise((resolve, reject) => {
    db.db.all(
      `SELECT DISTINCT publisher_id FROM strategies WHERE status = 'published'`,
      [],
      (err, rows) => err ? reject(err) : resolve(rows)
    );
  });

  // 串行计算，避免并发写入冲突
  for (const { publisher_id } of publishers) {
    try {
      await calcAndSaveRating(db, publisher_id);
    } catch (err) {
      console.error(`[publisher-rating] 重新计算评级失败: ${publisher_id}`, err.message);
    }
  }

  console.log(`[publisher-rating] 月度重置完成，共处理 ${publishers.length} 位发布者`);
}

// ============================================================
// 评级变动后价格截断处理
// ============================================================

/**
 * 评级变动后处理：若新评级天花板低于当前策略价格，截断并退差额给订阅者
 * 查询该发布者所有已上架策略，逐一检查价格是否超出新评级天花板
 *
 * @param {object} dbConn  数据库实例（支持 .all / .run）
 * @param {string} publisherId 发布者用户ID
 * @param {string} newGrade    新评级（S+/S/A/B/C/D）
 * @returns {Promise<{ truncatedCount: number, strategies: Array }>}
 */
async function handleGradeDowngrade(dbConn, publisherId, newGrade) {
  // 1. 查询该发布者所有已上架策略，获取 capital_tier 和当前价格
  const strategies = await new Promise((resolve, reject) => {
    dbConn.all(
      `SELECT id, name, capital_tier, price_monthly
       FROM strategies
       WHERE publisher_id = ? AND status = 'published'`,
      [publisherId],
      (err, rows) => err ? reject(err) : resolve(rows || [])
    );
  });

  const truncatedStrategies = [];

  for (const strategy of strategies) {
    // capital_tier 字段存储的是定价档次（10w/50w/200w）
    const tier = strategy.capital_tier;
    const currentPrice = strategy.price_monthly || 0;

    // 2. 检查当前价格是否超出新评级天花板
    const { newPrice, truncated, diff } = pricingCaps.applyGradeChange(currentPrice, newGrade, tier);

    if (truncated) {
      // 3a. 更新策略价格为截断后的新价格
      await new Promise((resolve, reject) => {
        dbConn.run(
          `UPDATE strategies SET price_monthly = ?, price_yearly = ?, pricing_updated_at = datetime('now')
           WHERE id = ?`,
          [newPrice, newPrice * 10, strategy.id],
          (err) => err ? reject(err) : resolve()
        );
      });

      // 3b. 记录调价历史到 strategy_pricing 表（change_reason='grade_downgrade'）
      await new Promise((resolve, reject) => {
        dbConn.run(
          `INSERT INTO strategy_pricing
             (strategy_id, price_monthly, price_yearly, change_reason, effective_from, created_at)
           VALUES (?, ?, ?, 'grade_downgrade', datetime('now'), datetime('now'))`,
          [strategy.id, newPrice, newPrice * 10],
          (err) => err ? reject(err) : resolve()
        );
      });

      // 3c. 查询受影响的当前活跃付费订阅者（用于通知和退款）
      const subscribers = await new Promise((resolve, reject) => {
        dbConn.all(
          `SELECT user_id, expires_at, price_paid
           FROM subscriptions
           WHERE strategy_id = ? AND status = 'active' AND price_paid > ?`,
          [strategy.id, newPrice],
          (err, rows) => err ? reject(err) : resolve(rows || [])
        );
      });

      // 3d. 为受影响订阅者写入退款记录（差价退款）
      for (const sub of subscribers) {
        // 计算剩余天数（按比例退还差价）
        const now = new Date();
        const expires = new Date(sub.expires_at);
        const totalDays = 30; // 月订阅按30天计算
        const remainingDays = Math.max(0, Math.ceil((expires - now) / (1000 * 60 * 60 * 24)));
        const refundAmount = Math.round((diff / totalDays) * remainingDays * 100) / 100;

        if (refundAmount > 0) {
          await new Promise((resolve, reject) => {
            dbConn.run(
              `INSERT INTO refund_records
                 (user_id, strategy_id, refund_amount, refund_reason, created_at)
               VALUES (?, ?, ?, ?, datetime('now'))`,
              [sub.user_id, strategy.id,
               refundAmount,
               `发布者评级变更为 ${newGrade}，策略价格从 ${currentPrice} 元调整为 ${newPrice} 元，退还剩余 ${remainingDays} 天差价`],
              (err) => err ? reject(err) : resolve()
            );
          });
        }
      }

      truncatedStrategies.push({
        strategyId: strategy.id,
        strategyName: strategy.name,
        oldPrice: currentPrice,
        newPrice,
        diff,
        affectedSubscribers: subscribers.length,
      });
    }

    // 4. 若新评级为 D：策略价格已归零（由上方 applyGradeChange 处理），收入冻结标记
    if (newGrade === 'D') {
      await new Promise((resolve, reject) => {
        dbConn.run(
          `UPDATE strategies SET income_frozen = 1 WHERE id = ?`,
          [strategy.id],
          (err) => err ? reject(err) : resolve()
        );
      }).catch(() => {
        // income_frozen 字段若不存在则忽略，不阻断主流程
      });
    }
  }

  console.log(`[publisher-rating] 评级变动处理完成：发布者 ${publisherId} 新评级 ${newGrade}，` +
    `共截断 ${truncatedStrategies.length} 个策略价格`);

  return { truncatedCount: truncatedStrategies.length, strategies: truncatedStrategies };
}

module.exports = {
  calcAndSaveRating,
  checkPublishQuota,
  incrementPublishedCount,
  monthlyReset,
  handleGradeDowngrade,
};
