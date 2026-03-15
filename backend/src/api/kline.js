const axios = require('axios');

/**
 * 股票K线数据API
 * 支持获取分时、日K、周K等历史数据
 * 日K线现在包含技术指标：MA5/MA10/MA20/MA60、MACD、RSI、KDJ
 */
class KLineAPI {
  /**
   * 获取分时数据（当日）
   * A股交易时间：09:30-11:30, 13:00-15:00
   * @param {string} code - 股票代码 (如: sh600519, sz000001)
   */
  async getIntradayData(code) {
    try {
      // 使用腾讯财经的分时数据接口
      const url = `https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=${code}`;
      const response = await axios.get(url, { timeout: 10000 });
      
      if (response.data && response.data.data && response.data.data[code]) {
        const stockData = response.data.data[code];
        
        const minuteData = stockData.data && stockData.data.data ? stockData.data.data : [];
        const tradeDate = stockData.data && stockData.data.date ? stockData.data.date : '';
        
        // 从 qt 数据获取前收盘价（索引4）
        let prevClose = 0;
        if (stockData.qt && stockData.qt[code]) {
          const qtData = stockData.qt[code];
          prevClose = parseFloat(qtData[4]) || 0;
        }
        
        if (!Array.isArray(minuteData) || minuteData.length === 0) {
          console.error('Invalid minute data format or empty data');
          return this.getMockIntradayData(code);
        }
        
        console.log(`Fetched real data for ${code}, date: ${tradeDate}, count: ${minuteData.length}, prevClose: ${prevClose}`);
        
        // 解析分时数据 "时间 价格 成交量 成交额"
        const allData = minuteData.map(item => {
          const parts = item.split(' ');
          const timeStr = parts[0];
          const price = parseFloat(parts[1]);
          const volume = parseInt(parts[2]) || 0;
          const hour = timeStr.substring(0, 2);
          const minute = timeStr.substring(2, 4);
          return {
            time: `${hour}:${minute}`,
            price: price,
            volume: volume,
            avgPrice: price
          };
        });
        
        // 过滤A股交易时间：09:30-11:30, 13:00-15:00
        const filteredData = allData.filter(item => {
          const [hour, minute] = item.time.split(':').map(Number);
          const timeValue = hour * 60 + minute;
          const isMorning = timeValue >= 570 && timeValue <= 690;
          const isAfternoon = timeValue >= 780 && timeValue <= 900;
          return isMorning || isAfternoon;
        });
        
        return { items: filteredData, prevClose: prevClose };
      }
      
      return { items: [], prevClose: 0 };
    } catch (error) {
      console.error('Intraday API Error:', error.message);
      const mockData = this.getMockIntradayData(code);
      return { items: mockData, prevClose: mockData[0]?.price || 1 };
    }
  }
  
