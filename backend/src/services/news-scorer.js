/**
 * @file 新闻重要性评分服务（StepFun LLM）
 * @module services/news-scorer
 *
 * 从数据库取 status='pending' 的新闻，调用 StepFun step-3.5-flash:free
 * 对每条新闻评分（0-10），写回 news_processed 表
 * 评分≥7的新闻触发知识库范式分析
 */

const { analyzeWithParadigm } = require('./news-paradigm-analyzer');

/** 评分阈值（>= 此值触发范式分析和飞书预警） */
const NEWS_SCORE_ALERT_THRESHOLD = parseInt(process.env.NEWS_SCORE_ALERT_THRESHOLD || '7', 10);

/** 每批最多处理条数 */
const BATCH_SIZE = 10;

/** 并发数上限 */
const CONCURRENCY = 3;

/**
 * 评分提示词（精简，控制 token 消耗）
 * @param {string} content
 * @returns {string}
 */
const SCORING_PROMPT = (content) => `
你是专业的财经新闻重要性分析师。对以下金融快讯评分（0-10）。

评分标准：
- 9-10：重大政策/央行决议/系统性风险事件
- 7-8：重要财报/龙头企业重大变化/行业政策
- 5-6：普通市场消息/一般公司公告
- 3-4：日常市场动态/非核心信息
- 0-2：噪音/广告/重复信息

只返回JSON，格式：
{"score": 数字, "reason": "20字以内理由", "sentiment": "利好/利空/中性", "urgency": "即时/今日/本周"}

新闻：${content.slice(0, 500)}
`.trim();

/**
 * 获取数据库实例（懒加载，避免循环依赖）
 * @returns {import('sqlite3').Database}
 */
function getDb() {
  // 通过 app.locals 无法在服务层直接访问，改为直接 require db
  const Database = require('../db');
  if (!getDb._instance) {
    getDb._instance = new Database();
  }
  return getDb._instance.db;
}

/**
 * 调用 StepFun（通过 OpenRouter）对新闻内容评分
 * 优先从 ai_providers 表读 key，fallback 到环境变量
 * @param {string} content
 * @returns {Promise<{score: number, reason: string, sentiment: string, urgency: string}>}
 */
async function callStepFun(content) {
  const db = getDb();

  // 优先从数据库读 OpenRouter key
  let apiKey = process.env.OPENROUTER_API_KEY || '';
  let baseUrl = 'https://openrouter.ai/api/v1';
  let model = 'stepfun/step-3.5-flash:free';

  try {
    const row = await new Promise((resolve, reject) => {
      db.get(
        `SELECT api_key, base_url FROM ai_providers WHERE is_active = 1 AND provider_type IN ('openrouter','stepfun') ORDER BY is_default DESC LIMIT 1`,
        [],
        (err, r) => { if (err) reject(err); else resolve(r); }
      );
    });
    if (row && row.api_key) {
      apiKey = row.api_key;
      if (row.base_url) baseUrl = row.base_url;
    }
  } catch (e) {
    console.warn('[NewsScorer] 读取 ai_providers 失败，使用环境变量 key:', e.message);
  }

  if (!apiKey) {
    throw new Error('未配置 OpenRouter/StepFun API Key');
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://quantoracle.app',
      'X-Title': 'QuantOracle NewsScorer',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: SCORING_PROMPT(content) }],
      max_tokens: 200,
      temperature: 0.1,
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`StepFun API error ${response.status}: ${text.slice(0, 200)}`);
  }

  const data = await response.json();
  const raw = data.choices?.[0]?.message?.content || '';

  // 提取 JSON（可能有多余文字包裹）
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`LLM 返回非 JSON: ${raw.slice(0, 100)}`);

  const parsed = JSON.parse(match[0]);
  return {
    score: Number(parsed.score) || 0,
    reason: String(parsed.reason || '').slice(0, 100),
    sentiment: parsed.sentiment || '中性',
    urgency: parsed.urgency || '本周',
  };
}

