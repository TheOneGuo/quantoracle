/**
 * @file 开仓数量计算器
 * @description 按策略规则计算合规的开仓/增仓数量，含T+1和涨跌停验证
 *              A股最小交易单位为100股（1手），所有买入数量必须是100的整数倍
 */

'use strict';

/** A股最小交易单位（1手 = 100股） */
const LOT_SIZE = 100;

/**
 * 计算开仓股数（向下取整至100股整数倍）
 *
 * @param {number} availableCash 可用资金（元）
 * @param {string} grade 评级 S/A/B/C（D级不开仓）
 * @param {number} price 当前价格（元/股）
 * @param {Object} capitalAllocation 资金使用规则
 *   - s_open: S级开仓占可用资金比例（%）
 *   - a_open: A级开仓占可用资金比例（%）
 *   - b_open: B级开仓占可用资金比例（%）
 *   - c_open: C级开仓占可用资金比例（%）
 *   - s_add: S级增仓比例（%）
 *   - a_add: A级增仓比例（%）
 *   - b_add: B级增仓比例（%）
 *   - max_single_pct: 单只股票最大仓位比例（%）
 *   - max_total_pct: 总仓位上限（%）
 *   - max_add_times: 最大允许增仓次数
 * @returns {{ quantity: number, amount: number, pct_used: number, valid: boolean, reason: string }}
 */
function calcOpenQuantity(availableCash, grade, price, capitalAllocation) {
  // D级不开仓
  if (grade === 'D') {
    return { quantity: 0, amount: 0, pct_used: 0, valid: false, reason: 'D级评分不建议开仓' };
  }

  // 按评级查找对应开仓比例
  const openPctMap = {
    S: capitalAllocation.s_open || 20,
    A: capitalAllocation.a_open || 15,
    B: capitalAllocation.b_open || 10,
    C: capitalAllocation.c_open || 5
  };
  const openPct = openPctMap[grade] || 0;

  if (openPct === 0) {
    return { quantity: 0, amount: 0, pct_used: 0, valid: false, reason: `${grade}级开仓比例未配置` };
  }

  if (price <= 0) {
    return { quantity: 0, amount: 0, pct_used: openPct, valid: false, reason: '价格无效（≤0）' };
  }

  // 计算目标投入金额
  const targetAmount = availableCash * openPct / 100;

  // 理论股数（不取整）
  const theoreticalShares = targetAmount / price;

  // 向下取整至100股整数倍（A股规则）
  const quantity = Math.floor(theoreticalShares / LOT_SIZE) * LOT_SIZE;

  // 至少需要1手（100股）
  if (quantity < LOT_SIZE) {
    return {
      quantity: 0,
      amount: 0,
      pct_used: openPct,
      valid: false,
      reason: `可用资金不足买入1手（100股），需 ${(price * LOT_SIZE).toFixed(2)} 元，当前可用 ${(targetAmount).toFixed(2)} 元`
    };
  }

  const actualAmount = quantity * price;

  return {
    quantity,
    amount: Math.round(actualAmount * 100) / 100, // 保留两位小数
    pct_used: openPct,
    valid: true,
    reason: `按${grade}级开仓${openPct}%，建议买入${quantity}股，约${(actualAmount / 10000).toFixed(2)}万元`
  };
}

/**
 * 计算增仓数量
 *
 * @param {number} availableCash 可用资金（元）
 * @param {string} grade 评级 S/A/B（C级不增仓）
 * @param {number} price 当前价格（元/股）
 * @param {Object} capitalAllocation 资金使用规则
 * @param {number} currentAddTimes 当前已增仓次数
 * @returns {{ quantity: number, amount: number, pct_used: number, valid: boolean, reason: string }}
 */
