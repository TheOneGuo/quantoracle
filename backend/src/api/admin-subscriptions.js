/**
 * @file 平台管理后台订阅管理 API
 * @description
 * GET  /api/admin/subscriptions       查询所有订阅（多维度过滤）
 * GET  /api/admin/publisher-revenue   发布者收入查询
 * GET  /api/admin/refund-queue        退款审核队列
 * POST /api/admin/ban-user            手动封禁用户
 * POST /api/admin/unban-user          手动解封用户
 * GET  /api/admin/ban-list            黑名单列表
 */

const express = require('express');
const router = express.Router();

/**
 * 管理员鉴权中间件：验证请求头中的管理员身份
 * 生产环境应接入真实的 JWT/Session 鉴权
 */
function requireAdmin(req, res, next) {
  const db = req.app.locals.dbWrapper;
  const userId = req.headers['x-user-id'] || req.session?.userId;

  if (!userId) {
    return res.status(401).json({ error: '未授权：请先登录' });
  }

  // 查询用户角色
  db.db.get(
    `SELECT role FROM users WHERE id = ?`,
    [userId],
    (err, user) => {
      if (err || !user || user.role !== 'admin') {
        return res.status(403).json({ error: '权限不足：需要管理员权限' });
      }
      req.adminId = userId;
      next();
    }
  );
}

/**
 * GET /api/admin/subscriptions
 * 查询所有订阅（多维度过滤）
 * 支持 ?subscriber_id=&strategy_id=&sub_type=&status=&page=&pageSize=
 */
