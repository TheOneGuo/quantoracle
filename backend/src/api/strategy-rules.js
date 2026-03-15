/**
 * @file 策略规则引擎 API 路由
 * @description 提供策略规则的 CRUD、AI建议、合规校验、评分调试等接口
 *
 * 路由列表：
 *   POST /api/strategy/rules/ai-suggest    — AI生成规则草稿（基于模板匹配）
 *   POST /api/strategy/rules/validate      — 合规性预检查（不保存）
 *   POST /api/strategy/rules               — 创建策略规则（新建/新版本）
 *   GET  /api/strategy/:id/rules           — 获取当前生效版本规则
 *   GET  /api/strategy/:id/rules/history   — 获取所有历史版本
 *   POST /api/strategy/:id/start-sim       — 用当前规则启动30天模拟盘
 *   GET  /api/strategy/:id/score/:stockCode — 对指定股票按当前规则打分（调试用）
 */

'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { validateStrategyRules, quickCheck } = require('../services/rule-validator');
const { scoreStock } = require('../services/stock-scorer');

const router = express.Router();

// =====================================================================
// AI 建议模板（3套预设策略风格）
// =====================================================================

/**
 * 保守型策略模板
 * 适合：低风险偏好、稳定收益，持仓周期较长（3个月以上）
 */
const TEMPLATE_CONSERVATIVE = {
  name: 'conservative',
  label: '保守型',
  description: '低风险低收益，重视基本面，轻仓稳健操作',
  dimension_weights: { technical: 35, fundamental: 40, sentiment: 5, capital: 10, chip: 10 },
  technical_rules: {
    ma: { enabled: true, periods: [5, 20, 60] },
    macd: { enabled: true },
    rsi: { enabled: true, overbought: 70, oversold: 30 },
    kdj: { enabled: false },
    volume: { enabled: true }
  },
  capital_allocation: {
    s_open: 15, a_open: 10, b_open: 5, c_open: 0,
    s_add: 10, a_add: 5, b_add: 0,
    max_single_pct: 15, max_total_pct: 70, max_add_times: 1
  },
  reduce_rules: [
    { trigger: 'grade_s_to_a', pct: 30 },
    { trigger: 'grade_a_to_b', pct: 50 },
    { trigger: 'grade_b_to_c', pct: 100 }
  ],
  take_profit_rules: [
    { type: 'fixed', trigger_pct: 12, sell_pct: 30 },
    { type: 'fixed', trigger_pct: 20, sell_pct: 50 },
    { type: 'trailing', drawdown_pct: 8, sell_pct: 50 }
  ],
  stop_loss_rules: { fixed_pct: 7, sell_pct: 100, tech_stop: 'MA60', time_stop_days: 60, drawdown_stop_pct: 40 },
  trigger_rules: [
    { condition: 'ma5_cross_ma20_up', signal: 'buy' },
    { condition: 'ma5_cross_ma20_down', signal: 'sell' }
  ],
  grade_s_threshold: 90, grade_a_threshold: 78, grade_b_threshold: 65, grade_c_threshold: 50
};

/**
 * 均衡型策略模板
 * 适合：中等风险偏好，技术面与基本面并重，持仓1-3个月
 */
const TEMPLATE_BALANCED = {
  name: 'balanced',
  label: '均衡型',
  description: '中等风险中等收益，五维度均衡权重，灵活进出',
  dimension_weights: { technical: 40, fundamental: 30, sentiment: 10, capital: 10, chip: 10 },
  technical_rules: {
    ma: { enabled: true, periods: [5, 10, 20, 60] },
    macd: { enabled: true },
    rsi: { enabled: true, overbought: 75, oversold: 25 },
    kdj: { enabled: true },
    volume: { enabled: true }
  },
  capital_allocation: {
    s_open: 20, a_open: 15, b_open: 10, c_open: 5,
    s_add: 15, a_add: 10, b_add: 5,
    max_single_pct: 20, max_total_pct: 80, max_add_times: 2
  },
  reduce_rules: [
    { trigger: 'grade_s_to_a', pct: 25 },
    { trigger: 'grade_a_to_b', pct: 40 },
    { trigger: 'grade_b_to_c', pct: 60 },
    { trigger: 'grade_c_to_d', pct: 100 }
  ],
  take_profit_rules: [
    { type: 'fixed', trigger_pct: 15, sell_pct: 30 },
    { type: 'fixed', trigger_pct: 25, sell_pct: 50 },
    { type: 'trailing', drawdown_pct: 10, sell_pct: 50 }
  ],
  stop_loss_rules: { fixed_pct: 8, sell_pct: 100, tech_stop: 'MA60', time_stop_days: 45, drawdown_stop_pct: 50 },
  trigger_rules: [
    { condition: 'ma5_cross_ma20_up', signal: 'add' },
    { condition: 'macd_golden_cross', signal: 'buy' },
    { condition: 'macd_death_cross', signal: 'reduce' }
  ],
  grade_s_threshold: 90, grade_a_threshold: 75, grade_b_threshold: 60, grade_c_threshold: 45
};

