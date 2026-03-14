import { useState, useEffect, useCallback } from 'react';
import './NewsFlash.css';

const NEGATIVE_WORDS = ['下跌', '利空', '亏损', '跌停', '下滑', '下行', '减少', '萎缩', '风险'];
const POSITIVE_WORDS = ['上涨', '利好', '增长', '涨停', '增益', '扩张', '突破', '增加', '大涨'];

function getSentiment(text) {
  if (!text) return 'neutral';
  if (NEGATIVE_WORDS.some(w => text.includes(w))) return 'negative';
  if (POSITIVE_WORDS.some(w => text.includes(w))) return 'positive';
  return 'neutral';
}

function formatTime(ts) {
  if (!ts) return '';
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return ts;
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }) + ' ' +
      d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return ts;
  }
}

function NewsItem({ item, maxItems }) {
  const [expanded, setExpanded] = useState(false);
  const sentiment = getSentiment(item.title + ' ' + item.content);

  return (
    <div className={`news-item news-${sentiment}`} onClick={() => setExpanded(e => !e)}>
      <div className="news-meta">
        <span className="news-time">{formatTime(item.published_at)}</span>
        <span className="news-source">{item.source_name}</span>
        {item.symbol && <span className="news-symbol">{item.symbol}</span>}
      </div>
      <div className={`news-title news-title-${sentiment}`}>{item.title}</div>
      {expanded && (
        <div className="news-content">
          <p>{item.content}</p>
          {item.url && (
            <a href={item.url} target="_blank" rel="noopener noreferrer"
               onClick={e => e.stopPropagation()}>
              查看原文 →
            </a>
          )}
        </div>
      )}
    </div>
  );
}

export default function NewsFlash({ compact = false, symbol = null }) {
  const [news, setNews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [tab, setTab] = useState(symbol ? 'stock' : 'flash');

  const fetchNews = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let url;
      if (tab === 'stock' && symbol) {
        url = `/api/news/stock/${symbol}?count=20`;
      } else if (tab === 'market') {
        url = '/api/news/market?count=30';
      } else {
        url = '/api/news/flash?count=20';
      }
      const res = await fetch(url);
      const json = await res.json();
      if (json.success) {
        setNews(json.data || []);
        setLastUpdate(new Date());
      } else {
        setError(json.error || '获取失败');
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [tab, symbol]);

  useEffect(() => {
    fetchNews();
    const timer = setInterval(fetchNews, 60000);
    return () => clearInterval(timer);
  }, [fetchNews]);

  const displayNews = compact ? news.slice(0, 5) : news;

  return (
    <div className={`news-flash ${compact ? 'news-compact' : ''}`}>
      <div className="news-header">
        <span className="news-header-title">📰 财经快讯</span>
        {lastUpdate && (
          <span className="news-update-time">
            更新于 {lastUpdate.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
        <button className="news-refresh" onClick={fetchNews} disabled={loading}>
          {loading ? '...' : '↻'}
        </button>
      </div>

      {!compact && (
        <div className="news-tabs">
          <button className={tab === 'flash' ? 'active' : ''} onClick={() => setTab('flash')}>⚡ 电报</button>
          <button className={tab === 'market' ? 'active' : ''} onClick={() => setTab('market')}>📊 市场</button>
          {symbol && (
            <button className={tab === 'stock' ? 'active' : ''} onClick={() => setTab('stock')}>🏢 个股</button>
          )}
        </div>
      )}

      <div className="news-list">
        {loading && news.length === 0 && <div className="news-loading">加载中...</div>}
        {error && <div className="news-error">⚠️ {error}</div>}
        {displayNews.map((item, i) => (
          <NewsItem key={i} item={item} />
        ))}
        {!loading && displayNews.length === 0 && !error && (
          <div className="news-empty">暂无新闻</div>
        )}
      </div>
    </div>
  );
}
