import { useState, useEffect, useCallback } from 'react';
import './ParadigmEditor.css';

const API_BASE = '/api/knowledge/paradigms';

const CATEGORIES = [
  { value: 'geo_conflict', label: '🌍 地缘冲突' },
  { value: 'macro_policy', label: '🏛️ 宏观政策' },
  { value: 'disaster', label: '🌊 自然灾害' },
  { value: 'financial', label: '💹 金融市场' },
  { value: 'political', label: '🗳️ 政治事件' },
  { value: 'industry', label: '🏭 行业动态' },
];

const MARKETS = ['A股', '美股', '港股'];

const SEVERITY_COLORS = { S: '#FFD700', A: '#00D4AA', B: '#4DABF7', C: '#868E96', D: '#FF6B6B' };

function severityLabel(v) {
  if (v >= 2.5) return 'S';
  if (v >= 1.8) return 'A';
  if (v >= 1.3) return 'B';
  if (v >= 1.0) return 'C';
  return 'D';
}

// ─── 标签输入组件 ────────────────────────────
function TagInput({ value = [], onChange, placeholder }) {
  const [input, setInput] = useState('');
  const add = () => {
    const v = input.trim();
    if (v && !value.includes(v)) { onChange([...value, v]); }
    setInput('');
  };
  return (
    <div className="tag-input-wrap">
      <div className="tag-list">
        {value.map(t => (
          <span key={t} className="tag">
            {t}
            <button onClick={() => onChange(value.filter(x => x !== t))}>×</button>
          </span>
        ))}
      </div>
      <div className="tag-input-row">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          placeholder={placeholder || '输入后按 Enter 添加'}
        />
        <button className="btn-add-tag" onClick={add}>+</button>
      </div>
    </div>
  );
}

// ─── market_impact 编辑器 ─────────────────────
function MarketImpactEditor({ value = {}, onChange }) {
  const [activeTab, setActiveTab] = useState('A股');
  const cur = value[activeTab] || { benefit: [], damage: [], rationale: '' };

  const update = (field, v) => {
    onChange({ ...value, [activeTab]: { ...cur, [field]: v } });
  };

  return (
    <div className="market-impact-editor">
      <div className="market-tabs">
        {MARKETS.map(m => (
          <button
            key={m}
            className={`market-tab ${activeTab === m ? 'active' : ''}`}
            onClick={() => setActiveTab(m)}
          >{m}</button>
        ))}
      </div>
      <div className="market-tab-body">
        <div className="field-group">
          <label>✅ 受益板块</label>
          <TagInput value={cur.benefit} onChange={v => update('benefit', v)} placeholder="输入板块后按 Enter" />
        </div>
        <div className="field-group">
          <label>❌ 受损板块</label>
          <TagInput value={cur.damage} onChange={v => update('damage', v)} placeholder="输入板块后按 Enter" />
        </div>
        <div className="field-group">
          <label>💡 分析理由</label>
          <textarea
            value={cur.rationale}
            onChange={e => update('rationale', e.target.value)}
            rows={3}
            placeholder="说明该事件对此市场影响的逻辑..."
          />
        </div>
      </div>
    </div>
  );
}

// ─── 动态列表（历史案例）─────────────────────
function DynamicList({ value = [], onChange, placeholder }) {
  return (
    <div className="dynamic-list">
      {value.map((item, i) => (
        <div key={i} className="dynamic-list-row">
          <input
            value={item}
            onChange={e => { const arr = [...value]; arr[i] = e.target.value; onChange(arr); }}
            placeholder={placeholder}
          />
          <button className="btn-remove" onClick={() => onChange(value.filter((_, j) => j !== i))}>🗑️</button>
        </div>
      ))}
      <button className="btn-add-item" onClick={() => onChange([...value, ''])}>+ 添加案例</button>
    </div>
  );
}

