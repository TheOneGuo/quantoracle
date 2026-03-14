/**
 * @file AIProviderManager.jsx
 * @description AI引擎管理中心 - 向导式配置 + 提供商列表管理
 * 支持 OpenRouter / Ollama / 硅基流动 / 自定义 OpenAI兼容接口
 */
import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import './AIProviderManager.css';

const API_BASE = 'http://localhost:3001/api';

// 提供商类型定义
const PROVIDER_TYPES = [
  {
    type: 'openrouter',
    icon: '🌐',
    name: 'OpenRouter',
    desc: '云端中转站',
    hint: '需API Key',
    defaultUrl: 'https://openrouter.ai/api/v1',
    needsKey: true,
    keyPlaceholder: 'sk-or-...',
    keyHowto: [
      '打开 openrouter.ai 注册账号',
      '点击右上角头像 → Keys',
      '点击 Create Key，复制粘贴到这里'
    ]
  },
  {
    type: 'ollama',
    icon: '🤖',
    name: 'Ollama',
    desc: '本地模型',
    hint: '免费私密',
    defaultUrl: 'http://localhost:11434/v1',
    needsKey: false,
    keyPlaceholder: '本地通常不需要',
  },
  {
    type: 'openai',
    icon: '⚡',
    name: '硅基流动',
    desc: '或其他',
    hint: '中转站',
    defaultUrl: 'https://api.siliconflow.cn/v1',
    needsKey: true,
    keyPlaceholder: 'sk-...',
    nameEditable: true,
  },
  {
    type: 'custom',
    icon: '🔧',
    name: '自定义',
    desc: 'OpenAI格式',
    hint: '兼容接口',
    defaultUrl: '',
    needsKey: true,
    keyPlaceholder: 'sk-...',
    nameEditable: true,
  }
];

const TIER_LABELS = { free: '免费', standard: '标准', premium: '高级', flagship: '旗舰' };
const TIER_COLORS = { free: '#52c41a', standard: '#1890ff', premium: '#722ed1', flagship: '#eb2f96' };

/**
 * 步骤指示器
 */
function StepIndicator({ step, total = 4 }) {
  const labels = ['选择引擎', '填写配置', '测试连接', '完成'];
  return (
    <div className="step-indicator">
      {labels.map((label, i) => (
        <div key={i} className={`step-item ${i + 1 <= step ? 'active' : ''} ${i + 1 < step ? 'done' : ''}`}>
          <div className="step-circle">{i + 1 < step ? '✓' : i + 1}</div>
          <div className="step-label">{label}</div>
          {i < labels.length - 1 && <div className="step-line" />}
        </div>
      ))}
    </div>
  );
}

/**
 * 提供商卡片（列表视图）
 */
