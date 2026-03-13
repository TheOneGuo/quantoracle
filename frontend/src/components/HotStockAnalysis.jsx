import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './HotStockAnalysis.css';

const API_BASE = 'http://localhost:3001/api';

const FILTER_BADGES = [
  { label: 'PE < 30', icon: '📊' },
  { label: '5日涨幅 > 3%', icon: '📈' },
  { label: '量能放大 > 150%', icon: '🔊' },
  { label: '市值 50-500亿', icon: '💰' },
  { label: 'AI/半导体/新能源/医药/消费', icon: '🏭' },
];

function HotStockAnalysis({ onBack, holdings, onAddToHoldings }) {
  const [stocks, setStocks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [error, setError] = useState(null);

  const fetchStocks = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get(`${API_BASE}/screen/hot-stocks`);
      if (res.data.success) {
        setStocks(res.data.data);
        setLastUpdated(new Date());
      }
    } catch (e) {
      setError('获取数据失败，请检查后端服务是否运行');
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchStocks(); }, []);

  const isInHoldings = (code) => holdings?.some(h => h.code === code);

  return (
    <div className="hot-stock-analysis">
      <div className="analysis-header">
        <div>
          <h2>🔥 A股智能筛选</h2>
          {lastUpdated && (
            <span style={{ fontSize: 12, color: '#718096', marginLeft: 8 }}>
              更新于 {lastUpdated.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-refresh" onClick={fetchStocks} disabled={loading}>
            {loading ? '刷新中...' : '🔄 刷新'}
          </button>
          <button className="btn-back" onClick={onBack}>← 返回</button>
        </div>
      </div>

      {/* 筛选条件 */}
      <div className="filter-bar">
        {FILTER_BADGES.map(f => (
          <span key={f.label} className="filter-badge">
            {f.icon} {f.label}
          </span>
        ))}
      </div>

      {error && (
        <div style={{ padding: 16, color: '#f56565', background: 'rgba(245,101,101,.1)', borderRadius: 8, margin: '12px 0', fontSize: 13 }}>
          ⚠️ {error}
        </div>
      )}

      {loading && stocks.length === 0 && (
        <div style={{ padding: 32, textAlign: 'center', color: '#718096' }}>加载中...</div>
      )}

      <div className="hot-stocks-list">
        {stocks.map(stock => (
          <div key={stock.code} className="hot-stock-card">
            <div className="stock-info">
              <span className="stock-name">{stock.name}</span>
              <span className="stock-code">{stock.code}</span>
              <span className="industry-tag">{stock.industry}</span>
            </div>
            <div className="stock-price">
              <span className="price">¥{stock.current?.toFixed(2)}</span>
              <span className={`change ${stock.changePercent >= 0 ? 'up' : 'down'}`}>
                {stock.changePercent >= 0 ? '+' : ''}{stock.changePercent?.toFixed(2)}%
              </span>
              {stock.pe && (
                <span className="pe-badge">PE {stock.pe}</span>
              )}
            </div>
            <p className="stock-reason">{stock.reason}</p>
            <div className="card-actions">
              <button
                className="btn-add-holding"
                disabled={isInHoldings(stock.code)}
                onClick={() => onAddToHoldings && onAddToHoldings(stock)}
              >
                {isInHoldings(stock.code) ? '✅ 已持仓' : '+ 加入持仓'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default HotStockAnalysis;
