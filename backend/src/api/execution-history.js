/**
 * @file 订阅者端执行记录展示 API
 * @description 提供策略执行记录、未响应摘要、风险仪表盘、发布者信用评级等接口。
 *              所有接口均为公开数据，订阅者可直接查看。
 */

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { calcCreditGrade } = require('../services/credit-scorer');

// ============================================================
// GET /api/marketplace/:strategyId/execution-history
// 订阅者可见的执行记录（公开数据）
// 返回：近30天信号执行情况时间线
// ============================================================
router.get('/marketplace/:strategyId/execution-history', async (req, res) => {
  try {
    const { strategyId } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 30, 100);

    // 查询近30天持仓操作信号（按时间倒序）
    const records = await db.all(`
      SELECT
        sg.id,
        sg.scheduled_date       AS date,
        sg.signal_type,         -- 信号类型：buy/sell/add/reduce/stop_loss
        sg.stock_code,          -- 标的代码
        sg.stock_name,          -- 标的名称
        sg.confirm_time         AS response_time,  -- 响应时间
        sg.confirm_status,      -- executed/skip/no_response/pending
        CASE WHEN sg.is_miss_counted = 1 THEN 1 ELSE 0 END AS is_counted_miss  -- 是否计入未响应次数
      FROM signals sg
      WHERE sg.strategy_id = ?
        AND sg.scheduled_date >= date('now', '-30 days')
        AND sg.signal_type IN ('buy','sell','add','reduce','stop_loss')
      ORDER BY sg.scheduled_date DESC, sg.created_at DESC
      LIMIT ?
    `, [strategyId, limit]);

    // 格式化响应状态标签（供前端展示）
    const timeline = records.map(r => ({
      id:           r.id,
      date:         r.date,
      signalType:   r.signal_type,
      stockCode:    r.stock_code,
      stockName:    r.stock_name,
      responseTime: r.response_time,
      status:       r.confirm_status,     // executed/skip/no_response/pending
      isCountedMiss: !!r.is_counted_miss, // 是否计入未响应次数
    }));

    res.json({ success: true, data: timeline });
  } catch (err) {
    console.error('[execution-history] execution-history error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// GET /api/marketplace/:strategyId/miss-summary
// 未响应摘要（订阅者可见）
// 返回：近3个月每月未响应次数、响应率趋势
// ============================================================
router.get('/marketplace/:strategyId/miss-summary', async (req, res) => {
  try {
    const { strategyId } = req.params;

    // 查询近3个月每月统计（来自 strategy_miss_stats 表）
    const monthly = await db.all(`
      SELECT
        stat_month,
        total_position_signals,
        no_response_count,
        ROUND((1 - miss_rate) * 100, 1) AS response_rate_pct,  -- 响应率%
        status_impact
      FROM strategy_miss_stats
      WHERE strategy_id = ?
        AND stat_month >= strftime('%Y-%m', date('now', '-3 months'))
      ORDER BY stat_month ASC
    `, [strategyId]);

    // 累计未响应次数
    const cumulative = await db.get(`
      SELECT COALESCE(SUM(no_response_count), 0) AS cum_miss
      FROM strategy_miss_stats WHERE strategy_id = ?
    `, [strategyId]);

    res.json({
      success: true,
      data: {
        monthly,
        cumulativeMiss: cumulative?.cum_miss || 0,
      },
    });
  } catch (err) {
    console.error('[execution-history] miss-summary error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// GET /api/marketplace/:strategyId/risk-dashboard
// 风险仪表盘数据（订阅者可见）
// 返回：近30天每日资金使用率折线图、最高仓位、高仓位天数占比、风险等级徽章
// ============================================================
router.get('/marketplace/:strategyId/risk-dashboard', async (req, res) => {
  try {
    const { strategyId } = req.params;

    // 近30天每日15:05资金使用率（折线图数据点）
    const dailyUsage = await db.all(`
      SELECT
        snapshot_date  AS date,
        cash_usage_rate AS usage_rate  -- 0-1浮点数
      FROM position_snapshots
      WHERE strategy_id = ?
        AND snapshot_date >= date('now', '-30 days')
      ORDER BY snapshot_date ASC
    `, [strategyId]);

    // 汇总指标
    const summary = await db.get(`
      SELECT
        ROUND(AVG(cash_usage_rate) * 100, 1) AS avg_usage_pct,    -- 月均使用率%
        ROUND(MAX(cash_usage_rate) * 100, 1) AS max_usage_pct,    -- 最高仓位%
        ROUND(
          SUM(CASE WHEN cash_usage_rate >= 0.8 THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1
        ) AS high_usage_day_pct  -- 高仓位天数占比（使用率>=80%）
      FROM position_snapshots
      WHERE strategy_id = ?
        AND snapshot_date >= date('now', '-30 days')
    `, [strategyId]);

    // 计算风险等级徽章
    // green: 均值<40%  yellow: 40-60%  orange: 60-80%  red: >80%
    const avgUsage = (summary?.avg_usage_pct || 0) / 100;
    let riskBadge = 'green';
    if (avgUsage >= 0.80)      riskBadge = 'red';
    else if (avgUsage >= 0.60) riskBadge = 'orange';
    else if (avgUsage >= 0.40) riskBadge = 'yellow';

    res.json({
      success: true,
      data: {
        dailyUsage: dailyUsage.map(d => ({
          date:      d.date,
          usageRate: Math.round(d.usage_rate * 1000) / 10, // 转换为%，1位小数
        })),
        summary: {
          avgUsagePct:     summary?.avg_usage_pct    || 0,
          maxUsagePct:     summary?.max_usage_pct    || 0,
          highUsageDayPct: summary?.high_usage_day_pct || 0,
          riskBadge,
        },
      },
    });
  } catch (err) {
    console.error('[execution-history] risk-dashboard error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// GET /api/publisher/my-credit
// 发布者查看自己的信用评级和各维度得分明细
// 需要登录鉴权（通过 req.user）
// ============================================================
router.get('/publisher/my-credit', async (req, res) => {
  try {
    // 从请求上下文获取当前登录用户（兼容多种鉴权中间件）
    const publisherId = req.user?.id || req.user?.publisher_id || req.headers['x-publisher-id'];
    if (!publisherId) {
      return res.status(401).json({ success: false, error: '请先登录' });
    }

    // 调用信用评级计算服务
    const creditResult = await calcCreditGrade(publisherId);

    res.json({ success: true, data: creditResult });
  } catch (err) {
    console.error('[execution-history] my-credit error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
