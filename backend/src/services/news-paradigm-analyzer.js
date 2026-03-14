/**
 * @file 高分新闻 × 知识库范式分析
 * @module services/news-paradigm-analyzer
 *
 * 当新闻评分 >= 阈值时，自动用已有范式库进行分析
 * 范式来自 ParadigmEditor 系统（/api/knowledge/paradigms）
 */

const NEWS_SCORE_ALERT_THRESHOLD = parseInt(process.env.NEWS_SCORE_ALERT_THRESHOLD || '7', 10);
const TRADING_AGENTS_URL = process.env.TRADING_AGENTS_URL || 'http://localhost:8768';

/** 缓存 db 实例 */
let _db = null;
function getDb() {
  if (!_db) {
    const Database = require('../db');
    const instance = new Database();
    _db = instance.db;
  }
  return _db;
}

/**
 * 获取 WebSocket 广播函数（若已挂载到 global.wsBroadcast）
 * @param {Object} payload
 */
function wsBroadcast(payload) {
  try {
    if (typeof global.wsBroadcast === 'function') {
      global.wsBroadcast(payload);
    }
  } catch (e) {
    // 静默失败，WS 推送非关键路径
  }
}

/**
 * 获取 API Key（与 news-scorer 共享逻辑）
 * @param {'free'|'standard'} tier - 模型等级
 * @returns {Promise<{apiKey: string, baseUrl: string, model: string}>}
 */
async function getApiConfig(tier = 'free') {
  const db = getDb();
  let apiKey = process.env.OPENROUTER_API_KEY || '';
  const baseUrl = 'https://openrouter.ai/api/v1';
  let model = tier === 'standard'
    ? (process.env.PARADIGM_ANALYSIS_MODEL || 'deepseek/deepseek-v3.2')
    : 'stepfun/step-3.5-flash:free';

  try {
    const row = await new Promise((resolve, reject) => {
      db.get(
        `SELECT api_key FROM ai_providers WHERE is_active = 1 AND provider_type IN ('openrouter','stepfun') ORDER BY is_default DESC LIMIT 1`,
        [],
        (err, r) => { if (err) reject(err); else resolve(r); }
      );
    });
    if (row && row.api_key) apiKey = row.api_key;
  } catch (e) {
    console.warn('[ParadigmAnalyzer] 读取 ai_providers 失败，使用环境变量 key');
  }

  return { apiKey, baseUrl, model };
}

/**
 * 从知识库获取相关范式
 * 先尝试 TradingAgents 微服务，失败则从本地 db 查
 * @param {string} assetType - 如 'A股'/'美股'
 * @param {string} eventType - 如 '政策'/'财报'
 * @returns {Promise<Array>}
 */
