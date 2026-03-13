import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './WorldMonitor.css';

function WorldMonitor() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);

  return (
    <div className="worldmonitor-wrapper">
      <div className="worldmonitor-header">
        <button className="worldmonitor-back-btn" onClick={() => navigate('/')}>
          ← 返回首页
        </button>
        <span className="worldmonitor-title">🌍 全球局势热点</span>
        <div style={{ width: '100px' }}></div>
      </div>
      <div className="worldmonitor-content">
        {loading && (
          <div className="worldmonitor-loading">正在加载全球局势热点...</div>
        )}
        <iframe
          src="https://worldmonitor.app/"
          title="World Monitor"
          allowFullScreen
          onLoad={() => setLoading(false)}
          onError={() => setLoading(false)}
        />
      </div>
    </div>
  );
}

export default WorldMonitor;
