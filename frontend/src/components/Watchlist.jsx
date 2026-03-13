import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const API_BASE = 'http://localhost:3001/api';

function Watchlist() {
  const [watchlist, setWatchlist] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [addCode, setAddCode] = useState('');
  const [addName, setAddName] = useState('');
  const [adding, setAdding] = useState(false);

  const fetchWatchlist = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API_BASE}/watchlist`);
      if (res.data.success) setWatchlist(res.data.data);
    } catch (e) {
      console.error('watchlist fetch failed', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWatchlist();
    const timer = setInterval(fetchWatchlist, 30000);
    return () => clearInterval(timer);
  }, [fetchWatchlist]);

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!addCode || !addName) return;
    setAdding(true);
    try {
      // 自动格式化代码前缀
      let code = addCode.trim();
      if (!/^(sh|sz|bj)/.test(code)) {
        if (code.startsWith('6')) code = 'sh' + code;
        else if (code.startsWith('0') || code.startsWith('3')) code = 'sz' + code;
        else if (code.startsWith('8') || code.startsWith('4')) code = 'bj' + code;
      }
      await axios.post(`${API_BASE}/watchlist`, { code, name: addName.trim() });
      setAddCode('');
      setAddName('');
      fetchWatchlist();
    } catch (e) {
      alert('添加失败: ' + e.message);
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (code) => {
    if (!confirm(`确定移除 ${code} 吗？`)) return;
    try {
      await axios.delete(`${API_BASE}/watchlist/${code}`);
      fetchWatchlist();
    } catch (e) {
      alert('删除失败: ' + e.message);
    }
  };

  return (
    <div className="panel watchlist-section" style={{ marginTop: 12 }}>
      <div className="panel-header" style={{ cursor: 'pointer' }} onClick={() => setExpanded(e => !e)}>
        <h3>⭐ 自选股 <span style={{ fontSize: 12, color: '#718096', fontWeight: 400 }}>{watchlist.length} 只</span></h3>
        <span style={{ color: '#718096', fontSize: 13 }}>{expanded ? '▲ 收起' : '▼ 展开'}</span>
      </div>

      {expanded && (
        <>
          {/* 添加表单 */}
          <form onSubmit={handleAdd} style={{ display: 'flex', gap: 6, padding: '8px 12px', borderBottom: '1px solid #2d3748' }}>
            <input
              value={addCode}
              onChange={e => setAddCode(e.target.value)}
              placeholder="股票代码"
              style={{ flex: 1, background: '#2d3748', border: 'none', borderRadius: 5, color: '#e2e8f0', padding: '5px 8px', fontSize: 12 }}
            />
            <input
              value={addName}
              onChange={e => setAddName(e.target.value)}
              placeholder="股票名称"
              style={{ flex: 1, background: '#2d3748', border: 'none', borderRadius: 5, color: '#e2e8f0', padding: '5px 8px', fontSize: 12 }}
            />
            <button type="submit" disabled={adding} style={{ background: '#667eea', border: 'none', borderRadius: 5, color: '#fff', padding: '5px 12px', cursor: 'pointer', fontSize: 12, whiteSpace: 'nowrap' }}>
              {adding ? '...' : '+ 添加'}
            </button>
          </form>

          {/* 自选股列表 */}
          <div className="watchlist-list" style={{ maxHeight: 280, overflowY: 'auto' }}>
            {loading && watchlist.length === 0 && (
              <div style={{ padding: 16, textAlign: 'center', color: '#718096', fontSize: 13 }}>加载中...</div>
            )}
            {!loading && watchlist.length === 0 && (
              <div style={{ padding: 16, textAlign: 'center', color: '#718096', fontSize: 13 }}>
                ⭐ 暂无自选股，添加后在这里监控
              </div>
            )}
            {watchlist.map(item => {
              const q = item.quote;
              const change = q?.changePercent ?? null;
              const up = change >= 0;
              return (
                <div key={item.code} style={{ display: 'flex', alignItems: 'center', padding: '7px 12px', borderBottom: '1px solid #1a1d2e', gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>{item.name}</div>
                    <div style={{ fontSize: 11, color: '#718096' }}>{item.code}</div>
                  </div>
                  {q ? (
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: up ? '#48bb78' : '#f56565' }}>
                        ¥{q.current?.toFixed(2)}
                      </div>
                      <div style={{ fontSize: 11, color: up ? '#48bb78' : '#f56565' }}>
                        {up ? '+' : ''}{change?.toFixed(2)}%
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, color: '#4a5568' }}>--</div>
                  )}
                  <button
                    onClick={() => handleDelete(item.code)}
                    style={{ background: 'transparent', border: 'none', color: '#f56565', cursor: 'pointer', fontSize: 16, padding: '0 4px', lineHeight: 1 }}
                    title="移除"
                  >×</button>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

export default Watchlist;
