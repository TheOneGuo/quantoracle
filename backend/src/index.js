/**
 * @file index.js
 * @description QuantOracle 后端主入口。注册所有 Express 路由、WebSocket 升级处理及定时任务。
 * @module server
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const StockAPI = require('./api/stock');
const watchlistRoutes = require('./watchlist-routes');
const KLineAPI = require('./api/kline');
const TradingRules = require('./rules/trading');
const AlertSystem = require('./alerts');
const FeishuNotifier = require('./notifiers/feishu');
const Database = require('./db');
const SmartAnalyzer = require('./analyzer/smart');

/** 单用户模式下统一使用的用户ID，避免硬编码散落在各路由 */
const DEFAULT_USER_ID = 'default-user';

const app = express();
const stockAPI = new StockAPI(process.env.STOCK_API_PROVIDER || 'sina');
const klineAPI = new KLineAPI();
const alertSystem = new AlertSystem();
const feishu = new FeishuNotifier();
const db = new Database();
app.locals.db = db.db; // 将原始 SQLite db 实例挂到 app.locals，供 broker-routes 使用

app.use(cors());
app.use(express.json());

// M6：初始化认证中间件
const createAuthMiddleware = require('./auth/auth-middleware');
const AuthService = require('./auth/auth-service');
const { authRequired, authOptional, authService } = createAuthMiddleware(db);

// 自选股 & A股筛选路由
watchlistRoutes(app, db, stockAPI);

// =============================================
// M6：JWT 认证路由
// =============================================

/**
 * 用户注册
 * @route POST /api/auth/register
 * @body {string} username - 用户名（3-20字符）
 * @body {string} password - 密码（至少6字符）
 */
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    const result = await authService.register(username, password);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * 用户登录
 * @route POST /api/auth/login
 * @body {string} username
 * @body {string} password
 * @returns {{ token: string, user: Object }}
 */
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const result = await authService.login(username, password);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(401).json({ success: false, error: err.message });
  }
});

/**
 * 获取当前用户信息（需要认证）
 * @route GET /api/auth/me
 */
