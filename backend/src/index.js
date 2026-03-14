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

// 自选股 & A股筛选路由
watchlistRoutes(app, db, stockAPI);

// 实盘对接路由（M5）
const brokerRoutes = require('./broker/broker-routes');
app.use('/api/broker', brokerRoutes);

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
app.post('/api/holdings', async (req, res) => {
  try {
    const { code, name, trades } = req.body;
    
    // 保存到数据库
    await db.addHolding(code, name);
    
    for (const trade of trades) {
      await db.addTrade(code, trade.buyPrice, trade.quantity, trade.buyDate);
    }
    
    // 获取最新持仓数据
    const holdings = await db.getHoldings();
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
app.post('/api/holdings/:code/trades', async (req, res) => {
  try {
    const { code } = req.params;
    const { buyPrice, sellPrice, quantity, buyDate, sellDate, type } = req.body;
    
    // 判断是买入还是卖出
    if (type === 'sell' && sellPrice) {
      // 卖出操作
      await db.addSellTrade(code, sellPrice, quantity, sellDate);
    } else {
      // 买入操作
      await db.addTrade(code, buyPrice, quantity, buyDate);
    }
    
    // 获取最新持仓数据
    const holdings = await db.getHoldings();
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
app.delete('/api/holdings/:code', async (req, res) => {
  try {
    const { code } = req.params;
    await db.deleteHolding(code);
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
app.get('/api/holdings', async (req, res) => {
  try {
    // 从数据库获取持仓
    const holdings = await db.getHoldings();
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

server.listen(PORT, () => {
  console.log(`Stock Platform API running on port ${PORT}`);
  console.log(`Using data provider: ${process.env.STOCK_API_PROVIDER || 'sina'}`);
  console.log(`Database: SQLite (persistent storage)`);
  console.log(`WebSocket: ws://localhost:${PORT}/ws`);
});

// DeepSeek AI API 代理
app.post('/api/ai/deepseek', async (req, res) => {
  try {
    const { messages, apiKey } = req.body;
    
    if (!apiKey) {
      return res.status(400).json({ error: 'Missing API key' });
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

// Kimi AI API 代理
app.post('/api/ai/kimi', async (req, res) => {
  try {
    const { messages, apiKey } = req.body;
    
    if (!apiKey) {
      return res.status(400).json({ error: 'Missing API key' });
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

// 豆包 AI API 代理
app.post('/api/ai/doubao', async (req, res) => {
  try {
    const { messages, apiKey } = req.body;
    
    if (!apiKey) {
      return res.status(400).json({ error: 'Missing API key' });
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
 * @returns {Object} 用户 token 余额信息
 */
app.get('/api/usage/balance', async (req, res) => {
    try {
        const userId = req.query.user_id || DEFAULT_USER_ID;
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
 * @query {number} limit - 返回记录数（默认50）
 * @query {number} offset - 偏移量（默认0）
 * @returns {Object} token 使用历史记录
 */
app.get('/api/usage/history', async (req, res) => {
    try {
        const userId = req.query.user_id || DEFAULT_USER_ID;
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
 * @body {Object} usageData - 使用数据
 * @returns {Object} 扣减结果
 */
app.post('/api/usage/deduct', async (req, res) => {
    try {
        const { user_id = DEFAULT_USER_ID, usage_data } = req.body;
        
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
        const result = await db.deductTokens(user_id, usage_data);
        
        res.json({
            success: true,
            user_id,
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
 * @query {number} days - 统计天数（默认30）
 * @returns {Object} token 使用统计数据
 */
app.get('/api/usage/stats', async (req, res) => {
    try {
        const userId = req.query.user_id || DEFAULT_USER_ID;
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
 * @body {number} tokens - 增加的 token 数量
 * @body {string} purchase_method - 购买方式（system/test/user）
 * @returns {Object} 充值结果
 */
app.post('/api/usage/add', async (req, res) => {
    try {
        const { user_id = DEFAULT_USER_ID, tokens, purchase_method = 'system' } = req.body;
        
        if (!tokens || tokens <= 0) {
            return res.status(400).json({
                success: false,
                error: '必须提供有效的 tokens 数量'
            });
        }
        
        const result = await db.addTokens(user_id, tokens, purchase_method);
        
        res.json({
            success: true,
            user_id,
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
 * 获取策略详情
 */
app.get('/api/marketplace/strategies/:id', (req, res) => {
  const mock = MOCK_STRATEGIES.find(s => s.id === req.params.id);
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
 * 订阅策略
 */
app.post('/api/marketplace/subscribe', (req, res) => {
  const { strategy_id, plan = 'monthly', user_id = DEFAULT_USER_ID } = req.body;
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

// 优雅关闭
process.on('SIGINT', () => {
  console.log('\nClosing database connection...');
  db.close();
  process.exit(0);
});

module.exports = app;