/**
 * 激进型策略模板
 * 适合：高风险高收益，以技术面为主，短线操作（1-4周）
 */
const TEMPLATE_AGGRESSIVE = {
  name: 'aggressive',
  label: '激进型',
  description: '高风险高收益，技术面主导，重仓快进快出',
  dimension_weights: { technical: 55, fundamental: 10, sentiment: 15, capital: 15, chip: 5 },
  technical_rules: {
    ma: { enabled: true, periods: [5, 10, 20] },
    macd: { enabled: true },
    rsi: { enabled: true, overbought: 80, oversold: 20 },
    kdj: { enabled: true },
    volume: { enabled: true }
  },
  capital_allocation: {
    s_open: 25, a_open: 20, b_open: 12, c_open: 5,
    s_add: 20, a_add: 12, b_add: 5,
    max_single_pct: 30, max_total_pct: 90, max_add_times: 3
  },
  reduce_rules: [
    { trigger: 'grade_s_to_a', pct: 20 },
    { trigger: 'grade_a_to_b', pct: 40 },
    { trigger: 'grade_b_to_c', pct: 70 },
    { trigger: 'grade_c_to_d', pct: 100 }
  ],
  take_profit_rules: [
    { type: 'fixed', trigger_pct: 10, sell_pct: 25 },
    { type: 'fixed', trigger_pct: 20, sell_pct: 40 },
    { type: 'fixed', trigger_pct: 35, sell_pct: 60 },
    { type: 'trailing', drawdown_pct: 12, sell_pct: 60 }
  ],
  stop_loss_rules: { fixed_pct: 6, sell_pct: 100, tech_stop: 'MA20', time_stop_days: 20, drawdown_stop_pct: 35 },
  trigger_rules: [
    { condition: 'ma5_cross_ma10_up', signal: 'add' },
    { condition: 'kdj_golden_cross_oversold', signal: 'buy' },
    { condition: 'volume_breakout', signal: 'add' },
    { condition: 'macd_death_cross', signal: 'reduce' }
  ],
  grade_s_threshold: 88, grade_a_threshold: 73, grade_b_threshold: 58, grade_c_threshold: 42
};

const TEMPLATES = [TEMPLATE_CONSERVATIVE, TEMPLATE_BALANCED, TEMPLATE_AGGRESSIVE];

/**
 * 根据用户描述文本匹配最接近的策略模板
 * 简单关键词匹配算法，无需调用LLM
 * @param {string} description 用户输入的策略描述
 * @returns {{ template: Object, confidence: number, matched_keywords: string[] }}
 */
function matchTemplate(description) {
  if (!description) return { template: TEMPLATE_BALANCED, confidence: 0.5, matched_keywords: [] };

  const desc = description.toLowerCase();

  // 关键词评分权重
  const scores = {
    conservative: 0,
    balanced: 0,
    aggressive: 0
  };

  const keywords = {
    conservative: ['保守', '稳健', '低风险', '长期', '价值', '基本面', '蓝筹', '分红', '3个月以上', '半年', '一年'],
    balanced: ['均衡', '中等', '适中', '平衡', '1-3个月', '中线', '综合', '多维度', '灵活'],
    aggressive: ['激进', '短线', '高收益', '重仓', '技术面', '快进快出', '趋势', '动量', '周线', '月线', '波段', '超短']
  };

  const matched = { conservative: [], balanced: [], aggressive: [] };

  Object.entries(keywords).forEach(([style, kws]) => {
    kws.forEach(kw => {
      if (desc.includes(kw)) {
        scores[style] += 1;
        matched[style].push(kw);
      }
    });
  });

  // 找得分最高的模板
  const topStyle = Object.entries(scores).sort(([, a], [, b]) => b - a)[0][0];
  const topScore = scores[topStyle];
  const totalMatched = Object.values(scores).reduce((s, v) => s + v, 0);

  const templateMap = {
    conservative: TEMPLATE_CONSERVATIVE,
    balanced: TEMPLATE_BALANCED,
    aggressive: TEMPLATE_AGGRESSIVE
  };

  return {
    template: templateMap[topStyle],
    confidence: totalMatched > 0 ? topScore / Math.max(totalMatched, 1) : 0.5,
    matched_keywords: matched[topStyle]
  };
}

