/**
 * @file 执行确认 API
 * @description 发布者对信号的执行确认、T+1顺延信号生成、未响应统计
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');

// ============================================================
// 辅助函数
// ============================================================

/**
 * 获取当月字符串 YYYY-MM
 */
function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

/**
 * 获取今日日期字符串 YYYY-MM-DD
 */
function today() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * 更新策略未响应统计，并检查是否触发警告/暂停
 * @param {string} strategyId
 * @param {string} month YYYY-MM
 * @param {boolean} isMiss 是否计入未响应次数
 */
async function updateMissStats(strategyId, month, isMiss) {
  return new Promise((resolve, reject) => {
    const dbConn = db.getInstance ? db.getInstance() : db;

    // UPSERT 统计记录
    dbConn.run(`
      INSERT INTO strategy_miss_stats (strategy_id, stat_month, total_position_signals, responded_count, no_response_count, status_impact)
      VALUES (?, ?, 1, ?, ?, 'normal')
      ON CONFLICT(strategy_id, stat_month) DO UPDATE SET
        total_position_signals = total_position_signals + 1,
        responded_count = responded_count + ?,
        no_response_count = no_response_count + ?
    `, [strategyId, month, isMiss ? 0 : 1, isMiss ? 0 : 1, isMiss ? 1 : 0], async (err) => {
      if (err) return reject(err);

      // 查询当前未响应次数，决定状态影响
      dbConn.get(`SELECT no_response_count FROM strategy_miss_stats WHERE strategy_id=? AND stat_month=?`,
        [strategyId, month], (err2, row) => {
          if (err2 || !row) return resolve(null);

          const cnt = row.no_response_count;
          let status_impact = 'normal';
          if (cnt >= 10) status_impact = 'suspended';       // 10次：暂停策略
          else if (cnt >= 7) status_impact = 'warning_orange'; // 7-9次：橙色警告
          else if (cnt >= 4) status_impact = 'warning_yellow'; // 4-6次：黄色警告

          dbConn.run(
            `UPDATE strategy_miss_stats SET status_impact=?, miss_rate=CAST(no_response_count AS REAL)/CAST(total_position_signals AS REAL)
             WHERE strategy_id=? AND stat_month=?`,
            [status_impact, strategyId, month],
            () => resolve({ no_response_count: cnt, status_impact })
          );
        });
    });
  });
}

/**
 * 生成T+1顺延信号（当减仓因T+1无法完全执行时，次日补充推送）
 * @param {Object} originalSignal 原信号
 * @param {number} t1Qty T+1锁定数量
 */
async function createT1FollowupSignal(originalSignal, t1Qty) {
  return new Promise((resolve, reject) => {
    const dbConn = db.getInstance ? db.getInstance() : db;
    const newId = uuidv4();
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    // 顺延信号在次日09:25推送窗口由定时任务处理
    dbConn.run(`
      INSERT INTO strategy_signals
        (id, strategy_id, signal_type, stock_code, stock_name, suggested_quantity,
         is_t1_followup, parent_signal_id, scheduled_date, push_status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, 'pending', CURRENT_TIMESTAMP)
    `, [
      newId,
      originalSignal.strategy_id,
      originalSignal.signal_type,
      originalSignal.stock_code,
      originalSignal.stock_name,
      t1Qty,
      originalSignal.id,
      tomorrow,
    ], (err) => {
      if (err) reject(err);
      else resolve(newId);
    });
  });
}

