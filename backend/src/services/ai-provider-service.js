/**
 * @file ai-provider-service.js
 * @description AI提供商服务 - 统一管理多个AI提供商的调用，支持fallback链。
 * 安全说明：API Key 仅在后端处理，对外接口返回脱敏版本。
 * @module AIProviderService
 */

/**
 * 脱敏API Key，只显示首4位和末4位
 * @param {string} key
 * @returns {string}
 */
function maskApiKey(key) {
  if (!key || key.length < 8) return '****';
  return key.slice(0, 4) + '****' + key.slice(-4);
}

class AIProviderService {
  /**
   * @param {import('sqlite3').Database} db - SQLite数据库实例
   */
  constructor(db) {
    this.db = db;
  }

  /**
   * 执行数据库查询（Promise包装）
   * @private
   */
  _get(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) reject(err); else resolve(row);
      });
    });
  }

  /**
   * 执行数据库查询列表（Promise包装）
   * @private
   */
  _all(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) reject(err); else resolve(rows || []);
      });
    });
  }

  /**
   * 执行数据库写操作（Promise包装）
   * @private
   */
  _run(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function(err) {
        if (err) reject(err); else resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  }

  /**
   * 获取所有提供商列表（API Key脱敏）
   * @returns {Promise<Array>}
   */
  async getAllProviders() {
    const providers = await this._all('SELECT * FROM ai_providers ORDER BY is_default DESC, id ASC');
    return providers.map(p => ({
      ...p,
      api_key: maskApiKey(p.api_key),
      models: JSON.parse(p.models || '[]'),
      extra_config: JSON.parse(p.extra_config || '{}'),
    }));
  }

  /**
   * 获取提供商完整配置（含明文Key，仅内部使用）
   * @param {number} id
   * @returns {Promise<Object>}
   */
  async getProviderRaw(id) {
    const p = await this._get('SELECT * FROM ai_providers WHERE id = ?', [id]);
    if (!p) return null;
    return {
      ...p,
      models: JSON.parse(p.models || '[]'),
      extra_config: JSON.parse(p.extra_config || '{}'),
    };
  }

  /**
   * 获取当前默认提供商配置（含明文Key）
   * @returns {Promise<Object|null>}
   */
  async getDefaultProvider() {
    const p = await this._get(
      'SELECT * FROM ai_providers WHERE is_default = TRUE AND is_active = TRUE LIMIT 1'
    );
    if (!p) return null;
    return {
      ...p,
      models: JSON.parse(p.models || '[]'),
      extra_config: JSON.parse(p.extra_config || '{}'),
    };
  }

  /**
   * 从数据库获取指定提供商类型的API Key
   * @param {string} providerType - 'openrouter'|'ollama'|'custom'
   * @returns {Promise<string|null>}
   */
  async getPlatformKey(providerType) {
    const p = await this._get(
      'SELECT api_key FROM ai_providers WHERE provider_type = ? AND is_active = TRUE ORDER BY is_default DESC LIMIT 1',
      [providerType]
    );
    return p ? p.api_key : null;
  }

  /**
   * 添加新提供商
   * @param {Object} data - 提供商数据
   * @returns {Promise<{id: number}>}
   */
  async addProvider(data) {
    const { name, provider_type, base_url, api_key, is_default = false, models = [], extra_config = {} } = data;
    if (!name || !provider_type || !base_url) {
      throw new Error('name/provider_type/base_url 为必填项');
    }
    const result = await this._run(
      `INSERT INTO ai_providers (name, provider_type, base_url, api_key, is_default, models, extra_config)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [name, provider_type, base_url, api_key || null, is_default ? 1 : 0,
       JSON.stringify(models), JSON.stringify(extra_config)]
    );
    return { id: result.lastID };
  }

  /**
   * 更新提供商配置
   * @param {number} id
   * @param {Object} data
   * @returns {Promise<{updated: boolean}>}
   */
  async updateProvider(id, data) {
    const fields = [];
    const params = [];
    const allowed = ['name', 'base_url', 'api_key', 'is_active', 'models', 'extra_config'];
    for (const key of allowed) {
      if (data[key] !== undefined) {
        fields.push(`${key} = ?`);
        // JSON字段序列化
        params.push(['models', 'extra_config'].includes(key) ? JSON.stringify(data[key]) : data[key]);
      }
    }
    if (!fields.length) return { updated: false };
    fields.push('updated_at = CURRENT_TIMESTAMP');
    params.push(id);
    const result = await this._run(
      `UPDATE ai_providers SET ${fields.join(', ')} WHERE id = ?`, params
    );
    return { updated: result.changes > 0 };
  }

  /**
   * 删除提供商
   * @param {number} id
   * @returns {Promise<{deleted: boolean}>}
   */
  async deleteProvider(id) {
    const result = await this._run('DELETE FROM ai_providers WHERE id = ?', [id]);
    return { deleted: result.changes > 0 };
  }

  /**
   * 设置默认提供商
   * @param {number} id
   * @returns {Promise<{ok: boolean}>}
   */
  async setDefault(id) {
    await this._run('UPDATE ai_providers SET is_default = FALSE');
    await this._run('UPDATE ai_providers SET is_default = TRUE WHERE id = ?', [id]);
    return { ok: true };
  }

  /**
   * 测试提供商连通性（发送一条极短的测试请求）
   * @param {number} id
   * @returns {Promise<{ok: boolean, latency: number, error?: string}>}
   */
  async testConnection(id) {
    const provider = await this.getProviderRaw(id);
    if (!provider) return { ok: false, latency: 0, error: '提供商不存在' };

    const start = Date.now();
    try {
      if (provider.provider_type === 'ollama') {
        // Ollama：直接请求 /api/tags
        const ollamaBase = provider.base_url.replace('/v1', '');
        const resp = await fetch(`${ollamaBase}/api/tags`, {
          signal: AbortSignal.timeout(8000)
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        const models = (data.models || []).map(m => m.name);
        return { ok: true, latency: Date.now() - start, models };
      } else {
        // OpenAI兼容接口：发一条简单请求
        const headers = {
          'Content-Type': 'application/json',
          ...(provider.api_key ? { 'Authorization': `Bearer ${provider.api_key}` } : {}),
          ...(provider.extra_config?.headers || {})
        };
        // 获取第一个已启用的模型ID
        const models = await this._all(
          'SELECT model_id FROM ai_models WHERE provider_id = ? AND is_enabled = TRUE LIMIT 1', [id]
        );
        const modelId = models[0]?.model_id || 'gpt-3.5-turbo';
        const resp = await fetch(`${provider.base_url}/chat/completions`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: modelId,
            messages: [{ role: 'user', content: 'Hi' }],
            max_tokens: 5
          }),
          signal: AbortSignal.timeout(15000)
        });
        if (!resp.ok) {
          const errText = await resp.text();
          throw new Error(`HTTP ${resp.status}: ${errText.slice(0, 200)}`);
        }
        return { ok: true, latency: Date.now() - start };
      }
    } catch (e) {
      return { ok: false, latency: Date.now() - start, error: e.message };
    }
  }

  /**
   * 获取提供商可用模型列表
   * - Ollama: 请求 /api/tags 获取本地模型
   * - 其他: 返回数据库中配置的模型
   * @param {number} id
   * @returns {Promise<{models: Array}>}
   */
  async fetchProviderModels(id) {
    const provider = await this.getProviderRaw(id);
    if (!provider) throw new Error('提供商不存在');

    if (provider.provider_type === 'ollama') {
      return this.fetchOllamaModels(provider.base_url);
    }

    const dbModels = await this._all(
      'SELECT * FROM ai_models WHERE provider_id = ? ORDER BY tier, display_name', [id]
    );
    return { models: dbModels, source: 'database' };
  }

  /**
   * 从Ollama获取本地模型列表
   * @param {string} baseUrl - Ollama v1 API地址（如 http://localhost:11434/v1）
   * @returns {Promise<{models: string[], source: string}>}
   */
  async fetchOllamaModels(baseUrl) {
    const ollamaBase = baseUrl.replace('/v1', '');
    const resp = await fetch(`${ollamaBase}/api/tags`, {
      signal: AbortSignal.timeout(8000)
    });
    if (!resp.ok) throw new Error(`Ollama返回 HTTP ${resp.status}`);
    const data = await resp.json();
    const models = (data.models || []).map(m => ({
      model_id: m.name,
      display_name: m.name,
      tier: 'standard',
      description: `大小: ${m.size ? (m.size / 1e9).toFixed(1) + 'GB' : '未知'}`
    }));
    return { models, source: 'ollama' };
  }

  /**
   * 添加模型配置
   * @param {Object} data
   * @returns {Promise<{id: number}>}
   */
  async addModel(data) {
    const { provider_id, model_id, display_name, tier = 'standard', token_cost_per_1k = 0,
            context_length = 8192, description = '' } = data;
    if (!provider_id || !model_id || !display_name) {
      throw new Error('provider_id/model_id/display_name 为必填项');
    }
    const result = await this._run(
      `INSERT INTO ai_models (provider_id, model_id, display_name, tier, token_cost_per_1k, context_length, description)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [provider_id, model_id, display_name, tier, token_cost_per_1k, context_length, description]
    );
    return { id: result.lastID };
  }

  /**
   * 删除模型配置
   * @param {number} id
   * @returns {Promise<{deleted: boolean}>}
   */
  async deleteModel(id) {
    const result = await this._run('DELETE FROM ai_models WHERE id = ?', [id]);
    return { deleted: result.changes > 0 };
  }

  /**
   * 用指定提供商调用LLM（OpenAI兼容接口）
   * @param {string} prompt - 提示词
   * @param {string} [model] - 模型ID（可选，使用提供商第一个模型）
   * @param {number} [providerId] - 提供商ID（可选，使用默认提供商）
   * @returns {Promise<{content: string, usage: Object, provider: string}>}
   */
  async call(prompt, model, providerId) {
    let provider;
    if (providerId) {
      provider = await this.getProviderRaw(providerId);
    } else {
      provider = await this.getDefaultProvider();
    }
    if (!provider) throw new Error('未找到可用的AI提供商，请在AI引擎管理中心配置');

    if (!model) {
      const m = await this._get(
        'SELECT model_id FROM ai_models WHERE provider_id = ? AND is_enabled = TRUE ORDER BY CASE tier WHEN "free" THEN 0 WHEN "standard" THEN 1 WHEN "premium" THEN 2 ELSE 3 END LIMIT 1',
        [provider.id]
      );
      model = m?.model_id;
    }

    const headers = {
      'Content-Type': 'application/json',
      ...(provider.api_key ? { 'Authorization': `Bearer ${provider.api_key}` } : {}),
      ...(provider.extra_config?.headers || {})
    };

    const resp = await fetch(`${provider.base_url}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 2000
      }),
      signal: AbortSignal.timeout(30000)
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`${provider.name} 返回错误 HTTP ${resp.status}: ${errText.slice(0, 300)}`);
    }

    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content || '';
    return {
      content,
      usage: data.usage || {},
      provider: provider.name,
      model: model || 'unknown'
    };
  }
}

/**
 * AI 提供商预设配置
 * 用户可通过 AI 引擎管理中心一键载入这些预设，无需手动填写
 */
const PROVIDER_PRESETS = [
  {
    name: 'OpenRouter（推荐）',
    provider_type: 'openrouter',
    base_url: 'https://openrouter.ai/api/v1',
    required_fields: ['api_key'],
    required_field_labels: { api_key: 'OpenRouter API Key' },
    models: [
      { model_id: 'stepfun/step-3.5-flash:free', display_name: 'StepFun Flash（免费）', tier: 'free', token_cost_per_1k: 0 },
      { model_id: 'google/gemini-flash-1.5:free', display_name: 'Gemini Flash 1.5（免费）', tier: 'free', token_cost_per_1k: 0 },
      { model_id: 'anthropic/claude-3-haiku', display_name: 'Claude 3 Haiku', tier: 'standard', token_cost_per_1k: 0.25 },
    ],
    description: '统一接入多家模型，含大量免费模型，推荐首选',
  },
  {
    name: 'StepFun阶跃星辰',
    provider_type: 'openrouter',
    base_url: 'https://openrouter.ai/api/v1',
    required_fields: ['api_key'],
    required_field_labels: { api_key: 'OpenRouter API Key' },
    models: [
      { model_id: 'stepfun/step-3.5-flash:free', display_name: 'Step-3.5-Flash（免费）', tier: 'free', token_cost_per_1k: 0 },
    ],
    description: '阶跃星辰 Step-3.5-Flash 免费模型，速度快，适合高频分析',
  },
  {
    name: 'Ollama 本地推理',
    provider_type: 'ollama',
    base_url: 'http://localhost:11434/v1',
    required_fields: [],
    required_field_labels: {},
    models: [],
    description: '本地部署，零成本，模型需提前下载',
  },
];

module.exports = { AIProviderService, maskApiKey, PROVIDER_PRESETS };
