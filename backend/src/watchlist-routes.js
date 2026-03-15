/**
 * 自选股 & A股筛选 路由
 * 挂载到 main index.js 前引入
 */
const express = require('express');
const router = express.Router();
const axios = require('axios');

// AkShare Python 微服务地址（与 index.js 保持一致）
const NEWS_SERVICE_URL = process.env.NEWS_SERVICE_URL || 'http://localhost:8767';

// 热股缓存（60秒有效，避免频繁调用 AkShare）
let hotStocksCache = { data: null, updatedAt: 0 };
const HOT_STOCKS_CACHE_TTL = 60 * 1000; // 60秒

// 港股缓存（60秒有效）
let hkSpotCache = { data: null, updatedAt: 0 };

module.exports = function(app, db, stockAPI) {

  // ===== 自选股 =====
  // 获取自选股列表（含实时行情）
  app.get('/api/watchlist', async (req, res) => {
    try {
      const rows = await new Promise((resolve, reject) => {
        db.db.all('SELECT * FROM watchlist ORDER BY created_at DESC', [], (err, rows) => {
          if (err) reject(err); else resolve(rows);
        });
      });
      // 批量拉行情
      const codes = rows.map(r => r.code);
      let quoteMap = {};
      if (codes.length > 0) {
        try {
          const quotes = await Promise.all(codes.map(c => stockAPI.getRealtimeQuote(c).catch(() => null)));
          quotes.forEach((q, i) => { if (q) quoteMap[codes[i]] = q; });
        } catch(e) {}
      }
      const data = rows.map(r => ({ ...r, quote: quoteMap[r.code] || null }));
      res.json({ success: true, data });
    } catch(e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // 添加自选股
  app.post('/api/watchlist', async (req, res) => {
    const { code, name, note } = req.body;
    if (!code || !name) return res.status(400).json({ success: false, error: '缺少 code 或 name' });
    try {
      await new Promise((resolve, reject) => {
        db.db.run(
          'INSERT INTO watchlist (code, name, note) VALUES (?, ?, ?) ON CONFLICT(code) DO UPDATE SET name=excluded.name, note=excluded.note',
          [code, name, note || ''], (err) => { if (err) reject(err); else resolve(); }
        );
      });
      res.json({ success: true });
    } catch(e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // 删除自选股
  app.delete('/api/watchlist/:code', async (req, res) => {
    try {
      await new Promise((resolve, reject) => {
        db.db.run('DELETE FROM watchlist WHERE code = ?', [req.params.code], (err) => { if (err) reject(err); else resolve(); });
      });
      res.json({ success: true });
    } catch(e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

    // ===== A股热股筛选（接入 AkShare 真实涨幅榜，60秒缓存）=====
  app.get('/api/screen/hot-stocks', async (req, res) => {
    const now = Date.now();
    
    // 命中缓存直接返回
    if (hotStocksCache.data && (now - hotStocksCache.updatedAt) < HOT_STOCKS_CACHE_TTL) {
      return res.json({
        success: true,
        data: hotStocksCache.data,
        cached: true,
        updatedAt: new Date(hotStocksCache.updatedAt).toISOString()
      });
    }
    
    try {
      // 调用 AkShare Python 微服务获取 A股实时涨幅榜
      const resp = await axios.get(`${NEWS_SERVICE_URL}/hot-stocks?limit=20`, { timeout: 10000 });
      if (resp.data && resp.data.success && resp.data.data) {
        hotStocksCache = { data: resp.data.data, updatedAt: now };
        return res.json({
          success: true,
          data: resp.data.data,
          cached: false,
          is_simulated: false,
          updatedAt: new Date().toISOString()
        });
      }
      throw new Error('AkShare 返回空数据');
    } catch (err) {
      console.warn('[/api/screen/hot-stocks] AkShare 失败，降级模拟数据:', err.message);
      
      // 降级：返回静态模拟数据并标注 is_simulated: true
      const mockData = [
        { code: 'sh688256', name: '寒武纪', price: 378.5, change_pct: 8.23, pe: null, market_cap: 1520e8 },
        { code: 'sz002230', name: '科大讯飞', price: 42.8, change_pct: 6.15, pe: 28.3, market_cap: 356e8 },
        { code: 'sz002371', name: '北方华创', price: 285.4, change_pct: 5.82, pe: 22.1, market_cap: 442e8 },
        { code: 'sh688981', name: '中芯国际', price: 68.9, change_pct: 7.43, pe: 18.7, market_cap: 548e8 },
        { code: 'sz300750', name: '宁德时代', price: 198.6, change_pct: 5.21, pe: 19.4, market_cap: 4320e8 },
        { code: 'sz002594', name: '比亚迪', price: 315.2, change_pct: 6.78, pe: 24.6, market_cap: 9150e8 },
        { code: 'sh603259', name: '药明康德', price: 58.7, change_pct: 9.12, pe: 16.3, market_cap: 318e8 },
        { code: 'sh600519', name: '贵州茅台', price: 1680, change_pct: 3.15, pe: 27.2, market_cap: 21120e8 },
      ];
      return res.json({
        success: true,
        data: mockData,
        cached: false,
        is_simulated: true,
        error_reason: err.message,
        updatedAt: new Date().toISOString()
      });
    }
  });

  // ===== 港股实时行情（接入 AkShare stock_hk_spot_em，60秒缓存）=====
  app.get('/api/hk/spot', async (req, res) => {
    const now = Date.now();
    
    // 命中缓存直接返回
    if (hkSpotCache.data && (now - hkSpotCache.updatedAt) < HOT_STOCKS_CACHE_TTL) {
      return res.json({
        success: true,
        data: hkSpotCache.data,
        cached: true,
        updatedAt: new Date(hkSpotCache.updatedAt).toISOString()
      });
    }
    
    try {
      // 调用 AkShare Python 微服务获取港股实时行情
      const limit = req.query.limit || 100;
      const resp = await axios.get(`${NEWS_SERVICE_URL}/hk-spot?limit=${limit}`, { timeout: 10000 });
      if (resp.data && resp.data.success && resp.data.data) {
        hkSpotCache = { data: resp.data.data, updatedAt: now };
        return res.json({
          success: true,
          data: resp.data.data,
          cached: false,
          is_simulated: false,
          updatedAt: new Date().toISOString()
        });
      }
      throw new Error('AkShare 港股数据为空');
    } catch (err) {
      console.error('[/api/hk/spot] 港股数据获取失败:', err.message);
      return res.status(503).json({
        success: false,
        error: `港股数据获取失败: ${err.message}`,
        is_simulated: true,
        data: []
      });
    }
  });

};
