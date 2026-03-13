import React, { useState } from 'react';

const MarketHeatmap = () => {
  const [selectedMap, setSelectedMap] = useState('eastmoney'); // eastmoney 或 asia
  
  const maps = [
    {
      id: 'eastmoney',
      name: '东方财富云图',
      url: 'https://quote.eastmoney.com/center/heatmap.html',
      description: '东方财富提供的大盘热力图，展示行业和概念板块热度'
    },
    {
      id: 'asia',
      name: 'Asiastocks 热力图',
      url: 'https://heatmap.asiastocks.cc/',
      description: '简洁直观的大盘热力图，实时展示涨跌分布'
    }
  ];

  const currentMap = maps.find(map => map.id === selectedMap);

  return (
    <div className="heatmap-container">
      <div className="heatmap-header">
        <h1>🔥 大盘云图</h1>
        <p>实时监控A股市场热度分布和板块轮动</p>
      </div>

      {/* 地图选择器 */}
      <div className="map-selector">
        <div className="selector-tabs">
          {maps.map(map => (
            <button
              key={map.id}
              className={`tab-btn ${selectedMap === map.id ? 'active' : ''}`}
              onClick={() => setSelectedMap(map.id)}
            >
              {map.name}
            </button>
          ))}
        </div>
        <div className="map-description">
          <p>{currentMap.description}</p>
        </div>
      </div>

      {/* iframe 容器 */}
      <div className="iframe-wrapper">
        <iframe
          src={currentMap.url}
          title={currentMap.name}
          className="heatmap-iframe"
          sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
          allowFullScreen
        />
        <div className="iframe-overlay">
          <div className="overlay-content">
            <span className="overlay-text">正在加载 {currentMap.name}...</span>
            <div className="loading-spinner"></div>
          </div>
        </div>
      </div>

      {/* 使用说明 */}
      <div className="usage-guide">
        <h3>📖 使用说明</h3>
        <div className="guide-cards">
          <div className="guide-card">
            <div className="guide-icon">🎨</div>
            <h4>颜色说明</h4>
            <ul>
              <li><span className="color-sample red"></span> 红色：上涨板块</li>
              <li><span className="color-sample green"></span> 绿色：下跌板块</li>
              <li><span className="color-sample dark"></span> 深色：涨跌幅大</li>
              <li><span className="color-sample light"></span> 浅色：涨跌幅小</li>
            </ul>
          </div>
          <div className="guide-card">
            <div className="guide-icon">🔍</div>
            <h4>操作指南</h4>
            <ul>
              <li>点击板块查看详细数据</li>
              <li>鼠标悬停查看实时信息</li>
              <li>使用滚轮缩放视图</li>
              <li>拖动鼠标平移画面</li>
            </ul>
          </div>
          <div className="guide-card">
            <div className="guide-icon">💡</div>
            <h4>投资提示</h4>
            <ul>
              <li>关注连续上涨的红色板块</li>
              <li>警惕大面积绿色下跌</li>
              <li>注意板块轮动节奏</li>
              <li>结合成交量分析热度</li>
            </ul>
          </div>
        </div>
      </div>

      {/* 刷新控制 */}
      <div className="refresh-controls">
        <button 
          className="btn-refresh"
          onClick={() => {
            const iframe = document.querySelector('.heatmap-iframe');
            if (iframe) {
              iframe.src = iframe.src;
            }
          }}
        >
          🔄 刷新云图
        </button>
        <div className="auto-refresh">
          <label>
            <input type="checkbox" /> 自动刷新（每5分钟）
          </label>
        </div>
      </div>
    </div>
  );
};

export default MarketHeatmap;