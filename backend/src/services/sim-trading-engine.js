/**
 * @file 模拟盘交易引擎
 * @description 严格按策略信号执行模拟交易，所有操作保留完整审计链路
 *              核心原则：无信号不可交易，违规操作被拒绝并计入违规记录
 */

const { v4: uuidv4 } = require('uuid');
const db = require('../db');

// 交易成本配置（模拟真实A股券商费率）
const TRADE_COST = {
  commissionRate: 0.00025,  // 佣金：万分之2.5
  stampDutyRate:  0.001,    // 印花税：千分之1（仅卖出）
  slippageRange:  0.001,    // 滑点：±0.1%
  minCommission:  5,        // 最低佣金5元
  lotSize:        100,      // 最小交易单位：100股（1手）
};

// 违规次数阈值：连续3次违规触发强制中止
const MAX_VIOLATION_COUNT = 3;

// 合规资金档位（元）
const CAPITAL_OPTIONS = [100000, 500000, 2000000];

class SimTradingEngine {
  /**
   * 创建新的模拟盘测试会话
   * @param {string} strategyId 策略ID
   * @param {string} userId 用户ID
   * @param {number} initialCapital 初始资金（须为合规档位：10万/50万/200万）
   * @returns {Promise<Object>} 新建会话信息
   */
  async createSession(strategyId, userId, initialCapital) {
    // 验证资金档位合规
    if (!CAPITAL_OPTIONS.includes(initialCapital)) {
      throw new Error(`初始资金须为合规档位：${CAPITAL_OPTIONS.join('/')} 元`);
    }

    // 检查是否已有该策略的运行中会话
    const existing = await db.get(
      `SELECT id FROM sim_trading_sessions WHERE strategy_id = ? AND user_id = ? AND status = 'running'`,
      [strategyId, userId]
    );
    if (existing) {
      throw new Error(`策略 ${strategyId} 已有运行中的模拟盘（session: ${existing.id}），请先中止后再启动`);
    }

    const sessionId = uuidv4();
    const startDate = new Date().toISOString().split('T')[0];

    await db.run(
      `INSERT INTO sim_trading_sessions
        (id, strategy_id, user_id, initial_capital, current_cash, total_assets, start_date, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'running')`,
      [sessionId, strategyId, userId, initialCapital, initialCapital, initialCapital, startDate]
    );

    return {
      sessionId,
      strategyId,
      userId,
      initialCapital,
      startDate,
      status: 'running',
    };
  }