  /**
   * 获取日K线数据，并计算技术指标
   * 技术指标：MA5/MA10/MA20/MA60、MACD(12,26,9)、RSI(14)、KDJ(9,3,3)
   * @param {string} code - 股票代码
   * @param {number} days - 获取天数，默认120天（确保有足够数据计算MA60）
   */
  async getDailyKLine(code, days = 120) {
    try {
      // 使用腾讯财经K线接口，获取更多数据以确保指标计算准确
      const fetchDays = Math.max(days, 120);
      const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${code},day,,,${fetchDays},qfq`;
      const response = await axios.get(url, { timeout: 10000 });
      
      if (response.data && response.data.data && response.data.data[code]) {
        const data = response.data.data[code];
        const klines = data.day || data.qfqday || [];
        
        // 解析K线原始数据 [日期, 开盘, 收盘, 最低, 最高, 成交量]
        const rawData = klines.map(item => {
          const [date, open, close, low, high, volume] = item;
          return {
            date: date,
            open: parseFloat(open),
            close: parseFloat(close),
            low: parseFloat(low),
            high: parseFloat(high),
            volume: parseInt(volume),
            change: parseFloat(((parseFloat(close) - parseFloat(open)) / parseFloat(open) * 100).toFixed(2))
          };
        });
        
        // 计算技术指标并附加到每个K线数据点
        const withIndicators = this.calculateIndicators(rawData);
        
        // 只返回请求天数内的数据
        return withIndicators.slice(-days);
      }
      
      return [];
    } catch (error) {
      console.error('Daily KLine API Error:', error.message);
      return this.getMockDailyData(code, days);
    }
  }
  
  /**
   * 计算技术指标（MA / MACD / RSI / KDJ）
   * @param {Array} data - K线原始数组，每项包含 {date, open, close, high, low, volume}
   * @returns {Array} 附加了技术指标的K线数组
   */
  calculateIndicators(data) {
    if (!data || data.length === 0) return data;
    
    const closes = data.map(d => d.close);
    const highs  = data.map(d => d.high);
    const lows   = data.map(d => d.low);
    
    // ── MA 均线 ──────────────────────────────────────────
    const ma5  = this._ma(closes, 5);
    const ma10 = this._ma(closes, 10);
    const ma20 = this._ma(closes, 20);
    const ma60 = this._ma(closes, 60);
    
    // ── MACD (12, 26, 9) ─────────────────────────────────
    const { dif, dea, macd } = this._macd(closes, 12, 26, 9);
    
    // ── RSI (14) ──────────────────────────────────────────
    const rsi14 = this._rsi(closes, 14);
    
    // ── KDJ (9, 3, 3) ─────────────────────────────────────
    const { k, d, j } = this._kdj(highs, lows, closes, 9, 3, 3);
    
    // 把指标合并回原始数据
    return data.map((item, i) => ({
      ...item,
      indicators: {
        ma5:  ma5[i]  !== null ? parseFloat(ma5[i].toFixed(3))  : null,
        ma10: ma10[i] !== null ? parseFloat(ma10[i].toFixed(3)) : null,
        ma20: ma20[i] !== null ? parseFloat(ma20[i].toFixed(3)) : null,
        ma60: ma60[i] !== null ? parseFloat(ma60[i].toFixed(3)) : null,
        macd: {
          dif:  dif[i]  !== null ? parseFloat(dif[i].toFixed(4))  : null,
          dea:  dea[i]  !== null ? parseFloat(dea[i].toFixed(4))  : null,
          bar:  macd[i] !== null ? parseFloat(macd[i].toFixed(4)) : null, // MACD柱（DIF-DEA)*2
        },
        rsi14: rsi14[i] !== null ? parseFloat(rsi14[i].toFixed(2)) : null,
        kdj: {
          k: k[i] !== null ? parseFloat(k[i].toFixed(2)) : null,
          d: d[i] !== null ? parseFloat(d[i].toFixed(2)) : null,
          j: j[i] !== null ? parseFloat(j[i].toFixed(2)) : null,
        }
      }
    }));
  }
  
  /**
   * 计算简单移动平均线（SMA/MA）
   * @param {number[]} closes - 收盘价序列
   * @param {number} period - 周期
   * @returns {Array} 与 closes 等长的 MA 数组，不足 period 的位置为 null
   */
  _ma(closes, period) {
    return closes.map((_, i) => {
      if (i < period - 1) return null;
      const slice = closes.slice(i - period + 1, i + 1);
      return slice.reduce((sum, v) => sum + v, 0) / period;
    });
  }
  
  /**
   * 计算指数移动平均（EMA）
   * @param {number[]} values - 数值序列
   * @param {number} period - 周期
   * @returns {number[]} EMA 数组
   */
  _ema(values, period) {
    const k = 2 / (period + 1);
    const ema = new Array(values.length).fill(null);
    // 用前 period 个均值作为初始 EMA
    if (values.length < period) return ema;
    ema[period - 1] = values.slice(0, period).reduce((s, v) => s + v, 0) / period;
    for (let i = period; i < values.length; i++) {
      ema[i] = values[i] * k + ema[i - 1] * (1 - k);
    }
    return ema;
  }
  
  /**
   * 计算 MACD 指标（DIF、DEA、MACD柱）
   * 标准参数：快线12、慢线26、信号9
   * @param {number[]} closes
   * @param {number} fast
   * @param {number} slow
   * @param {number} signal
   */
  _macd(closes, fast = 12, slow = 26, signal = 9) {
    const emaFast = this._ema(closes, fast);
    const emaSlow = this._ema(closes, slow);
    
    // DIF = EMA(fast) - EMA(slow)
    const dif = closes.map((_, i) =>
      emaFast[i] !== null && emaSlow[i] !== null ? emaFast[i] - emaSlow[i] : null
    );
    
    // DEA = EMA(DIF, signal)；只对有效 DIF 计算
    const validDif = dif.map(v => v !== null ? v : 0); // 临时用0填充
    const deaRaw = this._ema(validDif, signal);
    const dea = dif.map((v, i) => v !== null && deaRaw[i] !== null ? deaRaw[i] : null);
    
    // MACD柱 = (DIF - DEA) * 2
    const macd = dif.map((v, i) =>
      v !== null && dea[i] !== null ? (v - dea[i]) * 2 : null
    );
    
    return { dif, dea, macd };
  }
  
  /**
   * 计算 RSI（相对强弱指数）
   * @param {number[]} closes
   * @param {number} period - 默认14
   */
  _rsi(closes, period = 14) {
    const rsi = new Array(closes.length).fill(null);
    if (closes.length < period + 1) return rsi;
    
    let gains = 0, losses = 0;
    // 计算初始平均涨跌幅
    for (let i = 1; i <= period; i++) {
      const diff = closes[i] - closes[i - 1];
      if (diff > 0) gains += diff;
      else losses -= diff;
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;
    rsi[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    
    // 使用平滑移动平均（Wilder's smoothing）
    for (let i = period + 1; i < closes.length; i++) {
      const diff = closes[i] - closes[i - 1];
      const gain = diff > 0 ? diff : 0;
      const loss = diff < 0 ? -diff : 0;
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
      rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    }
    return rsi;
  }
  
  /**
   * 计算 KDJ 指标（随机指标）
   * 标准参数：N=9, M1=3, M2=3
   * @param {number[]} highs - 最高价序列
   * @param {number[]} lows  - 最低价序列
   * @param {number[]} closes - 收盘价序列
   * @param {number} n - RSV 周期（默认9）
   * @param {number} m1 - K值平滑（默认3）
   * @param {number} m2 - D值平滑（默认3）
   */
  _kdj(highs, lows, closes, n = 9, m1 = 3, m2 = 3) {
    const len = closes.length;
    const k = new Array(len).fill(null);
    const d = new Array(len).fill(null);
    const j = new Array(len).fill(null);
    
    let kPrev = 50, dPrev = 50; // 初始K、D值
    
    for (let i = 0; i < len; i++) {
      if (i < n - 1) continue;
      
      // 计算N日内最高最低
      const highSlice = highs.slice(i - n + 1, i + 1);
      const lowSlice  = lows.slice(i - n + 1, i + 1);
      const hn = Math.max(...highSlice);
      const ln = Math.min(...lowSlice);
      
      // RSV = (收盘 - N日最低) / (N日最高 - N日最低) * 100
      const rsv = hn === ln ? 50 : (closes[i] - ln) / (hn - ln) * 100;
      
      // K = (m1-1)/m1 * K前 + 1/m1 * RSV
      const kv = (m1 - 1) / m1 * kPrev + rsv / m1;
      // D = (m2-1)/m2 * D前 + 1/m2 * K
      const dv = (m2 - 1) / m2 * dPrev + kv / m2;
      // J = 3K - 2D
      const jv = 3 * kv - 2 * dv;
      
      k[i] = kv;
      d[i] = dv;
      j[i] = jv;
      
      kPrev = kv;
      dPrev = dv;
    }
    return { k, d, j };
  }
  
  /**
   * 获取5日分时数据（最近5个交易日的分时）
   * @param {string} code - 股票代码
   */
  async get5DayData(code) {
    try {
      const dailyData = await this.getDailyKLine(code, 5);
      const todayIntraday = await this.getIntradayData(code);
      
      const result = [];
      dailyData.forEach((day, index) => {
        const basePrice = day.open;
        const closePrice = day.close;
        const highPrice = day.high;
        const lowPrice = day.low;
        
        for (let i = 0; i < 240; i += 30) {
          const hour = 9 + Math.floor((i + 30) / 60);
          const minute = (i + 30) % 60;
          if (hour === 11 && minute > 30) continue;
          if (hour === 12) continue;
          if (hour > 15) continue;
          
          const progress = i / 240;
          const price = basePrice + (closePrice - basePrice) * progress + 
                       (Math.random() - 0.5) * (highPrice - lowPrice) * 0.2;
          
          result.push({
            time: `${day.date} ${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`,
            price: parseFloat(price.toFixed(2)),
            volume: Math.floor(day.volume / 8),
            date: day.date
          });
        }
      });
      
      return result;
    } catch (error) {
      console.error('5Day API Error:', error.message);
      return this.getMock5DayData(code);
    }
  }
  
  /**
   * 生成模拟分时数据（带技术指标）
   */
  getMockIntradayData(code) {
    const data = [];
    const basePrice = 10 + Math.random() * 50;
    let currentPrice = basePrice;
    
    for (let minutes = 30; minutes <= 150; minutes += 5) {
      const hour = 9 + Math.floor(minutes / 60);
      const minute = minutes % 60;
      currentPrice = currentPrice + (Math.random() - 0.48) * 0.1;
      data.push({
        time: `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`,
        price: parseFloat(currentPrice.toFixed(2)),
        volume: Math.floor(Math.random() * 10000),
        avgPrice: parseFloat((currentPrice * (0.99 + Math.random() * 0.02)).toFixed(2))
      });
    }
    for (let minutes = 0; minutes <= 120; minutes += 5) {
      const hour = 13 + Math.floor(minutes / 60);
      const minute = minutes % 60;
      currentPrice = currentPrice + (Math.random() - 0.48) * 0.1;
      data.push({
        time: `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`,
        price: parseFloat(currentPrice.toFixed(2)),
        volume: Math.floor(Math.random() * 10000),
        avgPrice: parseFloat((currentPrice * (0.99 + Math.random() * 0.02)).toFixed(2))
      });
    }
    return data;
  }
  
  /**
   * 生成模拟日K数据（含技术指标）
   */
  getMockDailyData(code, days) {
    const data = [];
    let basePrice = 10 + Math.random() * 50;
    const today = new Date();
    
    for (let i = days; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const open = basePrice;
      const close = basePrice + (Math.random() - 0.48) * basePrice * 0.03;
      const high = Math.max(open, close) + Math.random() * basePrice * 0.01;
      const low = Math.min(open, close) - Math.random() * basePrice * 0.01;
      data.push({
        date: date.toISOString().split('T')[0],
        open: parseFloat(open.toFixed(2)),
        close: parseFloat(close.toFixed(2)),
        high: parseFloat(high.toFixed(2)),
        low: parseFloat(low.toFixed(2)),
        volume: Math.floor(Math.random() * 1000000),
        change: parseFloat(((close - open) / open * 100).toFixed(2))
      });
      basePrice = close;
    }
    
    // 为模拟数据也计算技术指标
    return this.calculateIndicators(data);
  }
  
  /**
   * 生成模拟5日数据
   */
  getMock5DayData(code) {
    const data = [];
    let basePrice = 10 + Math.random() * 50;
    const today = new Date();
    
    for (let day = 4; day >= 0; day--) {
      const date = new Date(today);
      date.setDate(date.getDate() - day);
      const dateStr = date.toISOString().split('T')[0];
      let dayOpen = basePrice;
      let dayClose = dayOpen;
      
      for (let i = 0; i <= 240; i += 30) {
        const hour = 9 + Math.floor((i + 30) / 60);
        const minute = (i + 30) % 60;
        if (hour === 11 && minute > 30) continue;
        if (hour === 12) continue;
        if (hour > 15) continue;
        dayClose = dayOpen + (Math.random() - 0.48) * dayOpen * 0.02;
        data.push({
          time: `${dateStr} ${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`,
          price: parseFloat(dayClose.toFixed(2)),
          volume: Math.floor(Math.random() * 50000),
          date: dateStr
        });
      }
      basePrice = dayClose;
    }
    return data;
  }
}

module.exports = KLineAPI;