router.get('/subscriptions', requireAdmin, async (req, res) => {
  try {
    const db = req.app.locals.dbWrapper;
    const { subscriber_id, strategy_id, sub_type, page = 1, pageSize = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(pageSize);

    let where = '1=1';
    const params = [];

    if (subscriber_id) { where += ' AND s.subscriber_id = ?'; params.push(subscriber_id); }
    if (strategy_id) { where += ' AND s.strategy_id = ?'; params.push(strategy_id); }
    if (sub_type) { where += ' AND s.sub_type = ?'; params.push(sub_type); }

    const total = await new Promise((resolve, reject) => {
      db.db.get(
        `SELECT COUNT(*) as cnt FROM subscriptions s WHERE ${where}`,
        params,
        (err, row) => err ? reject(err) : resolve(row.cnt)
      );
    });

    const records = await new Promise((resolve, reject) => {
      db.db.all(
        `SELECT s.*, st.name as strategy_name, u.username as subscriber_name
         FROM subscriptions s
         LEFT JOIN strategies st ON st.id = s.strategy_id
         LEFT JOIN users u ON u.id = s.subscriber_id
         WHERE ${where}
         ORDER BY s.started_at DESC LIMIT ? OFFSET ?`,
        [...params, parseInt(pageSize), offset],
        (err, rows) => err ? reject(err) : resolve(rows || [])
      );
    });

    res.json({ success: true, data: { total, page: parseInt(page), pageSize: parseInt(pageSize), records } });
  } catch (err) {
    console.error('[admin] /subscriptions 错误:', err);
    res.status(500).json({ error: '查询订阅失败' });
  }
});

/**
 * GET /api/admin/publisher-revenue
 * 发布者收入查询
 * 支持 ?publisher_id=&month=2026-03&page=&pageSize=
 */
router.get('/publisher-revenue', requireAdmin, async (req, res) => {
  try {
    const db = req.app.locals.dbWrapper;
    const { publisher_id, month, page = 1, pageSize = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(pageSize);

    let where = '1=1';
    const params = [];

    if (publisher_id) { where += ' AND pw.publisher_id = ?'; params.push(publisher_id); }

    // 查询钱包汇总列表
    const wallets = await new Promise((resolve, reject) => {
      db.db.all(
        `SELECT pw.*, u.username
         FROM publisher_wallet pw
         LEFT JOIN users u ON u.id = pw.publisher_id
         WHERE ${where}
         ORDER BY pw.total_earned DESC LIMIT ? OFFSET ?`,
        [...params, parseInt(pageSize), offset],
        (err, rows) => err ? reject(err) : resolve(rows || [])
      );
    });

    res.json({ success: true, data: { page: parseInt(page), pageSize: parseInt(pageSize), wallets } });
  } catch (err) {
    console.error('[admin] /publisher-revenue 错误:', err);
    res.status(500).json({ error: '查询发布者收入失败' });
  }
});

/**
 * GET /api/admin/refund-queue
 * 退款审核队列（最近7日内退款记录）
 * 支持 ?user_id=&page=&pageSize=
 */
router.get('/refund-queue', requireAdmin, async (req, res) => {
  try {
    const db = req.app.locals.dbWrapper;
    const { user_id, page = 1, pageSize = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(pageSize);

    let where = '1=1';
    const params = [];

    if (user_id) { where += ' AND r.user_id = ?'; params.push(user_id); }

    const total = await new Promise((resolve, reject) => {
      db.db.get(
        `SELECT COUNT(*) as cnt FROM user_refund_records r WHERE ${where}`,
        params,
        (err, row) => err ? reject(err) : resolve(row.cnt)
      );
    });

    const records = await new Promise((resolve, reject) => {
      db.db.all(
        `SELECT r.*, u.username, s.strategy_id, s.sub_type, s.price_paid
         FROM user_refund_records r
         LEFT JOIN users u ON u.id = r.user_id
         LEFT JOIN subscriptions s ON s.id = r.subscription_id
         WHERE ${where}
         ORDER BY r.refunded_at DESC LIMIT ? OFFSET ?`,
        [...params, parseInt(pageSize), offset],
        (err, rows) => err ? reject(err) : resolve(rows || [])
      );
    });

    res.json({ success: true, data: { total, page: parseInt(page), pageSize: parseInt(pageSize), records } });
  } catch (err) {
    console.error('[admin] /refund-queue 错误:', err);
    res.status(500).json({ error: '查询退款队列失败' });
  }
});

/**
 * POST /api/admin/ban-user
 * 手动封禁用户
 * body: { userId, banType: 'temp_1month'|'permanent', banReason, banDays? }
 */
router.post('/ban-user', requireAdmin, async (req, res) => {
  try {
    const db = req.app.locals.dbWrapper;
    const { userId, banType, banReason, banDays } = req.body;

    if (!userId || !banType) {
      return res.status(400).json({ error: '缺少必要参数 userId 或 banType' });
    }

    const banUntil = banType === 'permanent'
      ? null
      : new Date(Date.now() + (banDays || 30) * 86400000).toISOString();

    await new Promise((resolve, reject) => {
      db.db.run(
        `INSERT INTO user_subscription_bans (user_id, ban_type, ban_reason, ban_until, ban_count)
         VALUES (?, ?, ?, ?, 1)
         ON CONFLICT(user_id) DO UPDATE SET
           ban_type = excluded.ban_type,
           ban_reason = excluded.ban_reason,
           ban_until = excluded.ban_until,
           ban_count = ban_count + 1,
           updated_at = CURRENT_TIMESTAMP`,
        [userId, banType, banReason || '管理员手动封禁', banUntil],
        (err) => err ? reject(err) : resolve()
      );
    });

    res.json({ success: true, message: `用户 ${userId} 已封禁`, banUntil });
  } catch (err) {
    console.error('[admin] /ban-user 错误:', err);
    res.status(500).json({ error: '封禁用户失败' });
  }
});

/**
 * POST /api/admin/unban-user
 * 手动解封用户
 * body: { userId }
 */
router.post('/unban-user', requireAdmin, async (req, res) => {
  try {
    const db = req.app.locals.dbWrapper;
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: '缺少 userId' });
    }

    await new Promise((resolve, reject) => {
      db.db.run(
        `UPDATE user_subscription_bans
         SET ban_type = 'none', ban_until = NULL,
             ban_reason = '管理员手动解封', updated_at = CURRENT_TIMESTAMP
         WHERE user_id = ?`,
        [userId],
        (err) => err ? reject(err) : resolve()
      );
    });

    res.json({ success: true, message: `用户 ${userId} 已解封` });
  } catch (err) {
    console.error('[admin] /unban-user 错误:', err);
    res.status(500).json({ error: '解封用户失败' });
  }
});

/**
 * GET /api/admin/ban-list
 * 获取黑名单列表
 * 支持 ?ban_type=&page=&pageSize=
 */
router.get('/ban-list', requireAdmin, async (req, res) => {
  try {
    const db = req.app.locals.dbWrapper;
    const { ban_type, page = 1, pageSize = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(pageSize);

    let where = `ban_type != 'none'`;
    const params = [];

    if (ban_type) { where += ' AND ban_type = ?'; params.push(ban_type); }

    const total = await new Promise((resolve, reject) => {
      db.db.get(
        `SELECT COUNT(*) as cnt FROM user_subscription_bans WHERE ${where}`,
        params,
        (err, row) => err ? reject(err) : resolve(row.cnt)
      );
    });

    const records = await new Promise((resolve, reject) => {
      db.db.all(
        `SELECT b.*, u.username
         FROM user_subscription_bans b
         LEFT JOIN users u ON u.id = b.user_id
         WHERE ${where}
         ORDER BY b.updated_at DESC LIMIT ? OFFSET ?`,
        [...params, parseInt(pageSize), offset],
        (err, rows) => err ? reject(err) : resolve(rows || [])
      );
    });

    res.json({ success: true, data: { total, page: parseInt(page), pageSize: parseInt(pageSize), records } });
  } catch (err) {
    console.error('[admin] /ban-list 错误:', err);
    res.status(500).json({ error: '获取黑名单失败' });
  }
});

module.exports = router;