app.get('/api/auth/me', authRequired, async (req, res) => {
  try {
    const user = await authService.getUserById(req.user.id);
    if (!user) return res.status(404).json({ success: false, error: '用户不存在' });
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 登出（前端清除 token 即可，后端返回成功）
 * @route POST /api/auth/logout
 */
app.post('/api/auth/logout', (req, res) => {
  res.json({ success: true, message: '已登出，请在前端清除 token' });
});

// 实盘对接路由（M5）- 需要认证
const brokerRoutes = require('./broker/broker-routes');
app.use('/api/broker', authRequired, brokerRoutes);

// 视频OCR实盘数据识别路由（一期：同花顺/东方财富）
const brokerVideoRoutes = require('./broker/broker-video-routes');
app.use('/api/broker', authRequired, brokerVideoRoutes);

/**
 * 计算持仓汇总信息
 */
function calculateHoldingSummary(holding) {
  const trades = holding.trades || [];
  // 只计算买入交易
  const buyTrades = trades.filter(t => t.type === 'buy');
  const sellTrades = trades.filter(t => t.type === 'sell');
  
  const totalBuyCost = buyTrades.reduce((sum, t) => sum + (t.buyPrice || 0) * t.quantity, 0);
  const totalBuyQty = buyTrades.reduce((sum, t) => sum + t.quantity, 0);
  const totalSellQty = sellTrades.reduce((sum, t) => sum + t.quantity, 0);
  
  // 当前持仓数量
  const currentQty = totalBuyQty - totalSellQty;
  
  // 平均成本 = 总买入成本 / 总买入数量
  const avgCost = totalBuyQty > 0 ? totalBuyCost / totalBuyQty : 0;
  
  // 当前持仓成本 = 平均成本 × 当前持仓数量
  const currentCost = avgCost * currentQty;
  
  return { totalCost: currentCost, totalQty: currentQty, avgCost };
}

/**
 * 运行交易规则检查
 */
async function runTradingRules(holding, stockData) {
  const summary = calculateHoldingSummary(holding);
  
  // 模拟均线数据
  const ma = {
    ma5: stockData.current * 0.98,
    ma10: stockData.current * 0.95,
    ma20: stockData.current * 0.92
  };
  
  const analysis = TradingRules.analyze(stockData, summary.avgCost, ma);
  
  // 如果有交易信号，记录预警并发送通知
  if (analysis.action !== 'HOLD') {
    const alert = {
      code: holding.code,
      stock: stockData.name || holding.name,  // 使用实时数据中的股票名称
      action: analysis.action,
      actionDesc: analysis.actionDesc,
      reason: analysis.reason,
      currentPrice: stockData.current,
      avgCost: summary.avgCost,
      changePercent: analysis.changePercent
    };
    
    // 记录到数据库
    await db.addAlert(alert);
    
    // 发送飞书通知（传入db用于检查重复）
    await feishu.sendAlert({
      stock: holding.name,
      ...alert
    }, db);
  }
  
  return analysis;
}

/**
 * 获取股票实时数据
 */
app.get('/api/stock/:code', async (req, res) => {
  try {
    const { code } = req.params;
    // 已验证真实数据源：调用新浪财经/腾讯财经实时行情接口
    // 默认使用新浪财经: https://hq.sinajs.cn/list=<code>
    const data = await stockAPI.getRealtimeQuote(code);
    if (data) {
      res.json({ success: true, data });
    } else {
      res.status(404).json({ success: false, error: 'Stock not found' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * 批量获取股票数据
 */
app.post('/api/stocks/batch', async (req, res) => {
  try {
    const { codes } = req.body;
    const data = await stockAPI.getBatchQuotes(codes);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * 添加持仓（支持多次买入）
 * 提交后立即运行交易规则
 */
app.post('/api/holdings', authOptional, async (req, res) => {
  try {
    const { code, name, trades } = req.body;
    const userId = req.user ? req.user.id : DEFAULT_USER_ID;
    
    // 保存到数据库
    await db.addHolding(code, name, userId);
    
    for (const trade of trades) {
      await db.addTrade(code, trade.buyPrice, trade.quantity, trade.buyDate, userId);
    }
    
    // 获取最新持仓数据
    const holdings = await db.getHoldings(userId);
    const holding = holdings.find(h => h.code === code);
    
    // 获取实时股价
    const stockData = await stockAPI.getRealtimeQuote(code);
    
    // 立即运行交易规则检查
    let analysis = null;
    if (holding && stockData) {
      analysis = await runTradingRules(holding, stockData);
    }
    
    res.json({ 
      success: true, 
      message: 'Holding added',
      analysis: analysis
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * 为已有持仓添加交易记录（买入/卖出）
 * 提交后立即运行交易规则
 */
app.post('/api/holdings/:code/trades', authOptional, async (req, res) => {
  try {
    const { code } = req.params;
    const { buyPrice, sellPrice, quantity, buyDate, sellDate, type } = req.body;
    const userId = req.user ? req.user.id : DEFAULT_USER_ID;
    
    // 判断是买入还是卖出
    if (type === 'sell' && sellPrice) {
      await db.addSellTrade(code, sellPrice, quantity, sellDate, userId);
    } else {
      await db.addTrade(code, buyPrice, quantity, buyDate, userId);
    }
    
    // 获取最新持仓数据
    const holdings = await db.getHoldings(userId);
    const holding = holdings.find(h => h.code === code);
    
    // 获取实时股价
    const stockData = await stockAPI.getRealtimeQuote(code);
    
    // 立即运行交易规则检查
    let analysis = null;
    if (holding && stockData) {
      analysis = await runTradingRules(holding, stockData);
    }
    
    res.json({ 
      success: true, 
      message: type === 'sell' ? 'Sell trade added' : 'Trade added',
      analysis: analysis
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * 删除持仓
 */
app.delete('/api/holdings/:code', authOptional, async (req, res) => {
  try {
    const { code } = req.params;
    const userId = req.user ? req.user.id : DEFAULT_USER_ID;
    await db.deleteHolding(code, userId);
    res.json({ success: true, message: 'Holding deleted' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * 删除单条交易记录
 */
app.delete('/api/trades/:tradeId', async (req, res) => {
  try {
    const { tradeId } = req.params;
    await db.deleteTrade(parseInt(tradeId));
    res.json({ success: true, message: 'Trade deleted' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * 获取持仓列表及分析
 */
app.get('/api/holdings', authOptional, async (req, res) => {
  try {
    const userId = req.user ? req.user.id : DEFAULT_USER_ID;
    // 从数据库获取持仓
    const holdings = await db.getHoldings(userId);
    const codes = holdings.map(h => h.code);
    
    // 获取实时数据
    const stockData = await stockAPI.getBatchQuotes(codes);
    
    // 分析每只持仓股票
    const analysis = await Promise.all(
      holdings.map(async holding => {
        const stock = stockData.find(s => s.code === holding.code);
        if (!stock) return null;
        
        // 运行交易规则
        const result = await runTradingRules(holding, stock);
        
        return {
          ...holding,
          currentData: stock,
          analysis: result
        };
      })
    );
    
    res.json({ success: true, data: analysis.filter(Boolean) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * 获取预警历史
 */
app.get('/api/alerts', async (req, res) => {
  try {
    const alerts = await db.getRecentAlerts();
    res.json({ success: true, data: alerts });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * 分析单只股票
 */
app.post('/api/analyze', async (req, res) => {
  try {
    const { code, buyPrice } = req.body;
    const stock = await stockAPI.getRealtimeQuote(code);

    if (!stock) {
      return res.status(404).json({ success: false, error: 'Stock not found' });
    }

    // 模拟均线数据
    const ma = {
      ma5: stock.current * 0.98,
      ma10: stock.current * 0.95,
      ma20: stock.current * 0.92
    };

    const analysis = TradingRules.analyze(stock, buyPrice, ma);

    res.json({
      success: true,
      data: { stock, analysis }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * 智能分析 - 对标 daily_stock_analysis 的决策仪表盘
 */
app.post('/api/smart-analyze', async (req, res) => {
  try {
    const { code } = req.body;

    // 获取股票实时数据
    const stockData = await stockAPI.getRealtimeQuote(code);
    if (!stockData) {
      return res.status(404).json({ success: false, error: 'Stock not found' });
    }

    // 检查是否有持仓
    const holdings = await db.getHoldings();
    const holding = holdings.find(h => h.code === code);

    // 运行智能分析
    const analysis = SmartAnalyzer.analyze(stockData, holding);

    res.json({
      success: true,
      data: analysis
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * 批量智能分析所有持仓
 */
app.get('/api/smart-analyze/holdings', async (req, res) => {
  try {
    // 获取所有持仓
    const holdings = await db.getHoldings();

    if (holdings.length === 0) {
      return res.json({ success: true, data: [] });
    }

    // 获取实时数据
    const codes = holdings.map(h => h.code);
    const stockDataList = await stockAPI.getBatchQuotes(codes);

    // 分析每只股票
    const results = holdings.map(holding => {
      const stockData = stockDataList.find(s => s.code === holding.code);
      if (!stockData) return null;

      return SmartAnalyzer.analyze(stockData, holding);
    }).filter(Boolean);

    res.json({
      success: true,
      data: results
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * ========== 翻倍推荐股票相关API ==========
 */

/**
 * 保存翻倍推荐股票列表（AI分析结果）
 */
app.post('/api/doubling-recommendations', async (req, res) => {
  try {
    const { stocks, modelId } = req.body;
    
    if (!stocks || !Array.isArray(stocks)) {
      return res.status(400).json({ success: false, error: 'Invalid stocks data' });
    }

    // 先清空旧的推荐
    await db.clearDoublingRecommendations();

    // 保存新的推荐
    const results = [];
    for (const stock of stocks) {
      const result = await db.addDoublingRecommendation({
        ...stock,
        modelId: modelId || 'unknown'
      });
      results.push(result);
    }

    res.json({
      success: true,
      data: { saved: results.length }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * 获取翻倍推荐股票列表
 */
app.get('/api/doubling-recommendations', async (req, res) => {
  try {
    const recommendations = await db.getDoublingRecommendations();
    res.json({
      success: true,
      data: recommendations
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * 删除单条翻倍推荐
 */
app.delete('/api/doubling-recommendations/:code', async (req, res) => {
  try {
    const { code } = req.params;
    const result = await db.deleteDoublingRecommendation(code);
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * ========== 意向分析股票相关API ==========
 */

/**
 * 添加意向分析股票
 */
app.post('/api/analysis-stocks', async (req, res) => {
  try {
    const stock = req.body;
    
    if (!stock.code || !stock.name) {
      return res.status(400).json({ success: false, error: 'Code and name are required' });
    }

    const result = await db.addAnalysisStock(stock);
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * 获取意向分析股票列表
 */
app.get('/api/analysis-stocks', async (req, res) => {
  try {
    const stocks = await db.getAnalysisStocks();
    res.json({
      success: true,
      data: stocks
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * 删除意向分析股票
 */
app.delete('/api/analysis-stocks/:code', async (req, res) => {
  try {
    const { code } = req.params;
    const result = await db.deleteAnalysisStock(code);
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * 获取股票K线数据
 * @param type: intraday(分时), 5day(五日), daily(日K)
 */
app.get('/api/kline/:code', async (req, res) => {
  try {
    const { code } = req.params;
    const { type = 'intraday' } = req.query;

    let result;
    switch (type) {
      case 'intraday':
        result = await klineAPI.getIntradayData(code);
        break;
      case '5day':
        result = await klineAPI.get5DayData(code);
        break;
      case 'daily':
        result = await klineAPI.getDailyKLine(code, 60);
        break;
      default:
        return res.status(400).json({ success: false, error: 'Invalid type' });
    }

    // 处理不同的返回格式
    let items, prevClose;
    if (type === 'intraday' && result.items) {
      items = result.items;
      prevClose = result.prevClose;
    } else {
      items = result;
      prevClose = 0;
    }

    res.json({
      success: true,
      data: {
        code,
        type,
        items: items,
        prevClose: prevClose
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * 获取股票基本面数据（PE/PB/ROE/净利润等）
 * 通过东方财富/新浪接口获取真实财务数据
 * @route GET /api/fundamental/:code
 */
app.get('/api/fundamental/:code', async (req, res) => {
  try {
    const { code } = req.params;
    
    // 提取纯数字代码（去掉 sh/sz 前缀），用于东方财富接口
    const pureCode = code.replace(/^(sh|sz)/i, '');
    const market = code.startsWith('sh') ? '1' : '0'; // 东方财富：1=上交所,0=深交所
    
    // 东方财富个股基本信息接口（包含PE/PB/总市值等）
    const infoUrl = `https://push2.eastmoney.com/api/qt/stock/get?secid=${market}.${pureCode}&fields=f57,f58,f162,f167,f173,f182,f183,f9,f115,f114`;
    
    const resp = await axios.get(infoUrl, {
      timeout: 8000,
      headers: { 'Referer': 'https://quote.eastmoney.com/' }
    });
    
    const d = resp.data && resp.data.data;
    if (d) {
      // 字段说明：f162=PE(动态), f167=PB, f173=ROE, f9=涨跌幅
      // f114=总市值(元), f115=流通市值
      const fundamental = {
        code: code,
        name: d.f58 || '',
        // PE 和 PB（东方财富返回值已是小数，除以100得到百分比）
        pe_dynamic: d.f162 !== '-' && d.f162 ? parseFloat((d.f162 / 100).toFixed(2)) : null,
        pb: d.f167 !== '-' && d.f167 ? parseFloat((d.f167 / 100).toFixed(2)) : null,
        // ROE（净资产收益率）
        roe: d.f173 !== '-' && d.f173 ? parseFloat((d.f173 / 100).toFixed(2)) : null,
        // 市值（亿元）
        total_market_cap: d.f114 ? parseFloat((d.f114 / 1e8).toFixed(2)) : null,
        circulating_market_cap: d.f115 ? parseFloat((d.f115 / 1e8).toFixed(2)) : null,
        // 股息率
        dividend_yield: d.f183 !== '-' && d.f183 ? parseFloat((d.f183 / 100).toFixed(2)) : null,
        // 净利润同比增长
        net_profit_yoy: d.f182 !== '-' && d.f182 ? parseFloat((d.f182 / 100).toFixed(2)) : null,
        source: '东方财富',
        timestamp: new Date().toISOString()
      };
      return res.json({ success: true, data: fundamental });
    }
    
    // 若东方财富接口无数据，返回基础信息提示
    res.json({ success: false, error: '暂无基本面数据' });
  } catch (error) {
    console.error('[/api/fundamental]', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * 获取个股资金流向数据
 * 通过东方财富接口获取主力/超大单/大单/中单/小单资金流向
 * @route GET /api/capital-flow/:code
 */
app.get('/api/capital-flow/:code', async (req, res) => {
  try {
    const { code } = req.params;
    const { days = 5 } = req.query; // 获取最近N天的数据
    
    const pureCode = code.replace(/^(sh|sz)/i, '');
    const market = code.startsWith('sh') ? '1' : '0';
    
    // 东方财富个股资金流向接口
    // lmt=10 最多返回10天，klt=101=日线
    const url = `https://push2his.eastmoney.com/api/qt/stock/fflow/daykline/get?lmt=${days}&klt=101&secid=${market}.${pureCode}&fields1=f1,f2,f3,f7&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63,f64,f65`;
    
    const resp = await axios.get(url, {
      timeout: 8000,
      headers: { 'Referer': 'https://quote.eastmoney.com/' }
    });
    
    const rawData = resp.data && resp.data.data && resp.data.data.klines;
    
    if (rawData && rawData.length > 0) {
      // 字段顺序：日期,主力净额,超大单净额,大单净额,中单净额,小单净额,
      //           主力净比,超大单净比,大单净比,中单净比,小单净比
      const items = rawData.map(line => {
        const f = line.split(',');
        return {
          date: f[0],
          // 净额（万元）
          main_net:       parseFloat(f[1]) || 0,  // 主力净流入
          super_large_net: parseFloat(f[2]) || 0,  // 超大单
          large_net:      parseFloat(f[3]) || 0,  // 大单
          mid_net:        parseFloat(f[4]) || 0,  // 中单
          small_net:      parseFloat(f[5]) || 0,  // 小单
          // 净比（%）
          main_pct:       parseFloat(f[6]) || 0,
          super_large_pct: parseFloat(f[7]) || 0,
          large_pct:      parseFloat(f[8]) || 0,
          mid_pct:        parseFloat(f[9]) || 0,
          small_pct:      parseFloat(f[10]) || 0,
        };
      });
      
      // 汇总最新一天
      const latest = items[items.length - 1] || {};
      const summary = {
        main_net_total: items.reduce((s, d) => s + d.main_net, 0),
        main_trend: latest.main_net > 0 ? '净流入' : '净流出',
        latest_date: latest.date || ''
      };
      
      return res.json({ success: true, data: { code, items, summary, source: '东方财富' } });
    }
    
    // 兜底：返回空数据提示
    res.json({ success: true, data: { code, items: [], summary: {}, source: '东方财富', note: '暂无资金流向数据' } });
  } catch (error) {
    console.error('[/api/capital-flow]', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * 获取个股筹码分布数据（真实价位分布）
 * 优先调用 AkShare Python 微服务（:8767/cyq），获取真实价位筹码占比
 * 若 AkShare 接口超时（>5s），降级为东方财富汇总数据并标注 is_simulated: true
 * @route GET /api/chip-distribution/:code
 */
app.get('/api/chip-distribution/:code', async (req, res) => {
  const { code } = req.params;
  const pureCode = code.replace(/^(sh|sz)/i, '');
  const adjust = req.query.adjust || 'hfq';

  // 1. 优先调用 AkShare Python 微服务获取真实价位筹码分布
  try {
    const akUrl = `${NEWS_SERVICE_URL}/cyq?code=${pureCode}&adjust=${adjust}`;
    const akResp = await axios.get(akUrl, { timeout: 5000 });
    if (akResp.data && akResp.data.success && akResp.data.data && akResp.data.data.length > 0) {
      return res.json({
        success: true,
        data: {
          code,
          distribution: akResp.data.data,  // [{price, percent, profit}, ...]
          source: 'AkShare stock_cyq_em',
          is_simulated: false,
          timestamp: new Date().toISOString()
        }
      });
    }
  } catch (akErr) {
    console.warn('[/api/chip-distribution] AkShare 超时或失败，降级到东方财富:', akErr.message);
  }

  // 2. 降级：调用东方财富汇总数据（仅含平均成本/获利比例等汇总指标）
  try {
    const market = code.startsWith('sh') ? '1' : '0';
    const url = `https://push2.eastmoney.com/api/qt/stock/cyq/get?secid=${market}.${pureCode}&fields=f61,f62,f63,f64,f65`;
    
    const resp = await axios.get(url, {
      timeout: 8000,
      headers: { 'Referer': 'https://quote.eastmoney.com/' }
    });
    
    const d = resp.data && resp.data.data;
    if (d) {
      // f61=获利比例, f62=平均成本, f63=90%集中度, f64=主力成本, f65=散户成本
      const chipData = {
        code: code,
        // 获利盘比例（%），即当前价格以下的筹码占比
        profit_ratio: d.f61 !== null && d.f61 !== undefined ? parseFloat((d.f61 / 100).toFixed(2)) : null,
        // 平均持仓成本（元）
        avg_cost: d.f62 !== null && d.f62 !== undefined ? parseFloat((d.f62 / 100).toFixed(2)) : null,
        // 90%筹码集中区间（元）
        concentration_90: d.f63 !== null && d.f63 !== undefined ? parseFloat((d.f63 / 100).toFixed(2)) : null,
        // 主力成本
        main_cost: d.f64 !== null && d.f64 !== undefined ? parseFloat((d.f64 / 100).toFixed(2)) : null,
        // 散户成本
        retail_cost: d.f65 !== null && d.f65 !== undefined ? parseFloat((d.f65 / 100).toFixed(2)) : null,
        source: '东方财富（汇总）',
        is_simulated: true,  // 无真实价位分布，仅有汇总指标
        timestamp: new Date().toISOString()
      };
      return res.json({ success: true, data: chipData });
    }
    
    res.json({ success: false, error: '暂无筹码分布数据' });
  } catch (error) {
    console.error('[/api/chip-distribution]', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 启动服务器（支持 WebSocket）
const PORT = process.env.PORT || 3001;
const http = require('http');
const { WebSocketServer } = require('ws');

const server = http.createServer(app);

/**
 * WebSocket 服务器（M5：实盘信号推送）
 * 客户端连接后，策略信号触发时会实时推送 signal 事件。
 */
const wss = new WebSocketServer({ server, path: '/ws' });

/** 广播消息给所有已连接的客户端 */
function broadcast(data) {
  const json = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === 1) { // WebSocket.OPEN
      client.send(json);
    }
  });
}

wss.on('connection', (ws, req) => {
  console.log('[WS] 客户端连接:', req.socket.remoteAddress);
  ws.send(JSON.stringify({ type: 'connected', message: '实盘信号推送已就绪', timestamp: new Date().toISOString() }));

  ws.on('close', () => {
    console.log('[WS] 客户端断开');
  });
});

// 将 broadcast 挂在 app 上，供其他模块使用
app.broadcast = broadcast;
// 挂到 global，让 news-paradigm-analyzer 等服务层也能推送
global.wsBroadcast = broadcast;

server.listen(PORT, () => {
  console.log(`Stock Platform API running on port ${PORT}`);
  console.log(`Using data provider: ${process.env.STOCK_API_PROVIDER || 'sina'}`);
  console.log(`Database: SQLite (persistent storage)`);
  console.log(`WebSocket: ws://localhost:${PORT}/ws`);
});

// DeepSeek AI API 代理（优先使用数据库平台Key）
app.post('/api/ai/deepseek', async (req, res) => {
  try {
    const { messages, apiKey: userApiKey } = req.body;
    // 优先级：数据库平台Key > 请求体中的apiKey > 报错
    const platformKey = await getPlatformKey('openrouter');
    const apiKey = platformKey || userApiKey;
    if (!apiKey) {
      return res.status(400).json({ error: '未配置API Key，请前往AI引擎设置配置' });
    }

    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: messages,
        temperature: 0.7,
        max_tokens: 2000
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ error: errorText });
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('DeepSeek proxy error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Kimi AI API 代理（优先使用数据库平台Key）
app.post('/api/ai/kimi', async (req, res) => {
  try {
    const { messages, apiKey: userApiKey } = req.body;
    const platformKey = await getPlatformKey('openrouter');
    const apiKey = platformKey || userApiKey;
    if (!apiKey) {
      return res.status(400).json({ error: '未配置API Key，请前往AI引擎设置配置' });
    }

    const response = await fetch('https://api.moonshot.cn/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'moonshot-v1-8k',
        messages: messages,
        temperature: 0.7,
        max_tokens: 2000
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ error: errorText });
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Kimi proxy error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 豆包 AI API 代理（优先使用数据库平台Key）
app.post('/api/ai/doubao', async (req, res) => {
  try {
    const { messages, apiKey: userApiKey } = req.body;
    const platformKey = await getPlatformKey('openrouter');
    const apiKey = platformKey || userApiKey;
    if (!apiKey) {
      return res.status(400).json({ error: '未配置API Key，请前往AI引擎设置配置' });
    }

    const response = await fetch('https://ark.cn-beijing.volces.com/api/v3/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'doubao-pro-32k',
        messages: messages,
        temperature: 0.7,
        max_tokens: 2000
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ error: errorText });
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Doubao proxy error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * AI 智能选股接口
 * 调用 Python TradingAgents 微服务（:8765）
 * 
 * @route POST /api/ai/screen
 * @body {string} market - 市场（A股/美股/港股）
 * @body {string} style - 风格（conservative/neutral/aggressive）
 * @body {number} count - 候选股数量（默认10）
 * @body {boolean} use_news_factor - 是否启用新闻因子
 * @returns {Object} 候选股列表，含多维度评分和 AI 分析理由
 */
app.post('/api/ai/screen', async (req, res) => {
    const { market, style, count, use_news_factor, filters } = req.body;
    
    // 参数验证
    if (!market || !style) {
        return res.status(400).json({
            success: false,
            error: '缺少必要参数: market 和 style'
        });
    }
    
    const validMarkets = ['A股', '美股', '港股'];
    if (!validMarkets.includes(market)) {
        return res.status(400).json({
            success: false,
            error: `不支持的市場: ${market}，支持: ${validMarkets.join(', ')}`
        });
    }
    
    const validStyles = ['conservative', 'neutral', 'aggressive'];
    if (!validStyles.includes(style)) {
        return res.status(400).json({
            success: false,
            error: `不支持的風格: ${style}，支持: ${validStyles.join(', ')}`
        });
    }
    
    const requestCount = Math.min(Math.max(parseInt(count) || 10, 1), 50);
    const useNews = Boolean(use_news_factor);
    
    try {
        // 调用 TradingAgents Python 服务
        const tradingAgentsUrl = process.env.TRADING_AGENTS_URL || 'http://localhost:8765';
        const response = await fetch(`${tradingAgentsUrl}/screen`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                market,
                style,
                count: requestCount,
                use_news_factor: useNews,
                filters: filters || {}
            }),
            timeout: 30000  // 30秒超时
        });
        
        if (!response.ok) {
            throw new Error(`TradingAgents 服务返回错误: ${response.status}`);
        }
        
        const data = await response.json();
        
        // 确保返回格式一致
        if (!data.success) {
            return res.status(500).json({
                success: false,
                error: data.error || 'AI选股服务返回失败',
                is_fallback: true
            });
        }
        
        res.json({
            success: true,
            model: data.model || 'trading-agents',
            is_fallback: data.is_fallback || false,
            llm_available: data.llm_available !== false,
            stocks: data.stocks || [],
            active_events: data.active_events || [],
            duration_ms: data.duration_ms || 0,
            market: data.market || market,
            style: data.style || style,
            count_analyzed: data.count_analyzed || 0,
            count_returned: data.count_returned || 0,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('AI选股服务调用失败:', error);
        
        // 超时或服务不可达时返回 mock 数据
        const isTimeout = error.name === 'AbortError' || error.message.includes('timeout');
        
        if (isTimeout || error.message.includes('ECONNREFUSED')) {
            // 返回模拟数据并标记 is_fallback: true
            const mockData = require('./mock/ai-screen-mock'); // 假设有mock文件
            const fallbackData = mockData.generateFallbackStocks(market, style, requestCount);
            
            return res.json({
                success: true,
                model: 'mock-fallback',
                is_fallback: true,
                llm_available: false,
                stocks: fallbackData,
                active_events: [],
                duration_ms: 100,
                market,
                style,
                count_analyzed: requestCount,
                count_returned: Math.min(fallbackData.length, requestCount),
                timestamp: new Date().toISOString(),
                warning: 'AI 服务不可达，显示模拟筛选结果'
            });
        }
        
        res.status(500).json({
            success: false,
            error: `AI选股服务调用失败: ${error.message}`,
            is_fallback: false
        });
    }
});

/**
 * Token 计量系统路由
 * 管理用户 token 余额和使用记录
 */

/**
 * 查询用户 token 余额
 * @route GET /api/usage/balance
 * @middleware authOptional - 可选认证，兼容未登录用户
 * @returns {Object} 用户 token 余额信息
 */
app.get('/api/usage/balance', authOptional, async (req, res) => {
    try {
        const userId = req.user?.id || req.query.user_id || DEFAULT_USER_ID;
        const balanceInfo = await db.getUserTokenBalance(userId);
        
        res.json({
            success: true,
            user_id: userId,
            remaining: balanceInfo.balance,
            purchased_total: balanceInfo.purchased_total,
            consumed_total: balanceInfo.consumed_total,
            last_purchase: balanceInfo.last_purchase_date,
            last_consumption: balanceInfo.last_consumption_date
        });
    } catch (error) {
        console.error('查询 token 余额失败:', error);
        res.status(500).json({
            success: false,
            error: `查询 token 余额失败: ${error.message}`
        });
    }
});

/**
 * 获取 token 使用历史记录
 * @route GET /api/usage/history
 * @middleware authOptional - 可选认证，兼容未登录用户
 * @query {number} limit - 返回记录数（默认50）
 * @query {number} offset - 偏移量（默认0）
 * @returns {Object} token 使用历史记录
 */
app.get('/api/usage/history', authOptional, async (req, res) => {
    try {
        const userId = req.user?.id || req.query.user_id || DEFAULT_USER_ID;
        const limit = parseInt(req.query.limit) || 50;
        const offset = parseInt(req.query.offset) || 0;
        
        const history = await db.getTokenUsageHistory(userId, limit, offset);
        
        res.json({
            success: true,
            user_id: userId,
            history: history,
            pagination: {
                limit,
                offset,
                total: history.length
            }
        });
    } catch (error) {
        console.error('获取 token 使用历史失败:', error);
        res.status(500).json({
            success: false,
            error: `获取 token 使用历史失败: ${error.message}`
        });
    }
});

/**
 * 内部扣减 token（AI调用时调用）
 * @route POST /api/usage/deduct
 * @middleware authOptional - 可选认证，兼容未登录用户
 * @body {Object} usageData - 使用数据
 * @returns {Object} 扣减结果
 */
app.post('/api/usage/deduct', authOptional, async (req, res) => {
    try {
        const userId = req.user?.id || req.body.user_id || DEFAULT_USER_ID;
        const { usage_data } = req.body;
        
        if (!usage_data) {
            return res.status(400).json({
                success: false,
                error: '缺少 usage_data 参数'
            });
        }
        
        // 验证必填字段
        const requiredFields = ['function_name', 'model_id'];
        for (const field of requiredFields) {
            if (!usage_data[field]) {
                return res.status(400).json({
                    success: false,
                    error: `缺少必填字段: ${field}`
                });
            }
        }
        
        // 计算总token数（如果没有提供tokens_total）
        if (!usage_data.tokens_total && !usage_data.tokens_input && !usage_data.tokens_output) {
            return res.status(400).json({
                success: false,
                error: '必须提供 tokens_total、tokens_input 或 tokens_output'
            });
        }
        
        // 执行扣减
        const result = await db.deductTokens(userId, usage_data);
        
        res.json({
            success: true,
            user_id: userId,
            usage_id: result.usage_id,
            new_balance: result.new_balance,
            tokens_deducted: result.tokens_deducted,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('扣减 token 失败:', error);
        
        if (error.message === 'Insufficient token balance') {
            return res.status(402).json({
                success: false,
                error: 'Token 余额不足',
                code: 'INSUFFICIENT_BALANCE'
            });
        }
        
        res.status(500).json({
            success: false,
            error: `扣减 token 失败: ${error.message}`
        });
    }
});

/**
 * 获取 token 使用统计
 * @route GET /api/usage/stats
 * @middleware authOptional - 可选认证，兼容未登录用户
 * @query {number} days - 统计天数（默认30）
 * @returns {Object} token 使用统计数据
 */
app.get('/api/usage/stats', authOptional, async (req, res) => {
    try {
        const userId = req.user?.id || req.query.user_id || DEFAULT_USER_ID;
        const days = parseInt(req.query.days) || 30;
        
        const stats = await db.getTokenUsageStats(userId, days);
        
        // 按日期分组，便于前端展示
        const groupedByDate = {};
        stats.forEach(stat => {
            if (!groupedByDate[stat.date]) {
                groupedByDate[stat.date] = [];
            }
            groupedByDate[stat.date].push({
                model_id: stat.model_id,
                function_name: stat.function_name,
                total_tokens: stat.total_tokens,
                request_count: stat.request_count
            });
        });
        
        // 计算汇总统计
        const summary = {
            total_tokens: stats.reduce((sum, stat) => sum + (stat.total_tokens || 0), 0),
            total_requests: stats.reduce((sum, stat) => sum + (stat.request_count || 0), 0),
            unique_models: [...new Set(stats.map(stat => stat.model_id))].length,
            unique_functions: [...new Set(stats.map(stat => stat.function_name))].length
        };
        
        res.json({
            success: true,
            user_id: userId,
            period_days: days,
            summary: summary,
            daily_stats: groupedByDate,
            raw_stats: stats
        });
    } catch (error) {
        console.error('获取 token 统计失败:', error);
        res.status(500).json({
            success: false,
            error: `获取 token 统计失败: ${error.message}`
        });
    }
});

/**
 * 充值 token（测试/管理用）
 * @route POST /api/usage/add
 * @middleware authOptional - 可选认证，兼容未登录用户
 * @body {number} tokens - 增加的 token 数量
 * @body {string} purchase_method - 购买方式（system/test/user）
 * @returns {Object} 充值结果
 */
app.post('/api/usage/add', authOptional, async (req, res) => {
    try {
        const userId = req.user?.id || req.body.user_id || DEFAULT_USER_ID;
        const { tokens, purchase_method = 'system' } = req.body;
        
        if (!tokens || tokens <= 0) {
            return res.status(400).json({
                success: false,
                error: '必须提供有效的 tokens 数量'
            });
        }
        
        const result = await db.addTokens(userId, tokens, purchase_method);
        
        res.json({
            success: true,
            user_id: userId,
            new_balance: result.new_balance,
            tokens_added: result.tokens_added,
            purchase_method: result.purchase_method,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('充值 token 失败:', error);
        res.status(500).json({
            success: false,
            error: `充值 token 失败: ${error.message}`
        });
    }
});

/**
 * 获取用户用量汇总（前端用量面板专用）
 * @route GET /api/usage/summary
 * @middleware authOptional - 可选认证，兼容未登录用户
 * @returns {Object} 包含余额、今日/总消耗、Top功能、模型分布的汇总数据
 */
app.get('/api/usage/summary', authOptional, async (req, res) => {
    try {
        const userId = req.user?.id || req.query.user_id || DEFAULT_USER_ID;

        // 并行获取余额和近30天统计
        const [balanceInfo, statsAll, statsToday] = await Promise.all([
            db.getUserTokenBalance(userId),
            db.getTokenUsageStats(userId, 30),
            db.getTokenUsageStats(userId, 1)
        ]);

        // 今日消耗
        const today_consumed = statsToday.reduce((sum, s) => sum + (s.total_tokens || 0), 0);
        // 总消耗（30天内）
        const total_consumed = balanceInfo.consumed_total || 0;

        // Top3 功能（按token消耗降序）
        const featureMap = {};
        statsAll.forEach(s => {
            featureMap[s.function_name] = (featureMap[s.function_name] || 0) + (s.total_tokens || 0);
        });
        const top_features = Object.entries(featureMap)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([name, tokens]) => ({ name, tokens }));

        // 模型分布
        const modelMap = {};
        statsAll.forEach(s => {
            modelMap[s.model_id] = (modelMap[s.model_id] || 0) + (s.total_tokens || 0);
        });
        const model_breakdown = Object.entries(modelMap)
            .sort((a, b) => b[1] - a[1])
            .map(([model_id, tokens]) => ({ model_id, tokens }));

        res.json({
            success: true,
            user_id: userId,
            token_balance: balanceInfo.balance,
            total_consumed,
            today_consumed,
            top_features,
            model_breakdown
        });
    } catch (error) {
        console.error('获取用量汇总失败:', error);
        res.status(500).json({
            success: false,
            error: `获取用量汇总失败: ${error.message}`
        });
    }
});

/**
 * 获取可用模型目录
 * @route GET /api/models/catalog
 * @returns {Object} 可用模型列表
 */
app.get('/api/models/catalog', async (req, res) => {
    try {
        // 从配置文件或数据库获取模型目录
        // 这里返回硬编码的模型列表，后续可从数据库读取
        const modelCatalog = [
            { 
                id: "stepfun/step-3.5-flash:free", 
                name: "StepFun Flash", 
                badge: "免费", 
                tokenCost: 0, 
                quality: 3,
                description: "快速响应，适合日常分析",
                maxTokens: 2048,
                latency: "fast",
                available: true
            },
            { 
                id: "deepseek/deepseek-v3.2", 
                name: "DeepSeek V3", 
                badge: "标准", 
                tokenCost: 15000, 
                quality: 4,
                description: "平衡性能与成本，推荐使用",
                maxTokens: 8192,
                latency: "medium",
                available: true
            },
            { 
                id: "anthropic/claude-sonnet-4-5", 
                name: "Claude Sonnet", 
                badge: "高级", 
                tokenCost: 60000, 
                quality: 5,
                description: "高质量分析，适合复杂推理",
                maxTokens: 16384,
                latency: "slow",
                available: true
            },
            { 
                id: "openai/gpt-4.5", 
                name: "GPT-4.5", 
                badge: "旗舰", 
                tokenCost: 120000, 
                quality: 5,
                description: "顶尖性能，处理复杂任务",
                maxTokens: 32768,
                latency: "medium",
                available: false,
                reason: "暂未开放"
            }
        ];
        
        res.json({
            success: true,
            models: modelCatalog,
            last_updated: new Date().toISOString()
        });
    } catch (error) {
        console.error('获取模型目录失败:', error);
        res.status(500).json({
            success: false,
            error: `获取模型目录失败: ${error.message}`
        });
    }
});

/**
 * Kronos 择时预测接口
 * 调用 Kronos 微服务预测股票走势
 * 
 * @route GET /api/kronos/predict/:code
 * @param {string} code - 股票代码
 * @query {string} model - 模型规格（kronos-mini/small/base）
 * @query {number} pred_len - 预测长度（默认20）
 * @returns {Object} 预测结果，含趋势、置信度、开仓/平仓信号
 */
app.get('/api/kronos/predict/:code', async (req, res) => {
    const { code } = req.params;
    const { model = 'kronos-base', pred_len = 20 } = req.query;
    
    if (!code) {
        return res.status(400).json({
            success: false,
            error: '缺少股票代码参数'
        });
    }
    
    try {
        // 调用 Kronos 微服务
        const kronosUrl = process.env.KRONOS_URL || 'http://localhost:8888';
        const response = await fetch(
            `${kronosUrl}/predict/${encodeURIComponent(code)}?model=${model}&pred_len=${pred_len}`,
            { timeout: 10000 }  // 10秒超时
        );
        
        if (!response.ok) {
            throw new Error(`Kronos 服务返回错误: ${response.status}`);
        }
        
        const data = await response.json();
        
        // 确保返回格式一致
        if (!data.success) {
            return res.status(500).json({
                success: false,
                error: data.error || 'Kronos预测服务返回失败',
                is_mock: true
            });
        }
        
        res.json({
            success: true,
            code: data.code || code,
            model: data.model || model,
            is_mock: data.is_mock || false,
            trend: data.trend || 'neutral',
            confidence: data.confidence || 0.5,
            entry_signal: data.entry_signal || false,
            exit_signal: data.exit_signal || false,
            forecast: data.forecast || [],
            analysis: data.analysis || 'Kronos择时分析',
            cached: data.cached || false,
            inference_ms: data.inference_ms || 0,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('Kronos预测服务调用失败:', error);
        
        // 返回模拟数据
        const mockTrend = Math.random() > 0.5 ? 'bullish' : 'bearish';
        const mockConfidence = 0.5 + Math.random() * 0.3;
        
        res.json({
            success: true,
            code,
            model,
            is_mock: true,
            trend: mockTrend,
            confidence: mockConfidence,
            entry_signal: mockTrend === 'bullish' && mockConfidence > 0.6,
            exit_signal: mockTrend === 'bearish' && mockConfidence > 0.65,
            forecast: Array(parseInt(pred_len)).fill(0).map((_, i) => [
                Date.now() + i * 86400000,  // 时间戳
                100 + Math.random() * 10,   // open
                105 + Math.random() * 10,   // high
                95 + Math.random() * 10,    // low
                102 + Math.random() * 10,   // close
                1000000 + Math.random() * 500000  // volume
            ]),
            analysis: `模拟分析：${code} 当前趋势${mockTrend}，置信度${mockConfidence.toFixed(2)}`,
            cached: false,
            inference_ms: 50,
            timestamp: new Date().toISOString(),
            warning: 'Kronos 服务不可达，显示模拟预测结果'
        });
    }
});

// 定时检查持仓规则（每小时执行一次）
cron.schedule('0 * * * *', async () => {
  console.log('[定时任务] 检查持仓规则...');
  try {
    const holdings = await db.getHoldings();
    if (holdings.length === 0) return;
    
    const codes = holdings.map(h => h.code);
    const stockData = await stockAPI.getBatchQuotes(codes);
    
    for (const holding of holdings) {
      const stock = stockData.find(s => s.code === holding.code);
      if (!stock) continue;
      await runTradingRules(holding, stock);
    }
    console.log('[定时任务] 检查完成');
  } catch (error) {
    console.error('[定时任务] 检查失败:', error.message);
  }
});

const { AIProviderService, maskApiKey } = require('./services/ai-provider-service');

/** @type {AIProviderService} */
let aiProviderService;

// 延迟初始化（db需要先完成init）
setTimeout(() => {
  aiProviderService = new AIProviderService(db.db);
}, 500);

// =============================================
// Admin - AI 提供商管理路由
// =============================================

/**
 * 获取所有AI提供商列表（API Key脱敏）
 * @route GET /api/admin/providers
 */
app.get('/api/admin/providers', authRequired, async (req, res) => {
  try {
    const providers = await aiProviderService.getAllProviders();
    res.json({ success: true, providers });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * 添加新AI提供商
 * @route POST /api/admin/providers
 */
app.post('/api/admin/providers', authRequired, async (req, res) => {
  try {
    const result = await aiProviderService.addProvider(req.body);
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

/**
 * 更新AI提供商配置（含Key、URL、模型）
 * @route PUT /api/admin/providers/:id
 */
app.put('/api/admin/providers/:id', authRequired, async (req, res) => {
  try {
    const result = await aiProviderService.updateProvider(Number(req.params.id), req.body);
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * 删除AI提供商
 * @route DELETE /api/admin/providers/:id
 */
app.delete('/api/admin/providers/:id', authRequired, async (req, res) => {
  try {
    const result = await aiProviderService.deleteProvider(Number(req.params.id));
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * 测试AI提供商连通性
 * @route POST /api/admin/providers/:id/test
 */
app.post('/api/admin/providers/:id/test', authRequired, async (req, res) => {
  try {
    const result = await aiProviderService.testConnection(Number(req.params.id));
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * 设置默认AI提供商
 * @route POST /api/admin/providers/:id/default
 */
app.post('/api/admin/providers/:id/default', authRequired, async (req, res) => {
  try {
    const result = await aiProviderService.setDefault(Number(req.params.id));
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * 拉取提供商的可用模型列表
 * @route GET /api/admin/providers/:id/models
 */
app.get('/api/admin/providers/:id/models', authRequired, async (req, res) => {
  try {
    const result = await aiProviderService.fetchProviderModels(Number(req.params.id));
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * 内部接口：获取提供商明文Key（仅localhost可调用）
 * @route GET /api/admin/providers/:id/key
 * @query {string} internal=1
 */
app.get('/api/admin/providers/:id/key', async (req, res) => {
  const ip = req.socket.remoteAddress || req.ip;
  const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  if (!isLocal || req.query.internal !== '1') {
    return res.status(403).json({ success: false, error: 'Forbidden' });
  }
  try {
    const provider = await aiProviderService.getProviderRaw(Number(req.params.id));
    if (!provider) return res.status(404).json({ success: false, error: '提供商不存在' });
    res.json({ success: true, api_key: provider.api_key, provider_type: provider.provider_type });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * 添加模型到提供商
 * @route POST /api/admin/models
 */
app.post('/api/admin/models', authRequired, async (req, res) => {
  try {
    const result = await aiProviderService.addModel(req.body);
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

/**
 * 删除模型配置
 * @route DELETE /api/admin/models/:id
 */
app.delete('/api/admin/models/:id', authRequired, async (req, res) => {
  try {
    const result = await aiProviderService.deleteModel(Number(req.params.id));
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// =============================================
// 从数据库获取平台Key的辅助函数
// =============================================

/**
 * 获取指定类型提供商的平台Key
 * @param {string} providerType - 'openrouter'|'ollama'|'custom'
 * @returns {Promise<string|null>}
 */
async function getPlatformKey(providerType) {
  if (!aiProviderService) return null;
  try {
    return await aiProviderService.getPlatformKey(providerType);
  } catch {
    return null;
  }
}

// =============================================
// 大盘云图代理（去除广告和不需要的内容）
app.get('/api/cloudmap-proxy', async (req, res) => {
  try {
    const https = require('https');
    const http = require('http');
    
    const targetUrl = 'https://52etf.site/';
    
    const getPage = () => {
      return new Promise((resolve, reject) => {
        const client = targetUrl.startsWith('https') ? https : http;
        client.get(targetUrl, (resp) => {
          let data = '';
          resp.on('data', (chunk) => data += chunk);
          resp.on('end', () => resolve(data));
        }).on('error', reject);
      });
    };
    
    let html = await getPage();
    
    // 替换相对路径为绝对路径
    html = html.replace(/href="\//g, 'href="https://52etf.site/');
    html = html.replace(/src="\//g, 'src="https://52etf.site/');
    html = html.replace(/href='/g, "href='https://52etf.site/");
    html = html.replace(/src='/g, "src='https://52etf.site/");
    
    // 去除不需要的内容
    const removePatterns = [
      /<div class="header"[\s\S]*?<\/div>/gi,
      /<div class="footer"[\s\S]*?<\/div>/gi,
      /<div class="scgl_s1"[\s\S]*?<\/div>/gi,
      /<div class="navBox"[\s\S]*?<\/div>/gi,
      /<div class="stock_inf"[\s\S]*?<\/div>/gi,
      /<div class="jrj-where"[\s\S]*?<\/div>/gi,
      /<div class="pinglunIfr"[\s\S]*?<\/div>/gi,
      /<div class="zn_tip"[\s\S]*?<\/div>/gi,
      /<div class="zn_tip_min"[\s\S]*?<\/div>/gi,
      /<div class="ad"[\s\S]*?<\/div>/gi,
      /<a[^>]*>收藏网址[^\n<>]+<\/a>/gi,
      /52ETF\.site/gi,
      /52etf\.site/gi,
      /52ETF/gi,
      /dapanyuntu/gi,
      /防丢网址：[^\n<>]+/gi,
      /站长知识星球[^\n<>]+/gi,
      /低佣开户[^\n<>]+/gi,
      /万0\.85免五开户[^\n<>]+/gi,
    ];
    
    removePatterns.forEach(pattern => {
      html = html.replace(pattern, '');
    });
    
    // 清理空标签和多余空白
    html = html.replace(/\s+/g, ' ');
    html = html.replace(/>\s+</g, '><');
    
    res.setHeader('Content-Type', 'text/html;charset=utf-8');
    res.send(html);
  } catch (error) {
    console.error('CloudMap proxy error:', error);
    res.status(500).send('Proxy error');
  }
});

// =============================================
// 知识库代理 API（M4）- 转发到 TradingAgents :8765
// =============================================

/**
 * 代理知识库 CRUD 到 TradingAgents Python 服务
 * 当 TradingAgents 不可达时，返回前5条 mock 范式
 *
 * 路由：GET/POST/PATCH/DELETE /api/knowledge/paradigms[/:id]
 */
const TRADING_AGENTS_URL = process.env.TRADING_AGENTS_URL || 'http://localhost:8765';

// mock 范式（TradingAgents 不可达时的兜底数据）
const MOCK_PARADIGMS = [
  { id: 1, category: "geo_conflict", subcategory: "war_outbreak", name: "战争爆发",
    trigger_keywords: ["战争", "开战", "军事行动", "空袭"], severity_multiplier: 2.0, duration_days: 30,
    market_impact: { "A股": { benefit: ["军工","黄金ETF"], damage: ["消费","旅游"], rationale: "战争刺激军工需求" } } },
  { id: 2, category: "geo_conflict", subcategory: "sanctions", name: "经济制裁",
    trigger_keywords: ["制裁", "禁令", "出口管制", "实体清单"], severity_multiplier: 1.5, duration_days: 60,
    market_impact: { "A股": { benefit: ["国产替代","军工"], damage: ["依赖进口原材料行业"], rationale: "倒逼国产替代" } } },
  { id: 3, category: "macro_policy", subcategory: "fed_rate_hike", name: "美联储加息",
    trigger_keywords: ["美联储加息", "Fed加息", "缩表", "鹰派"], severity_multiplier: 1.5, duration_days: 14,
    market_impact: { "美股": { benefit: ["银行","保险"], damage: ["科技成长","REITs"], rationale: "压制成长估值" } } },
  { id: 4, category: "macro_policy", subcategory: "china_fiscal_stimulus", name: "中国财政刺激",
    trigger_keywords: ["财政刺激", "专项债", "扩大内需", "消费补贴"], severity_multiplier: 1.8, duration_days: 60,
    market_impact: { "A股": { benefit: ["基建","消费","家电"], damage: [], rationale: "直接提振相关产业链" } } },
  { id: 5, category: "industry", subcategory: "ai_breakthrough", name: "AI重大突破",
    trigger_keywords: ["AI突破", "大模型发布", "GPT", "人工智能革命"], severity_multiplier: 1.5, duration_days: 30,
    market_impact: { "A股": { benefit: ["AI算力","数据中心","国产大模型"], damage: [], rationale: "算力需求爆发" } } },
];

/**
 * 代理请求到 TradingAgents，失败时返回 mock 数据
 * @param {string} path - TradingAgents 路径（如 /paradigms）
 * @param {string} method - HTTP 方法
 * @param {Object} body - 请求体（POST/PATCH）
 * @returns {Promise<Object>} 响应数据
 */
async function proxyToTradingAgents(path, method = 'GET', body = null) {
  try {
    const opts = { method, headers: { 'Content-Type': 'application/json' }, timeout: 5000 };
    if (body) opts.body = JSON.stringify(body);
    const resp = await fetch(`${TRADING_AGENTS_URL}${path}`, opts);
    return { ...(await resp.json()), is_mock: false };
  } catch (e) {
    // TradingAgents 不可达，返回 mock 数据
    return { success: true, paradigms: MOCK_PARADIGMS, total: MOCK_PARADIGMS.length, is_mock: true };
  }
}

// GET 范式列表
app.get('/api/knowledge/paradigms', async (req, res) => {
  const { category, active_only } = req.query;
  const qs = new URLSearchParams();
  if (category) qs.set('category', category);
  if (active_only) qs.set('active_only', active_only);
  res.json(await proxyToTradingAgents(`/paradigms?${qs}`));
});

// 搜索范式
app.get('/api/knowledge/paradigms/search', async (req, res) => {
  res.json(await proxyToTradingAgents(`/paradigms/search?q=${encodeURIComponent(req.query.q || '')}`));
});

// 获取单个范式
app.get('/api/knowledge/paradigms/:id', async (req, res) => {
  res.json(await proxyToTradingAgents(`/paradigms/${req.params.id}`));
});

// 新增范式
app.post('/api/knowledge/paradigms', async (req, res) => {
  res.json(await proxyToTradingAgents('/paradigms', 'POST', req.body));
});

// 从新闻匹配范式（RAG检索）
app.post('/api/knowledge/paradigms/match', async (req, res) => {
  res.json(await proxyToTradingAgents('/paradigms/match', 'POST', req.body));
});

// 部分更新范式
app.patch('/api/knowledge/paradigms/:id', async (req, res) => {
  res.json(await proxyToTradingAgents(`/paradigms/${req.params.id}`, 'PATCH', req.body));
});

// 软删除范式
app.delete('/api/knowledge/paradigms/:id', async (req, res) => {
  res.json(await proxyToTradingAgents(`/paradigms/${req.params.id}`, 'DELETE'));
});

// =============================================
// 策略广场 API（M3）
// =============================================
const { MOCK_STRATEGIES } = require('./mock/marketplace-mock');
const { calculateGrade } = require('./services/gradeCalculator');
// 用 crypto 生成 UUID，避免额外依赖
const { randomUUID } = require('crypto');

/**
 * 获取策略列表（公开浏览）
 * 支持市场/等级/风格/排序筛选
 */
app.get('/api/marketplace/strategies', (req, res) => {
  const { market, grade, style, sort = 'subscribers', page = 1, limit = 20, free_only } = req.query;
  try {
    let strategies = db.db ? (() => {
      let sql = 'SELECT * FROM strategies WHERE status = "active"';
      const params = [];
      if (market && market !== '全部') { sql += ' AND market = ?'; params.push(market); }
      if (grade) { sql += ' AND grade = ?'; params.push(grade); }
      if (style) { sql += ' AND style = ?'; params.push(style); }
      if (free_only === 'true') { sql += ' AND price_monthly = 0'; }
      const sortMap = { subscribers: 'subscribers DESC', annual_return: 'json_extract(backtest_metrics,"$.annual_return") DESC', sharpe: 'json_extract(backtest_metrics,"$.sharpe") DESC', created_at: 'created_at DESC' };
      sql += ` ORDER BY ${sortMap[sort] || 'subscribers DESC'} LIMIT ? OFFSET ?`;
      params.push(Number(limit), (Number(page) - 1) * Number(limit));
      return db.db.prepare(sql).all(...params);
    })() : [];

    // 数据库为空时用 mock 数据
    if (!strategies.length) strategies = MOCK_STRATEGIES;

    // 解析 JSON 字段
    strategies = strategies.map(s => ({
      ...s,
      backtest_metrics: typeof s.backtest_metrics === 'string' ? JSON.parse(s.backtest_metrics || '{}') : s.backtest_metrics,
      live_metrics: typeof s.live_metrics === 'string' ? JSON.parse(s.live_metrics || '{}') : s.live_metrics,
      tags: typeof s.tags === 'string' ? JSON.parse(s.tags || '[]') : s.tags,
    }));

    res.json({ success: true, total: strategies.length, page: Number(page), strategies, is_mock: !db.db });
  } catch (e) {
    res.json({ success: true, total: MOCK_STRATEGIES.length, page: 1, strategies: MOCK_STRATEGIES, is_mock: true });
  }
});

/**
 * 获取策略详情（先查数据库，fallback 到 mock）
 */
app.get('/api/marketplace/strategies/:id', (req, res) => {
  const { id } = req.params;
  try {
    const row = db.db && db.db.prepare('SELECT * FROM strategies WHERE id = ?').get(id);
    if (row) {
      const strategy = {
        ...row,
        backtest_metrics: typeof row.backtest_metrics === 'string' ? JSON.parse(row.backtest_metrics || '{}') : row.backtest_metrics,
        live_metrics: typeof row.live_metrics === 'string' ? JSON.parse(row.live_metrics || '{}') : row.live_metrics,
        tags: typeof row.tags === 'string' ? JSON.parse(row.tags || '[]') : row.tags,
      };
      return res.json({ success: true, strategy });
    }
  } catch (e) { /* ignore, fallback below */ }
  const mock = MOCK_STRATEGIES.find(s => s.id === id);
  res.json({ success: true, strategy: mock || null, is_mock: true });
});

/**
 * 发布策略（创作者）
 */
app.post('/api/marketplace/strategies', (req, res) => {
  const { name, description, market, style, tags, backtest_metrics, price_monthly = 0, price_yearly = 0, creator_id = DEFAULT_USER_ID } = req.body;
  if (!name || !market || !style) return res.status(400).json({ success: false, error: '缺少必填字段: name/market/style' });

  const id = randomUUID();
  const grade = calculateGrade({ backtest_metrics });

  try {
    db.db.prepare(`INSERT INTO strategies (id,creator_id,name,description,market,style,tags,backtest_metrics,price_monthly,price_yearly,grade,status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,'pending')`).run(
      id, creator_id, name, description, market, style,
      JSON.stringify(tags || []), JSON.stringify(backtest_metrics || {}),
      price_monthly, price_yearly, grade
    );
    res.json({ success: true, id, grade, message: '策略已提交，审核后发布到广场' });
  } catch (e) {
    res.json({ success: true, id, grade, message: '（Mock模式）策略已记录', is_mock: true });
  }
});

/**
 * 订阅策略（需要认证）
 */
app.post('/api/marketplace/subscribe', authRequired, (req, res) => {
  const { strategy_id, plan = 'monthly' } = req.body;
  const user_id = req.user.id; // M6: 从认证信息获取用户ID
  const strategy = MOCK_STRATEGIES.find(s => s.id === strategy_id) || {};
  const amount = plan === 'yearly' ? (strategy.price_yearly || 0) : (strategy.price_monthly || 0);
  const commission_rate = strategy.commission_rate || 0.20;
  const platform_fee = amount * commission_rate;
  const creator_revenue = amount - platform_fee;

  const subscription_id = randomUUID();
  res.json({ success: true, subscription_id, amount, platform_fee, creator_revenue, message: amount === 0 ? '免费策略，已订阅' : `订阅成功，已扣除 ¥${amount}` });
});

/**
 * 排行榜（按年化收益/夏普/实盘盈利率）
 */
app.get('/api/marketplace/leaderboard', (req, res) => {
  const { type = 'annual_return', limit: top = 10 } = req.query;
  const sorted = [...MOCK_STRATEGIES].sort((a, b) => {
    const getVal = (s) => {
      if (type === 'sharpe') return s.backtest_metrics?.sharpe || 0;
      if (type === 'live_profit_rate') return s.live_metrics?.profit_user_rate || 0;
      return s.backtest_metrics?.annual_return || 0;
    };
    return getVal(b) - getVal(a);
  }).slice(0, Number(top));
  res.json({ success: true, type, leaderboard: sorted });
});

/**
 * 重新计算策略等级（内部接口）
 */
app.post('/api/marketplace/strategies/:id/recalculate-grade', (req, res) => {
  const strategy = MOCK_STRATEGIES.find(s => s.id === req.params.id);
  if (!strategy) return res.status(404).json({ success: false, error: '策略不存在' });
  const grade = calculateGrade(strategy, strategy.live_metrics);
  res.json({ success: true, id: req.params.id, old_grade: strategy.grade, new_grade: grade });
});

// =============================================
// 策略广场补充路由（M3 扩展）
// =============================================

/**
 * 我发布的策略（需要认证）
 * @route GET /api/marketplace/my-strategies
 */
app.get('/api/marketplace/my-strategies', authRequired, (req, res) => {
  const user_id = req.user.id;
  try {
    const rows = db.db.prepare(
      'SELECT * FROM strategies WHERE creator_id = ? ORDER BY created_at DESC'
    ).all(user_id);
    const strategies = rows.map(s => ({
      ...s,
      backtest_metrics: typeof s.backtest_metrics === 'string' ? JSON.parse(s.backtest_metrics || '{}') : s.backtest_metrics,
      live_metrics: typeof s.live_metrics === 'string' ? JSON.parse(s.live_metrics || '{}') : s.live_metrics,
      tags: typeof s.tags === 'string' ? JSON.parse(s.tags || '[]') : s.tags,
    }));
    res.json({ success: true, strategies });
  } catch (e) {
    res.json({ success: true, strategies: [], error: e.message });
  }
});

/**
 * 我的订阅（需要认证）
 * @route GET /api/marketplace/my-subscriptions
 */
app.get('/api/marketplace/my-subscriptions', authRequired, (req, res) => {
  const user_id = req.user.id;
  try {
    const rows = db.db.prepare(`
      SELECT sub.*, s.name as strategy_name, s.style, s.grade, s.backtest_metrics, s.live_metrics
      FROM subscriptions sub
      LEFT JOIN strategies s ON sub.strategy_id = s.id
      WHERE sub.user_id = ?
      ORDER BY sub.created_at DESC
    `).all(user_id);
    const subscriptions = rows.map(s => ({
      ...s,
      backtest_metrics: typeof s.backtest_metrics === 'string' ? JSON.parse(s.backtest_metrics || '{}') : s.backtest_metrics,
      live_metrics: typeof s.live_metrics === 'string' ? JSON.parse(s.live_metrics || '{}') : s.live_metrics,
    }));
    res.json({ success: true, subscriptions });
  } catch (e) {
    res.json({ success: true, subscriptions: [], error: e.message });
  }
});

/**
 * 评价策略（需要认证，每用户只能评价一次）
 * @route POST /api/marketplace/strategies/:id/review
 */
app.post('/api/marketplace/strategies/:id/review', authRequired, (req, res) => {
  const strategy_id = req.params.id;
  const user_id = req.user.id;
  const { rating, comment } = req.body;
  if (!rating || rating < 1 || rating > 5) {
    return res.status(400).json({ success: false, error: 'rating 需在 1-5 之间' });
  }
  try {
    db.db.prepare(`
      INSERT INTO strategy_reviews (strategy_id, user_id, rating, comment)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(strategy_id, user_id) DO UPDATE SET rating=excluded.rating, comment=excluded.comment
    `).run(strategy_id, user_id, Number(rating), comment || '');
    res.json({ success: true, message: '评价已提交' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * 获取策略评价列表（公开）
 * @route GET /api/marketplace/strategies/:id/reviews
 */
app.get('/api/marketplace/strategies/:id/reviews', (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const offset = (Number(page) - 1) * Number(limit);
  try {
    const rows = db.db.prepare(
      'SELECT * FROM strategy_reviews WHERE strategy_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
    ).all(req.params.id, Number(limit), offset);
    const total = db.db.prepare('SELECT COUNT(*) as cnt FROM strategy_reviews WHERE strategy_id = ?').get(req.params.id);
    res.json({ success: true, reviews: rows, total: total?.cnt || 0, page: Number(page) });
  } catch (e) {
    res.json({ success: true, reviews: [], total: 0, error: e.message });
  }
});

/**
 * 更新策略信息（仅创作者）
 * @route PATCH /api/marketplace/strategies/:id
 */
app.patch('/api/marketplace/strategies/:id', authRequired, (req, res) => {
  const user_id = req.user.id;
  const { id } = req.params;
  try {
    const row = db.db.prepare('SELECT creator_id FROM strategies WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ success: false, error: '策略不存在' });
    if (row.creator_id !== user_id) return res.status(403).json({ success: false, error: '只能修改自己的策略' });

    const { description, price_monthly, price_yearly, tags } = req.body;
    db.db.prepare(`
      UPDATE strategies SET
        description = COALESCE(?, description),
        price_monthly = COALESCE(?, price_monthly),
        price_yearly = COALESCE(?, price_yearly),
        tags = COALESCE(?, tags)
      WHERE id = ?
    `).run(
      description ?? null,
      price_monthly ?? null,
      price_yearly ?? null,
      tags ? JSON.stringify(tags) : null,
      id
    );
    res.json({ success: true, message: '策略信息已更新' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * 下架策略（软删除，仅创作者）
 * @route DELETE /api/marketplace/strategies/:id
 */
app.delete('/api/marketplace/strategies/:id', authRequired, (req, res) => {
  const user_id = req.user.id;
  const { id } = req.params;
  try {
    const row = db.db.prepare('SELECT creator_id, status FROM strategies WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ success: false, error: '策略不存在' });
    if (row.creator_id !== user_id) return res.status(403).json({ success: false, error: '只能下架自己的策略' });
    db.db.prepare("UPDATE strategies SET status = 'delisted' WHERE id = ?").run(id);
    res.json({ success: true, message: '策略已下架' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * 记录实盘跟踪（需要认证）
 * @route POST /api/marketplace/strategies/:id/track
 */
app.post('/api/marketplace/strategies/:id/track', authRequired, (req, res) => {
  const strategy_id = req.params.id;
  const user_id = req.user.id;
  const { subscription_id, signal_id, action, code, price, quantity, pnl, pnl_percent } = req.body;
  if (!action || !code) {
    return res.status(400).json({ success: false, error: '缺少必填字段: action/code' });
  }
  try {
    const result = db.db.prepare(`
      INSERT INTO live_tracking (user_id, strategy_id, subscription_id, signal_id, action, code, price, quantity, pnl, pnl_percent)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(user_id, strategy_id, subscription_id || null, signal_id || null, action, code, price || 0, quantity || 0, pnl || 0, pnl_percent || 0);
    res.json({ success: true, id: result.lastInsertRowid, message: '实盘跟踪记录已保存' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ────────────────────────────────────────────────────────────────
// 新闻路由 - 代理到 AKShare Python 微服务 (:8767)
// GET /api/news/market     市场综合快讯（财新）
// GET /api/news/flash      财经电报（央视/财新）
// GET /api/news/stock/:code  个股相关新闻（东方财富）
// ────────────────────────────────────────────────────────────────
const NEWS_SERVICE_URL = process.env.NEWS_SERVICE_URL || 'http://localhost:8767';

const MOCK_NEWS = [
  { title: '市场快讯：沪指震荡上行，科技板块领涨', content: 'A股市场今日呈震荡上行态势，科技、新能源板块表现强势。', url: '', published_at: new Date().toISOString(), source_name: 'Mock数据' },
  { title: '央行货币政策：保持流动性合理充裕', content: '中国人民银行表示将继续保持货币政策稳健，维护流动性合理充裕。', url: '', published_at: new Date().toISOString(), source_name: 'Mock数据' },
  { title: '利好消息：外资持续流入A股市场', content: '北向资金今日净流入超过50亿元，外资看好中国股市长期发展前景。', url: '', published_at: new Date().toISOString(), source_name: 'Mock数据' },
  { title: '政策扶持：新能源汽车补贴政策延续', content: '国家发改委宣布新能源汽车补贴政策延续至2027年，利好相关产业链。', url: '', published_at: new Date().toISOString(), source_name: 'Mock数据' },
  { title: '警示：部分地区房市出现下跌压力', content: '多个城市房地产市场出现成交量下滑，市场观望情绪较浓。', url: '', published_at: new Date().toISOString(), source_name: 'Mock数据' },
];

async function proxyNews(path, res) {
  try {
    const response = await fetch(`${NEWS_SERVICE_URL}${path}`, { signal: AbortSignal.timeout(8000) });
    const data = await response.json();
    return res.json(data);
  } catch (e) {
    console.warn(`[news] proxy failed (${path}): ${e.message}, returning mock`);
    return res.json({ success: true, count: MOCK_NEWS.length, source: 'mock', data: MOCK_NEWS });
  }
}

app.get('/api/news/market', async (req, res) => {
  const count = req.query.count || 30;
  await proxyNews(`/news/market?count=${count}`, res);
});

app.get('/api/news/flash', async (req, res) => {
  const count = req.query.count || 20;
  await proxyNews(`/news/flash?count=${count}`, res);
});

app.get('/api/news/stock/:code', async (req, res) => {
  const code = req.params.code;
  const count = Math.min(parseInt(req.query.count || '20', 10), 100);

  try {
    // 优先从本地 news_processed 表查询已分类的相关新闻
    // stock_codes 字段是 JSON 数组，使用 LIKE 快速过滤（SQLite 无原生 JSON_CONTAINS）
    const localRows = await new Promise((resolve, reject) => {
      db.db.all(
        `SELECT id, content, url, published_at, source_key, source_weight,
                asset_type, event_type, sentiment, urgency, channel_type, stock_codes, score, status, created_at
         FROM news_processed
         WHERE stock_codes LIKE ?
           AND datetime(created_at) > datetime('now', '-7 days')
         ORDER BY created_at DESC
         LIMIT ?`,
        [`%"${code}"%`, count],
        (err, rows) => { if (err) reject(err); else resolve(rows || []); }
      );
    });

    if (localRows.length > 0) {
      // 有本地数据，直接返回（已分类，质量更高）
      const data = localRows.map((r) => ({
        title:        (r.content || '').slice(0, 60) + ((r.content || '').length > 60 ? '...' : ''),
        content:      r.content,
        url:          r.url || '',
        published_at: r.published_at,
        source_name:  r.source_key || 'Telegram',
        asset_type:   r.asset_type,
        event_type:   r.event_type,
        sentiment:    r.sentiment || '中性',
        urgency:      r.urgency || 'normal',
        channel_type: r.channel_type,
        stock_codes:  (() => { try { return JSON.parse(r.stock_codes || '[]'); } catch { return []; } })(),
        score:        r.score,
      }));
      return res.json({ success: true, count: data.length, source: 'local_db', symbol: code, data });
    }

    // 本地无数据，降级到 Python AkShare 服务
    await proxyNews(`/news/stock?symbol=${code}&count=${count}`, res);
  } catch (err) {
    console.error(`[/api/news/stock/${code}]`, err.message);
    // 双重兜底：两者都失败则返回 mock
    await proxyNews(`/news/stock?symbol=${code}&count=${count}`, res);
  }
});

// ────────────────────────────────────────────────────────────────
// 新闻分析路由（评分引擎 + 范式分析结果）
// ────────────────────────────────────────────────────────────────

/**
 * 已分析新闻列表（score >= 7，含范式分析结果）
 * @route GET /api/news/analyzed
 */
app.get('/api/news/analyzed', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
    const offset = parseInt(req.query.offset || '0', 10);
    const rows = await new Promise((resolve, reject) => {
      db.db.all(
        `SELECT np.*, na.id as analysis_id, na.analysis, na.confidence, na.action, na.time_window,
                na.stock_recommendations, na.model_used, na.paradigm_ids
         FROM news_processed np
         LEFT JOIN news_analysis na ON np.id = na.news_id
         WHERE np.score >= 7
         ORDER BY np.score DESC, np.created_at DESC
         LIMIT ? OFFSET ?`,
        [limit, offset],
        (err, r) => { if (err) reject(err); else resolve(r || []); }
      );
    });
    const parsed = rows.map(r => ({
      ...r,
      analysis: r.analysis ? (() => { try { return JSON.parse(r.analysis); } catch { return r.analysis; } })() : null,
      stock_recommendations: r.stock_recommendations ? (() => { try { return JSON.parse(r.stock_recommendations); } catch { return []; } })() : [],
    }));
    res.json({ success: true, count: parsed.length, data: parsed });
  } catch (e) {
    console.error('[/api/news/analyzed]', e.message);
    res.json({ success: true, count: 0, data: [], error: e.message });
  }
});

/**
 * 单条分析详情
 * @route GET /api/news/analysis/:id
 */
app.get('/api/news/analysis/:id', async (req, res) => {
  try {
    const row = await new Promise((resolve, reject) => {
      db.db.get(
        `SELECT na.*, np.content, np.title, np.score, np.sentiment, np.urgency, np.published_at, np.source_key
         FROM news_analysis na
         JOIN news_processed np ON na.news_id = np.id
         WHERE na.id = ?`,
        [req.params.id],
        (err, r) => { if (err) reject(err); else resolve(r); }
      );
    });
    if (!row) return res.status(404).json({ success: false, error: '分析记录不存在' });
    row.analysis = row.analysis ? (() => { try { return JSON.parse(row.analysis); } catch { return row.analysis; } })() : null;
    row.stock_recommendations = row.stock_recommendations ? (() => { try { return JSON.parse(row.stock_recommendations); } catch { return []; } })() : [];
    res.json({ success: true, data: row });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * 今日新闻统计
 * @route GET /api/news/stats
 */
app.get('/api/news/stats', async (req, res) => {
  try {
    const [total, scored, byScore, bySentiment, byStatus] = await Promise.all([
      new Promise((resolve, reject) => {
        db.db.get(`SELECT COUNT(*) as cnt FROM news_processed WHERE date(created_at) = date('now')`, [], (err, r) => { if (err) reject(err); else resolve(r?.cnt || 0); });
      }),
      new Promise((resolve, reject) => {
        db.db.get(`SELECT COUNT(*) as cnt FROM news_processed WHERE score IS NOT NULL AND date(created_at) = date('now')`, [], (err, r) => { if (err) reject(err); else resolve(r?.cnt || 0); });
      }),
      new Promise((resolve, reject) => {
        db.db.all(
          `SELECT
            SUM(CASE WHEN score >= 9 THEN 1 ELSE 0 END) as s9,
            SUM(CASE WHEN score >= 7 AND score < 9 THEN 1 ELSE 0 END) as s7,
            SUM(CASE WHEN score >= 5 AND score < 7 THEN 1 ELSE 0 END) as s5,
            SUM(CASE WHEN score >= 3 AND score < 5 THEN 1 ELSE 0 END) as s3,
            SUM(CASE WHEN score < 3 THEN 1 ELSE 0 END) as s0
           FROM news_processed WHERE score IS NOT NULL AND date(created_at) = date('now')`,
          [],
          (err, r) => { if (err) reject(err); else resolve(r?.[0] || {}); }
        );
      }),
      new Promise((resolve, reject) => {
        db.db.all(`SELECT sentiment, COUNT(*) as cnt FROM news_processed WHERE date(created_at) = date('now') GROUP BY sentiment`, [], (err, r) => { if (err) reject(err); else resolve(r || []); });
      }),
      new Promise((resolve, reject) => {
        db.db.all(`SELECT status, COUNT(*) as cnt FROM news_processed WHERE date(created_at) = date('now') GROUP BY status`, [], (err, r) => { if (err) reject(err); else resolve(r || []); });
      }),
    ]);

    res.json({
      success: true,
      data: {
        today_total: total,
        today_scored: scored,
        score_distribution: {
          critical: byScore.s9 || 0,    // 9-10
          important: byScore.s7 || 0,   // 7-8
          normal: byScore.s5 || 0,      // 5-6
          minor: byScore.s3 || 0,       // 3-4
          noise: byScore.s0 || 0,       // 0-2
        },
        sentiment: bySentiment,
        status: byStatus,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ────────────────────────────────────────────────────────────────
// 新闻评分定时调度（每1分钟）
// ────────────────────────────────────────────────────────────────
cron.schedule('* * * * *', async () => {
  try {
    const scorer = require('./services/news-scorer');
    const result = await scorer.scorePendingNews();
    if (result.processed > 0) {
      console.log(`[NewsScorer] 处理 ${result.processed} 条，高分 ${result.highScore} 条`);
    }
  } catch (e) {
    console.error('[NewsScorer] 调度器异常:', e.message);
  }
});

// ────────────────────────────────────────────────────────────────
// Telegram新闻管道路由
// ────────────────────────────────────────────────────────────────
const NewsPoller = require('./services/news-poller');
const { loadNewsSources } = require('./config/news-sources-loader');

const newsPoller = new NewsPoller(db);

// 启动定时轮询（仅在配置了 TG_BOT_TOKEN 或 NEWS_SRC_001 时）
if (process.env.TG_BOT_TOKEN || process.env.NEWS_SRC_001) {
  newsPoller.start();
}

/**
 * 已处理新闻流（分页，按评分降序，无评分的按时间降序）
 * @route GET /api/news/feed
 * @query {number} page - 页码（默认1）
 * @query {number} limit - 每页条数（默认20，最大50）
 * @query {number} minScore - 最低评分过滤
 */
app.get('/api/news/feed', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || '1'));
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || '20')));
    const minScore = parseFloat(req.query.minScore || '0');
    const offset = (page - 1) * limit;

    const rawDb = db.db;
    const rows = await new Promise((resolve, reject) => {
      rawDb.all(
        `SELECT np.*, nr.views
         FROM news_processed np
         LEFT JOIN news_raw nr ON np.raw_id = nr.id
         WHERE np.status != 'dismissed'
           AND (np.score IS NULL OR np.score >= ?)
         ORDER BY np.score DESC NULLS LAST, np.published_at DESC
         LIMIT ? OFFSET ?`,
        [minScore, limit, offset],
        (err, rows) => err ? reject(err) : resolve(rows)
      );
    });

    const total = await new Promise((resolve, reject) => {
      rawDb.get(
        `SELECT COUNT(*) as cnt FROM news_processed WHERE status != 'dismissed'`,
        (err, row) => err ? reject(err) : resolve(row.cnt)
      );
    });

    res.json({
      success: true,
      data: rows.map(r => ({ ...r, stock_codes: JSON.parse(r.stock_codes || '[]') })),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * 待评分新闻数量
 * @route GET /api/news/pending-score
 */
app.get('/api/news/pending-score', async (req, res) => {
  try {
    const rawDb = db.db;
    const row = await new Promise((resolve, reject) => {
      rawDb.get(
        `SELECT COUNT(*) as cnt FROM news_processed WHERE status = 'pending'`,
        (err, r) => err ? reject(err) : resolve(r)
      );
    });
    res.json({ success: true, pending: row.cnt });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * 手动触发一次抓取（需认证）
 * @route POST /api/news/poll
 */
app.post('/api/news/poll', authRequired, async (req, res) => {
  try {
    const result = await newsPoller.pollAll();
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * 查看来源列表（返回别名，不返回真实ID，需认证）
 * @route GET /api/news/sources
 */
app.get('/api/news/sources', authRequired, (req, res) => {
  const sources = loadNewsSources().map(({ key, alias, weight }) => ({ key, alias, weight }));
  res.json({ success: true, count: sources.length, data: sources });
});

// 优雅关闭
process.on('SIGINT', () => {
  console.log('\nClosing database connection...');
  newsPoller.stop();
  db.close();
  process.exit(0);
});

module.exports = app;
