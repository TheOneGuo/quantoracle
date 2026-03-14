/**
 * @file mock-adapter.js
 * @description 纸交易模拟券商适配器（MockBrokerAdapter）
 * 实现完整的模拟交易逻辑，不连接任何真实券商。
 * 用于开发调试和策略验证。
 *
 * @module broker/mock-adapter
 */

const { randomUUID: uuidv4 } = require('crypto');
const BrokerAdapter = require('./base-adapter');

/** 模拟初始资金（元）*/
const DEFAULT_INITIAL_CAPITAL = 500_000;

class MockBrokerAdapter extends BrokerAdapter {
  /**
   * 构造函数
   * @param {Object} [config]
   * @param {number} [config.initialCapital=500000] - 模拟初始资金（元）
   * @param {number} [config.commissionRate=0.0003] - 佣金率（万三）
   * @param {number} [config.stampTaxRate=0.001] - 印花税率（卖出）
   * @param {number} [config.slippage=0.002] - 滑点比例
   */
  constructor(config = {}) {
    super(config);
    this.initialCapital = config.initialCapital || DEFAULT_INITIAL_CAPITAL;
    this.commissionRate = config.commissionRate || 0.0003;
    this.stampTaxRate = config.stampTaxRate || 0.001;
    this.slippage = config.slippage || 0.002;

    /** @type {Map<string, import('./base-adapter').Position>} code → Position */
    this._positions = new Map();
    /** @type {import('./base-adapter').Order[]} */
    this._orders = [];
    /** 可用资金（元）*/
    this._availableCash = this.initialCapital;
    /** 累计成本（元）*/
    this._invested = 0;
  }

  /**
   * 模拟连接券商（始终成功）
   * @returns {Promise<boolean>}
   */
  async connect() {
    this.connected = true;
    console.log('[MockBroker] 已连接模拟券商（纸交易模式）');
    return true;
  }

  /**
   * 断开连接
   * @returns {Promise<void>}
   */
  async disconnect() {
    this.connected = false;
    console.log('[MockBroker] 已断开连接');
  }

  /**
   * 获取持仓列表
   * @returns {Promise<import('./base-adapter').Position[]>}
   */
  async getPositions() {
    return Array.from(this._positions.values()).map(pos => ({
      ...pos,
      profit: (pos.currentPrice - pos.costPrice) * pos.quantity,
      profitPct: ((pos.currentPrice - pos.costPrice) / pos.costPrice) * 100,
    }));
  }

  /**
   * 下单（买入或卖出）
   * 模拟成交：价格加入滑点后立即全部成交
   * @param {string} code       - 股票代码
   * @param {'buy'|'sell'} action - 方向
   * @param {number} quantity   - 数量（股）
   * @param {number} [price=0]  - 委托价（0 = 最新价模拟市价）
   * @returns {Promise<import('./base-adapter').Order>}
   */
  async placeOrder(code, action, quantity, price = 0) {
    this._validateOrderParams(code, action, quantity, price);

    // 若市价单，用最新持仓价或随机模拟价
    const execPrice = price > 0
      ? price * (1 + (action === 'buy' ? this.slippage : -this.slippage))
      : this._simulateMarketPrice(code);

    const totalAmount = execPrice * quantity;

    // 佣金计算（最低 5 元）
    const commission = Math.max(totalAmount * this.commissionRate, 5);
    // 印花税（仅卖出）
    const stampTax = action === 'sell' ? totalAmount * this.stampTaxRate : 0;
    const totalCost = totalAmount + commission + stampTax;

    // 买入：检查资金是否充足
    if (action === 'buy' && this._availableCash < totalCost) {
      const order = this._createOrder(code, action, quantity, price, 'failed', 0, 0);
      order.failReason = `资金不足：需要 ${totalCost.toFixed(2)} 元，可用 ${this._availableCash.toFixed(2)} 元`;
      this._orders.push(order);
      return order;
    }

    // 卖出：检查持仓是否充足
    if (action === 'sell') {
      const pos = this._positions.get(code);
      if (!pos || pos.available < quantity) {
        const order = this._createOrder(code, action, quantity, price, 'failed', 0, 0);
        order.failReason = `持仓不足：可卖 ${pos?.available || 0} 股`;
        this._orders.push(order);
        return order;
      }
    }

    // 执行成交
    if (action === 'buy') {
      this._availableCash -= totalCost;
      this._addPosition(code, quantity, execPrice);
    } else {
      this._availableCash += totalAmount - commission - stampTax;
      this._removePosition(code, quantity, execPrice);
    }

    const order = this._createOrder(code, action, quantity, execPrice, 'filled', quantity, execPrice);
    this._orders.push(order);

    console.log(`[MockBroker] ${action === 'buy' ? '买入' : '卖出'} ${code} x${quantity} @${execPrice.toFixed(3)}`);
    return order;
  }