// =====================================================================
// 路由处理函数
// =====================================================================

/**
 * POST /api/strategy/rules/ai-suggest
 * 根据用户策略描述，AI生成规则草稿
 * 当前使用模板匹配实现，无需调用LLM
 */
router.post('/rules/ai-suggest', (req, res) => {
  const { description, strategy_id } = req.body;

  if (!description || typeof description !== 'string' || description.trim().length === 0) {
    return res.status(400).json({ success: false, error: '请提供策略描述文字' });
  }

  const { template, confidence, matched_keywords } = matchTemplate(description.trim());

  // 返回完整规则草稿（前端可在此基础上调整）
  return res.json({
    success: true,
    data: {
      template_name: template.name,
      template_label: template.label,
      template_description: template.description,
      confidence,
      matched_keywords,
      // 规则草稿（完整字段，可直接用于表单填充）
      draft: {
        dimension_weights: template.dimension_weights,
        technical_rules: template.technical_rules,
        capital_allocation: template.capital_allocation,
        reduce_rules: template.reduce_rules,
        take_profit_rules: template.take_profit_rules,
        stop_loss_rules: template.stop_loss_rules,
        trigger_rules: template.trigger_rules,
        grade_s_threshold: template.grade_s_threshold,
        grade_a_threshold: template.grade_a_threshold,
        grade_b_threshold: template.grade_b_threshold,
        grade_c_threshold: template.grade_c_threshold,
        ai_template: template.name
      },
      // 全部可选模板（供用户切换）
      all_templates: TEMPLATES.map(t => ({
        name: t.name,
        label: t.label,
        description: t.description
      }))
    }
  });
});

/**
 * POST /api/strategy/rules/validate
 * 合规性预检查（不保存，仅返回校验结果）
 */
router.post('/rules/validate', (req, res) => {
  const rules = req.body;

  if (!rules || typeof rules !== 'object') {
    return res.status(400).json({ success: false, error: '请提供规则对象' });
  }

  const result = validateStrategyRules(rules);
  const quick = quickCheck(rules);

  return res.json({
    success: true,
    data: {
      valid: result.valid,
      errors: result.errors,
      warnings: result.warnings,
      completeness: quick.completeness,
      missing_fields: quick.missing
    }
  });
});

/**
 * POST /api/strategy/rules
 * 创建策略规则（新建或为已有策略新增版本）
 * Body: { strategy_id, dimension_weights, technical_rules, ..., push_channels }
 */