function calcAddQuantity(availableCash, grade, price, capitalAllocation, currentAddTimes = 0) {
  const maxAddTimes = capitalAllocation.max_add_times || 2;

  // 超过最大增仓次数
  if (currentAddTimes >= maxAddTimes) {
    return {
      quantity: 0, amount: 0, pct_used: 0, valid: false,
      reason: `已达最大增仓次数（${maxAddTimes}次）`
    };
  }

  // C/D级不增仓
  if (grade === 'C' || grade === 'D') {
    return {
      quantity: 0, amount: 0, pct_used: 0, valid: false,
      reason: `${grade}级不建议增仓`
    };
  }

  const addPctMap = {
    S: capitalAllocation.s_add || 15,
    A: capitalAllocation.a_add || 10,
    B: capitalAllocation.b_add || 5
  };
  const addPct = addPctMap[grade] || 0;

  const targetAmount = availableCash * addPct / 100;
  const quantity = Math.floor((targetAmount / price) / LOT_SIZE) * LOT_SIZE;

  if (quantity < LOT_SIZE) {
    return { quantity: 0, amount: 0, pct_used: addPct, valid: false, reason: '可用资金不足增仓1手' };
  }

  return {
    quantity,
    amount: Math.round(quantity * price * 100) / 100,
    pct_used: addPct,
    valid: true,
    reason: `按${grade}级增仓${addPct}%，建议买入${quantity}股（第${currentAddTimes + 1}次增仓）`
  };
}

/**
 * 验证价格是否在涨跌停范围内
 * 说明：A股普通股涨跌幅限制±10%，ST股±5%，科创板/创业板部分股票首日±20%（此处不处理特殊情况）
 *
 * @param {number} price 信号生成时的价格
 * @param {number} prevClose 昨日收盘价
 * @param {boolean} isST 是否为ST/*ST股
 * @returns {{ valid: boolean, limit_up: number, limit_down: number, message: string }}
 */
function validatePrice(price, prevClose, isST = false) {
  if (!prevClose || prevClose <= 0) {
    return { valid: false, limit_up: 0, limit_down: 0, message: '昨收价无效，无法验证涨跌停' };
  }

  const ratio = isST ? 0.05 : 0.10;
  const limitUp = +(prevClose * (1 + ratio)).toFixed(2);
  const limitDown = +(prevClose * (1 - ratio)).toFixed(2);
  const valid = price >= limitDown && price <= limitUp;

  let message = '';
  if (price >= limitUp) message = '价格已触及涨停，无法买入';
  else if (price <= limitDown) message = '价格已触及跌停，流动性风险';
  else message = '价格在正常交易范围内';

  return { valid, limit_up: limitUp, limit_down: limitDown, message };
}

/**
 * 计算减仓/止损的实际可执行数量（考虑T+1规则）
 * T+1 规则：当日买入的股票不能当日卖出，必须持有至次交易日
 *
 * @param {number} totalHolding 总持仓股数
 * @param {number} t1Locked 今日买入的锁定数量（不可当日卖出）
 * @param {number} reducePct 目标减仓比例（%）
 * @returns {{
 *   today_quantity: number,   // 今日可执行的减仓量
 *   t1_quantity: number,      // 需要T+1顺延到明日的量
 *   need_followup: boolean,   // 是否需要生成T+1顺延信号
 *   total_target: number,     // 目标总减仓量
 *   message: string
 * }}
 */
function calcReduceQuantity(totalHolding, t1Locked, reducePct) {
  if (totalHolding <= 0) {
    return { today_quantity: 0, t1_quantity: 0, need_followup: false, total_target: 0, message: '当前无持仓' };
  }

  // 当日可用股数（排除T+1锁定部分）
  const available = Math.max(0, totalHolding - t1Locked);

  // 目标减仓总量（向下取整至100股）
  const targetReduce = Math.floor(totalHolding * reducePct / 100 / LOT_SIZE) * LOT_SIZE;

  if (targetReduce < LOT_SIZE) {
    return {
      today_quantity: 0, t1_quantity: 0, need_followup: false, total_target: targetReduce,
      message: `目标减仓量不足1手（${targetReduce}股），暂不执行`
    };
  }

  // 今日可卖数量不得超过可用持仓
  const todayQty = Math.min(available, targetReduce);
  // 今日不够卖的部分顺延到T+1
  const t1Qty = targetReduce - todayQty;

  return {
    today_quantity: todayQty,
    t1_quantity: t1Qty,
    need_followup: t1Qty > 0,
    total_target: targetReduce,
    message: t1Qty > 0
      ? `T+1受限：今日可卖${todayQty}股，顺延${t1Qty}股至明日`
      : `今日可执行减仓${todayQty}股`
  };
}

