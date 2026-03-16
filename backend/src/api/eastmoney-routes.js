const express = require('express');
const router = express.Router();
const eastmoney = require('./eastmoney');

/**
 * 东方财富金融数据路由
 * 提供以下端点：
 *   POST /api/eastmoney/query      - 金融数据查询（行情、财务、关系）
 *   POST /api/eastmoney/screen     - 智能选股
 *   GET  /api/eastmoney/quote/:code - 单只股票行情（便捷封装）
 */

/**
 * @route POST /api/eastmoney/query
 * @desc  自然语言金融数据查询
 * @body  { "query": "茅台最新股价和市盈率" }
 */
router.post('/query', async (req, res) => {
  const { query } = req.body;
  if (!query || typeof query !== 'string') {
    return res.status(400).json({ error: '缺少 query 参数' });
  }
  try {
    const raw = await eastmoney.queryFinancialData(query);
    const result = eastmoney.parseFinancialDataResult(raw);
    res.json(result);
  } catch (err) {
    console.error('[EastMoney] query error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @route POST /api/eastmoney/screen
 * @desc  智能选股
 * @body  { "keyword": "市盈率低于10的银行股", "pageNo": 1, "pageSize": 20 }
 */
router.post('/screen', async (req, res) => {
  const { keyword, pageNo = 1, pageSize = 20 } = req.body;
  if (!keyword || typeof keyword !== 'string') {
    return res.status(400).json({ error: '缺少 keyword 参数' });
  }
  try {
    const raw = await eastmoney.screenStocks(keyword, pageNo, pageSize);
    const result = eastmoney.parseScreenResult(raw);
    res.json(result);
  } catch (err) {
    console.error('[EastMoney] screen error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @route GET /api/eastmoney/quote/:code
 * @desc  单只股票行情便捷接口
 * @param code - 股票代码，如 600519.SH 或 茅台
 */
router.get('/quote/:code', async (req, res) => {
  const { code } = req.params;
  try {
    const query = `${code} 最新价 涨跌幅 成交量 市盈率`;
    const raw = await eastmoney.queryFinancialData(query);
    const result = eastmoney.parseFinancialDataResult(raw);
    res.json(result);
  } catch (err) {
    console.error('[EastMoney] quote error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
