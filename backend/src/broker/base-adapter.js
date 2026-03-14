/**
 * @file base-adapter.js
 * @description 券商适配器抽象基类（BrokerAdapter）
 * 所有券商实现必须继承此类并实现全部抽象方法。
 *
 * @module broker/base-adapter
 */

/**
 * 持仓对象结构
 * @typedef {Object} Position
 * @property {string} code       - 股票代码（如 sh600519）
 * @property {string} name       - 股票名称
 * @property {number} quantity   - 持仓数量（股）
 * @property {number} available  - 可卖数量（股）
 * @property {number} costPrice  - 成本价（元）
 * @property {number} currentPrice - 最新价（元）
 * @property {number} profit     - 浮动盈亏（元）
 * @property {number} profitPct  - 浮动盈亏百分比
 */

/**
 * 委托订单结构
 * @typedef {Object} Order
 * @property {string} orderId    - 委托编号
 * @property {string} code       - 股票代码
 * @property {string} name       - 股票名称
 * @property {'buy'|'sell'} action - 操作方向
 * @property {number} quantity   - 委托数量
 * @property {number} price      - 委托价格（0 = 市价）
 * @property {'pending'|'filled'|'partial'|'cancelled'|'failed'} status - 委托状态
 * @property {number} filledQty  - 已成交数量
 * @property {number} filledPrice - 成交均价
 * @property {string} createdAt  - 委托时间（ISO 字符串）
 */

class BrokerAdapter {
  /**
   * 构造函数
   * @param {Object} config - 券商配置（各子类定义具体字段）
   */
  constructor(config = {}) {
    if (new.target === BrokerAdapter) {
      throw new Error('BrokerAdapter 是抽象类，请使用具体实现类');
    }
    this.config = config;
    this.connected = false;
  }

  /**
   * 连接券商（登录 / 建立 session）
   * @abstract
   * @returns {Promise<boolean>} 是否连接成功
   */
  async connect() {
    throw new Error('connect() 未实现');
  }

  /**
   * 断开连接
   * @abstract
   * @returns {Promise<void>}
   */
  async disconnect() {
    throw new Error('disconnect() 未实现');
  }

  /**
   * 获取当前持仓列表
   * @abstract
   * @returns {Promise<Position[]>} 持仓数组
   */
  async getPositions() {
    throw new Error('getPositions() 未实现');
  }

  /**
   * 下单（买入或卖出）
   * @abstract
   * @param {string} code       - 股票代码（如 sh600519）
   * @param {'buy'|'sell'} action - 操作方向
   * @param {number} quantity   - 数量（股，必须为 100 的整数倍）
   * @param {number} [price=0]  - 委托价格；0 表示市价单
   * @returns {Promise<Order>}  提交后的委托对象
   */
  async placeOrder(code, action, quantity, price = 0) {
    throw new Error('placeOrder() 未实现');
  }

  /**
   * 获取委托列表
   * @abstract
   * @param {Object} [options]
   * @param {'all'|'pending'|'filled'|'cancelled'} [options.status='all'] - 过滤状态
   * @param {number} [options.limit=50] - 最大返回条数
   * @returns {Promise<Order[]>} 委托数组
   */
  async getOrders(options = {}) {
    throw new Error('getOrders() 未实现');
  }

  /**
   * 撤销委托
   * @abstract
   * @param {string} orderId - 委托编号
   * @returns {Promise<boolean>} 是否撤销成功
   */
  async cancelOrder(orderId) {
    throw new Error('cancelOrder() 未实现');
  }

  /**
   * 获取账户资金信息
   * @abstract
   * @returns {Promise<{balance: number, available: number, marketValue: number, totalAssets: number}>}
   */
  async getAccountInfo() {
    throw new Error('getAccountInfo() 未实现');
  }

  /**
   * 获取适配器名称（用于日志和 UI 展示）
   * @returns {string}
   */
  getName() {
    return this.constructor.name;
  }

  /**
   * 验证下单参数合法性
   * @param {string} code
   * @param {'buy'|'sell'} action
   * @param {number} quantity
   * @param {number} price
   * @throws {Error} 参数不合法时抛出
   */
  _validateOrderParams(code, action, quantity, price) {
    if (!code || typeof code !== 'string') throw new Error('股票代码不合法');
    if (!['buy', 'sell'].includes(action)) throw new Error('action 必须为 buy 或 sell');
    if (!Number.isInteger(quantity) || quantity <= 0) throw new Error('数量必须为正整数');
    if (quantity % 100 !== 0) throw new Error('A股数量必须为 100 的整数倍');
    if (typeof price !== 'number' || price < 0) throw new Error('价格不合法');
  }
}

module.exports = BrokerAdapter;
