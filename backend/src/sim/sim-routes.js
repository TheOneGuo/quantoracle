/**
 * @file 模拟盘验证系统 API 路由
 * @description 提供模拟盘全生命周期管理接口，包括启动、交易、查询、报告等
 *              所有交易操作须经过信号合规验证，违规操作被拒绝并留审计记录
 */

const express = require('express');
const router = express.Router();
const engine = require('../services/sim-trading-engine');
const grader = require('../services/sim-grader');
const db = require('../db');

/**
 * POST /api/sim/start
 * 启动模拟盘测试（须选择合规资金档位）
 * Body: { strategyId, initialCapital }
 * 资金档位：100000（10万）/ 500000（50万）/ 2000000（200万）
 */
router.post('/start', async (req, res) => {
  try {
    const userId = req.user?.id || req.body.userId || 'anonymous';
    const { strategyId, initialCapital } = req.body;

    if (!strategyId) {
      return res.status(400).json({ success: false, message: '缺少策略ID（strategyId）' });
    }
    if (!initialCapital) {
      return res.status(400).json({ success: false, message: '缺少初始资金（initialCapital），须为 100000/500000/2000000' });
    }

    const session = await engine.createSession(strategyId, userId, Number(initialCapital));
    res.json({ success: true, data: session, message: '模拟盘已启动，30个交易日后自动评测' });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/sim/user/active
 * 获取当前用户所有活跃中的模拟盘（须在 /:sessionId 之前注册，避免路由冲突）
 */
router.get('/user/active', async (req, res) => {
  try {
    const userId = req.user?.id || req.query.userId || 'anonymous';
    const sessions = await db.all(
      `SELECT s.*, st.name as strategy_name
       FROM sim_trading_sessions s
       LEFT JOIN strategies st ON s.strategy_id = st.id
       WHERE s.user_id = ? AND s.status = 'running'
       ORDER BY s.created_at DESC`,
      [userId]
    );
    res.json({ success: true, data: sessions });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/sim/:sessionId
 * 获取模拟盘会话详情（总资产/收益率/状态/Day X/30）
 */
router.get('/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = await db.get(`SELECT * FROM sim_trading_sessions WHERE id = ?`, [sessionId]);
    if (!session) return res.status(404).json({ success: false, message: '会话不存在' });

    // 计算已运行交易日数
    const snapshotCount = await db.get(
      `SELECT COUNT(*) as cnt FROM sim_daily_snapshots WHERE session_id = ?`,
      [sessionId]
    );
    const tradingDays = snapshotCount?.cnt || 0;
    const returnPct = session.initial_capital > 0
      ? +((session.total_assets - session.initial_capital) / session.initial_capital).toFixed(4)
      : 0;

    res.json({
      success: true,
      data: {
        ...session,
        tradingDays,
        totalTradingDaysTarget: 30,
        returnPct,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/sim/:sessionId/trade
 * 执行模拟交易（经过信号合规验证）
 * Body: { stockCode, stockName?, action, quantity, price }
 * action: buy/sell/add/reduce
 */
router.post('/:sessionId/trade', async (req, res) => {
  try {
    const userId = req.user?.id || req.body.userId || 'anonymous';
    const { sessionId } = req.params;
    const { stockCode, stockName, action, quantity, price } = req.body;

    // 参数校验
    if (!stockCode || !action || !quantity || !price) {
      return res.status(400).json({ success: false, message: '缺少必要参数：stockCode/action/quantity/price' });
    }
    if (!['buy', 'sell', 'add', 'reduce'].includes(action)) {
      return res.status(400).json({ success: false, message: 'action 须为 buy/sell/add/reduce' });
    }
    if (quantity % 100 !== 0) {
      return res.status(400).json({ success: false, message: '数量须为100股（1手）的整数倍' });
    }

    const result = await engine.executeTrade(sessionId, userId, {
      stockCode, stockName, action,
      quantity: Number(quantity),
      price: Number(price),
    });

    const statusCode = result.success ? 200 : (result.violationFlag ? 403 : 400);
    res.status(statusCode).json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/sim/:sessionId/abort
 * 主动中止模拟盘（策略发布者放弃本次测试）
 */
router.post('/:sessionId/abort', async (req, res) => {
  try {
    const userId = req.user?.id || req.body.userId || 'anonymous';
    const { sessionId } = req.params;

    const session = await db.get(`SELECT * FROM sim_trading_sessions WHERE id = ?`, [sessionId]);
    if (!session) return res.status(404).json({ success: false, message: '会话不存在' });
    if (session.user_id !== userId) return res.status(403).json({ success: false, message: '无权限' });
    if (session.status !== 'running') {
      return res.status(400).json({ success: false, message: `会话状态为 ${session.status}，无法中止` });
    }

    const today = new Date().toISOString().split('T')[0];
    await db.run(
      `UPDATE sim_trading_sessions SET status = 'aborted', end_date = ? WHERE id = ?`,
      [today, sessionId]
    );
    res.json({ success: true, message: '模拟盘已中止，可重新发起测试' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/sim/:sessionId/signals
 * 获取信号列表（默认返回今日信号，可通过 ?date=YYYY-MM-DD 查询历史）
 */
router.get('/:sessionId/signals', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const date = req.query.date || new Date().toISOString().split('T')[0];

    const signals = await db.all(
      `SELECT * FROM sim_signals
       WHERE session_id = ? AND DATE(signal_time) = ?
       ORDER BY signal_time DESC`,
      [sessionId, date]
    );
    res.json({ success: true, data: signals, date });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/sim/:sessionId/trades
 * 获取完整交易记录（审计链路），支持分页
 * Query: page=1&pageSize=20&violationOnly=false
 */
router.get('/:sessionId/trades', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Number(req.query.pageSize) || 20);
    const offset = (page - 1) * pageSize;
    const violationOnly = req.query.violationOnly === 'true';

    const whereExtra = violationOnly ? 'AND violation_flag = 1' : '';
    const trades = await db.all(
      `SELECT * FROM sim_trades WHERE session_id = ? ${whereExtra}
       ORDER BY trade_time DESC LIMIT ? OFFSET ?`,
      [sessionId, pageSize, offset]
    );
    const total = await db.get(
      `SELECT COUNT(*) as cnt FROM sim_trades WHERE session_id = ? ${whereExtra}`,
      [sessionId]
    );
    res.json({ success: true, data: trades, pagination: { page, pageSize, total: total?.cnt || 0 } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/sim/:sessionId/snapshots
 * 获取每日快照数据（用于收益曲线图表）
 */
router.get('/:sessionId/snapshots', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const snapshots = await db.all(
      `SELECT snapshot_date, total_assets, daily_pnl, daily_return_pct,
              cumulative_return_pct, max_drawdown_pct, benchmark_return_pct
       FROM sim_daily_snapshots WHERE session_id = ? ORDER BY snapshot_date ASC`,
      [sessionId]
    );
    res.json({ success: true, data: snapshots });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/sim/:sessionId/report
 * 获取30天评测报告（含综合评分、等级、智能定价建议）
 * 仅在会话 status = 'completed' 时返回完整报告
 */
router.get('/:sessionId/report', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = await db.get(`SELECT * FROM sim_trading_sessions WHERE id = ?`, [sessionId]);
    if (!session) return res.status(404).json({ success: false, message: '会话不存在' });

    if (session.status !== 'completed') {
      // 非完成状态返回实时预估数据
      const snapshots = await db.all(
        `SELECT * FROM sim_daily_snapshots WHERE session_id = ? ORDER BY snapshot_date ASC`,
        [sessionId]
      );
      const tradingDays = snapshots.length;
      return res.json({
        success: true,
        partial: true,
        message: `模拟盘进行中（第 ${tradingDays}/30 交易日），报告将在30天后生成`,
        data: { tradingDays, status: session.status },
      });
    }

    // 生成完整评测报告
    const report = await grader.gradeSimSession(sessionId);
    res.json({ success: true, data: report });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
