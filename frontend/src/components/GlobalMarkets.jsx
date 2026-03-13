import React, { useState } from 'react';

const GlobalMarkets = () => {
  const [selectedMarket, setSelectedMarket] = useState('tradingview'); // tradingview 或 ft
  
  const markets = [
    {
      id: 'tradingview',
      name: 'TradingView 全球市场',
      url: 'https://www.tradingview.com/markets/',
      description: 'TradingView 提供的全球市场概览，覆盖股票、期货、外汇、加密货币等'
    },
    {
      id: 'ft',
      name: 'Financial Times 市场',
      url: 'https://markets.ft.com/data',
      description: '金融时报市场数据，提供全球主要指数、外汇和大宗商品行情'
    }
  ];

  const currentMarket = markets.find(market => market.id === selectedMarket);

  // 主要全球市场指数数据（模拟）
  const globalIndices = [
    { name: '道琼斯', symbol: 'DJI', price: 39232.45, change: 125.67, changePercent: 0.32, country: 'US' },
    { name: '标普500', symbol: 'SPX', price: 5205.81, change: 18.45, changePercent: 0.36, country: 'US' },
    { name: '纳斯达克', symbol: 'NDX', price: 16298.34, change: 89.23, changePercent: 0.55, country: 'US' },
    { name: '德国DAX', symbol: 'DAX', price: 18457.92, change: -23.45, changePercent: -0.13, country: 'EU' },
    { name: '英国富时', symbol: 'FTSE', price: 7992.13, change: 12.34, changePercent: 0.15, country: 'UK' },
    { name: '日经225', symbol: 'N225', price: 39581.67, change: 234.56, changePercent: 0.60, country: 'JP' },
    { name: '恒生指数', symbol: 'HSI', price: 16723.45, change: -67.89, changePercent: -0.40, country: 'HK' },
    { name: '上证指数', symbol: 'SH000001', price: 3048.67, change: 12.34, changePercent: 0.41, country: 'CN' }
  ];

  return (
    <div className="global-markets-container">
      <div className="global-header">
        <h1>🌍 全球市场</h1>
        <p>实时监控全球主要金融市场表现</p>
      </div>

      {/* 快速概览 */}
      <div className="quick-overview">
        <h3>📈 全球指数概览</h3>
        <div className="indices-grid">
          {globalIndices.map(index => (
            <div key={index.symbol} className="index-card">
              <div className="index-header">
                <div className="index-name">
                  <span className={`flag ${index.country.toLowerCase()}`}></span>
                  <span>{index.name}</span>
                </div>
                <span className="index-symbol">{index.symbol}</span>
              </div>
              <div className="index-body">
                <div className="price-row">
                  <span className="price">{index.price.toLocaleString()}</span>
                  <span className={`change ${index.changePercent >= 0 ? 'up' : 'down'}`}>
                    {index.change >= 0 ? '+' : ''}{index.change.toFixed(2)} ({index.changePercent >= 0 ? '+' : ''}{index.changePercent.toFixed(2)}%)
                  </span>
                </div>
              </div>
              <div className="index-footer">
                <div className="trend-bar">
                  <div 
                    className="trend-fill"
                    style={{ 
                      width: `${Math.min(Math.abs(index.changePercent) * 20, 100)}%`,
                      backgroundColor: index.changePercent >= 0 ? '#48bb78' : '#f56565'
                    }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 市场选择器 */}
      <div className="market-selector">
        <div className="selector-tabs">
          {markets.map(market => (
            <button
              key={market.id}
              className={`tab-btn ${selectedMarket === market.id ? 'active' : ''}`}
              onClick={() => setSelectedMarket(market.id)}
            >
              {market.name}
            </button>
          ))}
        </div>
        <div className="market-description">
          <p>{currentMarket.description}</p>
        </div>
      </div>

      {/* iframe 容器 */}
      <div className="iframe-wrapper">
        <iframe
          src={currentMarket.url}
          title={currentMarket.name}
          className="market-iframe"
          sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
          allowFullScreen
        />
        <div className="iframe-overlay">
          <div className="overlay-content">
            <span className="overlay-text">正在加载 {currentMarket.name}...</span>
            <div className="loading-spinner"></div>
          </div>
        </div>
      </div>

      {/* 市场分类 */}
      <div className="market-categories">
        <h3>📊 市场分类</h3>
        <div className="category-cards">
          <div className="category-card">
            <div className="category-icon">📈</div>
            <h4>股票市场</h4>
            <p>全球主要股票指数</p>
            <ul>
              <li>美股三大指数</li>
              <li>欧洲主要股市</li>
              <li>亚洲主要股市</li>
            </ul>
          </div>
          <div className="category-card">
            <div className="category-icon">💱</div>
            <h4>外汇市场</h4>
            <p>主要货币对汇率</p>
            <ul>
              <li>美元指数 (DXY)</li>
              <li>欧元/美元</li>
              <li>美元/日元</li>
            </ul>
          </div>
          <div className="category-card">
            <div className="category-icon">🛢️</div>
            <h4>大宗商品</h4>
            <p>能源、金属、农产品</p>
            <ul>
              <li>原油 (WTI/Brent)</li>
              <li>黄金/白银</li>
              <li>铜/铝/铁矿石</li>
            </ul>
          </div>
          <div className="category-card">
            <div className="category-icon">🔗</div>
            <h4>加密货币</h4>
            <p>主流数字货币</p>
            <ul>
              <li>比特币 (BTC)</li>
              <li>以太坊 (ETH)</li>
              <li>其他主流币种</li>
            </ul>
          </div>
        </div>
      </div>

      {/* 时间区域 */}
      <div className="time-zones">
        <h3>⏰ 主要交易时段</h3>
        <div className="timezone-cards">
          <div className="timezone-card active">
            <h4>亚洲时段</h4>
            <p>09:00 - 17:00 (GMT+8)</p>
            <div className="status active">交易中</div>
          </div>
          <div className="timezone-card">
            <h4>欧洲时段</h4>
            <p>15:00 - 23:00 (GMT+8)</p>
            <div className="status inactive">未开盘</div>
          </div>
          <div className="timezone-card">
            <h4>美洲时段</h4>
            <p>21:30 - 04:00 (GMT+8)</p>
            <div className="status inactive">未开盘</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GlobalMarkets;