// ============================================================
// POST /api/signals/:signalId/confirm
// 发布者确认执行状态（在30分钟窗口内）
// ============================================================
router.post('/signals/:signalId/confirm', async (req, res) => {
  const { signalId } = req.params;
  const { action, actual_price, actual_quantity, reason_code, reason_text } = req.body;
  const userId = req.user?.id || req.headers['x-user-id'];

  if (!['executed', 'not_executed'].includes(action)) {
    return res.status(400).json({ error: 'action 必须为 executed 或 not_executed' });
  }

  try {
    const dbConn = db.getInstance ? db.getInstance() : db;

    // 1. 查询信号，验证归属和有效性
    const signal = await new Promise((resolve, reject) => {
      dbConn.get(`
        SELECT ss.*, s.publisher_id
        FROM strategy_signals ss
        JOIN strategies s ON ss.strategy_id = s.id
        WHERE ss.id = ?
      `, [signalId], (err, row) => err ? reject(err) : resolve(row));
    });

    if (!signal) return res.status(404).json({ error: '信号不存在' });
    if (signal.publisher_id !== userId) return res.status(403).json({ error: '无权操作此信号' });
    if (signal.push_status === 'no_response') {
      return res.status(400).json({ error: '信号已超时，无法确认' });
    }

    // 2. 验证30分钟响应窗口
    const now = new Date();
    const expiresAt = new Date(signal.expires_at);
    if (now > expiresAt) {
      return res.status(400).json({ error: '已超过30分钟响应窗口', expires_at: signal.expires_at });
    }

    // 3. 判断是否计入未响应次数
    // reason_code 核验逻辑：
    //   limit_up/limit_down/t1_lock → 系统自动核验（此处模拟查行情）
    //   position_limit → 系统核验持仓上限
    //   tech_issue → 不核验，计次（-15分，不触发10次机制）
    //   other → 直接计次
    let isMiss = false;         // 是否计入未响应
    let isTechIssue = false;    // 是否是技术问题（特殊计次）
    let skipCount = false;      // 系统核验属实则不计次

    if (action === 'not_executed') {
      if (['limit_up', 'limit_down', 't1_lock'].includes(reason_code)) {
        // TODO: 对接行情API核验涨跌停/T+1锁定状态
        // 模拟：暂时认为属实（免计次）
        skipCount = true;
        isMiss = false;
      } else if (reason_code === 'position_limit') {
        // TODO: 核验持仓上限（查 holdings 表）
        skipCount = true;
        isMiss = false;
      } else if (reason_code === 'tech_issue') {
        // 记录但计次（评分-15，不触发10次暂停机制）
        isMiss = false;
        isTechIssue = true;
      } else {
        // other 或 undefined → 直接计次
        isMiss = true;
      }
    }

    // 4. 写入执行记录
    const execId = uuidv4();
    await new Promise((resolve, reject) => {
      dbConn.run(`
        INSERT INTO signal_executions
          (id, signal_id, strategy_id, action, actual_price, actual_quantity,
           reason_code, reason_text, is_miss, is_tech_issue, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, [execId, signalId, signal.strategy_id, action,
          actual_price || null, actual_quantity || null,
          reason_code || null, reason_text || null,
          isMiss ? 1 : 0, isTechIssue ? 1 : 0],
        (err) => err ? reject(err) : resolve()
      );
    });

    // 更新信号状态
    await new Promise((resolve, reject) => {
      dbConn.run(
        `UPDATE strategy_signals SET push_status=? WHERE id=?`,
        [action === 'executed' ? 'executed' : 'not_executed', signalId],
        (err) => err ? reject(err) : resolve()
      );
    });

    // 5. 更新未响应统计
    const month = currentMonth();
    const statsResult = await updateMissStats(signal.strategy_id, month, isMiss || isTechIssue);

    // 6. 若信号有T+1锁定部分，生成次日顺延信号
    let t1FollowupId = null;
    const t1Qty = signal.t1_locked_qty || 0;
    if (action === 'not_executed' && reason_code === 't1_lock' && t1Qty > 0) {
      t1FollowupId = await createT1FollowupSignal(signal, t1Qty);
    } else if (action === 'executed' && t1Qty > 0 && actual_quantity < signal.suggested_quantity) {
      // 部分执行，剩余T+1部分顺延
      const remainQty = signal.suggested_quantity - actual_quantity;
      t1FollowupId = await createT1FollowupSignal(signal, remainQty);
    }

    // 7. 检查是否触发暂停
    const suspended = statsResult?.status_impact === 'suspended';
    if (suspended) {
      // 记录暂停事件
      dbConn.run(`
        INSERT INTO incident_log (incident_type, affected_strategy_id, description, auto_handled)
        VALUES ('suspend', ?, '策略当月未响应次数达10次，系统自动暂停', 1)
      `, [signal.strategy_id]);
      // 更新策略状态
      dbConn.run(`UPDATE strategies SET status='suspended' WHERE id=?`, [signal.strategy_id]);
    }

    return res.json({
      success: true,
      execution_id: execId,
      is_counted: isMiss || isTechIssue,     // 是否计入统计
      skip_suspend_trigger: isTechIssue,      // tech_issue 不触发10次机制
      t1_followup_signal_id: t1FollowupId,   // 顺延信号ID（若生成）
      miss_stats: statsResult,
      warning: suspended ? '策略已因未响应次数过多被暂停' :
                statsResult?.status_impact !== 'normal' ? `警告：当月未响应次数 ${statsResult.no_response_count} 次` : null,
    });

  } catch (err) {
    console.error('[signal-confirm] confirm error:', err);
    return res.status(500).json({ error: '服务器内部错误', detail: err.message });
  }
});

// ============================================================
// POST /api/signals/batch-timeout-check
// 批量检查超时信号，每5分钟由定时任务调用
// ============================================================
router.post('/signals/batch-timeout-check', async (req, res) => {
  try {
    const dbConn = db.getInstance ? db.getInstance() : db;

    // 查找所有超时且未响应的信号（expires_at < NOW 且 push_status='sent'）
    const expiredSignals = await new Promise((resolve, reject) => {
      dbConn.all(`
        SELECT ss.*, s.publisher_id
        FROM strategy_signals ss
        JOIN strategies s ON ss.strategy_id = s.id
        WHERE ss.expires_at < datetime('now')
          AND ss.push_status = 'sent'
      `, [], (err, rows) => err ? reject(err) : resolve(rows || []));
    });

    let processedCount = 0;
    for (const signal of expiredSignals) {
      // 标记为 no_response
      await new Promise((resolve) => {
        dbConn.run(
          `UPDATE strategy_signals SET push_status='no_response' WHERE id=?`,
          [signal.id], resolve
        );
      });

      // 更新未响应统计
      await updateMissStats(signal.strategy_id, currentMonth(), true);
      processedCount++;
    }

    return res.json({ success: true, processed: processedCount });

  } catch (err) {
    console.error('[signal-confirm] batch-timeout-check error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ============================================================
// GET /api/strategy/:id/miss-count
// 获取策略当月累计未响应次数
// ============================================================
router.get('/strategy/:id/miss-count', async (req, res) => {
  const { id } = req.params;
  const month = req.query.month || currentMonth();

  try {
    const dbConn = db.getInstance ? db.getInstance() : db;
    const row = await new Promise((resolve, reject) => {
      dbConn.get(
        `SELECT * FROM strategy_miss_stats WHERE strategy_id=? AND stat_month=?`,
        [id, month],
        (err, r) => err ? reject(err) : resolve(r)
      );
    });

    return res.json({
      strategy_id: id,
      month,
      no_response_count: row?.no_response_count || 0,
      total_position_signals: row?.total_position_signals || 0,
      miss_rate: row?.miss_rate || 0,
      status_impact: row?.status_impact || 'normal',
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ============================================================
// GET /api/signals/today
// 获取当日所有信号（当前发布者）
// ============================================================
router.get('/signals/today', async (req, res) => {
  const userId = req.user?.id || req.headers['x-user-id'];
  const date = today();

  try {
    const dbConn = db.getInstance ? db.getInstance() : db;
    const signals = await new Promise((resolve, reject) => {
      dbConn.all(`
        SELECT ss.*
        FROM strategy_signals ss
        JOIN strategies s ON ss.strategy_id = s.id
        WHERE s.publisher_id = ?
          AND date(ss.created_at) = ?
        ORDER BY ss.created_at DESC
      `, [userId, date], (err, rows) => err ? reject(err) : resolve(rows || []));
    });

    return res.json({ date, signals });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ============================================================
// POST /api/signals/:signalId/t1-followup
// 手动生成T+1顺延信号
// ============================================================
router.post('/signals/:signalId/t1-followup', async (req, res) => {
  const { signalId } = req.params;
  const { t1_quantity } = req.body;
  const userId = req.user?.id || req.headers['x-user-id'];

  try {
    const dbConn = db.getInstance ? db.getInstance() : db;
    const signal = await new Promise((resolve, reject) => {
      dbConn.get(`
        SELECT ss.*, s.publisher_id
        FROM strategy_signals ss
        JOIN strategies s ON ss.strategy_id = s.id
        WHERE ss.id = ?
      `, [signalId], (err, row) => err ? reject(err) : resolve(row));
    });

    if (!signal) return res.status(404).json({ error: '信号不存在' });
    if (signal.publisher_id !== userId) return res.status(403).json({ error: '无权操作' });

    const qty = t1_quantity || signal.t1_locked_qty;
    if (!qty || qty <= 0) return res.status(400).json({ error: 'T+1数量无效' });

    const newId = await createT1FollowupSignal(signal, qty);
    return res.json({ success: true, followup_signal_id: newId });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
