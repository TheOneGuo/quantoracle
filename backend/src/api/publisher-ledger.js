/**
 * @file 发布者对账 API
 * @description
 * GET  /api/publisher/wallet        发布者钱包汇总
 * GET  /api/publisher/ledger        账本流水（支持?month=2026-03）
 * POST /api/publisher/withdraw      申请提现（body: { amount }）
 * GET  /api/publisher/withdrawals   提现历史
 */

const express = require('express');
const router = express.Router();
const publisherLedger = require('../services/publisher-ledger');

/**
 * 认证中间件：要求用户已登录（从 req.user 获取发布者ID）
 */
function requireAuth(req, res, next) {
  if (!req.user || !req.user.id) {
    return res.status(401).json({ error: '请先登录' });
  }
  next();
}

/**
 * GET /api/publisher/wallet
 * 获取当前发布者的钱包汇总
 */
router.get('/wallet', requireAuth, async (req, res) => {
  try {
    const db = req.app.locals.dbWrapper;
    const publisherId = req.user.id;
    const wallet = await publisherLedger.getWalletSummary(db, publisherId);
    res.json({ success: true, data: wallet });
  } catch (err) {
    console.error('[publisher-ledger API] /wallet 错误:', err);
    res.status(500).json({ error: '获取钱包信息失败' });
  }
});

/**
 * GET /api/publisher/ledger
 * 获取账本流水（支持?month=2026-03&page=1&pageSize=20）
 */
router.get('/ledger', requireAuth, async (req, res) => {
  try {
    const db = req.app.locals.dbWrapper;
    const publisherId = req.user.id;
    const page = parseInt(req.query.page) || 1;
    const pageSize = Math.min(parseInt(req.query.pageSize) || 20, 100);
    const month = req.query.month || null; // 格式：2026-03

    const result = await publisherLedger.getLedgerEntries(db, publisherId, page, pageSize, month);
    res.json({ success: true, data: result });
  } catch (err) {
    console.error('[publisher-ledger API] /ledger 错误:', err);
    res.status(500).json({ error: '获取账本流水失败' });
  }
});

/**
 * POST /api/publisher/withdraw
 * 申请提现
 * body: { amount: number }
 */
router.post('/withdraw', requireAuth, async (req, res) => {
  try {
    const db = req.app.locals.dbWrapper;
    const publisherId = req.user.id;
    const amount = parseFloat(req.body.amount);

    if (isNaN(amount) || amount <= 0) {
      return res.status(400).json({ error: '提现金额无效' });
    }

    const result = await publisherLedger.applyWithdrawal(db, publisherId, amount);
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json({ success: true, data: result });
  } catch (err) {
    console.error('[publisher-ledger API] /withdraw 错误:', err);
    res.status(500).json({ error: '提现申请失败' });
  }
});

/**
 * GET /api/publisher/withdrawals
 * 获取提现历史（支持?page=1&pageSize=20）
 */
router.get('/withdrawals', requireAuth, async (req, res) => {
  try {
    const db = req.app.locals.dbWrapper;
    const publisherId = req.user.id;
    const page = parseInt(req.query.page) || 1;
    const pageSize = Math.min(parseInt(req.query.pageSize) || 20, 100);
    const offset = (page - 1) * pageSize;

    const total = await new Promise((resolve, reject) => {
      db.db.get(
        `SELECT COUNT(*) as cnt FROM publisher_withdrawals WHERE publisher_id = ?`,
        [publisherId],
        (err, row) => err ? reject(err) : resolve(row.cnt)
      );
    });

    const records = await new Promise((resolve, reject) => {
      db.db.all(
        `SELECT * FROM publisher_withdrawals WHERE publisher_id = ?
         ORDER BY applied_at DESC LIMIT ? OFFSET ?`,
        [publisherId, pageSize, offset],
        (err, rows) => err ? reject(err) : resolve(rows || [])
      );
    });

    res.json({ success: true, data: { total, page, pageSize, records } });
  } catch (err) {
    console.error('[publisher-ledger API] /withdrawals 错误:', err);
    res.status(500).json({ error: '获取提现历史失败' });
  }
});

module.exports = router;