  /**
   * 获取委托列表
   * @param {Object} [options]
   * @param {string} [options.status='all']
   * @param {number} [options.limit=50]
   * @returns {Promise<import('./base-adapter').Order[]>}
   */
  async getOrders(options = {}) {
    const { status = 'all', limit = 50 } = options;
    let orders = [...this._orders].reverse(); // 最新在前
    if (status !== 'all') {
      orders = orders.filter(o => o.status === status);
    }
    return orders.slice(0, limit);
  }

  /**
   * 撤销委托（模拟中已成交的无法撤）
   * @param {string} orderId
   * @returns {Promise<boolean>}
   */
  async cancelOrder(orderId) {
    const order = this._orders.find(o => o.orderId === orderId);
    if (!order) return false;
    if (order.status !== 'pending') return false;
    order.status = 'cancelled';
    return true;
  }

  /**
   * 获取账户资金信息
   * @returns {Promise<{balance: number, available: number, marketValue: number, totalAssets: number}>}
   */
  async getAccountInfo() {
    const marketValue = Array.from(this._positions.values())
      .reduce((sum, pos) => sum + pos.currentPrice * pos.quantity, 0);

    return {
      balance: this._availableCash + marketValue,
      available: this._availableCash,
      marketValue,
      totalAssets: this._availableCash + marketValue,
      initialCapital: this.initialCapital,
      profitLoss: (this._availableCash + marketValue) - this.initialCapital,
    };
  }

  // ========== 私有辅助方法 ==========

  /**
   * 模拟市价（用于市价单）
   * @param {string} code
   * @returns {number}
   */
  _simulateMarketPrice(code) {
    const pos = this._positions.get(code);
    if (pos) return pos.currentPrice;
    // 随机生成一个合理价格（10~200 元）
    return Math.round((Math.random() * 190 + 10) * 100) / 100;
  }

  /**
   * 添加或增加持仓
   * @param {string} code
   * @param {number} quantity
   * @param {number} price
   */
  _addPosition(code, quantity, price) {
    const existing = this._positions.get(code);
    if (existing) {
      const totalQty = existing.quantity + quantity;
      const avgCost = (existing.costPrice * existing.quantity + price * quantity) / totalQty;
      this._positions.set(code, {
        ...existing,
        quantity: totalQty,
        available: totalQty, // T+1 实际应为0，此处简化
        costPrice: avgCost,
        currentPrice: price,
      });
    } else {
      this._positions.set(code, {
        code,
        name: code, // 实际应查询名称，此处用 code 占位
        quantity,
        available: quantity,
        costPrice: price,
        currentPrice: price,
        profit: 0,
        profitPct: 0,
      });
    }
  }

  /**
   * 减少持仓
   * @param {string} code
   * @param {number} quantity
   * @param {number} currentPrice - 成交价（用于更新最新价）
   */
  _removePosition(code, quantity, currentPrice) {
    const pos = this._positions.get(code);
    if (!pos) return;
    const newQty = pos.quantity - quantity;
    if (newQty <= 0) {
      this._positions.delete(code);
    } else {
      this._positions.set(code, {
        ...pos,
        quantity: newQty,
        available: Math.max(pos.available - quantity, 0),
        currentPrice,
      });
    }
  }

  /**
   * 创建委托对象
   * @param {string} code
   * @param {string} action
   * @param {number} quantity
   * @param {number} price
   * @param {string} status
   * @param {number} filledQty
   * @param {number} filledPrice
   * @returns {import('./base-adapter').Order}
   */
  _createOrder(code, action, quantity, price, status, filledQty, filledPrice) {
    return {
      orderId: uuidv4(),
      code,
      name: code,
      action,
      quantity,
      price,
      status,
      filledQty,
      filledPrice,
      createdAt: new Date().toISOString(),
    };
  }
}

module.exports = MockBrokerAdapter;