/**
 * 检查是否触及止损条件
 *
 * @param {number} currentPrice 当前价格
 * @param {number} avgCost 持仓均价
 * @param {Object} stopLossRules 止损规则
 *   - fixed_pct: 固定止损线（%，如8表示亏损8%触发）
 *   - sell_pct: 止损卖出比例（%，通常100%清仓）
 * @returns {{ triggered: boolean, type: string, sell_pct: number, loss_pct: number }}
 */
function checkStopLoss(currentPrice, avgCost, stopLossRules = {}) {
  if (!avgCost || avgCost <= 0) {
    return { triggered: false, type: null, sell_pct: 0, loss_pct: 0 };
  }

  const lossPct = ((currentPrice - avgCost) / avgCost) * 100;
  const { fixed_pct = 8, sell_pct = 100 } = stopLossRules;

  // 固定止损：亏损超过阈值
  if (lossPct <= -fixed_pct) {
    return {
      triggered: true,
      type: 'fixed_stop_loss',
      sell_pct,
      loss_pct: Math.round(lossPct * 10) / 10,
      message: `触发固定止损：当前亏损${Math.abs(lossPct).toFixed(1)}%，超过止损线${fixed_pct}%`
    };
  }

  return { triggered: false, type: null, sell_pct: 0, loss_pct: Math.round(lossPct * 10) / 10 };
}

/**
 * 检查是否触及止盈条件
 *
 * @param {number} currentPrice 当前价格
 * @param {number} avgCost 持仓均价
 * @param {number} highPrice 持仓期间最高价（用于追踪止盈）
 * @param {Array} takeProfitRules 止盈规则数组
 *   每项: { type:'fixed', trigger_pct:15, sell_pct:30 }
 *      或 { type:'trailing', drawdown_pct:15, sell_pct:50 }
 * @returns {{ triggered: boolean, type: string, sell_pct: number, profit_pct: number, rule: Object }}
 */
function checkTakeProfit(currentPrice, avgCost, highPrice, takeProfitRules = []) {
  if (!avgCost || avgCost <= 0 || !Array.isArray(takeProfitRules)) {
    return { triggered: false };
  }

  const profitPct = ((currentPrice - avgCost) / avgCost) * 100;
  const drawdownFromHigh = highPrice > 0 ? ((currentPrice - highPrice) / highPrice) * 100 : 0;

  for (const rule of takeProfitRules) {
    if (rule.type === 'fixed' && profitPct >= rule.trigger_pct) {
      return {
        triggered: true,
        type: 'fixed_take_profit',
        sell_pct: rule.sell_pct,
        profit_pct: Math.round(profitPct * 10) / 10,
        rule,
        message: `触发固定止盈：当前盈利${profitPct.toFixed(1)}%，达到${rule.trigger_pct}%止盈线，减仓${rule.sell_pct}%`
      };
    }
    if (rule.type === 'trailing' && highPrice > 0 && drawdownFromHigh <= -rule.drawdown_pct) {
      return {
        triggered: true,
        type: 'trailing_take_profit',
        sell_pct: rule.sell_pct,
        profit_pct: Math.round(profitPct * 10) / 10,
        rule,
        message: `触发追踪止盈：从高点回落${Math.abs(drawdownFromHigh).toFixed(1)}%，超过${rule.drawdown_pct}%回撤线，减仓${rule.sell_pct}%`
      };
    }
  }

  return { triggered: false, profit_pct: Math.round(profitPct * 10) / 10 };
}

module.exports = {
  LOT_SIZE,
  calcOpenQuantity,
  calcAddQuantity,
  validatePrice,
  calcReduceQuantity,
  checkStopLoss,
  checkTakeProfit
};
