/**
 * @file 策略广场 API
 * @description 提供策略广场列表（排序+筛选）、策略详情接口。
 *              推荐得分 = 收益率得分×30% + 风险评级得分×30% + 信用评级得分×25% + 订阅数得分×15%
 */

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { calcCreditGrade } = require('../services/credit-scorer');
// 引入定价矩阵，用于策略详情中返回天花板和地板信息
const pricingCaps = require('../config/pricing-caps');

// ============================================================
// 工具函数
// ============================================================

/**
 * 将数组中某字段归一化到 0-100
 * @param {Array} items 数据列表
 * @param {string} field 字段名
 * @returns {Map<any, number>} 各行得分 Map（key = 行索引）
 */
function normalizeField(items, field) {
  const values = items.map(item => item[field] ?? 0);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  return items.map(item => ((item[field] ?? 0) - min) / range * 100);
}

/**
 * 信用评级 → 数值分（用于归一化）
 * S+ → 7, S → 6, A+ → 5, A → 4, B → 3, C → 2, D → 1
 */
const GRADE_SCORE = { 'S+': 7, 'S': 6, 'A+': 5, 'A': 4, 'B': 3, 'C': 2, 'D': 1 };

/**
 * 风险等级 → 数值分（风险越低越安全，排序时高评分=低风险）
 * low → 3, medium → 2, high → 1
 */
const RISK_SCORE = { low: 3, medium: 2, high: 1 };

/**
 * 信用评级下限过滤：判断策略评级是否满足最低要求
 * @param {string} strategyGrade 策略信用评级
 * @param {string} minGrade 筛选最低评级
 */
function gradeGte(strategyGrade, minGrade) {
  return (GRADE_SCORE[strategyGrade] || 0) >= (GRADE_SCORE[minGrade] || 0);
}