router.post('/rules', async (req, res) => {
  const db = req.app.get('db') || req.app.locals.dbInstance;
  if (!db) return res.status(500).json({ success: false, error: '数据库未初始化' });

  const {
    strategy_id,
    dimension_weights, technical_rules,
    fundamental_rules, sentiment_rules, capital_rules, chip_rules,
    grade_s_threshold = 90, grade_a_threshold = 75,
    grade_b_threshold = 60, grade_c_threshold = 45,
    capital_allocation, reduce_rules, take_profit_rules,
    stop_loss_rules, trigger_rules, push_channels, ai_template
  } = req.body;

  // 基本参数校验
  if (!strategy_id) return res.status(400).json({ success: false, error: 'strategy_id 为必填项' });
  if (!dimension_weights) return res.status(400).json({ success: false, error: 'dimension_weights 为必填项' });
  if (!technical_rules) return res.status(400).json({ success: false, error: 'technical_rules 为必填项' });
  if (!capital_allocation) return res.status(400).json({ success: false, error: 'capital_allocation 为必填项' });
  if (!stop_loss_rules) return res.status(400).json({ success: false, error: 'stop_loss_rules 为必填项' });
  if (!take_profit_rules) return res.status(400).json({ success: false, error: 'take_profit_rules 为必填项' });
  if (!reduce_rules) return res.status(400).json({ success: false, error: 'reduce_rules 为必填项' });
  if (!trigger_rules) return res.status(400).json({ success: false, error: 'trigger_rules 为必填项' });

  // 合规性校验
  const validation = validateStrategyRules(req.body);
  if (!validation.valid) {
    return res.status(422).json({
      success: false,
      error: '策略规则不符合合规要求',
      errors: validation.errors,
      warnings: validation.warnings
    });
  }

  try {
    // 查询当前最大版本号
    const maxVersionRow = await new Promise((resolve, reject) => {
      db.get(
        'SELECT MAX(version) as max_version FROM strategy_rules WHERE strategy_id = ?',
        [strategy_id],
        (err, row) => err ? reject(err) : resolve(row)
      );
    });
    const newVersion = (maxVersionRow?.max_version || 0) + 1;

    // 将旧版本标记为非激活
    await new Promise((resolve, reject) => {
      db.run(
        'UPDATE strategy_rules SET is_active = 0 WHERE strategy_id = ?',
        [strategy_id],
        err => err ? reject(err) : resolve()
      );
    });

    // 序列化 JSON 字段
    const toJson = v => typeof v === 'string' ? v : JSON.stringify(v);

    const id = uuidv4();
    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO strategy_rules (
          id, strategy_id, version, is_active,
          dimension_weights, technical_rules, fundamental_rules,
          sentiment_rules, capital_rules, chip_rules,
          grade_s_threshold, grade_a_threshold, grade_b_threshold, grade_c_threshold,
          capital_allocation, reduce_rules, take_profit_rules,
          stop_loss_rules, trigger_rules, push_channels, ai_template
        ) VALUES (?,?,?,1, ?,?,?, ?,?,?, ?,?,?,?, ?,?,?, ?,?,?,?)`,
        [
          id, strategy_id, newVersion,
          toJson(dimension_weights), toJson(technical_rules), toJson(fundamental_rules || null),
          toJson(sentiment_rules || null), toJson(capital_rules || null), toJson(chip_rules || null),
          grade_s_threshold, grade_a_threshold, grade_b_threshold, grade_c_threshold,
          toJson(capital_allocation), toJson(reduce_rules), toJson(take_profit_rules),
          toJson(stop_loss_rules), toJson(trigger_rules), toJson(push_channels || null), ai_template || null
        ],
        err => err ? reject(err) : resolve()
      );
    });

    return res.json({
      success: true,
      data: { id, strategy_id, version: newVersion, is_active: 1 },
      warnings: validation.warnings
    });

  } catch (err) {
    console.error('[strategy-rules] 创建规则失败:', err);
    return res.status(500).json({ success: false, error: '创建规则失败: ' + err.message });
  }
});

/**
 * GET /api/strategy/:id/rules
 * 获取策略当前生效版本的规则
 */
router.get('/:id/rules', async (req, res) => {
  const db = req.app.get('db') || req.app.locals.dbInstance;
  if (!db) return res.status(500).json({ success: false, error: '数据库未初始化' });

  const { id } = req.params;

  try {
    const rule = await new Promise((resolve, reject) => {
      db.get(
        'SELECT * FROM strategy_rules WHERE strategy_id = ? AND is_active = 1 ORDER BY version DESC LIMIT 1',
        [id],
        (err, row) => err ? reject(err) : resolve(row)
      );
    });

    if (!rule) {
      return res.status(404).json({ success: false, error: '该策略尚未配置规则' });
    }

    // 解析 JSON 字段
    const jsonFields = [
      'dimension_weights', 'technical_rules', 'fundamental_rules',
      'sentiment_rules', 'capital_rules', 'chip_rules',
      'capital_allocation', 'reduce_rules', 'take_profit_rules',
      'stop_loss_rules', 'trigger_rules', 'push_channels'
    ];
    jsonFields.forEach(f => {
      if (rule[f] && typeof rule[f] === 'string') {
        try { rule[f] = JSON.parse(rule[f]); } catch { /* 保留原字符串 */ }
      }
    });

    return res.json({ success: true, data: rule });

  } catch (err) {
    console.error('[strategy-rules] 查询规则失败:', err);
    return res.status(500).json({ success: false, error: '查询失败: ' + err.message });
  }
});

/**
 * GET /api/strategy/:id/rules/history
 * 获取策略所有历史版本的规则列表
 */
router.get('/:id/rules/history', async (req, res) => {
  const db = req.app.get('db') || req.app.locals.dbInstance;
  if (!db) return res.status(500).json({ success: false, error: '数据库未初始化' });

  const { id } = req.params;

  try {
    const rows = await new Promise((resolve, reject) => {
      db.all(
        'SELECT id, strategy_id, version, is_active, ai_template, created_at FROM strategy_rules WHERE strategy_id = ? ORDER BY version DESC',
        [id],
        (err, rows) => err ? reject(err) : resolve(rows)
      );
    });

    return res.json({ success: true, data: rows, total: rows.length });

  } catch (err) {
    return res.status(500).json({ success: false, error: '查询历史版本失败: ' + err.message });
  }
});

/**
 * POST /api/strategy/:id/start-sim
 * 用当前规则启动30天模拟盘
 * Body: { initial_capital: 100000|500000|2000000, user_id }
 */
router.post('/:id/start-sim', async (req, res) => {
  const db = req.app.get('db') || req.app.locals.dbInstance;
  if (!db) return res.status(500).json({ success: false, error: '数据库未初始化' });

  const { id: strategy_id } = req.params;
  const { initial_capital = 100000, user_id = 'default-user' } = req.body;

  // 验证资金档位（10万/50万/200万）
  const validCapitals = [100000, 500000, 2000000];
  if (!validCapitals.includes(Number(initial_capital))) {
    return res.status(400).json({
      success: false,
      error: `initial_capital 必须为以下之一：${validCapitals.join('/')}（10万/50万/200万）`
    });
  }

  try {
    // 检查策略是否有生效规则
    const rule = await new Promise((resolve, reject) => {
      db.get(
        'SELECT id, version FROM strategy_rules WHERE strategy_id = ? AND is_active = 1',
        [strategy_id],
        (err, row) => err ? reject(err) : resolve(row)
      );
    });

    if (!rule) {
      return res.status(422).json({ success: false, error: '策略尚未配置生效规则，请先完成规则配置' });
    }

    // 创建模拟盘会话（使用 sim_trading_sessions 表）
    const sessionId = uuidv4();
    const startDate = new Date().toISOString().split('T')[0];
    const endDate = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().split('T')[0];

    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO sim_trading_sessions (
          id, strategy_id, user_id, session_type, status,
          initial_capital, current_cash, start_date, end_date,
          rule_version
        ) VALUES (?,?,?,?,?, ?,?,?,?, ?)`,
        [
          sessionId, strategy_id, user_id, 'strategy_sim', 'running',
          initial_capital, initial_capital, startDate, endDate,
          rule.version
        ],
        err => err ? reject(err) : resolve()
      );
    });

    return res.json({
      success: true,
      data: {
        session_id: sessionId,
        strategy_id,
        rule_version: rule.version,
        initial_capital,
        start_date: startDate,
        end_date: endDate,
        status: 'running',
        message: `30天模拟盘已启动，初始资金 ${(initial_capital / 10000).toFixed(0)}万元`
      }
    });

  } catch (err) {
    console.error('[strategy-rules] 启动模拟盘失败:', err);
    return res.status(500).json({ success: false, error: '启动模拟盘失败: ' + err.message });
  }
});

