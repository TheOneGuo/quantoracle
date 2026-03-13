/**
 * 自选股 & A股筛选 路由
 * 挂载到 main index.js 前引入
 */
const express = require('express');
const router = express.Router();

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

  // ===== A股筛选（模拟数据，后续接 AkShare） =====
  app.get('/api/screen/hot-stocks', async (req, res) => {
    // 模拟筛选结果，后续可接入 AkShare python 服务
    const mockData = [
      { code: 'sh688256', name: '寒武纪', current: 378.5, changePercent: 8.23, pe: null, industry: 'AI芯片', reason: 'AI算力需求爆发，国产GPU龙头', marketCap: 1520 },
      { code: 'sz002230', name: '科大讯飞', current: 42.8, changePercent: 6.15, pe: 28.3, industry: 'AI应用', reason: '大模型落地加速，教育+政务双轮驱动', marketCap: 356 },
      { code: 'sz002371', name: '北方华创', current: 285.4, changePercent: 5.82, pe: 22.1, industry: '半导体设备', reason: '国产替代加速，刻蚀机龙头', marketCap: 442 },
      { code: 'sh688981', name: '中芯国际', current: 68.9, changePercent: 7.43, pe: 18.7, industry: '半导体', reason: '14nm量产提速，先进制程突破', marketCap: 548 },
      { code: 'sz300750', name: '宁德时代', current: 198.6, changePercent: 5.21, pe: 19.4, industry: '新能源', reason: '固态电池进展超预期，欧美订单回暖', marketCap: 4320 },
      { code: 'sz002594', name: '比亚迪', current: 315.2, changePercent: 6.78, pe: 24.6, industry: '新能源车', reason: '2月销量创历史新高，海外市场扩张', marketCap: 9150 },
      { code: 'sz300760', name: '迈瑞医疗', current: 226.4, changePercent: 5.44, pe: 27.8, industry: '医疗器械', reason: '海外市场持续扩张，设备升级周期', marketCap: 276 },
      { code: 'sh603259', name: '药明康德', current: 58.7, changePercent: 9.12, pe: 16.3, industry: '医药CRO', reason: '全球创新药研发回暖，订单量改善', marketCap: 318 },
      { code: 'sh600519', name: '贵州茅台', current: 1680, changePercent: 3.15, pe: 27.2, industry: '消费白酒', reason: '春节动销超预期，直销渠道占比提升', marketCap: 21120 },
      { code: 'sz002415', name: '海康威视', current: 28.4, changePercent: 5.67, pe: 14.8, industry: 'AI安防', reason: 'AI摄像头升级换代，政府采购恢复', marketCap: 267 },
    ];
    // 筛选条件过滤
    const filtered = mockData.filter(s => {
      const peOk = !s.pe || s.pe < 30;
      const changeOk = s.changePercent >= 3;
      return peOk && changeOk;
    });
    res.json({ success: true, data: filtered, filters: { pe: 30, minChange: 3, marketCapRange: '50-500亿' }, updatedAt: new Date().toISOString() });
  });

};
