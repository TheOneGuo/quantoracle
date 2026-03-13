/**
 * 交易规则引擎
 * 实现用户的股票操作策略
 */
class TradingRules {
  /**
   * 分析股票并生成操作建议
   * @param {Object} stock - 股票数据
   * @param {number} buyPrice - 买入成本价
   * @param {Object} ma - 均线数据 {ma5, ma10, ma20}
   */
  static analyze(stock, buyPrice, ma) {
    const currentPrice = stock.current;
    const changePercent = ((currentPrice - buyPrice) / buyPrice) * 100;
    
    const result = {
      code: stock.code,
      name: stock.name,
      currentPrice,
      buyPrice,
      changePercent: parseFloat(changePercent.toFixed(2)),
      action: 'HOLD',  // HOLD, BUY, SELL, CLEAR
      actionDesc: '持仓不动',
      reason: '',
      intensity: 0  // 操作强度 (加仓/减仓百分比)
    };

    // 下跌规则
    if (changePercent < 0) {
      return this.handleDecline(result, changePercent, ma, currentPrice);
    }
    
    // 上涨规则
    if (changePercent > 0) {
      return this.handleRise(result, changePercent);
    }

    return result;
  }

  /**
   * 处理下跌情况
   */
  static handleDecline(result, changePercent, ma, currentPrice) {
    const absChange = Math.abs(changePercent);
    
    // 下跌 5%, 10% - 持仓不动
    if (absChange <= 10) {
      result.action = 'HOLD';
      result.actionDesc = '坚定持仓';
      result.reason = `股价下跌${absChange.toFixed(1)}%，拒绝小波动恐慌，不做任何调整`;
      return result;
    }
    
    // 下跌 15% - 观察5日均线
    if (absChange <= 15) {
      if (ma && ma.ma5 && currentPrice >= ma.ma5) {
        result.action = 'BUY';
        result.actionDesc = '加仓10%';
        result.intensity = 10;
        result.reason = '股价下跌15%，5日均线有支撑，加仓10%';
      } else {
        result.action = 'SELL';
        result.actionDesc = '减仓10%';
        result.intensity = 10;
        result.reason = '股价下跌15%，5日均线无支撑，减仓10%';
      }
      return result;
    }
    
    // 下跌 20% - 观察10日均线
    if (absChange <= 20) {
      if (ma && ma.ma10 && currentPrice >= ma.ma10) {
        result.action = 'BUY';
        result.actionDesc = '加仓20%';
        result.intensity = 20;
        result.reason = '股价下跌20%，10日均线有支撑，加仓20%';
      } else {
        result.action = 'SELL';
        result.actionDesc = '减仓20%';
        result.intensity = 20;
        result.reason = '股价下跌20%，10日均线无支撑，减仓20%';
      }
      return result;
    }
    
    // 下跌 25% - 观察20日均线
    if (absChange <= 25) {
      if (ma && ma.ma20 && currentPrice >= ma.ma20) {
        result.action = 'BUY';
        result.actionDesc = '加仓30%';
        result.intensity = 30;
        result.reason = '股价下跌25%，20日均线有支撑，加仓30%';
      } else {
        result.action = 'SELL';
        result.actionDesc = '减仓30%';
        result.intensity = 30;
        result.reason = '股价下跌25%，20日均线无支撑，减仓30%';
      }
      return result;
    }
    
    // 下跌 30%+ 且跌破20日均线 - 无条件清仓
    if (absChange >= 30 && ma && ma.ma20 && currentPrice < ma.ma20) {
      result.action = 'CLEAR';
      result.actionDesc = '无条件清仓';
      result.intensity = 100;
      result.reason = '股价下跌30%+且跌破20日均线，果断止损，杜绝深套';
      return result;
    }
    
    // 其他情况
    result.reason = `股价下跌${absChange.toFixed(1)}%，继续观察`;
    return result;
  }

  /**
   * 处理上涨情况
   */
  static handleRise(result, changePercent) {
    // 上涨 10%, 20% - 持仓不动
    if (changePercent <= 20) {
      result.action = 'HOLD';
      result.actionDesc = '安心持有';
      result.reason = `股价上涨${changePercent.toFixed(1)}%，让利润继续奔跑`;
      return result;
    }
    
    // 上涨 30% - 减仓50%
    if (changePercent <= 30) {
      result.action = 'SELL';
      result.actionDesc = '减仓50%';
      result.intensity = 50;
      result.reason = '股价上涨30%，减仓50%，先锁定一半利润，落袋为安';
      return result;
    }
    
    // 上涨 40% - 再减仓30% (累计80%)
    if (changePercent <= 40) {
      result.action = 'SELL';
      result.actionDesc = '再减仓30%';
      result.intensity = 30;
      result.reason = '股价上涨40%，在已有减仓基础上再减仓30%，累计减仓80%，进一步守住收益';
      return result;
    }
    
    // 上涨 50% - 全额清仓
    if (changePercent >= 50) {
      result.action = 'CLEAR';
      result.actionDesc = '全额清仓';
      result.intensity = 100;
      result.reason = '股价上涨50%，全额清仓离场，不恋战、不贪婪，规避高位回调风险';
      return result;
    }
    
    return result;
  }
}

module.exports = TradingRules;
