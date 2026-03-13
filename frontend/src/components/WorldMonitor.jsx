import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './WorldMonitor.css';

function WorldMonitor() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('geopolitics'); // 'geopolitics', 'tech', 'finance'

  const tabs = [
    { id: 'geopolitics', label: '🌍 地缘政治', url: 'https://worldmonitor.app' },
    { id: 'tech', label: '💻 科技情报', url: 'https://tech.worldmonitor.app' },
    { id: 'finance', label: '💹 金融市场', url: 'https://finance.worldmonitor.app' },
  ];

  return (
    <div className="worldmonitor-wrapper">
      <div className="worldmonitor-header">
        <button className="worldmonitor-back-btn" onClick={() => navigate('/')}>
          ← 返回首页
        </button>
        <div className="worldmonitor-header-center">
          <span className="worldmonitor-title">全球实时监控</span>
          <span className="worldmonitor-subtitle">实时全球情报聚合 · AI 驱动 · 36+ 数据层</span>
        </div>
        <div className="worldmonitor-tab-container">
          {tabs.map(tab => (
            <button
              key={tab.id}
              className={`worldmonitor-tab ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div style={{ width: '100px' }}></div>
      </div>
      <div className="worldmonitor-content">
        {tabs.map(tab => (
          <div
            key={tab.id}
            className="worldmonitor-tab-content"
            style={{ display: activeTab === tab.id ? 'block' : 'none' }}
          >
            <iframe
              src={tab.url}
              title={tab.label}
              allowFullScreen
              loading="lazy"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export default WorldMonitor;