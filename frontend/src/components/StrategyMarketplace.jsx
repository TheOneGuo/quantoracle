/**
 * @file 策略广场组件
 * @description 策略列表展示，含卡片式布局、顶部筛选栏、排序方式选择。
 *              每个卡片展示：策略名/发布者信用等级/30天收益/最大回撤/风险等级/月均仓位/订阅数/定价。
 */

import React, { useState, useEffect, useCallback } from 'react';
import './StrategyMarketplace.css';

// ============================================================
// 常量配置
// ============================================================

/** 排序方式选项 */
const SORT_OPTIONS = [
  { value: 'recommended',      label: '综合推荐' },
  { value: 'return_desc',      label: '收益最高' },
  { value: 'risk_asc',         label: '风险最低' },
  { value: 'subscribers_desc', label: '订阅最多' },
  { value: 'newest',           label: '最新上架' },
];

/** 资金档位选项 */
const CAPITAL_TIER_OPTIONS = [
  { value: '',    label: '全部档位' },
  { value: '10w', label: '10万以内' },
  { value: '50w', label: '50万以内' },
  { value: '200w',label: '200万以内' },
];

/** 风险等级选项 */
const RISK_LEVEL_OPTIONS = [
  { value: '',       label: '全部风险' },
  { value: 'low',    label: '低风险' },
  { value: 'medium', label: '中风险' },
  { value: 'high',   label: '高风险' },
];

/** 信用评级选项 */
const CREDIT_GRADE_OPTIONS = [
  { value: '',   label: '全部评级' },
  { value: 'S+', label: 'S+ 及以上' },
  { value: 'S',  label: 'S 及以上' },
  { value: 'A+', label: 'A+ 及以上' },
  { value: 'A',  label: 'A 及以上' },
  { value: 'B',  label: 'B 及以上' },
];

/** 风险等级 → 中文标签 & 颜色 */
const RISK_LABELS = {
  low:    { text: '低风险', color: '#10b981' },
  medium: { text: '中风险', color: '#f59e0b' },
  high:   { text: '高风险', color: '#ef4444' },
};

/** 信用评级 → 颜色 */
const GRADE_COLORS = {
  'S+': '#7c3aed', 'S': '#6d28d9',
  'A+': '#2563eb', 'A': '#1d4ed8',
  'B':  '#059669', 'C': '#d97706', 'D': '#dc2626',
};

// ============================================================
// 子组件：策略卡片
// ============================================================

/**
 * 单个策略卡片
 * @param {Object} props.strategy 策略数据
 * @param {Function} props.onClick 点击进入详情页
 */
