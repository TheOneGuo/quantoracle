import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import './CloudMap.css';

function CloudMap() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('a_share');
  // 定义tab配置，包含主URL和备用URL
  const tabsConfig = [
    { id: 'a_share', label: 'A股大盘云图', primaryUrl: 'https://dapanyuntu.com/', fallbackUrl: null },
    { id: 'us', label: '美股云图', primaryUrl: 'https://finviz.com/map.ashx', fallbackUrl: null },
    { 
      id: 'hk', 
      label: '港股云图', 
      primaryUrl: 'https://www.futunn.com/hk/quote/hk/heatmap', 
      fallbackUrl: 'https://s.tradingview.com/embed-widget/stock-heatmap/?locale=zh_CN#{"exchanges":["HKEX"],"dataSource":"HKEX","grouping":"sector","blockSize":"market_cap_basic","blockColor":"change","locale":"zh_CN","symbolUrl":"","colorTheme":"dark","hasTopBar":false,"isDataSetEnabled":false,"isZoomEnabled":true,"hasSymbolTooltip":true,"isMonoSize":false,"width":"100%","height":"100%"}'
    },
    { 
      id: 'forex', 
      label: '外汇云图', 
      primaryUrl: 'https://www.myfxbook.com/zh/forex-market/heat-map', 
      fallbackUrl: 'https://s.tradingview.com/embed-widget/forex-heat-map/?locale=zh_CN#{"width":"100%","height":"100%","currencies":["EUR","USD","JPY","GBP","CHF","AUD","CAD","NZD","CNY"],"isTransparent":false,"colorTheme":"dark","locale":"zh_CN"}'
    },
  ];

  // 管理每个tab当前使用的URL
  const [currentUrls, setCurrentUrls] = useState(() => {
    const initial = {};
    tabsConfig.forEach(tab => {
      initial[tab.id] = tab.primaryUrl;
    });
    return initial;
  });

  // iframe加载失败时的处理
  const handleIframeError = useCallback((tabId, fallbackUrl) => {
    if (fallbackUrl) {
      setCurrentUrls(prev => ({
        ...prev,
        [tabId]: fallbackUrl
      }));
    }
  }, []);

  return (
    <div className="cloudmap-wrapper">
      <div className="cloudmap-header">
        <button className="cloudmap-back-btn" onClick={() => navigate('/')}>
          ← 返回首页
        </button>
        <span className="cloudmap-title">📊 大盘云图</span>
        <div className="cloudmap-tab-container">
          {tabsConfig.map(tab => (
            <button
              key={tab.id}
              className={`cloudmap-tab ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div style={{ width: '100px' }}></div>
      </div>
      <div className="cloudmap-content">
        {tabsConfig.map(tab => (
          <div
            key={tab.id}
            className="cloudmap-tab-content"
            style={{ display: activeTab === tab.id ? 'block' : 'none' }}
          >
            <iframe
              src={currentUrls[tab.id]}
              title={tab.label}
              allowFullScreen
              loading="lazy"
              sandbox={
                tab.id === 'forex'
                  ? 'allow-scripts allow-same-origin allow-popups allow-forms'
                  : 'allow-scripts allow-same-origin allow-popups'
              }
              style={{
                width: '100%',
                height: 'calc(100vh - 120px)',
                border: 'none',
              }}
              onError={() => handleIframeError(tab.id, tab.fallbackUrl)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export default CloudMap;