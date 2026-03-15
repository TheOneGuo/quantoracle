/**
 * @file 评价系统 API
 * @description 用户提交评价、AI审核（模拟）、发布者支付返现、评分摘要等功能
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');

// ============================================================
// 辅助函数
// ============================================================

/**
 * 计算拖延罚金（发布者超期未支付返现）
 * @param {number} refundAmount 应返现金额（元）
 * @param {number} daysOverdue 超期天数
 * @returns {number} 罚金金额（元）
 */
function calcOverdueFine(refundAmount, daysOverdue) {
  // 每超期1天，罚金为返现金额的5%（累计）
  return refundAmount * 0.05 * daysOverdue;
}

/**
 * 判断当月订阅期间策略的盈亏状态（用于AI审核模拟）
 * @param {string} strategyId 策略ID
 * @param {string} userId 用户ID
 * @param {string} subscriptionMonth 订阅月份 YYYY-MM
 * @returns {Promise<'profit'|'loss'|'unknown'>}
 */
async function getSubscriptionPnlStatus(strategyId, userId, subscriptionMonth) {
  try {
    const dbConn = db.getInstance ? db.getInstance() : db;

    // 查询该月模拟盘快照的累计收益率
    const snapshot = await new Promise((resolve, reject) => {
      dbConn.get(`
        SELECT total_return_pct
        FROM sim_daily_snapshots
        WHERE session_id IN (
          SELECT id FROM sim_trading_sessions WHERE strategy_id=? AND user_id=? LIMIT 1
        )
        AND snapshot_date >= ? AND snapshot_date < date(?, '+1 month')
        ORDER BY snapshot_date DESC LIMIT 1
      `, [strategyId, userId, subscriptionMonth + '-01', subscriptionMonth + '-01'],
        (err, row) => err ? reject(err) : resolve(row)
      );
    });

    if (!snapshot) return 'unknown';
    return snapshot.total_return_pct >= 0 ? 'profit' : 'loss';
  } catch {
    return 'unknown';
  }
}

