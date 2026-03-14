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

function NewsItem({ item }) {
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

// ──────────────────────────────────────────
// 精选分析卡片（高分新闻 + 范式分析结果）
// ──────────────────────────────────────────

function ScoreBadge({ score }) {
  if (!score && score !== 0) return null;
  const isHigh = score >= 9;
  return (
    <span className={`news-score-badge ${isHigh ? 'score-critical' : 'score-important'}`}>
      {score >= 9 ? '🔴' : '🟢'} {score}分
    </span>
  );
}

function ConfidenceBar({ value }) {
  if (!value && value !== 0) return null;
  const pct = Math.round(value * 100);
  return (
    <div className="confidence-bar-wrap" title={`置信度 ${pct}%`}>
      <div className="confidence-bar-bg">
        <div className="confidence-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="confidence-label">{pct}%</span>
    </div>
  );
}

function ActionTag({ action }) {
  const map = { buy: { label: '买入', cls: 'action-buy' }, watch: { label: '观望', cls: 'action-watch' }, avoid: { label: '规避', cls: 'action-avoid' } };
  const cfg = map[action] || { label: action || '—', cls: '' };
  return <span className={`news-action-tag ${cfg.cls}`}>{cfg.label}</span>;
}

function AnalyzedNewsItem({ item }) {
  const [expanded, setExpanded] = useState(false);
  const analysis = item.analysis || {};
  const stocks = item.stock_recommendations || analysis.beneficiary_stocks || [];
  const paradigmName = analysis.triggered_paradigm || null;

  const preview = (item.content || item.title || '').slice(0, 100);

  return (
    <div className="analyzed-news-card" onClick={() => setExpanded(e => !e)}>
      <div className="analyzed-news-header">
        <ScoreBadge score={item.score} />
        {paradigmName && <span className="paradigm-tag">📐 {paradigmName}</span>}
        <span className="news-time">{formatTime(item.published_at || item.created_at)}</span>
      </div>
      <div className="analyzed-news-preview">{preview}{preview.length >= 100 ? '...' : ''}</div>
      <div className="analyzed-news-actions">
        {item.action && <ActionTag action={item.action} />}
        {stocks.length > 0 && (
          <span className="stock-reco-list">
            {stocks.slice(0, 3).map((s, i) => <code key={i} className="stock-code">{s}</code>)}
            {stocks.length > 3 && <span className="more-stocks">+{stocks.length - 3}</span>}
          </span>
        )}
        {item.time_window && <span className="time-window-tag">{item.time_window}</span>}
        <ConfidenceBar value={item.confidence} />
      </div>
      {expanded && (
        <div className="analyzed-news-detail" onClick={e => e.stopPropagation()}>
          {item.content && <p className="news-full-content">{item.content}</p>}
          {analysis.summary && <p className="analysis-summary">💡 {analysis.summary}</p>}
          {analysis.risk_note && <p className="risk-note">⚠️ 风险：{analysis.risk_note}</p>}
          {analysis.beneficiary_sectors?.length > 0 && (
            <p className="sectors">受益行业：{analysis.beneficiary_sectors.join('、')}</p>
          )}
          {item.sentiment && <span className="sentiment-tag">情绪：{item.sentiment}</span>}
          {item.urgency && <span className="urgency-tag">紧急度：{item.urgency}</span>}
          {item.score_reason && <p className="score-reason">评分理由：{item.score_reason}</p>}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────
// 主组件
// ──────────────────────────────────────────

export default function NewsFlash({ compact = false, symbol = null }) {
  const [news, setNews] = useState([]);
  const [analyzedNews, setAnalyzedNews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [analyzedLoading, setAnalyzedLoading] = useState(false);
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
      } else if (tab === 'analyzed') {
        // handled separately
        return;
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

  const fetchAnalyzed = useCallback(async () => {
    setAnalyzedLoading(true);
    try {
      const res = await fetch('/api/news/analyzed?limit=30');
      const json = await res.json();
      if (json.success) {
        setAnalyzedNews(json.data || []);
        setLastUpdate(new Date());
      }
    } catch (e) {
      console.warn('[NewsFlash] 精选分析获取失败:', e.message);
    } finally {
      setAnalyzedLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === 'analyzed') {
      fetchAnalyzed();
      const timer = setInterval(fetchAnalyzed, 60000);
      return () => clearInterval(timer);
    } else {
      fetchNews();
      const timer = setInterval(fetchNews, 60000);
      return () => clearInterval(timer);
    }
  }, [tab, fetchNews, fetchAnalyzed]);

  const displayNews = compact ? news.slice(0, 5) : news;
  const isAnalyzedTab = tab === 'analyzed';

  return (
    <div className={`news-flash ${compact ? 'news-compact' : ''}`}>
      <div className="news-header">
        <span className="news-header-title">📰 财经快讯</span>
        {lastUpdate && (
          <span className="news-update-time">
            更新于 {lastUpdate.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
        <button className="news-refresh" onClick={isAnalyzedTab ? fetchAnalyzed : fetchNews} disabled={loading || analyzedLoading}>
          {(loading || analyzedLoading) ? '...' : '↻'}
        </button>
      </div>

      {!compact && (
        <div className="news-tabs">
          <button className={tab === 'flash' ? 'active' : ''} onClick={() => setTab('flash')}>⚡ 电报</button>
          <button className={tab === 'market' ? 'active' : ''} onClick={() => setTab('market')}>📊 市场</button>
          <button className={tab === 'analyzed' ? 'active' : ''} onClick={() => setTab('analyzed')}>🔥 精选分析</button>
          {symbol && (
            <button className={tab === 'stock' ? 'active' : ''} onClick={() => setTab('stock')}>🏢 个股</button>
          )}
        </div>
      )}

      <div className="news-list">
        {isAnalyzedTab ? (
          <>
            {analyzedLoading && analyzedNews.length === 0 && <div className="news-loading">加载中...</div>}
            {analyzedNews.length === 0 && !analyzedLoading && (
              <div className="news-empty">暂无高分分析新闻（评分≥7）</div>
            )}
            {analyzedNews.map((item, i) => (
              <AnalyzedNewsItem key={item.analysis_id || i} item={item} />
            ))}
          </>
        ) : (
          <>
            {loading && news.length === 0 && <div className="news-loading">加载中...</div>}
            {error && <div className="news-error">⚠️ {error}</div>}
            {displayNews.map((item, i) => (
              <NewsItem key={i} item={item} />
            ))}
            {!loading && displayNews.length === 0 && !error && (
              <div className="news-empty">暂无新闻</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