/**
 * 发送飞书预警（如果配置了 webhook）
 * @param {Object} newsItem
 * @param {Object} scoreResult
 */
async function sendFeishuAlert(newsItem, scoreResult) {
  const webhook = process.env.FEISHU_WEBHOOK;
  if (!webhook) return;
  try {
    const emoji = scoreResult.score >= 9 ? '🚨' : '⚠️';
    const body = {
      msg_type: 'text',
      content: {
        text: `${emoji} 高分新闻预警 [${scoreResult.score}分]\n${newsItem.title || newsItem.content?.slice(0, 80)}\n情绪：${scoreResult.sentiment} | 紧急度：${scoreResult.urgency}\n理由：${scoreResult.reason}`,
      },
    };
    await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
  } catch (e) {
    console.warn('[NewsScorer] 飞书推送失败:', e.message);
  }
}

/**
 * 批量处理待评分新闻（每批最多 BATCH_SIZE 条，最多 CONCURRENCY 并发）
 * @returns {Promise<{processed: number, highScore: number}>}
 */
async function scorePendingNews() {
  const db = getDb();
  let processed = 0;
  let highScore = 0;

  try {
    // 1. 取最多 BATCH_SIZE 条 status='pending' 的新闻
    const rows = await new Promise((resolve, reject) => {
      db.all(
        `SELECT * FROM news_processed WHERE status = 'pending' ORDER BY created_at ASC LIMIT ?`,
        [BATCH_SIZE],
        (err, r) => { if (err) reject(err); else resolve(r || []); }
      );
    });

    if (rows.length === 0) return { processed: 0, highScore: 0 };

    // 2. 分批并发（最多 CONCURRENCY 个同时进行）
    for (let i = 0; i < rows.length; i += CONCURRENCY) {
      const chunk = rows.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        chunk.map(async (news) => {
          const content = news.content || news.title || '';
          try {
            const scoreResult = await callStepFun(content);

            // 3. 写回数据库
            await new Promise((resolve, reject) => {
              db.run(
                `UPDATE news_processed SET score = ?, score_reason = ?, sentiment = ?, urgency = ?, status = 'scored', scored_at = CURRENT_TIMESTAMP WHERE id = ?`,
                [scoreResult.score, scoreResult.reason, scoreResult.sentiment, scoreResult.urgency, news.id],
                (err) => { if (err) reject(err); else resolve(); }
              );
            });

            processed++;

            // 4. 高分新闻触发范式分析 + 飞书预警
            if (scoreResult.score >= NEWS_SCORE_ALERT_THRESHOLD) {
              highScore++;
              const enriched = { ...news, score: scoreResult.score, sentiment: scoreResult.sentiment };
              analyzeWithParadigm(enriched).catch(e =>
                console.error(`[NewsScorer] 范式分析失败 news_id=${news.id}:`, e.message)
              );
              sendFeishuAlert(news, scoreResult).catch(() => {});
            }

            return scoreResult;
          } catch (e) {
            console.error(`[NewsScorer] 评分失败 news_id=${news.id}:`, e.message);
            // 失败：标记为 score_failed，下次重试
            await new Promise((resolve) => {
              db.run(
                `UPDATE news_processed SET status = 'score_failed', score_reason = ? WHERE id = ?`,
                [e.message.slice(0, 200), news.id],
                () => resolve()
              );
            });
            throw e;
          }
        })
      );

      // 记录失败情况
      results.forEach((r, idx) => {
        if (r.status === 'rejected') {
          console.warn(`[NewsScorer] chunk[${i + idx}] rejected:`, r.reason?.message);
        }
      });
    }
  } catch (e) {
    console.error('[NewsScorer] scorePendingNews 异常:', e.message);
  }

  return { processed, highScore };
}

module.exports = { scorePendingNews };