/**
 * GET /api/strategy/:id/score/:stockCode
 * 对指定股票按策略当前规则打分（调试用）
 * 返回各维度评分明细和综合评级
 */
router.get('/:id/score/:stockCode', async (req, res) => {
  const db = req.app.get('db') || req.app.locals.dbInstance;
  if (!db) return res.status(500).json({ success: false, error: '数据库未初始化' });

  const { id: strategy_id, stockCode } = req.params;

  try {
    // 获取当前生效规则
    const rule = await new Promise((resolve, reject) => {
      db.get(
        'SELECT * FROM strategy_rules WHERE strategy_id = ? AND is_active = 1',
        [strategy_id],
        (err, row) => err ? reject(err) : resolve(row)
      );
    });

    if (!rule) {
      return res.status(404).json({ success: false, error: '策略规则未找到' });
    }

    // 调用评分引擎
    const scoreResult = await scoreStock(stockCode, rule);

    return res.json({
      success: true,
      data: {
        stock_code: stockCode,
        strategy_id,
        rule_version: rule.version,
        ...scoreResult,
        note: scoreResult.is_mock ? '当前使用模拟数据（AkShare数据源未连接）' : '实时数据'
      }
    });

  } catch (err) {
    console.error('[strategy-rules] 打分失败:', err);
    return res.status(500).json({ success: false, error: '打分失败: ' + err.message });
  }
});

module.exports = router;
