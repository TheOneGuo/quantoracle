import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './HotStockAnalysis.css';
import { getMarketColor, getChangeColor } from '../constants/marketColors';

const API_BASE = 'http://localhost:3001/api';

// 市场选项
const MARKET_OPTIONS = [
  { value: 'A股', label: 'A股', icon: '🇨🇳' },
  { value: '美股', label: '美股', icon: '🇺🇸' },
  { value: '港股', label: '港股', icon: '🇭🇰' }
];

// 风格选项
const STYLE_OPTIONS = [
  { value: 'conservative', label: '保守', icon: '🛡️' },
  { value: 'neutral', label: '中性', icon: '⚖️' },
  { value: 'aggressive', label: '激进', icon: '🚀' }
];

function HotStockAnalysis({ onBack, holdings, onAddToHoldings }) {
  // 状态管理
  const [stocks, setStocks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [error, setError] = useState(null);
  
  // 筛选参数
  const [market, setMarket] = useState('A股');
  const [style, setStyle] = useState('neutral');
  const [useNewsFactor, setUseNewsFactor] = useState(false);
  const [isFallback, setIsFallback] = useState(false);
  
  // 扩展状态
  const [expandedStocks, setExpandedStocks] = useState({});
  const [kronosSignals, setKronosSignals] = useState({});

  // 获取股票数据
  const fetchStocks = async () => {
    setLoading(true);
    setError(null);
    setIsFallback(false);
    
    try {
      // 尝试调用新的 AI 选股接口
      const res = await axios.post(`${API_BASE}/ai/screen`, {
        market,
        style,
        count: 10,
        use_news_factor: useNewsFactor,
        filters: {
          pe_max: 30,
          market_cap_min: 50,
          market_cap_max: 5000
        }
      }, { timeout: 30000 });
      
      if (res.data.success) {
        setStocks(res.data.stocks || []);
        setIsFallback(res.data.is_fallback || false);
        setLastUpdated(new Date());
        
        // 如果有股票，获取 Kronos 信号
        if (res.data.stocks && res.data.stocks.length > 0) {
          fetchKronosSignals(res.data.stocks);
        }
      } else {
        throw new Error(res.data.error || 'AI选股服务返回失败');
      }
    } catch (e) {
      console.error('AI选股失败，回退到基础筛选:', e);
      
      // 回退到基础筛选
      try {
        const fallbackRes = await axios.get(`${API_BASE}/screen/hot-stocks`);
        if (fallbackRes.data.success) {
          setStocks(fallbackRes.data.data);
          setIsFallback(true);
          setLastUpdated(new Date());
          setError('AI 服务不可达，显示基础筛选结果');
        } else {
          throw new Error('基础筛选也失败');
        }
      } catch (fallbackError) {
        setError('获取数据失败，请检查后端服务是否运行');
        console.error(fallbackError);
      }
    } finally {
      setLoading(false);
    }
  };

  // 获取 Kronos 择时信号
  const fetchKronosSignals = async (stocksList) => {
    const signals = {};
    const promises = stocksList.slice(0, 5).map(async (stock) => { // 只获取前5个
      try {
        const res = await axios.get(`${API_BASE}/kronos/predict/${stock.code}`, {
          params: { model: 'kronos-base', pred_len: 20 },
          timeout: 10000
        });
        if (res.data.success) {
          signals[stock.code] = res.data;
        }
      } catch (e) {
        console.error(`获取 ${stock.code} Kronos 信号失败:`, e);
      }
    });
    
    await Promise.all(promises);
    setKronosSignals(signals);
  };

  // 初始化加载
  useEffect(() => {
    fetchStocks();
  }, [market, style, useNewsFactor]); // 参数变化时重新加载

  // 切换股票详情展开状态
  const toggleStockDetails = (code) => {
    setExpandedStocks(prev => ({
      ...prev,
      [code]: !prev[code]
    }));
  };

  // 检查是否在持仓中
  const isInHoldings = (code) => holdings?.some(h => h.code === code);

  // 渲染评分条
  const renderScoreBar = (score, label, color) => {
    const percentage = Math.round(score * 100);
    return (
      <div className="score-bar-container">
        <div className="score-bar-label">{label}</div>
        <div className="score-bar-bg">
          <div 
            className="score-bar-fill" 
            style={{ 
              width: `${percentage}%`,
              backgroundColor: color
            }}
          />
        </div>
        <div className="score-bar-value">{percentage}%</div>
      </div>
    );
  };

  // 渲染多维度评分
  const renderMultiScores = (scores) => {
    if (!scores) return null;
    
    const dimensions = [
      { key: 'fundamental', label: '基本面', color: '#4299e1' },
      { key: 'technical', label: '技术面', color: '#ed8936' },
      { key: 'sentiment', label: '情绪面', color: '#9f7aea' },
      { key: 'news', label: '新闻面', color: '#f56565' },
      { key: 'debate', label: '辩论', color: '#48bb78' }
    ];
    
    return (
      <div className="multi-scores-container">
        {dimensions.map(dim => {
          const score = scores[dim.key];
          if (score === undefined) return null;
          return (
            <div key={dim.key} className="score-dimension">
              <div className="dimension-label">{dim.label}</div>
              <div className="dimension-bar">
                <div 
                  className="dimension-fill"
                  style={{ 
                    width: `${score * 100}%`,
                    backgroundColor: dim.color
                  }}
                />
              </div>
              <div className="dimension-value">{score.toFixed(2)}</div>
            </div>
          );
        })}
      </div>
    );
  };

  // 渲染 Kronos 信号
  const renderKronosSignal = (code) => {
    const signal = kronosSignals[code];
    if (!signal) return null;
    
    const trendColor = getMarketColor(market, signal.trend);
    const confidencePercentage = Math.round(signal.confidence * 100);
    
    return (
      <div className="kronos-signal">
        <div className="kronos-header">
          <span className="kronos-label">Kronos择时</span>
          <span 
            className="kronos-trend" 
            style={{ color: trendColor, fontWeight: 'bold' }}
          >
            {signal.trend === 'bullish' ? '看涨' : 
             signal.trend === 'bearish' ? '看跌' : '中性'}
          </span>
        </div>
        <div className="kronos-details">
          <div className="kronos-confidence">
            置信度: {confidencePercentage}%
            <div className="confidence-bar">
              <div 
                className="confidence-fill"
                style={{ width: `${confidencePercentage}%` }}
              />
            </div>
          </div>
          {signal.entry_signal && (
            <span className="signal-badge entry">开仓信号</span>
          )}
          {signal.exit_signal && (
            <span className="signal-badge exit">平仓信号</span>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="hot-stock-analysis">
      {/* 头部控制栏 */}
      <div className="analysis-header">
        <div className="header-left">
          <h2>🤖 AI智能选股</h2>
          {lastUpdated && (
            <span className="update-time">
              更新于 {lastUpdated.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
        <div className="header-right">
          <button 
            className="btn-refresh" 
            onClick={fetchStocks} 
            disabled={loading}
          >
            {loading ? '刷新中...' : '🔄 刷新'}
          </button>
          <button className="btn-back" onClick={onBack}>← 返回</button>
        </div>
      </div>

      {/* 参数配置栏 */}
      <div className="config-panel">
        <div className="config-group">
          <label>市场选择</label>
          <div className="market-selector">
            {MARKET_OPTIONS.map(option => (
              <button
                key={option.value}
                className={`market-btn ${market === option.value ? 'active' : ''}`}
                onClick={() => setMarket(option.value)}
              >
                {option.icon} {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="config-group">
          <label>投资风格</label>
          <div className="style-selector">
            {STYLE_OPTIONS.map(option => (
              <button
                key={option.value}
                className={`style-btn ${style === option.value ? 'active' : ''}`}
                onClick={() => setStyle(option.value)}
              >
                {option.icon} {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="config-group">
          <label>新闻因子</label>
          <div className="toggle-switch">
            <input
              type="checkbox"
              id="news-toggle"
              checked={useNewsFactor}
              onChange={(e) => setUseNewsFactor(e.target.checked)}
            />
            <label htmlFor="news-toggle" className="toggle-label">
              <span className="toggle-slider"></span>
              <span className="toggle-text">
                {useNewsFactor ? '开启' : '关闭'}
              </span>
            </label>
            <div className="toggle-description">
              分析地缘政治和新闻事件影响
            </div>
          </div>
        </div>
      </div>

      {/* 警告提示 */}
      {isFallback && (
        <div className="fallback-warning">
          ⚠️ AI 服务不可达，显示{error ? '基础筛选' : '模拟'}结果
        </div>
      )}
      
      {error && !isFallback && (
        <div className="error-warning">
          ⚠️ {error}
        </div>
      )}

      {/* 加载状态 */}
      {loading && stocks.length === 0 && (
        <div className="loading-state">
          <div className="loading-spinner"></div>
          <div>AI分析中，请稍候...</div>
        </div>
      )}

      {/* 股票列表 */}
      <div className="hot-stocks-list">
        {stocks.map(stock => (
          <div key={stock.code} className="hot-stock-card">
            {/* 股票基本信息 */}
            <div className="stock-header">
              <div className="stock-info">
                <span className="stock-name">{stock.name}</span>
                <span className="stock-code">{stock.code}</span>
                <span className="industry-tag">{stock.industry}</span>
              </div>
              <div className="stock-confidence">
                <div className="confidence-score">
                  AI评分: <strong>{stock.confidence?.toFixed(2) || '0.00'}</strong>
                </div>
                <div className="risk-badge">
                  {stock.risk === 'low' ? '低风险' : 
                   stock.risk === 'high' ? '高风险' : '中风险'}
                </div>
              </div>
            </div>

            {/* 多维度评分 */}
            <div className="stock-scores">
              {renderMultiScores(stock.scores)}
            </div>

            {/* Kronos择时信号 */}
            {renderKronosSignal(stock.code)}

            {/* AI分析理由 */}
            <div className="stock-reason">
              <div className="reason-header">
                <span>AI分析理由</span>
                <button 
                  className="expand-btn"
                  onClick={() => toggleStockDetails(stock.code)}
                >
                  {expandedStocks[stock.code] ? '收起' : '展开'}
                </button>
              </div>
              <div className={`reason-content ${expandedStocks[stock.code] ? 'expanded' : ''}`}>
                {stock.reason}
                {stock.analysis_details && (
                  <div className="analysis-details">
                    <div className="detail-item">
                      <strong>投资建议:</strong> {stock.analysis_details.investment_advice}
                    </div>
                    {stock.analysis_details.key_risks && stock.analysis_details.key_risks.length > 0 && (
                      <div className="detail-item">
                        <strong>主要风险:</strong> {stock.analysis_details.key_risks.join('; ')}
                      </div>
                    )}
                    {stock.analysis_details.key_opportunities && stock.analysis_details.key_opportunities.length > 0 && (
                      <div className="detail-item">
                        <strong>主要机会:</strong> {stock.analysis_details.key_opportunities.join('; ')}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* 操作按钮 */}
            <div className="card-actions">
              <button
                className="btn-add-holding"
                disabled={isInHoldings(stock.code)}
                onClick={() => onAddToHoldings && onAddToHoldings(stock)}
              >
                {isInHoldings(stock.code) ? '✅ 已持仓' : '+ 加入持仓'}
              </button>
              <button 
                className="btn-details"
                onClick={() => toggleStockDetails(stock.code)}
              >
                {expandedStocks[stock.code] ? '收起详情' : '查看详情'}
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* 空状态 */}
      {!loading && stocks.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">📊</div>
          <div className="empty-text">暂无符合条件的股票</div>
          <button className="btn-retry" onClick={fetchStocks}>
            重新筛选
          </button>
        </div>
      )}

      {/* 底部提示 */}
      <div className="footer-note">
        <p>
          <strong>颜色方向说明:</strong> {market}市场采用
          {market === 'A股' || market === '港股' ? '红涨绿跌' : '绿涨红跌'}习惯。
          用户可在设置页自定义颜色。
        </p>
        <p>
          <strong>数据说明:</strong> {isFallback ? '当前为模拟/基础数据。' : '当前为AI分析结果。'}
          投资有风险，决策需谨慎。
        </p>
      </div>
    </div>
  );
}

export default HotStockAnalysis;