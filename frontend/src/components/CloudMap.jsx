import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './CloudMap.css';

function CloudMap() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('a_share'); // 'a_share' or 'us'

  const tabs = [
    { id: 'a_share', label: 'A股大盘云图', url: 'https://dapanyuntu.com/' },
    { id: 'us', label: '美股云图', url: 'https://finviz.com/map.ashx' },
  ];

  return (
    <div className="cloudmap-wrapper">
      <div className="cloudmap-header">
        <button className="cloudmap-back-btn" onClick={() => navigate('/')}>
          ← 返回首页
        </button>
        <span className="cloudmap-title">📊 大盘云图</span>
        <div className="cloudmap-tab-container">
          {tabs.map(tab => (
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
        {tabs.map(tab => (
          <div
            key={tab.id}
            className="cloudmap-tab-content"
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

export default CloudMap;