async function getRelevantParadigms(assetType, eventType) {
  // 尝试调用 TradingAgents 微服务（带筛选参数）
  try {
    const qs = new URLSearchParams();
    if (assetType) qs.set('asset_type', assetType);
    if (eventType) qs.set('category', eventType);
    const resp = await fetch(`${TRADING_AGENTS_URL}/paradigms?${qs}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (resp.ok) {
      const data = await resp.json();
      const list = data.paradigms || data.data || data;
      if (Array.isArray(list) && list.length > 0) return list.slice(0, 10);
    }
  } catch (e) {
    console.warn('[ParadigmAnalyzer] TradingAgents 范式获取失败，使用 mock:', e.message);
  }

  // Fallback：返回 mock 范式（沙僧模块未就绪时使用）
  return [
    { id: 1, name: '政策利好共振', description: '重大政策出台时，受益板块通常在1-3天内出现明显上涨', category: '政策' },
    { id: 2, name: '龙头财报超预期', description: '行业龙头业绩超预期，带动整个板块估值重塑', category: '财报' },
    { id: 3, name: '央行降息周期', description: '央行降息周期中，高股息蓝筹和成长股均受益', category: '货币政策' },
    { id: 4, name: '系统性风险规避', description: '重大外部冲击时应降低仓位，等待情绪底部', category: '风险' },
    { id: 5, name: '行业供给侧改革', description: '供给侧改革利好龙头企业，建议优选细分领域第一', category: '政策' },
  ];
}

/**
 * 构建范式分析提示词
 * @param {Object} news
 * @param {Array} paradigms
 * @returns {string}
 */
function buildAnalysisPrompt(news, paradigms) {
  const paradigmText = paradigms.length > 0
    ? paradigms.map(p => `- ${p.name}: ${p.description}`).join('\n')
    : '暂无范式，请基于通用投资逻辑分析。';

  return `
你是专业股票分析师，根据以下投资范式分析这条金融新闻的交易含义。

【新闻】
${(news.content || news.title || '').slice(0, 800)}

【相关投资范式】
${paradigmText}

请分析并以JSON格式返回（字段含义见下）：
{
  "triggered_paradigm": "触发的范式名称，如无则填null",
  "paradigm_id": 范式ID数字或null,
  "beneficiary_stocks": ["股票代码1", "股票代码2"],
  "beneficiary_sectors": ["行业1", "行业2"],
  "action": "buy 或 watch 或 avoid",
  "time_window": "immediate 或 1-3days 或 1-2weeks",
  "risk_note": "风险提示，50字以内",
  "confidence": 0到1之间的置信度,
  "summary": "整体分析摘要，100字以内"
}
`.trim();
}

/**
 * 调用 LLM 执行分析
 * @param {string} prompt
 * @param {string} tier
 * @returns {Promise<Object>}
 */
async function callLLM(prompt, tier = 'free') {
  const { apiKey, baseUrl, model } = await getApiConfig(tier);
  if (!apiKey) throw new Error('未配置 API Key');

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://quantoracle.app',
      'X-Title': 'QuantOracle ParadigmAnalyzer',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 600,
      temperature: 0.2,
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`LLM error ${response.status}: ${text.slice(0, 200)}`);
  }

  const data = await response.json();
  const raw = data.choices?.[0]?.message?.content || '';
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`LLM 返回非 JSON: ${raw.slice(0, 100)}`);
  return { parsed: JSON.parse(match[0]), model };
}

/**
 * 存储分析结果到 news_analysis 表
 * @param {number} newsId
 * @param {Object} result
 * @param {string} modelUsed
 */
async function saveAnalysis(newsId, result, modelUsed) {
  const db = getDb();
  const paradigmIds = result.paradigm_id ? JSON.stringify([result.paradigm_id]) : '[]';
  const stockRecos = JSON.stringify(result.beneficiary_stocks || []);

  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO news_analysis
         (news_id, paradigm_ids, analysis, model_used, confidence, stock_recommendations, action, time_window)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        newsId,
        paradigmIds,
        JSON.stringify(result),
        modelUsed,
        result.confidence || 0,
        stockRecos,
        result.action || 'watch',
        result.time_window || '1-3days',
      ],
      function(err) {
        if (err) reject(err);
        else resolve(this.lastID);
      }
    );
  });
}

/**
 * 用知识库范式分析高分新闻（入口函数）
 * @param {Object} newsItem - 来自 news_processed 的新闻条目
 * @returns {Promise<Object>} 分析结果
 */
async function analyzeWithParadigm(newsItem) {
  try {
    // Step 1: 获取相关范式
    const paradigms = await getRelevantParadigms(
      newsItem.asset_type || null,
      newsItem.event_type || null
    );

    // Step 2: 构建提示词
    const prompt = buildAnalysisPrompt(newsItem, paradigms);

    // Step 3: 选择模型（score >= 9 用更强模型）
    const tier = (newsItem.score >= 9) ? 'standard' : 'free';
    const { parsed, model } = await callLLM(prompt, tier);

    // Step 4: 存储到数据库
    const analysisId = await saveAnalysis(newsItem.id, parsed, model);

    // Step 5: WebSocket 推送
    wsBroadcast({
      type: 'news_analysis',
      data: {
        analysisId,
        newsId: newsItem.id,
        score: newsItem.score,
        action: parsed.action,
        stocks: parsed.beneficiary_stocks,
        sectors: parsed.beneficiary_sectors,
        confidence: parsed.confidence,
        summary: parsed.summary,
        time_window: parsed.time_window,
      },
    });

    console.log(`[ParadigmAnalyzer] news_id=${newsItem.id} 分析完成，action=${parsed.action}，置信度=${parsed.confidence}`);
    return { analysisId, ...parsed };
  } catch (e) {
    console.error(`[ParadigmAnalyzer] analyzeWithParadigm 异常 news_id=${newsItem.id}:`, e.message);
    // 不抛出，避免影响主服务
  }
}

module.exports = { analyzeWithParadigm, getRelevantParadigms };