// ─── 编辑抽屉 ────────────────────────────────
function Drawer({ paradigm, onClose, onSave }) {
  const isNew = !paradigm?.id;
  const [form, setForm] = useState(paradigm || {
    category: 'geo_conflict', subcategory: '', name: '', description: '',
    trigger_keywords: [], market_impact: {}, severity_multiplier: 1.0,
    duration_days: 7, historical_cases: [],
  });

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const grade = severityLabel(form.severity_multiplier);

  return (
    <div className="drawer-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="drawer">
        <div className="drawer-header">
          <h2>{isNew ? '新增分析范式' : '编辑范式'}</h2>
          <button className="btn-close" onClick={onClose}>✕</button>
        </div>
        <div className="drawer-body">

          <div className="field-row">
            <div className="field-group">
              <label>大类 *</label>
              <select value={form.category} onChange={e => set('category', e.target.value)}>
                {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div className="field-group">
              <label>小类 *</label>
              <input value={form.subcategory} onChange={e => set('subcategory', e.target.value)} placeholder="如 war_outbreak" />
            </div>
          </div>

          <div className="field-group">
            <label>范式名称 *</label>
            <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="如 美联储加息" />
          </div>

          <div className="field-group">
            <label>说明 / 使用场景</label>
            <textarea value={form.description || ''} onChange={e => set('description', e.target.value)} rows={2} placeholder="简要描述此范式的适用条件..." />
          </div>

          <div className="field-group">
            <label>触发关键词 *</label>
            <TagInput value={form.trigger_keywords} onChange={v => set('trigger_keywords', v)} placeholder="输入关键词后按 Enter" />
          </div>

          <div className="field-group">
            <label>市场影响框架</label>
            <MarketImpactEditor value={form.market_impact} onChange={v => set('market_impact', v)} />
          </div>

          <div className="field-row">
            <div className="field-group">
              <label>
                严重程度乘数
                <span className="grade-badge" style={{ background: SEVERITY_COLORS[grade] }}>
                  {grade} 级 ({form.severity_multiplier?.toFixed(1)})
                </span>
              </label>
              <input
                type="range" min={0.5} max={3.0} step={0.1}
                value={form.severity_multiplier}
                onChange={e => set('severity_multiplier', parseFloat(e.target.value))}
                className="slider"
              />
              <div className="slider-labels"><span>0.5 普通</span><span>3.0 极端</span></div>
            </div>
            <div className="field-group">
              <label>预期持续天数</label>
              <input
                type="number" min={1} max={365}
                value={form.duration_days}
                onChange={e => set('duration_days', parseInt(e.target.value))}
              />
            </div>
          </div>

          <div className="field-group">
            <label>历史案例（供 LLM 参考）</label>
            <DynamicList value={form.historical_cases} onChange={v => set('historical_cases', v)} placeholder="如 2022年俄乌冲突" />
          </div>

        </div>
        <div className="drawer-footer">
          <button className="btn-cancel" onClick={onClose}>取消</button>
          <button className="btn-save" onClick={() => onSave(form)}>{isNew ? '创建范式' : '保存修改'}</button>
        </div>
      </div>
    </div>
  );
}

// ─── 匹配测试面板 ────────────────────────────
function MatchTester({ onClose }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);

  const test = async () => {
    if (!title.trim()) return;
    setLoading(true);
    try {
      const resp = await fetch(`${API_BASE}/match`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, body, top_k: 5 }),
      });
      const data = await resp.json();
      setResults(data.paradigms || []);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="drawer-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="drawer">
        <div className="drawer-header">
          <h2>🧪 范式匹配测试</h2>
          <button className="btn-close" onClick={onClose}>✕</button>
        </div>
        <div className="drawer-body">
          <div className="field-group">
            <label>新闻标题</label>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="粘贴新闻标题..." />
          </div>
          <div className="field-group">
            <label>新闻正文（可选）</label>
            <textarea value={body} onChange={e => setBody(e.target.value)} rows={4} placeholder="粘贴正文以提高匹配精度..." />
          </div>
          <button className="btn-save" onClick={test} disabled={loading || !title.trim()}>
            {loading ? '匹配中…' : '开始匹配'}
          </button>

          {results !== null && (
            <div className="match-results">
              {results.length === 0
                ? <p className="no-match">未匹配到任何范式，建议新增对应范式</p>
                : results.map((p, i) => (
                  <div key={p.id} className="match-card">
                    <div className="match-rank">#{i + 1}</div>
                    <div className="match-info">
                      <div className="match-name">{p.name}</div>
                      <div className="match-meta">
                        <span className="match-category">{CATEGORIES.find(c => c.value === p.category)?.label || p.category}</span>
                        <span className="match-score">命中 {p.match_score} 个关键词</span>
                      </div>
                      <div className="match-keywords">
                        {(p.trigger_keywords || []).slice(0, 6).map(k => (
                          <span key={k} className="tag small">{k}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                ))
              }
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── 主组件 ──────────────────────────────────
export default function ParadigmEditor() {
  const [paradigms, setParadigms] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [editing, setEditing] = useState(null);       // null=关闭, {}=新增, {...}=编辑
  const [showTester, setShowTester] = useState(false);
  const [toast, setToast] = useState(null);
  const [isMock, setIsMock] = useState(false);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (filterCategory) qs.set('category', filterCategory);
      const resp = await fetch(`${API_BASE}?${qs}`);
      const data = await resp.json();
      setParadigms(data.paradigms || []);
      setIsMock(!!data.is_mock);
    } catch {
      showToast('加载失败，请检查后端连接', 'error');
    } finally {
      setLoading(false);
    }
  }, [filterCategory]);

  useEffect(() => { load(); }, [load]);

  const handleSearch = async () => {
    if (!search.trim()) { load(); return; }
    try {
      const resp = await fetch(`${API_BASE}/search?q=${encodeURIComponent(search)}`);
      const data = await resp.json();
      setParadigms(data.paradigms || []);
    } catch { showToast('搜索失败', 'error'); }
  };

  const handleSave = async (form) => {
    const isNew = !form.id;
    try {
      const url = isNew ? API_BASE : `${API_BASE}/${form.id}`;
      const method = isNew ? 'POST' : 'PATCH';
      const resp = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await resp.json();
      if (data.success) {
        showToast(isNew ? '范式已创建 ✅' : '范式已更新 ✅');
        setEditing(null);
        load();
      } else {
        showToast(data.error || '保存失败', 'error');
      }
    } catch { showToast('网络错误', 'error'); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('确认删除此范式？（软删除，数据保留可恢复）')) return;
    try {
      const resp = await fetch(`${API_BASE}/${id}`, { method: 'DELETE' });
      const data = await resp.json();
      if (data.success) { showToast('已删除'); load(); }
    } catch { showToast('删除失败', 'error'); }
  };

  const filtered = paradigms.filter(p =>
    !search || p.name?.includes(search) || (p.trigger_keywords || []).some(k => k.includes(search))
  );

  return (
    <div className="paradigm-editor">
      {/* Toast */}
      {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}

      <div className="pe-header">
        <div className="pe-title">
          <span>📚</span>
          <div>
            <h1>知识库管理</h1>
            <p>新闻因子分析范式 · {paradigms.length} 条{isMock ? ' (Mock数据)' : ''}</p>
          </div>
        </div>
        <div className="pe-actions">
          <button className="btn-test" onClick={() => setShowTester(true)}>🧪 匹配测试</button>
          <button className="btn-new" onClick={() => setEditing({})}>+ 新增范式</button>
        </div>
      </div>

      <div className="pe-toolbar">
        <div className="search-row">
          <input
            className="search-input"
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            placeholder="搜索范式名称或关键词..."
          />
          <button className="btn-search" onClick={handleSearch}>搜索</button>
          {search && <button className="btn-clear" onClick={() => { setSearch(''); load(); }}>清除</button>}
        </div>
        <div className="filter-tabs">
          <button className={`filter-tab ${!filterCategory ? 'active' : ''}`} onClick={() => setFilterCategory('')}>全部</button>
          {CATEGORIES.map(c => (
            <button
              key={c.value}
              className={`filter-tab ${filterCategory === c.value ? 'active' : ''}`}
              onClick={() => setFilterCategory(c.value)}
            >{c.label}</button>
          ))}
        </div>
      </div>

      <div className="paradigm-grid">
        {loading && <div className="loading">加载中…</div>}
        {!loading && filtered.length === 0 && (
          <div className="empty">暂无范式，点击"新增范式"创建第一条</div>
        )}
        {filtered.map(p => {
          const grade = severityLabel(p.severity_multiplier || 1.0);
          const catLabel = CATEGORIES.find(c => c.value === p.category)?.label || p.category;
          return (
            <div key={p.id} className="paradigm-card">
              <div className="pc-header">
                <div className="pc-title">
                  <span className="pc-name">{p.name}</span>
                  <span className="pc-cat">{catLabel}</span>
                </div>
                <span className="pc-grade" style={{ color: SEVERITY_COLORS[grade] }}>
                  {grade}
                </span>
              </div>
              <div className="pc-meta">
                <span>⏱️ {p.duration_days}天</span>
                <span>✖️ {p.severity_multiplier?.toFixed(1)}</span>
                <span>🔑 {(p.trigger_keywords || []).length} 关键词</span>
              </div>
              <div className="pc-keywords">
                {(p.trigger_keywords || []).slice(0, 5).map(k => (
                  <span key={k} className="tag small">{k}</span>
                ))}
                {(p.trigger_keywords || []).length > 5 && (
                  <span className="tag small muted">+{(p.trigger_keywords || []).length - 5}</span>
                )}
              </div>
              {p.description && <p className="pc-desc">{p.description}</p>}
              <div className="pc-actions">
                <button className="btn-edit" onClick={() => setEditing(p)}>编辑</button>
                <button className="btn-del" onClick={() => handleDelete(p.id)}>删除</button>
              </div>
            </div>
          );
        })}
      </div>

      {editing !== null && (
        <Drawer paradigm={Object.keys(editing).length ? editing : null} onClose={() => setEditing(null)} onSave={handleSave} />
      )}
      {showTester && <MatchTester onClose={() => setShowTester(false)} />}
    </div>
  );
}
