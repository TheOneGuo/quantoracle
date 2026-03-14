import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './Dashboard.css';

const API_BASE = 'http://localhost:3001/api';

const MARKET_INDEXES = [
  { code: 'sh000001', name: '上证指数', color: '#e53e3e' },
  { code: 'sh000300', name: '沪深300', color: '#38a169' },
  { code: 'sz399001', name: '深证成指', color: '#3182ce' },
  { code: 'sz399006', name: '创业板指', color: '#805ad5' },
  { code: 'sh000905', name: '中证500', color: '#dd6b20' },
  { code: 'sh000016', name: '上证50', color: '#d53f8c' }
];

const Dashboard = () => {
  const [marketData, setMarketData] = useState([]);
  const [recentSignals, setRecentSignals] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMarketData();
    fetchRecentSignals();
  }, []);

  const fetchMarketData = async () => {
    try {
      const codes = MARKET_INDEXES.map(i => i.code);
      const res = await axios.post(`${API_BASE}/stocks/batch`, { codes });
      const dataWithNames = res.data.data.map(item => {
        const indexInfo = MARKET_INDEXES.find(i => i.code === item.code);
        return { ...item, name: indexInfo?.name || item.name, color: indexInfo?.color };
      });
      setMarketData(dataWithNames);
    } catch (error) {
      console.error('Failed to fetch market data:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchRecentSignals = async () => {
    // 模拟最近信号数据
    const mockSignals = [
      { id: 1, stock: '贵州茅台', code: 'sh600519', action: '买入', reason: '突破阻力位', time: '10:30', priority: 'high' },
      { id: 2, stock: '宁德时代', code: 'sz300750', action: '减仓', reason: '达到目标价', time: '11:15', priority: 'medium' },
      { id: 3, stock: '招商银行', code: 'sh600036', action: '持有', reason: '趋势良好', time: '13:45', priority: 'low' },
      { id: 4, stock: '中国平安', code: 'sh601318', action: '清仓', reason: '跌破支撑', time: '14:20', priority: 'high' },
      { id: 5, stock: '比亚迪', code: 'sz002594', action: '买入', reason: '金叉信号', time: '15:00', priority: 'medium' }
    ];
    setRecentSignals(mockSignals);
  };

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'high': return '#f56565';
      case 'medium': return '#ed8936';
      case 'low': return '#48bb78';
      default: return '#a0aec0';
    }
  };

  const getActionColor = (action) => {
    switch (action) {
      case '买入': return '#38a169';
      case '减仓': return '#ed8936';
      case '清仓': return '#e53e3e';
      case '持有': return '#3182ce';
      default: return '#718096';
    }
  };

  return (
    <div className="dashboard-container">
      <div className="dashboard-header">
        <h1>📊 大盘总览</h1>
        <p>实时监控A股主要指数表现和交易信号</p>
      </div>

      {/* 大盘指数卡片 */}
      <div className="market-cards">
        {loading ? (
          <div className="loading">加载中...</div>
        ) : (
          marketData.map((index) => (
            <div key={index.code} className="market-card" style={{ borderLeftColor: index.color }}>
              <div className="market-card-header">
                <span className="index-name">{index.name}</span>
                <span className="index-code">{index.code}</span>
              </div>
              <div className="market-card-body">
                <div className="price-row">
                  <span className="current-price">¥{index.current?.toFixed(2)}</span>
                  <span className={`change ${index.changePercent >= 0 ? 'up' : 'down'}`}>
                    {index.changePercent >= 0 ? '+' : ''}{index.changePercent?.toFixed(2)}%
                  </span>
                </div>
                <div className="detail-row">
                  <span className="detail-item">
                    <label>涨跌</label>
                    <value className={index.change >= 0 ? 'up' : 'down'}>
                      {index.change >= 0 ? '+' : ''}{index.change?.toFixed(2)}
                    </value>
                  </span>
                  <span className="detail-item">
                    <label>振幅</label>
                    <value>{index.amplitude?.toFixed(2)}%</value>
                  </span>
                </div>
                <div className="range-row">
                  <span className="range-item">
                    <label>高</label>
                    <value>¥{index.high?.toFixed(2)}</value>
                  </span>
                  <span className="range-item">
                    <label>低</label>
                    <value>¥{index.low?.toFixed(2)}</value>
                  </span>
                  <span className="range-item">
                    <label>量</label>
                    <value>{(index.volume / 1000000).toFixed(1)}M</value>
                  </span>
                </div>
              </div>
              <div className="market-card-footer">
                <div className="trend-indicator">
                  <div 
                    className="trend-bar" 
                    style={{ 
                      width: `${Math.min(Math.abs(index.changePercent) * 5, 100)}%`,
                      backgroundColor: index.changePercent >= 0 ? '#48bb78' : '#f56565'
                    }}
                  />
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* 涨跌统计 */}
      <div className="stats-section">
        <div className="stat-card">
          <div className="stat-icon" style={{ background: '#38a169' }}>📈</div>
          <div className="stat-content">
            <h3>上涨指数</h3>
            <p className="stat-value">
              {marketData.filter(d => d.changePercent > 0).length}
              <span className="stat-label"> / {marketData.length}</span>
            </p>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: '#e53e3e' }}>📉</div>
          <div className="stat-content">
            <h3>下跌指数</h3>
            <p className="stat-value">
              {marketData.filter(d => d.changePercent < 0).length}
              <span className="stat-label"> / {marketData.length}</span>
            </p>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: '#3182ce' }}>📊</div>
          <div className="stat-content">
            <h3>平均涨跌</h3>
            <p className="stat-value">
              {marketData.length > 0 
                ? (marketData.reduce((sum, d) => sum + d.changePercent, 0) / marketData.length).toFixed(2) + '%'
                : '0.00%'
              }
            </p>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: '#805ad5' }}>⚡</div>
          <div className="stat-content">
            <h3>平均振幅</h3>
            <p className="stat-value">
              {marketData.length > 0 
                ? (marketData.reduce((sum, d) => sum + d.amplitude, 0) / marketData.length).toFixed(2) + '%'
                : '0.00%'
              }
            </p>
          </div>
        </div>
      </div>

      {/* 最近信号列表 */}
      <div className="signals-section">
        <div className="section-header">
          <h2>📢 最近信号</h2>
          <button className="btn-refresh" onClick={fetchRecentSignals}>刷新</button>
        </div>
        <div className="signals-table">
          <table>
            <thead>
              <tr>
                <th>股票</th>
                <th>代码</th>
                <th>信号</th>
                <th>原因</th>
                <th>时间</th>
                <th>优先级</th>
              </tr>
            </thead>
            <tbody>
              {recentSignals.map(signal => (
                <tr key={signal.id}>
                  <td>
                    <span className="stock-name">{signal.stock}</span>
                  </td>
                  <td>
                    <span className="stock-code">{signal.code}</span>
                  </td>
                  <td>
                    <span 
                      className="action-tag" 
                      style={{ backgroundColor: getActionColor(signal.action) }}
                    >
                      {signal.action}
                    </span>
                  </td>
                  <td>
                    <span className="reason">{signal.reason}</span>
                  </td>
                  <td>
                    <span className="time">{signal.time}</span>
                  </td>
                  <td>
                    <span 
                      className="priority-dot" 
                      style={{ backgroundColor: getPriorityColor(signal.priority) }}
                    />
                    <span className="priority-text">{signal.priority}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;