// ============================================================
// POST /api/reviews — 提交评价
// ============================================================
router.post('/reviews', async (req, res) => {
  const {
    strategy_id,
    subscription_id,
    rating,            // good/bad
    review_text,       // Markdown，限1000字
    video_url,
    subscription_month,
  } = req.body;
  const userId = req.user?.id || req.headers['x-user-id'];

  // 参数校验
  if (!strategy_id || !subscription_id || !rating || !subscription_month) {
    return res.status(400).json({ error: '缺少必填字段' });
  }
  if (!['good', 'bad'].includes(rating)) {
    return res.status(400).json({ error: 'rating 必须为 good 或 bad' });
  }
  if (review_text && review_text.length > 1000) {
    return res.status(400).json({ error: 'review_text 不能超过1000字' });
  }

  try {
    const dbConn = db.getInstance ? db.getInstance() : db;

    // 验证订阅是否存在且属于该用户
    const sub = await new Promise((resolve, reject) => {
      dbConn.get(
        `SELECT * FROM subscriptions WHERE id=? AND user_id=? AND strategy_id=?`,
        [subscription_id, userId, strategy_id],
        (err, row) => err ? reject(err) : resolve(row)
      );
    });

    if (!sub) return res.status(403).json({ error: '订阅不存在或无权评价' });

    // 计算返现金额（差评时：月费的20%）
    let refund_amount = null;
    if (rating === 'bad') {
      const pricing = await new Promise((resolve, reject) => {
        dbConn.get(
          `SELECT price_monthly FROM strategy_pricing WHERE strategy_id=? ORDER BY created_at DESC LIMIT 1`,
          [strategy_id],
          (err, row) => err ? reject(err) : resolve(row)
        );
      });
      refund_amount = pricing ? parseFloat((pricing.price_monthly * 0.20).toFixed(2)) : null;
    }

    const reviewId = uuidv4();
    await new Promise((resolve, reject) => {
      dbConn.run(`
        INSERT INTO strategy_reviews
          (id, strategy_id, user_id, subscription_id, rating, review_text, video_url,
           refund_amount, subscription_month, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, [reviewId, strategy_id, userId, subscription_id, rating,
          review_text || null, video_url || null, refund_amount, subscription_month],
        (err) => err ? reject(err) : resolve()
      );
    });

    return res.status(201).json({
      success: true,
      review_id: reviewId,
      ai_audit_status: 'pending',
      refund_amount,
      message: rating === 'bad' ? '差评已提交，AI审核完成后平台将通知发布者支付返现' : '好评已提交，等待AI审核',
    });

  } catch (err) {
    if (err.message?.includes('UNIQUE')) {
      return res.status(409).json({ error: '该订阅月份已提交过评价' });
    }
    console.error('[reviews] POST /reviews error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ============================================================
// GET /api/reviews/strategy/:id — 获取策略评价列表（已审核通过的）
// ============================================================
router.get('/reviews/strategy/:id', async (req, res) => {
  const { id } = req.params;
  const { page = 1, limit = 20, rating } = req.query;

  try {
    const dbConn = db.getInstance ? db.getInstance() : db;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let sql = `
      SELECT r.id, r.strategy_id, r.rating, r.review_text,
             r.subscription_month, r.created_at,
             u.nickname AS reviewer_nickname
      FROM strategy_reviews r
      LEFT JOIN users u ON r.user_id = u.id
      WHERE r.strategy_id=? AND r.ai_audit_status='approved'
    `;
    const params = [id];

    if (rating) {
      sql += ` AND r.rating=?`;
      params.push(rating);
    }

    sql += ` ORDER BY r.created_at DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), offset);

    const reviews = await new Promise((resolve, reject) => {
      dbConn.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || []));
    });

    return res.json({ reviews, page: parseInt(page), limit: parseInt(limit) });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ============================================================
// POST /api/reviews/:reviewId/audit — AI审核（模拟）
// ============================================================
router.post('/reviews/:reviewId/audit', async (req, res) => {
  const { reviewId } = req.params;

  try {
    const dbConn = db.getInstance ? db.getInstance() : db;

    const review = await new Promise((resolve, reject) => {
      dbConn.get(`SELECT * FROM strategy_reviews WHERE id=?`, [reviewId],
        (err, row) => err ? reject(err) : resolve(row));
    });

    if (!review) return res.status(404).json({ error: '评价不存在' });
    if (review.ai_audit_status !== 'pending') {
      return res.status(400).json({ error: `评价已审核：${review.ai_audit_status}` });
    }

    // 模拟AI审核：根据用户订阅期间的实际盈亏判断评价方向是否一致
    const pnlStatus = await getSubscriptionPnlStatus(
      review.strategy_id, review.user_id, review.subscription_month
    );

    let ai_audit_status, ai_audit_result, ai_audit_reason;

    if (pnlStatus === 'unknown') {
      // 无法确定盈亏，默认通过（人工复核）
      ai_audit_status = 'approved';
      ai_audit_result = 'pass_no_data';
      ai_audit_reason = '无法核验订阅期间盈亏数据，默认通过，建议人工复核';
    } else if (
      (review.rating === 'good' && pnlStatus === 'profit') ||
      (review.rating === 'bad' && pnlStatus === 'loss')
    ) {
      // 评价方向与实际盈亏一致 → 审核通过
      ai_audit_status = 'approved';
      ai_audit_result = 'pass';
      ai_audit_reason = `订阅期间策略${pnlStatus === 'profit' ? '盈利' : '亏损'}，评价方向一致，审核通过`;
    } else {
      // 方向不一致 → 审核拒绝
      ai_audit_status = 'rejected';
      ai_audit_result = 'fail_mismatch';
      ai_audit_reason = `评价方向（${review.rating === 'good' ? '好评' : '差评'}）与订阅期间实际${pnlStatus === 'profit' ? '盈利' : '亏损'}不符，审核驳回`;
    }

    // 更新审核状态
    const isCounted = ai_audit_status === 'approved' ? 1 : 0;
    await new Promise((resolve, reject) => {
      dbConn.run(`
        UPDATE strategy_reviews SET
          ai_audit_status=?, ai_audit_result=?, ai_audit_reason=?, is_counted=?
        WHERE id=?
      `, [ai_audit_status, ai_audit_result, ai_audit_reason, isCounted, reviewId],
        (err) => err ? reject(err) : resolve()
      );
    });

    // 若审核通过且为差评，通知发布者需支付返现（写 incident_log 记录）
    if (ai_audit_status === 'approved' && review.rating === 'bad') {
      dbConn.run(`
        INSERT INTO incident_log (incident_type, affected_strategy_id, description, auto_handled)
        VALUES ('data_error', ?, ?, 0)
      `, [review.strategy_id, `差评审核通过，返现金额 ¥${review.refund_amount}，请发布者尽快支付`]);
    }

    return res.json({
      success: true,
      review_id: reviewId,
      ai_audit_status,
      ai_audit_result,
      ai_audit_reason,
      is_counted: isCounted === 1,
    });

  } catch (err) {
    console.error('[reviews] audit error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ============================================================
// POST /api/reviews/:reviewId/refund-pay — 发布者支付返现（解锁查看评价）
// ============================================================
router.post('/reviews/:reviewId/refund-pay', async (req, res) => {
  const { reviewId } = req.params;
  const userId = req.user?.id || req.headers['x-user-id'];

  try {
    const dbConn = db.getInstance ? db.getInstance() : db;

    const review = await new Promise((resolve, reject) => {
      dbConn.get(`
        SELECT r.*, s.publisher_id
        FROM strategy_reviews r
        JOIN strategies s ON r.strategy_id = s.id
        WHERE r.id=?
      `, [reviewId], (err, row) => err ? reject(err) : resolve(row));
    });

    if (!review) return res.status(404).json({ error: '评价不存在' });
    if (review.publisher_id !== userId) return res.status(403).json({ error: '无权操作' });
    if (review.ai_audit_status !== 'approved') {
      return res.status(400).json({ error: '评价尚未审核通过' });
    }
    if (review.rating !== 'bad') {
      return res.status(400).json({ error: '仅差评需要支付返现' });
    }
    if (review.refund_paid) {
      return res.status(400).json({ error: '已支付过返现' });
    }

    // 计算是否超期（审核通过后3天内支付）
    const auditedDaysAgo = Math.floor(
      (Date.now() - new Date(review.updated_at || review.created_at).getTime()) / 86400000
    );
    const daysOverdue = Math.max(0, auditedDaysAgo - 3);
    const fine = daysOverdue > 0 ? calcOverdueFine(review.refund_amount, daysOverdue) : 0;
    const totalPayment = review.refund_amount + fine;

    // 标记已支付（实际支付逻辑接支付宝/微信，此处模拟）
    await new Promise((resolve, reject) => {
      dbConn.run(`
        UPDATE strategy_reviews SET
          refund_paid=1, refund_paid_at=CURRENT_TIMESTAMP
        WHERE id=?
      `, [reviewId], (err) => err ? reject(err) : resolve());
    });

    return res.json({
      success: true,
      review_id: reviewId,
      refund_amount: review.refund_amount,
      overdue_fine: fine,
      total_payment: totalPayment,
      days_overdue: daysOverdue,
      message: fine > 0 ? `已逾期 ${daysOverdue} 天，需额外支付罚金 ¥${fine.toFixed(2)}` : '支付成功',
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ============================================================
// GET /api/reviews/:reviewId — 发布者查看评价详情（需先支付返现）
// ============================================================
router.get('/reviews/:reviewId', async (req, res) => {
  const { reviewId } = req.params;
  const userId = req.user?.id || req.headers['x-user-id'];

  try {
    const dbConn = db.getInstance ? db.getInstance() : db;

    const review = await new Promise((resolve, reject) => {
      dbConn.get(`
        SELECT r.*, s.publisher_id
        FROM strategy_reviews r
        JOIN strategies s ON r.strategy_id = s.id
        WHERE r.id=?
      `, [reviewId], (err, row) => err ? reject(err) : resolve(row));
    });

    if (!review) return res.status(404).json({ error: '评价不存在' });

    // 发布者查看差评需先支付返现
    if (review.publisher_id === userId && review.rating === 'bad' && !review.refund_paid) {
      return res.status(402).json({
        error: '请先支付返现才能查看差评详情',
        refund_amount: review.refund_amount,
        pay_url: `/api/reviews/${reviewId}/refund-pay`,
      });
    }

    // 用户只能看自己的评价；发布者可看所有评价
    if (review.user_id !== userId && review.publisher_id !== userId) {
      return res.status(403).json({ error: '无权查看' });
    }

    return res.json({ review });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ============================================================
// GET /api/publisher/refund-pending — 待支付返现列表（发布者）
// ============================================================
router.get('/publisher/refund-pending', async (req, res) => {
  const userId = req.user?.id || req.headers['x-user-id'];

  try {
    const dbConn = db.getInstance ? db.getInstance() : db;

    const pending = await new Promise((resolve, reject) => {
      dbConn.all(`
        SELECT r.id, r.strategy_id, r.rating, r.refund_amount,
               r.ai_audit_status, r.created_at,
               julianday('now') - julianday(r.updated_at) - 3 AS days_overdue
        FROM strategy_reviews r
        JOIN strategies s ON r.strategy_id = s.id
        WHERE s.publisher_id = ?
          AND r.rating = 'bad'
          AND r.ai_audit_status = 'approved'
          AND r.refund_paid = 0
        ORDER BY r.created_at ASC
      `, [userId], (err, rows) => err ? reject(err) : resolve(rows || []));
    });

    // 计算每条的罚金
    const withFines = pending.map(r => ({
      ...r,
      days_overdue: Math.max(0, Math.floor(r.days_overdue || 0)),
      overdue_fine: r.days_overdue > 0 ? calcOverdueFine(r.refund_amount, Math.floor(r.days_overdue)) : 0,
    }));

    return res.json({ pending: withFines, total: withFines.length });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ============================================================
// GET /api/strategy/:id/rating-summary — 评分摘要
// ============================================================
router.get('/strategy/:id/rating-summary', async (req, res) => {
  const { id } = req.params;

  try {
    const dbConn = db.getInstance ? db.getInstance() : db;

    // 好评数/差评数（已审核通过的）
    const counts = await new Promise((resolve, reject) => {
      dbConn.get(`
        SELECT
          SUM(CASE WHEN rating='good' THEN 1 ELSE 0 END) AS good_count,
          SUM(CASE WHEN rating='bad' THEN 1 ELSE 0 END) AS bad_count,
          COUNT(*) AS total
        FROM strategy_reviews
        WHERE strategy_id=? AND ai_audit_status='approved' AND is_counted=1
      `, [id], (err, row) => err ? reject(err) : resolve(row));
    });

    const goodCount = counts?.good_count || 0;
    const badCount = counts?.bad_count || 0;
    const netRating = goodCount - badCount;

    // 当前定价
    const pricing = await new Promise((resolve, reject) => {
      dbConn.get(
        `SELECT price_monthly, price_annual FROM strategy_pricing WHERE strategy_id=? ORDER BY created_at DESC LIMIT 1`,
        [id],
        (err, row) => err ? reject(err) : resolve(row)
      );
    });

    return res.json({
      strategy_id: id,
      good_count: goodCount,
      bad_count: badCount,
      net_rating: netRating,
      total_reviews: counts?.total || 0,
      current_price_monthly: pricing?.price_monthly || null,
      current_price_annual: pricing?.price_annual || null,
      // 触发调价阈值提示
      next_price_up_trigger: Math.max(0, 10 - netRating),   // 再需多少好评触发涨价
      next_price_down_trigger: Math.max(0, 5 - badCount),   // 再需多少差评触发降价
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
