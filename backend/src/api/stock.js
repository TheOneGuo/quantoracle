const axios = require('axios');
const iconv = require('iconv-lite');

/**
 * 股票数据 API 封装
 * 支持多数据源切换
 */
class StockAPI {
  constructor(provider = 'sina') {
    this.provider = provider;
  }

  /**
   * 获取实时股票数据
   * @param {string} code - 股票代码 (如: sh600519, sz000001)
   */
  async getRealtimeQuote(code) {
    switch (this.provider) {
      case 'sina':
        return this.getSinaQuote(code);
      case 'tencent':
        return this.getTencentQuote(code);
      default:
        throw new Error(`Unknown provider: ${this.provider}`);
    }
  }

  /**
   * 新浪财经 API（已验证真实数据源）
   * 接口URL: https://hq.sinajs.cn/list=<code>
   * 格式: https://hq.sinajs.cn/list=sh600519
   */
  async getSinaQuote(code) {
    try {
      const url = `https://hq.sinajs.cn/list=${code}`;
      const response = await axios.get(url, {
        headers: {
          'Referer': 'https://finance.sina.com.cn'
        },
        responseType: 'arraybuffer'  // 获取二进制数据
      });
      
      // 使用 GBK 解码
      const dataStr = iconv.decode(response.data, 'GBK');
      
      // 解析返回数据
      const match = dataStr.match(/"([^"]+)"/);
      if (!match) return null;
      
      const fields = match[1].split(',');
      return {
        code,
        name: fields[0],
        open: parseFloat(fields[1]),
        close: parseFloat(fields[2]),
        current: parseFloat(fields[3]),
        high: parseFloat(fields[4]),
        low: parseFloat(fields[5]),
        volume: parseInt(fields[8]),
        amount: parseFloat(fields[9]),
        date: fields[30],
        time: fields[31],
        // 计算涨跌幅
        change: parseFloat((parseFloat(fields[3]) - parseFloat(fields[2])).toFixed(2)),
        changePercent: parseFloat(((parseFloat(fields[3]) - parseFloat(fields[2])) / parseFloat(fields[2]) * 100).toFixed(2))
      };
    } catch (error) {
      console.error('Sina API Error:', error.message);
      return null;
    }
  }

  /**
      * 腾讯财经 API（已验证真实数据源）
   * 接口URL: https://qt.gtimg.cn/q=<code>
   * 格式: https://qt.gtimg.cn/q=sh600519
   */
  async getTencentQuote(code) {
    try {
      const url = `https://qt.gtimg.cn/q=${code}`;
      const response = await axios.get(url);
      
      const dataStr = response.data;
      const match = dataStr.match(/"([^"]+)"/);
      if (!match) return null;
      
      const fields = match[1].split('~');
      return {
        code,
        name: fields[1],
        current: parseFloat(fields[3]),
        close: parseFloat(fields[4]),
        open: parseFloat(fields[5]),
        volume: parseInt(fields[6]),
        high: parseFloat(fields[33]),
        low: parseFloat(fields[34]),
        change: parseFloat(fields[31]),
        changePercent: parseFloat(fields[32]),
        date: fields[30]
      };
    } catch (error) {
      console.error('Tencent API Error:', error.message);
      return null;
    }
  }

  /**
   * 批量获取股票数据
   * @param {string[]} codes - 股票代码数组
   */
  async getBatchQuotes(codes) {
    const promises = codes.map(code => this.getRealtimeQuote(code));
    const results = await Promise.all(promises);
    return results.filter(r => r !== null);
  }
}

module.exports = StockAPI;
