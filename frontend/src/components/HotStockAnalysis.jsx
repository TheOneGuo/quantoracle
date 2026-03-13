import React from 'react';
import './HotStockAnalysis.css';

function HotStockAnalysis({ onBack, holdings, onAddToHoldings }) {
  const hotStocks = [
    { code: 'sh600519', name: '贵州茅台', currentPrice: 1680.5, changePercent: 1.23, reason: '白酒龙头，消费升级受益' },
    { code: 'sz000858', name: '五粮液', currentPrice: 145.8, changePercent: 0.85, reason: '高端白酒，业绩稳健' },
    { code: 'sh601318', name: '中国平安', currentPrice: 48.2, changePercent: -0.42, reason: '保险龙头，估值低位' },
    { code: 'sz300750', name: '宁德时代', currentPrice: 198.6, changePercent: 2.15, reason: '新能源电池领军企业' },
    { code: 'sh600036', name: '招商银行', currentPrice: 35.4, changePercent: 0.56, reason: '优质银行，股息率高' },
  ];

  return (
    <div className="hot-stock-analysis">
      <div className="analysis-header">
        <h2>🔥 爆款投资股票分析</h2>
        <button className="btn-back" onClick={onBack}>← 返回</button>
      </div>
      <div className="hot-stocks-list">
        {hotStocks.map(stock => (
          <div key={stock.code} className="hot-stock-card">
            <div className="stock-info">
              <span className="stock-name">{stock.name}</span>
              <span className="stock-code">{stock.code}</span>
            </div>
            <div className="stock-price">
              <span className="price">¥{stock.currentPrice}</span>
              <span className={`change ${stock.changePercent >= 0 ? 'up' : 'down'}`}>
                {stock.changePercent >= 0 ? '+' : ''}{stock.changePercent}%
              </span>
            </div>
            <p className="stock-reason">{stock.reason}</p>
            <button
              className="btn-add-holding"
              onClick={() => onAddToHoldings && onAddToHoldings(stock)}
            >
              + 加入持仓
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default HotStockAnalysis;