function ProviderCard({ provider, onTest, onEdit, onDelete, onSetDefault, onRefreshModels, testResult }) {
  const [expanded, setExpanded] = useState(false);
  const [models, setModels] = useState([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [newModelId, setNewModelId] = useState('');
  const [newModelName, setNewModelName] = useState('');
  const [addingModel, setAddingModel] = useState(false);

  const token = localStorage.getItem('token');
  const headers = token ? { Authorization: `Bearer ${token}` } : {};

  const loadModels = useCallback(async () => {
    setLoadingModels(true);
    try {
      const res = await axios.get(`${API_BASE}/admin/providers/${provider.id}/models`, { headers });
      setModels(res.data.models || []);
    } catch { /* ignore */ }
    setLoadingModels(false);
  }, [provider.id]);

  useEffect(() => {
    if (expanded) loadModels();
  }, [expanded, loadModels]);

  const handleAddModel = async () => {
    if (!newModelId || !newModelName) return;
    setAddingModel(true);
    try {
      await axios.post(`${API_BASE}/admin/models`, {
        provider_id: provider.id,
        model_id: newModelId,
        display_name: newModelName
      }, { headers });
      setNewModelId('');
      setNewModelName('');
      loadModels();
    } catch (e) {
      alert('添加失败：' + (e.response?.data?.error || e.message));
    }
    setAddingModel(false);
  };

  const handleDeleteModel = async (modelId) => {
    if (!confirm('确认删除此模型？')) return;
    try {
      await axios.delete(`${API_BASE}/admin/models/${modelId}`, { headers });
      loadModels();
    } catch (e) {
      alert('删除失败');
    }
  };

  const isDefault = provider.is_default;
  const statusOk = testResult?.ok;

  return (
    <div className={`provider-card ${isDefault ? 'provider-default' : ''}`}>
      <div className="provider-card-header">
        <div className="provider-info">
          <span className="provider-icon">
            {PROVIDER_TYPES.find(t => t.type === provider.provider_type)?.icon || '🔌'}
          </span>
          <div>
            <div className="provider-name">
              {provider.name}
              {isDefault && <span className="badge badge-default">默认</span>}
              {!provider.is_active && <span className="badge badge-inactive">已禁用</span>}
            </div>
            <div className="provider-meta">
              {provider.provider_type === 'ollama'
                ? `地址: ${provider.base_url}`
                : `Key: ${provider.api_key || '未配置'}`}
              {testResult && (
                <span className={`status-dot ${statusOk ? 'ok' : 'fail'}`}>
                  {statusOk ? `✅ 正常 ${testResult.latency}ms` : `❌ 失败`}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="provider-actions">
          {!isDefault && (
            <button className="btn btn-sm" onClick={() => onSetDefault(provider.id)}>设为默认</button>
          )}
          <button className="btn btn-sm btn-test" onClick={() => onTest(provider.id)}>测试</button>
          <button className="btn btn-sm btn-edit" onClick={() => setExpanded(!expanded)}>
            {expanded ? '收起' : '编辑'}
          </button>
          <button className="btn btn-sm btn-delete" onClick={() => onDelete(provider.id)}>删</button>
        </div>
      </div>

      {expanded && (
        <div className="provider-edit-panel">
          <h4>模型列表</h4>
          {loadingModels && <div className="loading-hint">加载中...</div>}
          <button className="btn btn-sm" onClick={loadModels} style={{ marginBottom: 8 }}>
            🔄 {provider.provider_type === 'ollama' ? '拉取本地模型' : '刷新模型列表'}
          </button>
          <div className="model-list">
            {models.map(m => (
              <div key={m.id || m.model_id} className="model-item">
                <span className="model-tier" style={{ color: TIER_COLORS[m.tier] || '#666' }}>
                  {TIER_LABELS[m.tier] || m.tier}
                </span>
                <span className="model-id">{m.model_id}</span>
                <span className="model-name">{m.display_name}</span>
                {m.description && <span className="model-desc">{m.description}</span>}
                {m.id && (
                  <button className="btn btn-xs btn-delete" onClick={() => handleDeleteModel(m.id)}>✕</button>
                )}
              </div>
            ))}
            {!loadingModels && models.length === 0 && (
              <div className="empty-hint">暂无模型，请点击拉取或手动添加</div>
            )}
          </div>
          <div className="model-add-row">
            <input
              className="input-sm"
              placeholder="模型ID (如 deepseek/deepseek-v3.2)"
              value={newModelId}
              onChange={e => setNewModelId(e.target.value)}
            />
            <input
              className="input-sm"
              placeholder="显示名称"
              value={newModelName}
              onChange={e => setNewModelName(e.target.value)}
            />
            <button className="btn btn-sm btn-add" onClick={handleAddModel} disabled={addingModel}>
              + 添加
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * 向导步骤2：填写配置表单
 */
function StepConfig({ typeInfo, formData, setFormData }) {
  const [showHowto, setShowHowto] = useState(false);

  return (
    <div className="step-config">
      <h3>配置 {typeInfo.name}</h3>

      {typeInfo.nameEditable && (
        <div className="form-row">
          <label>服务名称</label>
          <input
            className="input-full"
            value={formData.name}
            onChange={e => setFormData(f => ({ ...f, name: e.target.value }))}
            placeholder={`如：${typeInfo.name}`}
          />
        </div>
      )}

      <div className="form-row">
        <label>API 地址</label>
        <input
          className="input-full"
          value={formData.base_url}
          onChange={e => setFormData(f => ({ ...f, base_url: e.target.value }))}
          placeholder={typeInfo.defaultUrl}
        />
      </div>

      {typeInfo.type === 'ollama' && (
        <div className="hint-box">💡 如果 Ollama 在其他设备，填那台设备的 IP（如 http://192.168.1.100:11434/v1）</div>
      )}

      <div className="form-row">
        <label>
          API Key
          {typeInfo.keyHowto && (
            <button className="btn-link" onClick={() => setShowHowto(!showHowto)}>
              如何获取？→
            </button>
          )}
        </label>
        <input
          className="input-full"
          type="password"
          value={formData.api_key}
          onChange={e => setFormData(f => ({ ...f, api_key: e.target.value }))}
          placeholder={typeInfo.keyPlaceholder}
        />
        {showHowto && typeInfo.keyHowto && (
          <div className="howto-box">
            {typeInfo.keyHowto.map((step, i) => (
              <div key={i}>{i + 1}. {step}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * 向导步骤3：测试连接
 */
function StepTest({ providerId, testResult, onTest }) {
  return (
    <div className="step-test">
      <h3>测试连接</h3>
      {!testResult && (
        <div>
          <div className="loading-hint">准备测试...</div>
          <button className="btn btn-primary" onClick={onTest}>开始测试</button>
        </div>
      )}
      {testResult?.loading && (
        <div className="test-loading">⏳ 正在测试连接...</div>
      )}
      {testResult && !testResult.loading && (
        <div className={`test-result ${testResult.ok ? 'success' : 'fail'}`}>
          {testResult.ok ? (
            <>
              <div>✅ 连接成功！延迟 {testResult.latency}ms</div>
              {testResult.models?.length > 0 && (
                <div>✅ 检测到 {testResult.models.length} 个可用模型：
                  {testResult.models.slice(0, 3).map(m => m.model_id || m.name || m).join(' / ')}
                  {testResult.models.length > 3 ? ' ...' : ''}
                </div>
              )}
            </>
          ) : (
            <div>❌ 连接失败：{testResult.error}</div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * 主组件：AI引擎管理中心
 */
export default function AIProviderManager() {
  const navigate = useNavigate();
  const token = localStorage.getItem('token');
  const headers = token ? { Authorization: `Bearer ${token}` } : {};

  // 列表视图状态
  const [providers, setProviders] = useState([]);
  const [loadingProviders, setLoadingProviders] = useState(false);
  const [testResults, setTestResults] = useState({});

  // 向导状态机
  const [wizardOpen, setWizardOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [selectedType, setSelectedType] = useState(null);
  const [formData, setFormData] = useState({ name: '', base_url: '', api_key: '' });
  const [createdProviderId, setCreatedProviderId] = useState(null);
  const [testResult, setTestResult] = useState(null);
  const [saving, setSaving] = useState(false);

  const loadProviders = useCallback(async () => {
    setLoadingProviders(true);
    try {
      const res = await axios.get(`${API_BASE}/admin/providers`, { headers });
      setProviders(res.data.providers || []);
    } catch (e) {
      console.error('加载提供商失败', e);
    }
    setLoadingProviders(false);
  }, []);

  useEffect(() => { loadProviders(); }, [loadProviders]);

  // 测试现有提供商
  const handleTest = async (id) => {
    setTestResults(r => ({ ...r, [id]: { loading: true } }));
    try {
      const res = await axios.post(`${API_BASE}/admin/providers/${id}/test`, {}, { headers });
      setTestResults(r => ({ ...r, [id]: res.data }));
    } catch (e) {
      setTestResults(r => ({ ...r, [id]: { ok: false, error: e.message } }));
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('确认删除此提供商？')) return;
    try {
      await axios.delete(`${API_BASE}/admin/providers/${id}`, { headers });
      loadProviders();
    } catch (e) { alert('删除失败'); }
  };

  const handleSetDefault = async (id) => {
    try {
      await axios.post(`${API_BASE}/admin/providers/${id}/default`, {}, { headers });
      loadProviders();
    } catch (e) { alert('设置失败'); }
  };

  // 向导：选择类型
  const handleSelectType = (typeInfo) => {
    setSelectedType(typeInfo);
    setFormData({
      name: typeInfo.name,
      base_url: typeInfo.defaultUrl,
      api_key: ''
    });
    setStep(2);
  };

  // 向导：保存并测试
  const handleSaveAndTest = async () => {
    setSaving(true);
    try {
      const payload = {
        name: formData.name || selectedType.name,
        provider_type: selectedType.type,
        base_url: formData.base_url,
        api_key: formData.api_key || null,
      };
      const res = await axios.post(`${API_BASE}/admin/providers`, payload, { headers });
      const newId = res.data.id;
      setCreatedProviderId(newId);
      setStep(3);
      // 自动测试
      setTestResult({ loading: true });
      const testRes = await axios.post(`${API_BASE}/admin/providers/${newId}/test`, {}, { headers });
      setTestResult(testRes.data);
    } catch (e) {
      alert('保存失败：' + (e.response?.data?.error || e.message));
    }
    setSaving(false);
  };

  const handleSetDefaultAndClose = async () => {
    if (createdProviderId) {
      await axios.post(`${API_BASE}/admin/providers/${createdProviderId}/default`, {}, { headers });
    }
    setWizardOpen(false);
    setStep(1);
    setSelectedType(null);
    setCreatedProviderId(null);
    setTestResult(null);
    loadProviders();
  };

  const handleWizardClose = () => {
    setWizardOpen(false);
    setStep(1);
    setSelectedType(null);
    setTestResult(null);
    loadProviders();
  };

  return (
    <div className="ai-provider-manager">
      <div className="manager-header">
        <div>
          <button className="btn btn-back" onClick={() => navigate(-1)}>← 返回</button>
          <h2>⚙️ AI引擎管理中心</h2>
          <p className="manager-desc">管理多个AI提供商，支持OpenRouter云端、Ollama本地模型及自定义中转站</p>
        </div>
        <button className="btn btn-primary" onClick={() => { setWizardOpen(true); setStep(1); }}>
          + 添加引擎
        </button>
      </div>

      {/* 提供商列表 */}
      <div className="provider-list">
        {loadingProviders && <div className="loading-hint">加载中...</div>}
        {!loadingProviders && providers.length === 0 && (
          <div className="empty-state">
            <div className="empty-icon">🤖</div>
            <p>暂未配置AI引擎</p>
            <button className="btn btn-primary" onClick={() => setWizardOpen(true)}>立即添加</button>
          </div>
        )}
        {providers.map(p => (
          <ProviderCard
            key={p.id}
            provider={p}
            testResult={testResults[p.id]}
            onTest={handleTest}
            onEdit={() => {}}
            onDelete={handleDelete}
            onSetDefault={handleSetDefault}
          />
        ))}
      </div>

      {/* 向导对话框 */}
      {wizardOpen && (
        <div className="wizard-overlay" onClick={e => e.target === e.currentTarget && handleWizardClose()}>
          <div className="wizard-modal">
            <button className="wizard-close" onClick={handleWizardClose}>✕</button>
            <StepIndicator step={step} />

            {/* Step 1：选择引擎类型 */}
            {step === 1 && (
              <div className="wizard-step">
                <h3>选择引擎类型</h3>
                <div className="type-grid">
                  {PROVIDER_TYPES.map(typeInfo => (
                    <div
                      key={typeInfo.type}
                      className="type-card"
                      onClick={() => handleSelectType(typeInfo)}
                    >
                      <div className="type-icon">{typeInfo.icon}</div>
                      <div className="type-name">{typeInfo.name}</div>
                      <div className="type-desc">{typeInfo.desc}</div>
                      <div className="type-hint">{typeInfo.hint}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Step 2：填写配置 */}
            {step === 2 && selectedType && (
              <div className="wizard-step">
                <StepConfig typeInfo={selectedType} formData={formData} setFormData={setFormData} />
                <div className="wizard-actions">
                  <button className="btn" onClick={() => setStep(1)}>← 上一步</button>
                  <button className="btn btn-primary" onClick={handleSaveAndTest} disabled={saving}>
                    {saving ? '保存中...' : '下一步：测试连接'}
                  </button>
                </div>
              </div>
            )}

            {/* Step 3：测试连接 */}
            {step === 3 && (
              <div className="wizard-step">
                <StepTest
                  providerId={createdProviderId}
                  testResult={testResult}
                  onTest={() => handleTest(createdProviderId)}
                />
                <div className="wizard-actions">
                  <button className="btn" onClick={() => setStep(2)}>← 上一步</button>
                  <button
                    className="btn btn-primary"
                    onClick={() => setStep(4)}
                    disabled={!testResult || testResult.loading}
                  >
                    完成配置 →
                  </button>
                </div>
              </div>
            )}

            {/* Step 4：完成 */}
            {step === 4 && (
              <div className="wizard-step wizard-done">
                <div className="done-icon">🎉</div>
                <h3>配置完成！</h3>
                <p>{formData.name || selectedType?.name} 已成功添加为您的AI引擎</p>
                {testResult?.ok && <p className="success-hint">✅ 连接正常，可以开始使用</p>}
                <div className="wizard-actions done-actions">
                  <button className="btn" onClick={handleSetDefaultAndClose}>设为默认引擎</button>
                  <button className="btn" onClick={() => { setStep(1); setSelectedType(null); setTestResult(null); setCreatedProviderId(null); }}>
                    继续添加
                  </button>
                  <button className="btn btn-primary" onClick={handleWizardClose}>完成</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
