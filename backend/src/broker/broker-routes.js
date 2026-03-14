/**
 * @file broker-routes.js
 * @description 实盘对接 API 路由
 * 提供持仓、委托、下单接口，默认使用 MockBrokerAdapter（纸交易）。
 * 下单成功后向 live_tracking 表写入记录，并通过 WebSocket 广播信号。
 *
 * @module broker/broker-routes
 */

const express = require('express');
const router = express.Router();
const MockBrokerAdapter = require('./mock-adapter');

// 单例 broker 实例（进程生命周期内复用）
const broker = new MockBrokerAdapter({
  initialCapital: 500_000,
  commissionRate: 0.0003,
  stampTaxRate: 0.001,
  slippage: 0.002,
});

// 启动时自动连接
broker.connect().catch(err => console.error('[BrokerRoutes] 连接失败:', err));

/**
 * GET /api/broker/account
 * 获取账户资金信息
 */
router.get('/account', async (req, res) => {
  try {
    const info = await broker.getAccountInfo();
    res.json({ success: true, data: info, broker: broker.getName() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/broker/positions
 * 获取当前持仓列表
 */
router.get('/positions', async (req, res) => {
  try {
    const positions = await broker.getPositions();
    res.json({ success: true, data: positions, broker: broker.getName() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/broker/orders
 * 获取委托列表
 * @query {string} [status=all] - all | pending | filled | cancelled
 * @query {number} [limit=50]
 */
router.get('/orders', async (req, res) => {
  try {
    const { status = 'all', limit = 50 } = req.query;
    const orders = await broker.getOrders({ status, limit: parseInt(limit, 10) });
    res.json({ success: true, data: orders, total: orders.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/broker/trade
 * 下单
 * @body {string} code     - 股票代码（如 sh600519）
 * @body {string} action   - buy | sell
 * @body {number} quantity - 数量（必须为 100 的整数倍）
 * @body {number} [price]  - 委托价；不传或传 0 表示市价
 */
router.post('/trade', async (req, res) => {
  try {
    const { code, action, quantity, price = 0 } = req.body;

    if (!code || !action || !quantity) {
      return res.status(400).json({
        success: false,
        error: '缺少必填参数：code, action, quantity',
      });
    }

    const order = await broker.placeOrder(
      String(code),
      String(action),
      parseInt(quantity, 10),
      parseFloat(price) || 0,
    );

    const ok = order.status === 'filled' || order.status === 'pending';

    // P2: 广播 WebSocket 信号
    if (ok && req.app && req.app.broadcast) {
      req.app.broadcast({
        type: 'trade_signal',
        action,
        code: String(code),
        quantity: parseInt(quantity, 10),
        price: order.filledPrice || parseFloat(price) || 0,
        orderId: order.orderId,
        message: `${action === 'buy' ? '买入' : '卖出'} ${code} x${parseInt(quantity, 10)} @${(order.filledPrice || 0).toFixed(3)}`,
        timestamp: new Date().toISOString(),
      });
    }

    // P2: 写入 live_tracking 表（纸交易时 subscription_id 填 NULL）
    if (ok && req.app && req.app.locals && req.app.locals.db) {
      const db = req.app.locals.db;
      db.run(
        `INSERT INTO live_tracking
           (subscription_id, strategy_id, signal_id, action, code, code_name, price, quantity, pnl, pnl_percent)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [null, 'paper', order.orderId, action, String(code), String(code),
          order.filledPrice || 0, parseInt(quantity, 10), 0, 0],
        (err) => { if (err) console.warn('[BrokerRoutes] live_tracking 写入失败:', err.message); }
      );
    }

    res.status(ok ? 200 : 422).json({
      success: ok,
      data: order,
      message: ok ? '委托成功' : (order.failReason || '委托失败'),
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /api/broker/orders/:orderId
 * 撤销委托
 */
router.delete('/orders/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    const success = await broker.cancelOrder(orderId);
    res.json({
      success,
      message: success ? '撤单成功' : '撤单失败（订单不存在或已成交）',
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/broker/status
 * 获取券商连接状态
 */
router.get('/status', (req, res) => {
  res.json({
    success: true,
    connected: broker.connected,
    broker: broker.getName(),
    mode: 'paper_trading',
  });
});

module.exports = router;
module.exports.broker = broker; // 导出 broker 实例供 WebSocket 使用