  /**
   * 写入策略信号（每日09:25由策略引擎调用）
   * 信号有效期至当日15:00收盘，过期自动失效
   * @param {string} sessionId 会话ID
   * @param {Array<Object>} signals 信号列表
   * @returns {Promise<number>} 成功写入的信号数量
   */
  async writeSignals(sessionId, signals) {
    if (!Array.isArray(signals) || signals.length === 0) return 0;

    // 验证会话存在且运行中
    const session = await this._getRunningSession(sessionId);
    if (!session) throw new Error(`会话 ${sessionId} 不存在或已结束`);

    // 计算当日信号有效期（当日15:00）
    const today = new Date().toISOString().split('T')[0];
    const expiresAt = `${today} 15:00:00`;

    let count = 0;
    for (const sig of signals) {
      const signalId = uuidv4();
      await db.run(
        `INSERT OR IGNORE INTO sim_signals
          (id, session_id, stock_code, stock_name, signal_type, signal_time, signal_price,
           target_position_pct, trigger_reason, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          signalId,
          sessionId,
          sig.stockCode,
          sig.stockName || null,
          sig.signalType,
          sig.signalTime || new Date().toISOString(),
          sig.signalPrice || null,
          sig.targetPositionPct || null,
          sig.triggerReason ? JSON.stringify(sig.triggerReason) : null,
          expiresAt,
        ]
      );
      count++;
    }
    return count;
  }

  /**
   * 执行模拟交易（核心方法：严格验证信号合规性）
   * 无对应有效信号时，拒绝操作并记录违规；
   * 累计违规达3次时，强制标记 violation_stopped 并中止会话。
   *
   * @param {string} sessionId 会话ID
   * @param {string} userId 操作用户ID（须与会话owner匹配）
   * @param {Object} tradeRequest 交易请求 { stockCode, action, quantity, price }
   * @returns {Promise<Object>} { success, tradeId?, violationFlag, message }
   */
  async executeTrade(sessionId, userId, tradeRequest) {
    const { stockCode, action, quantity, price } = tradeRequest;

    // ── 步骤1：获取会话，验证用户权限 ──────────────────────────────
    const session = await this._getRunningSession(sessionId);
    if (!session) {
      return { success: false, message: `会话 ${sessionId} 不存在或已结束` };
    }
    if (session.user_id !== userId) {
      return { success: false, message: '无权限操作此模拟盘' };
    }

    // ── 步骤2：查询是否有对应的有效未执行信号 ──────────────────────
    const now = new Date().toISOString();
    const signal = await db.get(
      `SELECT * FROM sim_signals
       WHERE session_id = ? AND stock_code = ? AND signal_type LIKE ?
         AND is_executed = 0 AND expires_at > ?
       ORDER BY signal_time DESC LIMIT 1`,
      [sessionId, stockCode, `%${this._mapActionToSignalType(action)}%`, now]
    );

    // ── 步骤3：无信号 → 记录违规，拒绝执行 ──────────────────────────
    if (!signal) {
      const violationCount = session.violation_count + 1;
      const rejectReason = `无有效策略信号：stockCode=${stockCode}, action=${action}`;

      // 记录违规交易（violation_flag=1，未实际成交）
      await db.run(
        `INSERT INTO sim_trades
          (id, session_id, signal_id, stock_code, stock_name, action, quantity, price,
           amount, net_amount, violation_flag, reject_reason, trade_time)
         VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        [
          uuidv4(), sessionId, stockCode, tradeRequest.stockName || null,
          action, quantity, price,
          +(quantity * price).toFixed(2),
          +(quantity * price).toFixed(2),
          rejectReason, now,
        ]
      );

      // 更新违规计数
      let newStatus = session.status;
      if (violationCount >= MAX_VIOLATION_COUNT) {
        // 步骤3b：连续3次违规 → 强制中止
        newStatus = 'violation_stopped';
        await db.run(
          `UPDATE sim_trading_sessions SET violation_count = ?, status = ?, end_date = ? WHERE id = ?`,
          [violationCount, newStatus, now.split('T')[0], sessionId]
        );
        return {
          success: false,
          violationFlag: true,
          violationCount,
          status: newStatus,
          message: `⛔ 累计违规 ${violationCount} 次，模拟盘已被强制中止！必须按策略信号操作。`,
        };
      } else {
        await db.run(
          `UPDATE sim_trading_sessions SET violation_count = ? WHERE id = ?`,
          [violationCount, sessionId]
        );
        return {
          success: false,
          violationFlag: true,
          violationCount,
          message: `⚠️ 操作被拒绝：${rejectReason}。当前违规次数：${violationCount}/${MAX_VIOLATION_COUNT}`,
        };
      }
    }

    // ── 步骤4：有信号 → 计算交易费用 ──────────────────────────────
    const amount = +(quantity * price).toFixed(2);
    const { commission, stampDuty, slippage } = this._calcTradeCost(action, quantity, price);
    // 买入时净金额为正（支出），卖出时净金额为负（收入）
    const netAmount = action === 'buy' || action === 'add'
      ? +(amount + commission + stampDuty + slippage).toFixed(2)
      : +(amount - commission - stampDuty - slippage).toFixed(2);

    // ── 步骤5：检查资金是否充足 ────────────────────────────────────
    if ((action === 'buy' || action === 'add') && session.current_cash < netAmount) {
      return {
        success: false,
        message: `资金不足：需 ${netAmount.toFixed(2)} 元，可用 ${session.current_cash.toFixed(2)} 元`,
      };
    }

    // ── 步骤6：执行交易，更新持仓和账户 ────────────────────────────
    const tradeId = uuidv4();
    const tradeTime = now;

    // 6a. 写入交易记录
    await db.run(
      `INSERT INTO sim_trades
        (id, session_id, signal_id, stock_code, stock_name, action, quantity, price,
         amount, commission, stamp_duty, slippage, net_amount, is_strategy_driven, trade_time)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [
        tradeId, sessionId, signal.id, stockCode, tradeRequest.stockName || signal.stock_name || null,
        action, quantity, price, amount,
        +commission.toFixed(2), +stampDuty.toFixed(2), +slippage.toFixed(2),
        netAmount, tradeTime,
      ]
    );

    // 6b. 更新 sim_holdings
    await this._updateHoldings(sessionId, stockCode, tradeRequest.stockName || signal.stock_name, action, quantity, price, tradeTime);

    // 6c. 更新账户资金和总资产
    let newCash;
    if (action === 'buy' || action === 'add') {
      newCash = +(session.current_cash - netAmount).toFixed(2);
    } else {
      newCash = +(session.current_cash + netAmount).toFixed(2);
    }
    const holdingsValue = await this._calcHoldingsValue(sessionId);
    const totalAssets = +(newCash + holdingsValue).toFixed(2);

    await db.run(
      `UPDATE sim_trading_sessions
       SET current_cash = ?, current_holdings_value = ?, total_assets = ?,
           total_trades = total_trades + 1
       WHERE id = ?`,
      [newCash, +holdingsValue.toFixed(2), totalAssets, sessionId]
    );

    // ── 步骤7：标记信号为已执行 ─────────────────────────────────────
    await db.run(
      `UPDATE sim_signals SET is_executed = 1, executed_at = ? WHERE id = ?`,
      [tradeTime, signal.id]
    );

    return {
      success: true,
      tradeId,
      violationFlag: false,
      trade: { stockCode, action, quantity, price, amount, commission: +commission.toFixed(2), stampDuty: +stampDuty.toFixed(2), slippage: +slippage.toFixed(2), netAmount },
      account: { currentCash: newCash, holdingsValue: +holdingsValue.toFixed(2), totalAssets },
      message: `✅ 交易成功：${action} ${stockCode} ${quantity}股 @ ${price}元`,
    };
  }

  /**
   * 每日收盘快照（15:05定时任务调用）
   * 计算当日盈亏、累计收益率、最大回撤、基准对比
   * @param {string} sessionId 会话ID
   * @returns {Promise<Object>} 快照数据
   */
  async takeDailySnapshot(sessionId) {
    const session = await db.get(`SELECT * FROM sim_trading_sessions WHERE id = ?`, [sessionId]);
    if (!session || session.status !== 'running') return null;

    const today = new Date().toISOString().split('T')[0];

    // 获取最近一次快照（用于计算日涨跌）
    const prevSnapshot = await db.get(
      `SELECT * FROM sim_daily_snapshots WHERE session_id = ? ORDER BY snapshot_date DESC LIMIT 1`,
      [sessionId]
    );

    // 计算当日持仓市值（使用最新价格）
    const holdingsValue = await this._calcHoldingsValue(sessionId);
    const totalAssets = +(session.current_cash + holdingsValue).toFixed(2);

    // 当日盈亏
    const prevAssets = prevSnapshot ? prevSnapshot.total_assets : session.initial_capital;
    const dailyPnl = +(totalAssets - prevAssets).toFixed(2);
    const dailyReturnPct = prevAssets > 0 ? +(dailyPnl / prevAssets).toFixed(4) : 0;

    // 累计收益率
    const cumulativeReturnPct = session.initial_capital > 0
      ? +((totalAssets - session.initial_capital) / session.initial_capital).toFixed(4)
      : 0;

    // 获取所有历史快照，计算最大回撤
    const allSnapshots = await db.all(
      `SELECT total_assets FROM sim_daily_snapshots WHERE session_id = ? ORDER BY snapshot_date ASC`,
      [sessionId]
    );
    allSnapshots.push({ total_assets: totalAssets });
    const maxDrawdownPct = this._calcMaxDrawdown(allSnapshots);

    // 持仓明细JSON
    const holdings = await db.all(
      `SELECT stock_code, stock_name, quantity, avg_cost, current_price, market_value,
              unrealized_pnl, unrealized_pnl_pct, position_weight
       FROM sim_holdings WHERE session_id = ?`,
      [sessionId]
    );

    // TODO: 基准（沪深300）收益率，目前用0占位，后续接入行情接口
    const benchmarkReturnPct = 0;

    await db.run(
      `INSERT OR REPLACE INTO sim_daily_snapshots
        (session_id, snapshot_date, total_assets, cash, holdings_value, daily_pnl,
         daily_return_pct, cumulative_return_pct, max_drawdown_pct, holdings_json, benchmark_return_pct)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sessionId, today, totalAssets,
        +session.current_cash.toFixed(2),
        +holdingsValue.toFixed(2),
        dailyPnl, dailyReturnPct, cumulativeReturnPct, maxDrawdownPct,
        JSON.stringify(holdings), benchmarkReturnPct,
      ]
    );