function StrategyCard({ strategy, onClick }) {
  const riskLabel = RISK_LABELS[strategy.riskLevel] || { text: strategy.riskLevel, color: '#6b7280' };
  const gradeColor = GRADE_COLORS[strategy.creditGrade] || '#6b7280';
  const returnColor = strategy.return30d >= 0 ? '#10b981' : '#ef4444';

  return (
    <div className="strategy-card" onClick={() => onClick(strategy.id)}>
      {/* 卡片头部：策略名 + 信用等级 */}
      <div className="card-header">
        <div className="strategy-name">{strategy.name}</div>
        <div className="credit-badge" style={{ backgroundColor: gradeColor }}>
          {strategy.creditGrade}
        </div>
      </div>

      {/* 警示提示（warning_yellow/warning_orange） */}
      {strategy.warningLevel && (
        <div className={`warning-bar warning-${strategy.warningLevel}`}>
          {strategy.warningLevel === 'warning_yellow' ? '⚠️ 近期执行率偏低，请关注' : '🔶 执行率连续低迷，请谨慎'}
        </div>
      )}

      {/* 核心指标网格 */}
      <div className="metrics-grid">
        <div className="metric">
          <div className="metric-value" style={{ color: returnColor }}>
            {strategy.return30d >= 0 ? '+' : ''}{strategy.return30d}%
          </div>
          <div className="metric-label">30天收益</div>
        </div>
        <div className="metric">
          <div className="metric-value">-{strategy.maxDrawdown}%</div>
          <div className="metric-label">最大回撤</div>
        </div>
        <div className="metric">
          <div className="metric-value">{strategy.avgUsageRate}%</div>
          <div className="metric-label">月均仓位</div>
        </div>
        <div className="metric">
          <div className="metric-value">{strategy.totalSubscribers}</div>
          <div className="metric-label">订阅数</div>
        </div>
      </div>

      {/* 卡片底部：风险徽章 + 定价 */}
      <div className="card-footer">
        <div className="risk-badge" style={{ color: riskLabel.color, borderColor: riskLabel.color }}>
          {riskLabel.text}
        </div>
        <div className="pricing">
          {strategy.priceMonthly > 0 ? (
            <span>¥{strategy.priceMonthly}/月</span>
          ) : (
            <span className="free-tag">免费</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// 主组件：策略广场
// ============================================================

/**
 * 策略广场主页
 * @param {Function} props.onStrategyClick 点击策略进入详情（传入 strategyId）
 */
export default function StrategyMarketplace({ onStrategyClick }) {
  const [strategies, setStrategies] = useState([]);
  const [loading, setLoading]       = useState(false);
  const [total, setTotal]           = useState(0);
  const [page, setPage]             = useState(1);

  // 筛选 & 排序状态
  const [sort,         setSort]         = useState('recommended');
  const [capitalTier,  setCapitalTier]  = useState('');
  const [riskLevel,    setRiskLevel]    = useState('');
  const [minReturn,    setMinReturn]    = useState('');
  const [creditGrade,  setCreditGrade]  = useState('');

  // 加载策略列表
  const fetchStrategies = useCallback(async (resetPage = false) => {
    setLoading(true);
    try {
      const currentPage = resetPage ? 1 : page;
      if (resetPage) setPage(1);

      const params = new URLSearchParams({
        sort,
        page: currentPage,
        limit: 20,
        ...(capitalTier  && { capital_tier:  capitalTier  }),
        ...(riskLevel    && { risk_level:    riskLevel    }),
        ...(minReturn    && { min_return:    minReturn    }),
        ...(creditGrade  && { credit_grade:  creditGrade  }),
      });

      const res  = await fetch(`/api/marketplace/strategies?${params}`);
      const json = await res.json();

      if (json.success) {
        setStrategies(resetPage ? json.data : prev => [...prev, ...json.data]);
        setTotal(json.meta?.total || 0);
      }
    } catch (e) {
      console.error('[StrategyMarketplace] 加载失败:', e);
    } finally {
      setLoading(false);
    }
  }, [sort, page, capitalTier, riskLevel, minReturn, creditGrade]);

  // 筛选/排序变化时重新加载
  useEffect(() => {
    fetchStrategies(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort, capitalTier, riskLevel, minReturn, creditGrade]);

  // 加载更多
  const handleLoadMore = () => {
    setPage(prev => prev + 1);
    fetchStrategies();
  };

  const handleStrategyClick = (id) => {
    if (onStrategyClick) onStrategyClick(id);
  };

  // ---- 渲染 ----
  return (
    <div className="strategy-marketplace">
      {/* 顶部筛选栏 */}
      <div className="filter-bar">
        <h2 className="marketplace-title">🏛️ 策略广场</h2>
        <div className="filter-row">
          {/* 排序方式 */}
          <div className="filter-group">
            <label>排序</label>
            <select value={sort} onChange={e => setSort(e.target.value)}>
              {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          {/* 资金档位 */}
          <div className="filter-group">
            <label>资金档位</label>
            <select value={capitalTier} onChange={e => setCapitalTier(e.target.value)}>
              {CAPITAL_TIER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          {/* 风险等级 */}
          <div className="filter-group">
            <label>风险等级</label>
            <select value={riskLevel} onChange={e => setRiskLevel(e.target.value)}>
              {RISK_LEVEL_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          {/* 信用评级 */}
          <div className="filter-group">
            <label>信用评级</label>
            <select value={creditGrade} onChange={e => setCreditGrade(e.target.value)}>
              {CREDIT_GRADE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          {/* 最低收益率 */}
          <div className="filter-group">
            <label>最低收益率</label>
            <input
              type="number"
              placeholder="如 5（%）"
              value={minReturn}
              onChange={e => setMinReturn(e.target.value)}
              min="0"
              max="100"
            />
          </div>
        </div>

        {/* 结果数量提示 */}
        <div className="result-count">共 {total} 个策略</div>
      </div>

      {/* 策略卡片列表 */}
      <div className="strategy-list">
        {strategies.map(s => (
          <StrategyCard key={s.id} strategy={s} onClick={handleStrategyClick} />
        ))}
        {!loading && strategies.length === 0 && (
          <div className="empty-tip">暂无符合条件的策略</div>
        )}
      </div>

      {/* 加载更多 */}
      {strategies.length < total && (
        <div className="load-more">
          <button onClick={handleLoadMore} disabled={loading}>
            {loading ? '加载中...' : '加载更多'}
          </button>
        </div>
      )}

      {loading && strategies.length === 0 && (
        <div className="loading-tip">加载中...</div>
      )}
    </div>
  );
}