// ============================================================
// GET /api/marketplace/strategies
// 策略广场列表，支持排序和筛选
// ============================================================
router.get('/strategies', async (req, res) => {
  try {
    const {
      sort         = 'recommended', // recommended/return_desc/risk_asc/subscribers_desc/newest
      capital_tier,   // 10w / 50w / 200w（资金档位）
      risk_level,     // low / medium / high
      min_return,     // 最低收益率%（如 5 表示5%）
      credit_grade,   // 信用评级下限 S+ / S / A+ / A / B
      page  = 1,
      limit = 20,
    } = req.query;

    const pageSize = Math.min(parseInt(limit) || 20, 100);
    const offset   = (Math.max(parseInt(page) || 1, 1) - 1) * pageSize;

    // 资金档位映射（前端传10w/50w/200w → 数据库字段值）
    const CAPITAL_TIER_MAP = { '10w': 'small', '50w': 'medium', '200w': 'large' };
    const dbCapitalTier = capital_tier ? CAPITAL_TIER_MAP[capital_tier] : null;

    // 基础查询：拉取所有未暂停策略及其最新统计数据
    let sql = `
      SELECT
        s.id,
        s.name,
        s.description,
        s.capital_tier,
        s.risk_level,
        s.status,
        s.warning_level,
        s.total_subscribers,
        s.created_at,
        -- 最新定价
        sp.price_monthly,
        sp.price_yearly,
        -- 近30天月均收益率（来自 strategy_monthly_returns）
        COALESCE(smr.monthly_return, 0) AS return_30d,
        -- 最大回撤（来自模拟盘或历史统计）
        COALESCE(ss.max_drawdown, 0) AS max_drawdown,
        -- 月均资金使用率（近30天快照均值）
        COALESCE(ps.avg_usage, 0) AS avg_usage_rate,
        -- 发布者ID（用于查信用评级）
        s.publisher_id,
        -- 信用评级（来自缓存表，若无则默认B）
        COALESCE(pc.grade, 'B') AS credit_grade
      FROM strategies s
      LEFT JOIN strategy_pricing sp
        ON sp.strategy_id = s.id
        AND sp.effective_from = (SELECT MAX(effective_from) FROM strategy_pricing WHERE strategy_id = s.id)
      LEFT JOIN strategy_monthly_returns smr
        ON smr.strategy_id = s.id
        AND smr.stat_month = strftime('%Y-%m', date('now', '-1 month'))
      LEFT JOIN strategy_stats ss ON ss.strategy_id = s.id
      LEFT JOIN (
        SELECT strategy_id, AVG(cash_usage_rate) AS avg_usage
        FROM position_snapshots
        WHERE snapshot_date >= date('now', '-30 days')
        GROUP BY strategy_id
      ) ps ON ps.strategy_id = s.id
      LEFT JOIN publisher_credit_cache pc ON pc.publisher_id = s.publisher_id
      WHERE s.status != 'suspended'
    `;

    const params = [];

    // 筛选条件
    if (dbCapitalTier) {
      sql += ` AND s.capital_tier = ?`;
      params.push(dbCapitalTier);
    }
    if (risk_level) {
      sql += ` AND s.risk_level = ?`;
      params.push(risk_level);
    }
    if (min_return) {
      sql += ` AND COALESCE(smr.monthly_return, 0) >= ?`;
      params.push(parseFloat(min_return) / 100);
    }
    // credit_grade 过滤在内存中处理（评级为字符串，SQL不便比较大小）

    sql += ` ORDER BY s.created_at DESC`; // 先全量拉取，内存排序

    const rawList = await db.all(sql, params);

    // 内存处理：信用评级过滤
    let filtered = rawList;
    if (credit_grade) {
      filtered = rawList.filter(item => gradeGte(item.credit_grade, credit_grade));
    }

    // ---- 推荐得分计算（内部） ----
    if (sort === 'recommended') {
      // 各维度归一化
      const returnScores  = normalizeField(filtered, 'return_30d');
      const riskScoresArr = filtered.map(item => RISK_SCORE[item.risk_level] || 2);
      const riskNorm      = normalizeField(riskScoresArr.map(v => ({ __v: v })), '__v');
      const creditScores  = filtered.map(item => GRADE_SCORE[item.credit_grade] || 3);
      const creditNorm    = normalizeField(creditScores.map(v => ({ __v: v })), '__v');
      const subNorm       = normalizeField(filtered, 'total_subscribers');

      filtered = filtered.map((item, i) => ({
        ...item,
        recommendScore: Math.round(
          returnScores[i]  * 0.30 +
          riskNorm[i]      * 0.30 +
          creditNorm[i]    * 0.25 +
          subNorm[i]       * 0.15
        ),
      })).sort((a, b) => b.recommendScore - a.recommendScore);
    } else if (sort === 'return_desc') {
      filtered.sort((a, b) => b.return_30d - a.return_30d);
    } else if (sort === 'risk_asc') {
      filtered.sort((a, b) => (RISK_SCORE[b.risk_level] || 2) - (RISK_SCORE[a.risk_level] || 2));
    } else if (sort === 'subscribers_desc') {
      filtered.sort((a, b) => b.total_subscribers - a.total_subscribers);
    }
    // newest: 已按 created_at DESC 排好序

    // 分页
    const total = filtered.length;
    const paged = filtered.slice(offset, offset + pageSize);

    // 格式化返回字段
    const list = paged.map(item => ({
      id:              item.id,
      name:            item.name,
      capitalTier:     item.capital_tier,
      riskLevel:       item.risk_level,
      creditGrade:     item.credit_grade,
      return30d:       Math.round((item.return_30d || 0) * 1000) / 10, // 转%
      maxDrawdown:     Math.round((item.max_drawdown || 0) * 1000) / 10,
      avgUsageRate:    Math.round((item.avg_usage_rate || 0) * 1000) / 10,
      totalSubscribers: item.total_subscribers || 0,
      priceMonthly:    item.price_monthly || 0,
      priceYearly:     item.price_yearly  || 0,
      warningLevel:    item.warning_level || null,
      recommendScore:  item.recommendScore || null,
    }));

    res.json({
      success: true,
      data:  list,
      meta:  { total, page: parseInt(page) || 1, pageSize },
    });
  } catch (err) {
    console.error('[marketplace] strategies list error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// GET /api/marketplace/strategies/:id
// 策略详情（订阅者视角完整版）
// 含：规则摘要 + 模拟盘数据 + 执行记录 + 信用评级 + 评价列表 + 当前定价
// ============================================================
router.get('/strategies/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // 基础策略信息
    const strategy = await db.get(`
      SELECT
        s.*,
        sp.price_monthly,
        sp.price_yearly,
        sp.effective_from AS pricing_updated_at,
        COALESCE(ss.max_drawdown, 0) AS max_drawdown,
        COALESCE(ss.sharpe_ratio, 0) AS sharpe_ratio
      FROM strategies s
      LEFT JOIN strategy_pricing sp
        ON sp.strategy_id = s.id
        AND sp.effective_from = (SELECT MAX(effective_from) FROM strategy_pricing WHERE strategy_id = s.id)
      LEFT JOIN strategy_stats ss ON ss.strategy_id = s.id
      WHERE s.id = ?
    `, [id]);

    if (!strategy) {
      return res.status(404).json({ success: false, error: '策略不存在' });
    }

    // 模拟盘数据（最近一期）
    const simData = await db.get(`
      SELECT * FROM simulations WHERE strategy_id = ? ORDER BY created_at DESC LIMIT 1
    `, [id]);

    // 近30条执行记录
    const execHistory = await db.all(`
      SELECT
        scheduled_date AS date,
        signal_type,
        stock_code,
        stock_name,
        confirm_status,
        confirm_time AS response_time,
        CASE WHEN is_miss_counted = 1 THEN 1 ELSE 0 END AS is_counted_miss
      FROM signals
      WHERE strategy_id = ?
        AND signal_type IN ('buy','sell','add','reduce','stop_loss')
      ORDER BY scheduled_date DESC
      LIMIT 30
    `, [id]);

    // 信用评级（实时计算）
    let creditInfo = null;
    try {
      creditInfo = await calcCreditGrade(strategy.publisher_id);
    } catch (e) {
      creditInfo = { grade: 'B', score: 50, breakdown: {} }; // 兜底
    }

    // 评价列表（最近20条）
    const reviews = await db.all(`
      SELECT
        r.id,
        r.rating,
        r.review_text AS comment,
        r.created_at,
        r.rating AS net_assessment,      -- good/bad（策略广场使用 good/bad）
        u.nickname AS reviewer_name
      FROM strategy_reviews r
      LEFT JOIN users u ON r.user_id = u.id
      WHERE r.strategy_id = ? AND r.ai_audit_status = 'approved'
      ORDER BY r.created_at DESC
      LIMIT 20
    `, [id]);

    // 执行统计摘要（近3个月）
    const missSummary = await db.all(`
      SELECT stat_month, total_position_signals, no_response_count,
        ROUND((1 - miss_rate) * 100, 1) AS response_rate_pct
      FROM strategy_miss_stats
      WHERE strategy_id = ?
        AND stat_month >= strftime('%Y-%m', date('now', '-3 months'))
      ORDER BY stat_month ASC
    `, [id]);

    // 查询发布者评级（用于前端展示评级徽章及定价上限）
    let publisherGrade = 'B'; // 兜底值
    try {
      const gradeRow = await db.get(
        `SELECT grade FROM publisher_ratings WHERE publisher_id = ? ORDER BY calculated_at DESC LIMIT 1`,
        [strategy.publisher_id]
      );
      if (gradeRow?.grade) publisherGrade = gradeRow.grade;
    } catch (_) {}

    // 计算当前评级×档次的调价天花板和价格地板（用于前端展示）
    const capitalTier = strategy.capital_tier;
    const priceCeiling = pricingCaps.getPriceCeiling(publisherGrade, capitalTier);
    const priceFloor = strategy.price_monthly
      ? Math.floor(strategy.price_monthly * pricingCaps.PRICE_FLOOR_RATIO)
      : 0;

    res.json({
      success: true,
      data: {
        strategy: {
          id:              strategy.id,
          name:            strategy.name,
          description:     strategy.description,
          capitalTier:     strategy.capital_tier,
          riskLevel:       strategy.risk_level,
          status:          strategy.status,
          warningLevel:    strategy.warning_level,
          totalSubscribers: strategy.total_subscribers,
          priceMonthly:    strategy.price_monthly || 0,
          priceYearly:     strategy.price_yearly  || 0,
          pricingUpdatedAt: strategy.pricing_updated_at,
          maxDrawdown:     Math.round((strategy.max_drawdown || 0) * 1000) / 10,
          sharpeRatio:     strategy.sharpe_ratio,
          createdAt:       strategy.created_at,
          // 评级与定价约束信息（供前端展示徽章和定价说明）
          publisherGrade,                    // 发布者评级（S+/S/A/B/C/D）
          priceCeiling:  priceCeiling ?? 0,  // 当前评级×档次的调价天花板（元）
          priceFloor,                        // 价格地板（初始定价×30%，防止恶意差评归零）
        },
        rulesSummary: strategy.rules_summary || null, // 规则摘要（发布者填写的公开说明）
        simData,
        creditInfo,
        execHistory: execHistory.map(r => ({
          date:          r.date,
          signalType:    r.signal_type,
          stockCode:     r.stock_code,
          stockName:     r.stock_name,
          status:        r.confirm_status,
          responseTime:  r.response_time,
          isCountedMiss: !!r.is_counted_miss,
        })),
        reviews,
        missSummary,
      },
    });
  } catch (err) {
    console.error('[marketplace] strategy detail error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 引入订阅管理服务（双重定价模式 + 宽限期管理）
const subscriptionManager = require('../services/subscription-manager');

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/strategy/:id/set-lifetime-price
// 发布者设置终身定价（仅 S/S+ 可调用）
// ─────────────────────────────────────────────────────────────────────────────
router.post('/strategy/:id/set-lifetime-price', async (req, res) => {
  try {
    // 从请求头或 session 获取发布者身份（生产环境替换为 JWT 中间件）
    const publisherId = req.headers['x-publisher-id'] || req.session?.publisherId;
    if (!publisherId) return res.status(401).json({ success: false, error: '未授权：请先登录' });

    const strategyId = req.params.id;
    const { lifetime_price } = req.body;

    if (typeof lifetime_price !== 'number' || lifetime_price < 0) {
      return res.status(400).json({ success: false, error: 'lifetime_price 必须为非负数字' });
    }

    const result = await subscriptionManager.setLifetimePricing(db, publisherId, strategyId, lifetime_price);
    if (!result.success) {
      return res.status(403).json({ success: false, error: result.reason, suggested: result.suggested });
    }

    res.json({ success: true, lifetimePrice: result.lifetimePrice, suggested: result.suggested });
  } catch (err) {
    console.error('[marketplace] set-lifetime-price error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/subscription/renew
// 订阅者续费（月订阅）
// Body: { strategy_id: number }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/subscription/renew', async (req, res) => {
  try {
    const subscriberId = req.headers['x-subscriber-id'] || req.session?.userId;
    if (!subscriberId) return res.status(401).json({ success: false, error: '未授权：请先登录' });

    const { strategy_id } = req.body;
    if (!strategy_id) return res.status(400).json({ success: false, error: '缺少 strategy_id' });

    const result = await subscriptionManager.renewSubscription(db, subscriberId, strategy_id);
    if (!result.success) {
      return res.status(400).json({ success: false, error: result.reason });
    }

    res.json({ success: true, newExpiresAt: result.newExpiresAt });
  } catch (err) {
    console.error('[marketplace] subscription/renew error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/subscription/status/:strategyId
// 订阅者查看自己对某策略的订阅状态（是否在宽限期、到期时间等）
// ─────────────────────────────────────────────────────────────────────────────
router.get('/subscription/status/:strategyId', async (req, res) => {
  try {
    const subscriberId = req.headers['x-subscriber-id'] || req.session?.userId;
    if (!subscriberId) return res.status(401).json({ success: false, error: '未授权：请先登录' });

    const { strategyId } = req.params;
    const status = await subscriptionManager.checkSubscriptionActive(db, subscriberId, strategyId);

    res.json({
      success: true,
      subscription: {
        active:    status.active,
        type:      status.type,       // 'monthly' | 'lifetime' | null
        expiresAt: status.expiresAt,  // 到期时间（终身订阅为 null）
        inGrace:   status.inGrace,    // 是否在宽限期内
      },
    });
  } catch (err) {
    console.error('[marketplace] subscription/status error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