    // 同步更新主表总资产
    await db.run(
      `UPDATE sim_trading_sessions SET total_assets = ?, current_holdings_value = ? WHERE id = ?`,
      [totalAssets, +holdingsValue.toFixed(2), sessionId]
    );

    // 检查30天是否完成
    await this.checkCompletion(sessionId);

    return { sessionId, snapshotDate: today, totalAssets, dailyPnl, dailyReturnPct, cumulativeReturnPct, maxDrawdownPct };
  }

  /**
   * 更新持仓实时价格（盘中每分钟调用）
   * 目前使用模拟价格，生产环境需接入行情API
   * @param {string} sessionId 会话ID
   */
  async updateHoldingPrices(sessionId) {
    const holdings = await db.all(
      `SELECT id, stock_code, quantity, avg_cost, market_value FROM sim_holdings WHERE session_id = ?`,
      [sessionId]
    );
    if (!holdings.length) return;

    const session = await db.get(`SELECT * FROM sim_trading_sessions WHERE id = ?`, [sessionId]);
    if (!session) return;

    let totalHoldingsValue = 0;

    for (const h of holdings) {
      // TODO: 生产环境接入实时行情API（如聚宽、同花顺、东财等）
      // 目前用随机波动模拟（±0.5%日内波动）
      const prevPrice = h.market_value ? h.market_value / h.quantity : h.avg_cost;
      const fluctuation = prevPrice * (Math.random() * 0.01 - 0.005);
      const currentPrice = +(prevPrice + fluctuation).toFixed(2);
      const marketValue = +(currentPrice * h.quantity).toFixed(2);
      const unrealizedPnl = +(marketValue - h.avg_cost * h.quantity).toFixed(2);
      const unrealizedPnlPct = h.avg_cost > 0 ? +(unrealizedPnl / (h.avg_cost * h.quantity)).toFixed(4) : 0;

      totalHoldingsValue += marketValue;

      await db.run(
        `UPDATE sim_holdings
         SET current_price = ?, market_value = ?, unrealized_pnl = ?,
             unrealized_pnl_pct = ?, updated_at = datetime('now')
         WHERE id = ?`,
        [currentPrice, marketValue, unrealizedPnl, unrealizedPnlPct, h.id]
      );
    }

    // 更新持仓权重
    if (totalHoldingsValue > 0) {
      const holdingsList = await db.all(`SELECT id, market_value FROM sim_holdings WHERE session_id = ?`, [sessionId]);
      for (const h of holdingsList) {
        const weight = +(h.market_value / (totalHoldingsValue + session.current_cash)).toFixed(4);
        await db.run(`UPDATE sim_holdings SET position_weight = ? WHERE id = ?`, [weight, h.id]);
      }
    }

    // 更新主表持仓市值和总资产
    const totalAssets = +(session.current_cash + totalHoldingsValue).toFixed(2);
    await db.run(
      `UPDATE sim_trading_sessions SET current_holdings_value = ?, total_assets = ? WHERE id = ?`,
      [+totalHoldingsValue.toFixed(2), totalAssets, sessionId]
    );
  }

  /**
   * 检查是否到30个交易日，触发评测并更新状态
   * @param {string} sessionId 会话ID
   * @returns {Promise<boolean>} 是否已完成
   */
  async checkCompletion(sessionId) {
    const session = await db.get(`SELECT * FROM sim_trading_sessions WHERE id = ?`, [sessionId]);
    if (!session || session.status !== 'running') return false;

    // 统计已有快照数（即已过交易日数）
    const snapshotCount = await db.get(
      `SELECT COUNT(*) as cnt FROM sim_daily_snapshots WHERE session_id = ?`,
      [sessionId]
    );
    const tradingDays = snapshotCount ? snapshotCount.cnt : 0;

    if (tradingDays >= 30) {
      const today = new Date().toISOString().split('T')[0];
      await db.run(
        `UPDATE sim_trading_sessions SET status = 'completed', end_date = ? WHERE id = ?`,
        [today, sessionId]
      );
      return true;
    }
    return false;
  }

  /**
   * 计算最大回撤（从历史快照数据）
   * 采用"滚动峰值法"：以历史最高点为参考，计算最大跌幅
   * @param {Array<{total_assets: number}>} snapshots 历史快照（按日期升序）
   * @returns {number} 最大回撤（负值小数，保留4位，如 -0.1523 表示 -15.23%）
   */
  _calcMaxDrawdown(snapshots) {
    if (!snapshots || snapshots.length < 2) return 0;

    let peak = snapshots[0].total_assets;
    let maxDrawdown = 0;

    for (const snap of snapshots) {
      const assets = snap.total_assets;
      if (assets > peak) {
        peak = assets;
      } else if (peak > 0) {
        const drawdown = (assets - peak) / peak;
        if (drawdown < maxDrawdown) {
          maxDrawdown = drawdown;
        }
      }
    }
    return +maxDrawdown.toFixed(4);
  }

  /**
   * 计算单笔交易费用（A股真实费率模型）
   * @param {string} action buy/sell/add/reduce
   * @param {number} quantity 数量（股）
   * @param {number} price 价格（元）
   * @returns {{ commission: number, stampDuty: number, slippage: number }}
   */
  _calcTradeCost(action, quantity, price) {
    const amount = quantity * price;
    // 佣金：万分之2.5，最低5元
    const commission = Math.max(TRADE_COST.minCommission, amount * TRADE_COST.commissionRate);
    // 印花税：千分之1，仅卖出收取
    const stampDuty = (action === 'sell' || action === 'reduce') ? amount * TRADE_COST.stampDutyRate : 0;
    // 滑点：±0.1%随机波动（模拟成交价偏差）
    const slippage = amount * TRADE_COST.slippageRange * (Math.random() * 2 - 1);
    return { commission, stampDuty, slippage };
  }

  // ──────────────────────────── 内部辅助方法 ──────────────────────────────

  /**
   * 获取运行中的会话（内部使用）
   */
  async _getRunningSession(sessionId) {
    return db.get(`SELECT * FROM sim_trading_sessions WHERE id = ? AND status = 'running'`, [sessionId]);
  }

  /**
   * 将交易动作映射到信号类型（用于信号查询匹配）
   */
  _mapActionToSignalType(action) {
    const map = { buy: 'buy', add: 'add', sell: 'sell', reduce: 'reduce' };
    return map[action] || action;
  }

  /**
   * 更新或插入持仓记录
   */
  async _updateHoldings(sessionId, stockCode, stockName, action, quantity, price, tradeTime) {
    const existing = await db.get(
      `SELECT * FROM sim_holdings WHERE session_id = ? AND stock_code = ?`,
      [sessionId, stockCode]
    );

    if (action === 'buy' || action === 'add') {
      if (existing) {
        // 加仓：重新计算均价
        const newQty = existing.quantity + quantity;
        const newAvgCost = +((existing.avg_cost * existing.quantity + price * quantity) / newQty).toFixed(4);
        await db.run(
          `UPDATE sim_holdings
           SET quantity = ?, avg_cost = ?, last_trade_time = ?, updated_at = datetime('now')
           WHERE session_id = ? AND stock_code = ?`,
          [newQty, newAvgCost, tradeTime, sessionId, stockCode]
        );
      } else {
        // 建仓
        await db.run(
          `INSERT INTO sim_holdings
            (session_id, stock_code, stock_name, quantity, avg_cost, current_price,
             market_value, unrealized_pnl, unrealized_pnl_pct, position_weight,
             hold_days, first_buy_time, last_trade_time)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, ?, ?)`,
          [sessionId, stockCode, stockName || null, quantity, price, price, +(quantity * price).toFixed(2), tradeTime, tradeTime]
        );
      }
    } else if (action === 'sell' || action === 'reduce') {
      if (existing) {
        const newQty = existing.quantity - quantity;
        if (newQty <= 0) {
          // 清仓
          await db.run(
            `DELETE FROM sim_holdings WHERE session_id = ? AND stock_code = ?`,
            [sessionId, stockCode]
          );
        } else {
          // 减仓（均价不变）
          await db.run(
            `UPDATE sim_holdings SET quantity = ?, last_trade_time = ?, updated_at = datetime('now')
             WHERE session_id = ? AND stock_code = ?`,
            [newQty, tradeTime, sessionId, stockCode]
          );
        }
      }
    }
  }

  /**
   * 计算当前持仓总市值
   */
  async _calcHoldingsValue(sessionId) {
    const result = await db.get(
      `SELECT COALESCE(SUM(market_value), 0) as total FROM sim_holdings WHERE session_id = ?`,
      [sessionId]
    );
    return result ? result.total : 0;
  }
}

module.exports = new SimTradingEngine();
