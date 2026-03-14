/**
 * MarketplacePage.jsx - 策略广场
 * 支持筛选/排序/详情/评价/发布/我的订阅
 */
import { useState, useEffect, useCallback } from 'react';
import './MarketplacePage.css';

const API_BASE = '';

/** 获取 JWT token */
function getToken() {
  return localStorage.getItem('quantoracle_token');
}

/** 带 auth 的 fetch */
async function apiFetch(url, options = {}) {
  const token = getToken();
  return fetch(`${API_BASE}${url}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
}

// ======================== 子组件 ========================

/**
 * 策略卡片
 * @param {object} props.strategy - 策略对象
 * @param {Function} props.onDetail - 点击详情回调
 * @param {Function} props.onSubscribe - 订阅回调
 * @param {boolean} props.isLoggedIn
 */
function StrategyCard({ strategy, onDetail, onSubscribe, isLoggedIn }) {
  const m = strategy.backtest_metrics || {};
  const gradeColor = { S: '#f6c90e', A: '#48bb78', B: '#63b3ed', C: '#a0aec0' };

  return (
    <div className="mp-card" onClick={() => onDetail(strategy)}>
      <div className="mp-card-header">
        <span className="mp-grade" style={{ background: gradeColor[strategy.grade] || '#a0aec0' }}>
          {strategy.grade || 'N/A'}
        </span>
        <span className="mp-card-name">{strategy.name}</span>
        <span className="mp-card-market">{strategy.market}</span>
      </div>
      <div className="mp-card-metrics">
        <div className="mp-metric">
          <span className="mp-metric-label">年化</span>
          <span className="mp-metric-val up">{m.annual_return != null ? (m.annual_return * 100).toFixed(1) + '%' : '--'}</span>
        </div>
        <div className="mp-metric">
          <span className="mp-metric-label">夏普</span>
          <span className="mp-metric-val">{m.sharpe != null ? m.sharpe.toFixed(2) : '--'}</span>
        </div>
        <div className="mp-metric">
          <span className="mp-metric-label">最大回撤</span>
          <span className="mp-metric-val down">{m.max_drawdown != null ? (m.max_drawdown * 100).toFixed(1) + '%' : '--'}</span>
        </div>
        <div className="mp-metric">
          <span className="mp-metric-label">订阅</span>
          <span className="mp-metric-val">{strategy.subscribers || 0}</span>
        </div>
      </div>
      <div className="mp-card-tags">
        {(strategy.tags || []).map(t => <span key={t} className="mp-tag">{t}</span>)}
      </div>
      <div className="mp-card-footer">
        <span className="mp-price">
          {strategy.price_monthly === 0 ? '免费' : `¥${strategy.price_monthly}/月`}
        </span>
        <button
          className="mp-btn-subscribe"
          onClick={e => { e.stopPropagation(); onSubscribe(strategy); }}
          disabled={!isLoggedIn}
          title={isLoggedIn ? '订阅' : '请先登录'}
        >
          订阅
        </button>
      </div>
    </div>
  );
}

/**
 * 排行榜列表
 * @param {object[]} props.list - 排行榜数据
 * @param {Function} props.onDetail - 点击详情回调
 */
function LeaderboardList({ list, onDetail }) {
  const medals = ['🥇', '🥈', '🥉'];
  return (
    <div className="mp-leaderboard">
      {list.map((s, i) => {
        const m = s.backtest_metrics || {};
        return (
          <div key={s.id} className="mp-lb-item" onClick={() => onDetail(s)}>
            <span className="mp-lb-rank">{medals[i] || `${i + 1}`}</span>
            <span className="mp-lb-name">{s.name}</span>
            <span className="mp-lb-grade">{s.grade}</span>
            <span className="mp-lb-ret up">年化 {m.annual_return != null ? (m.annual_return * 100).toFixed(1) + '%' : '--'}</span>
            <span className="mp-lb-arrow">▶</span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * 策略详情 Modal
 * @param {object} props.strategy - 策略详情
 * @param {object[]} props.reviews - 评价列表
 * @param {boolean} props.isLoggedIn
 * @param {Function} props.onClose
 * @param {Function} props.onSubscribe
 * @param {Function} props.onSubmitReview
 */
function DetailModal({ strategy, reviews, isLoggedIn, onClose, onSubscribe, onSubmitReview }) {
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const m = strategy.backtest_metrics || {};

  function handleReview(e) {
    e.preventDefault();
    onSubmitReview(strategy.id, rating, comment);
    setComment('');
  }

  return (
    <div className="mp-modal-overlay" onClick={onClose}>
      <div className="mp-modal" onClick={e => e.stopPropagation()}>
        <button className="mp-modal-close" onClick={onClose}>✕</button>
        <h2 className="mp-modal-title">{strategy.name}</h2>
        <div className="mp-modal-meta">
          <span>等级: <b>{strategy.grade}</b></span>
          <span>市场: <b>{strategy.market}</b></span>
          <span>风格: <b>{strategy.style}</b></span>
          <span>订阅: <b>{strategy.subscribers || 0}</b></span>
        </div>
        <p className="mp-modal-desc">{strategy.description || '暂无描述'}</p>
        <div className="mp-modal-metrics">
          <div className="mp-metric"><span className="mp-metric-label">年化收益</span><span className="mp-metric-val up">{m.annual_return != null ? (m.annual_return * 100).toFixed(2) + '%' : '--'}</span></div>
          <div className="mp-metric"><span className="mp-metric-label">夏普比率</span><span className="mp-metric-val">{m.sharpe != null ? m.sharpe.toFixed(2) : '--'}</span></div>
          <div className="mp-metric"><span className="mp-metric-label">最大回撤</span><span className="mp-metric-val down">{m.max_drawdown != null ? (m.max_drawdown * 100).toFixed(2) + '%' : '--'}</span></div>
          <div className="mp-metric"><span className="mp-metric-label">胜率</span><span className="mp-metric-val">{m.win_rate != null ? (m.win_rate * 100).toFixed(1) + '%' : '--'}</span></div>
        </div>
        <div className="mp-modal-actions">
          <span className="mp-price">{strategy.price_monthly === 0 ? '免费' : `¥${strategy.price_monthly}/月 · ¥${strategy.price_yearly}/年`}</span>
          <button className="mp-btn-subscribe" onClick={() => onSubscribe(strategy)} disabled={!isLoggedIn}>
            {isLoggedIn ? '立即订阅' : '登录后订阅'}
          </button>
        </div>

        <div className="mp-reviews">
          <h3>用户评价 ({reviews.length})</h3>
          {reviews.length === 0 && <p className="mp-no-reviews">暂无评价</p>}
          {reviews.map(r => (
            <div key={r.id} className="mp-review-item">
              <span className="mp-review-stars">{'⭐'.repeat(r.rating)}</span>
              <span className="mp-review-comment">{r.comment}</span>
              <span className="mp-review-time">{new Date(r.created_at).toLocaleDateString()}</span>
            </div>
          ))}
          {isLoggedIn && (
            <form className="mp-review-form" onSubmit={handleReview}>
              <h4>写评价</h4>
              <div className="mp-star-select">
                {[1,2,3,4,5].map(n => (
                  <span key={n} className={`mp-star ${n <= rating ? 'active' : ''}`} onClick={() => setRating(n)}>★</span>
                ))}
              </div>
              <textarea
                value={comment}
                onChange={e => setComment(e.target.value)}
                placeholder="分享你的使用体验..."
                rows={3}
                className="mp-review-input"
              />
              <button type="submit" className="mp-btn-review">提交评价</button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * 发布策略 Modal
 * @param {Function} props.onClose
 * @param {Function} props.onSubmit
 */
function PublishModal({ onClose, onSubmit }) {
  const [form, setForm] = useState({
    name: '', description: '', market: 'A股', style: '量化', tags: '',
    price_monthly: 0, price_yearly: 0,
    annual_return: '', sharpe: '', max_drawdown: '', win_rate: '',
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  function handleSubmit(e) {
    e.preventDefault();
    onSubmit({
      name: form.name, description: form.description,
      market: form.market, style: form.style,
      tags: form.tags.split(',').map(t => t.trim()).filter(Boolean),
      price_monthly: Number(form.price_monthly),
      price_yearly: Number(form.price_yearly),
      backtest_metrics: {
        annual_return: Number(form.annual_return),
        sharpe: Number(form.sharpe),
        max_drawdown: Number(form.max_drawdown),
        win_rate: Number(form.win_rate),
      },
    });
  }

  return (
    <div className="mp-modal-overlay" onClick={onClose}>
      <div className="mp-modal mp-modal-publish" onClick={e => e.stopPropagation()}>
        <button className="mp-modal-close" onClick={onClose}>✕</button>
        <h2>发布策略</h2>
        <form onSubmit={handleSubmit} className="mp-publish-form">
          <label>策略名称 *<input required value={form.name} onChange={e => set('name', e.target.value)} /></label>
          <label>描述<textarea value={form.description} onChange={e => set('description', e.target.value)} rows={3} /></label>
          <div className="mp-form-row">
            <label>市场<select value={form.market} onChange={e => set('market', e.target.value)}>
              <option>A股</option><option>美股</option><option>港股</option><option>期货</option>
            </select></label>
            <label>风格<select value={form.style} onChange={e => set('style', e.target.value)}>
              <option>量化</option><option>价值</option><option>动量</option><option>套利</option>
            </select></label>
          </div>
          <label>标签（逗号分隔）<input value={form.tags} onChange={e => set('tags', e.target.value)} placeholder="例：趋势,中长线" /></label>
          <div className="mp-form-row">
            <label>月费(¥)<input type="number" min="0" value={form.price_monthly} onChange={e => set('price_monthly', e.target.value)} /></label>
            <label>年费(¥)<input type="number" min="0" value={form.price_yearly} onChange={e => set('price_yearly', e.target.value)} /></label>
          </div>
          <h4>回测指标</h4>
          <div className="mp-form-row">
            <label>年化收益(0-1)<input type="number" step="0.001" value={form.annual_return} onChange={e => set('annual_return', e.target.value)} placeholder="0.32" /></label>
            <label>夏普比率<input type="number" step="0.01" value={form.sharpe} onChange={e => set('sharpe', e.target.value)} placeholder="1.8" /></label>
          </div>
          <div className="mp-form-row">
            <label>最大回撤(0-1)<input type="number" step="0.001" value={form.max_drawdown} onChange={e => set('max_drawdown', e.target.value)} placeholder="0.15" /></label>
            <label>胜率(0-1)<input type="number" step="0.001" value={form.win_rate} onChange={e => set('win_rate', e.target.value)} placeholder="0.55" /></label>
          </div>
          <div className="mp-form-actions">
            <button type="button" onClick={onClose} className="mp-btn-cancel">取消</button>
            <button type="submit" className="mp-btn-publish">发布</button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * 我的订阅列表
 * @param {object[]} props.subscriptions
 * @param {Function} props.onDetail
 */
function MySubscriptions({ subscriptions, onDetail }) {
  if (!subscriptions.length) {
    return <div className="mp-empty">暂无订阅的策略，去广场发现好策略吧！</div>;
  }
  return (
    <div className="mp-my-subs">
      {subscriptions.map(s => (
        <div key={s.id} className="mp-sub-item" onClick={() => onDetail({ id: s.strategy_id, name: s.strategy_name })}>
          <div className="mp-sub-name">{s.strategy_name || s.strategy_id}</div>
          <div className="mp-sub-meta">
            <span>计划: {s.plan === 'yearly' ? '年付' : '月付'}</span>
            <span>到期: {s.expires_at ? new Date(s.expires_at).toLocaleDateString() : '长期'}</span>
            <span>等级: {s.grade || '--'}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ======================== 主组件 ========================

/**
 * MarketplacePage - 策略广场主页面
 * @param {object} props.user - 当前用户信息（null 表示未登录）
 */
function MarketplacePage({ user }) {
  const isLoggedIn = !!user;

  // 主 Tab：广场 / 排行榜 / 我的订阅
  const [activeTab, setActiveTab] = useState('market');

  // 筛选条件
  const [filters, setFilters] = useState({ market: '', grade: '', style: '', free_only: false });
  const [sort, setSort] = useState('subscribers');
  const setFilter = (k, v) => setFilters(f => ({ ...f, [k]: v }));

  // 数据
  const [strategies, setStrategies] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [mySubscriptions, setMySubscriptions] = useState([]);
  const [loading, setLoading] = useState(false);

  // Modal 状态
  const [detailStrategy, setDetailStrategy] = useState(null);
  const [detailReviews, setDetailReviews] = useState([]);
  const [showPublish, setShowPublish] = useState(false);
  const [toast, setToast] = useState('');

  function showMsg(msg) {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  }

  // 加载策略列表
  const loadStrategies = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ sort, page: 1, limit: 50 });
      if (filters.market) params.set('market', filters.market);
      if (filters.grade) params.set('grade', filters.grade);
      if (filters.style) params.set('style', filters.style);
      if (filters.free_only) params.set('free_only', 'true');
      const res = await fetch(`/api/marketplace/strategies?${params}`);
      const data = await res.json();
      setStrategies(data.strategies || []);
    } catch (e) {
      console.error('加载策略失败', e);
    }
    setLoading(false);
  }, [filters, sort]);

  // 加载排行榜
  const loadLeaderboard = useCallback(async () => {
    try {
      const res = await fetch('/api/marketplace/leaderboard?type=annual_return&limit=10');
      const data = await res.json();
      setLeaderboard(data.leaderboard || []);
    } catch (e) { /* ignore */ }
  }, []);

  // 加载我的订阅
  const loadMySubscriptions = useCallback(async () => {
    if (!isLoggedIn) return;
    try {
      const res = await apiFetch('/api/marketplace/my-subscriptions');
      const data = await res.json();
      setMySubscriptions(data.subscriptions || []);
    } catch (e) { /* ignore */ }
  }, [isLoggedIn]);

  useEffect(() => { loadStrategies(); }, [loadStrategies]);
  useEffect(() => { loadLeaderboard(); }, [loadLeaderboard]);
  useEffect(() => { if (activeTab === 'mine') loadMySubscriptions(); }, [activeTab, loadMySubscriptions]);

  // 打开详情 Modal
  async function openDetail(strategy) {
    setDetailStrategy(strategy);
    try {
      const [detRes, revRes] = await Promise.all([
        fetch(`/api/marketplace/strategies/${strategy.id}`),
        fetch(`/api/marketplace/strategies/${strategy.id}/reviews`),
      ]);
      const detData = await detRes.json();
      const revData = await revRes.json();
      if (detData.strategy) setDetailStrategy(detData.strategy);
      setDetailReviews(revData.reviews || []);
    } catch (e) { /* use existing data */ }
  }

  // 订阅
  async function handleSubscribe(strategy) {
    if (!isLoggedIn) return showMsg('请先登录');
    try {
      const res = await apiFetch('/api/marketplace/subscribe', {
        method: 'POST',
        body: JSON.stringify({ strategy_id: strategy.id, plan: 'monthly' }),
      });
      const data = await res.json();
      showMsg(data.message || '订阅成功');
    } catch (e) {
      showMsg('订阅失败，请重试');
    }
  }

  // 提交评价
  async function handleReview(strategyId, rating, comment) {
    try {
      const res = await apiFetch(`/api/marketplace/strategies/${strategyId}/review`, {
        method: 'POST',
        body: JSON.stringify({ rating, comment }),
      });
      const data = await res.json();
      showMsg(data.message || '评价已提交');
      // 刷新评价列表
      const revRes = await fetch(`/api/marketplace/strategies/${strategyId}/reviews`);
      const revData = await revRes.json();
      setDetailReviews(revData.reviews || []);
    } catch (e) {
      showMsg('评价提交失败');
    }
  }

  // 发布策略
  async function handlePublish(formData) {
    try {
      const res = await apiFetch('/api/marketplace/strategies', {
        method: 'POST',
        body: JSON.stringify({ ...formData, creator_id: user?.id }),
      });
      const data = await res.json();
      showMsg(data.message || '策略已提交审核');
      setShowPublish(false);
      loadStrategies();
    } catch (e) {
      showMsg('发布失败，请重试');
    }
  }

  const marketOptions = ['A股', '美股', '港股', '期货'];
  const gradeOptions = ['S', 'A', 'B', 'C'];
  const styleOptions = ['量化', '价值', '动量', '套利', '网格'];

  return (
    <div className="mp-page">
      {/* Header */}
      <div className="mp-header">
        <h1 className="mp-title">🏛 策略广场</h1>
        <div className="mp-header-actions">
          {isLoggedIn && (
            <button className="mp-btn-publish-entry" onClick={() => setShowPublish(true)}>
              + 发布策略
            </button>
          )}
          <button
            className={`mp-tab-btn ${activeTab === 'mine' ? 'active' : ''}`}
            onClick={() => setActiveTab(activeTab === 'mine' ? 'market' : 'mine')}
            disabled={!isLoggedIn}
            title={isLoggedIn ? '我的订阅' : '请先登录'}
          >
            我的订阅
          </button>
        </div>
      </div>

      {/* Tab Bar */}
      <div className="mp-tabs">
        <button className={`mp-tab ${activeTab === 'market' ? 'active' : ''}`} onClick={() => setActiveTab('market')}>策略列表</button>
        <button className={`mp-tab ${activeTab === 'board' ? 'active' : ''}`} onClick={() => setActiveTab('board')}>排行榜</button>
        {isLoggedIn && (
          <button className={`mp-tab ${activeTab === 'mine' ? 'active' : ''}`} onClick={() => setActiveTab('mine')}>我的订阅</button>
        )}
      </div>

      <div className="mp-body">
        {/* 筛选侧栏（策略列表模式显示） */}
        {activeTab === 'market' && (
          <aside className="mp-sidebar">
            <div className="mp-filter-group">
              <h4>市场</h4>
              {marketOptions.map(m => (
                <label key={m} className="mp-checkbox">
                  <input type="checkbox" checked={filters.market === m}
                    onChange={() => setFilter('market', filters.market === m ? '' : m)} />
                  {m}
                </label>
              ))}
            </div>
            <div className="mp-filter-group">
              <h4>等级</h4>
              <div className="mp-grade-row">
                {gradeOptions.map(g => (
                  <button key={g} className={`mp-grade-btn ${filters.grade === g ? 'active' : ''}`}
                    onClick={() => setFilter('grade', filters.grade === g ? '' : g)}>{g}</button>
                ))}
              </div>
            </div>
            <div className="mp-filter-group">
              <h4>风格</h4>
              {styleOptions.map(s => (
                <label key={s} className="mp-checkbox">
                  <input type="checkbox" checked={filters.style === s}
                    onChange={() => setFilter('style', filters.style === s ? '' : s)} />
                  {s}
                </label>
              ))}
            </div>
            <div className="mp-filter-group">
              <label className="mp-checkbox">
                <input type="checkbox" checked={filters.free_only}
                  onChange={e => setFilter('free_only', e.target.checked)} />
                只看免费
              </label>
            </div>
            <div className="mp-filter-group">
              <h4>排序</h4>
              <select className="mp-sort-select" value={sort} onChange={e => setSort(e.target.value)}>
                <option value="subscribers">订阅数</option>
                <option value="annual_return">年化收益</option>
                <option value="sharpe">夏普比率</option>
                <option value="created_at">最新发布</option>
              </select>
            </div>
          </aside>
        )}

        {/* 主内容区 */}
        <main className="mp-main">
          {activeTab === 'market' && (
            <>
              {loading && <div className="mp-loading">加载中...</div>}
              {!loading && strategies.length === 0 && <div className="mp-empty">暂无策略数据</div>}
              <div className="mp-grid">
                {strategies.map(s => (
                  <StrategyCard key={s.id} strategy={s} onDetail={openDetail}
                    onSubscribe={handleSubscribe} isLoggedIn={isLoggedIn} />
                ))}
              </div>
            </>
          )}

          {activeTab === 'board' && (
            <LeaderboardList list={leaderboard} onDetail={openDetail} />
          )}

          {activeTab === 'mine' && (
            <MySubscriptions subscriptions={mySubscriptions} onDetail={openDetail} />
          )}
        </main>
      </div>

      {/* 详情 Modal */}
      {detailStrategy && (
        <DetailModal
          strategy={detailStrategy}
          reviews={detailReviews}
          isLoggedIn={isLoggedIn}
          onClose={() => setDetailStrategy(null)}
          onSubscribe={handleSubscribe}
          onSubmitReview={handleReview}
        />
      )}

      {/* 发布策略 Modal */}
      {showPublish && (
        <PublishModal onClose={() => setShowPublish(false)} onSubmit={handlePublish} />
      )}

      {/* Toast 消息 */}
      {toast && <div className="mp-toast">{toast}</div>}
    </div>
  );
}

export default MarketplacePage;
