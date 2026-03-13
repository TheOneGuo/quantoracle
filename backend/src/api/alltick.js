const axios = require('axios');
const WebSocket = require('ws');

/**
 * AllTick 股票数据 API 封装
 * 官网: https://alltick.co/
 * 免费版: 10个演示股票，每分钟10次调用
 */
class AllTickAPI {
  constructor(token = 'demo') {
    this.token = token;
    this.baseURL = 'https://quote.alltick.io/quote-b-api';
    this.wsURL = 'wss://quote.alltick.io/quote-b-ws-api';
    this.ws = null;
    this.subscribers = new Map();
  }

  /**
   * 获取实时股票数据 (HTTP 方式)
   * @param {string} code - 股票代码 (如: 600519.SH, 000001.SZ)
   */
  async getRealtimeQuote(code) {
    try {
      // AllTick 使用格式: 股票代码.交易所
      const formattedCode = this.formatCode(code);
      
      const url = `${this.baseURL}/tick?token=${this.token}&query=${encodeURIComponent(JSON.stringify({
        data: {
          code: formattedCode
        }
      }))}`;
      
      const response = await axios.get(url, {
        timeout: 5000
      });
      
      if (response.data && response.data.data) {
        return this.parseTickData(response.data.data, code);
      }
      
      return null;
    } catch (error) {
      console.error('AllTick API Error:', error.message);
      return null;
    }
  }

  /**
   * 批量获取股票数据
   */
  async getBatchQuotes(codes) {
    // AllTick 免费版限制，串行请求
    const results = [];
    for (const code of codes) {
      const data = await this.getRealtimeQuote(code);
      if (data) results.push(data);
      // 避免频率限制，延迟100ms
      await new Promise(r => setTimeout(r, 100));
    }
    return results;
  }

  /**
   * 转换股票代码格式
   * sh600519 -> 600519.SH
   * sz000001 -> 000001.SZ
   */
  formatCode(code) {
    if (code.startsWith('sh')) {
      return code.replace('sh', '') + '.SH';
    } else if (code.startsWith('sz')) {
      return code.replace('sz', '') + '.SZ';
    } else if (code.startsWith('bj')) {
      return code.replace('bj', '') + '.BJ';
    }
    return code;
  }

  /**
   * 解析 Tick 数据
   */
  parseTickData(data, originalCode) {
    // AllTick 返回的数据格式
    const tick = data.tick || data;
    
    return {
      code: originalCode,
      name: tick.name || tick.symbol || originalCode,
      current: parseFloat(tick.close || tick.price || 0),
      open: parseFloat(tick.open || 0),
      high: parseFloat(tick.high || 0),
      low: parseFloat(tick.low || 0),
      close: parseFloat(tick.pre_close || tick.close || 0), // 昨收
      volume: parseInt(tick.volume || tick.vol || 0),
      amount: parseFloat(tick.amount || 0),
      change: parseFloat(tick.change || 0),
      changePercent: parseFloat(tick.change_percent || tick.percent || 0),
      time: tick.time || new Date().toISOString(),
      // 买卖五档
      bid1: parseFloat(tick.bid1 || tick.bp1 || 0),
      ask1: parseFloat(tick.ask1 || tick.ap1 || 0),
      bidVol1: parseInt(tick.bv1 || 0),
      askVol1: parseInt(tick.av1 || 0)
    };
  }

  /**
   * 连接 WebSocket 实时推送
   */
  connectWebSocket() {
    if (this.ws) return;
    
    this.ws = new WebSocket(`${this.wsURL}?token=${this.token}`);
    
    this.ws.on('open', () => {
      console.log('AllTick WebSocket connected');
      // 重新订阅之前的股票
      this.subscribers.forEach((callback, code) => {
        this.subscribe(code);
      });
    });
    
    this.ws.on('message', (data) => {
      try {
        const message = JSON.parse(data);
        if (message.data && message.data.code) {
          const code = this.reverseFormatCode(message.data.code);
          const callback = this.subscribers.get(code);
          if (callback) {
            callback(this.parseTickData(message.data, code));
          }
        }
      } catch (e) {
        console.error('WebSocket message error:', e);
      }
    });
    
    this.ws.on('error', (error) => {
      console.error('WebSocket error:', error);
    });
    
    this.ws.on('close', () => {
      console.log('WebSocket disconnected, reconnecting...');
      this.ws = null;
      setTimeout(() => this.connectWebSocket(), 5000);
    });
  }

  /**
   * 订阅股票实时数据
   */
  subscribe(code) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.connectWebSocket();
      return;
    }
    
    const formattedCode = this.formatCode(code);
    this.ws.send(JSON.stringify({
      cmd: 'subscribe',
      data: {
        code: formattedCode
      }
    }));
  }

  /**
   * 添加订阅回调
   */
  onTick(code, callback) {
    this.subscribers.set(code, callback);
    this.subscribe(code);
  }

  /**
   * 反向转换代码格式
   */
  reverseFormatCode(code) {
    if (code.endsWith('.SH')) {
      return 'sh' + code.replace('.SH', '');
    } else if (code.endsWith('.SZ')) {
      return 'sz' + code.replace('.SZ', '');
    } else if (code.endsWith('.BJ')) {
      return 'bj' + code.replace('.BJ', '');
    }
    return code;
  }
}

module.exports = AllTickAPI;
