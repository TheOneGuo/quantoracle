/**
 * @file StrategyRuleWizard.jsx
 * @description 策略规则创建向导（5步流程）
 *   Step 1: 基本信息（名称/简介/风格描述+AI建议）
 *   Step 2: 选股规则（维度权重+各维度指标配置）
 *   Step 3: 资金管理（各级开仓/增仓比例）
 *   Step 4: 进出场规则（减仓/止盈/止损）
 *   Step 5: 推送渠道（Telegram/企微/飞书）
 *
 *   底部实时合规检查面板，全绿才能提交
 *   提交后选择初始资金档位，跳转模拟盘控制台
 */

import React, { useState, useEffect, useCallback } from 'react';

// ===================== 常量与默认值 =====================

const GRADE_LABELS = { S: 'S级', A: 'A级', B: 'B级', C: 'C级' };

/** 默认均衡型规则模板 */
const DEFAULT_RULES = {
  strategy_name: '',
  strategy_desc: '',
  style_description: '',
  dimension_weights: { technical: 40, fundamental: 30, sentiment: 10, capital: 10, chip: 10 },
  technical_rules: {
    ma: { enabled: true, periods: [5, 10, 20, 60] },
    macd: { enabled: true },
    rsi: { enabled: true, overbought: 75, oversold: 25 },
    kdj: { enabled: true },
    volume: { enabled: true }
  },
  fundamental_rules: {},
  sentiment_rules: {},
  capital_rules: {},
  chip_rules: {},
  grade_s_threshold: 90,
  grade_a_threshold: 75,
  grade_b_threshold: 60,
  grade_c_threshold: 45,
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
  stop_loss_rules: {
    fixed_pct: 8, sell_pct: 100, tech_stop: 'MA60', time_stop_days: 45, drawdown_stop_pct: 50
  },
  trigger_rules: [
    { condition: 'ma5_cross_ma20_up', signal: 'add' },
    { condition: 'macd_golden_cross', signal: 'buy' },
    { condition: 'macd_death_cross', signal: 'reduce' }
  ],
  push_channels: []
};

// ===================== 子组件：合规检查面板 =====================

/**
 * 底部实时合规检查面板
 * 显示各项规则的完成状态（✅/❌/⚠️）
 */
function CompliancePanel({ rules, validationResult }) {
  const checks = [
    { key: 'dimension_weights', label: '选股维度权重', required: true },
    { key: 'technical_rules', label: '技术面指标', required: true },
    { key: 'capital_allocation', label: '资金管理规则', required: true },
    { key: 'stop_loss_rules', label: '止损规则（必填）', required: true },
    { key: 'take_profit_rules', label: '止盈规则', required: true },
    { key: 'reduce_rules', label: '减仓规则', required: false },
    { key: 'trigger_rules', label: '触发规则', required: false },
    { key: 'push_channels', label: '推送渠道', required: true }
  ];

  return (
    <div style={styles.compliancePanel}>
      <div style={styles.complianceTitle}>📋 合规检查</div>
      <div style={styles.complianceGrid}>
        {checks.map(({ key, label, required }) => {
          const val = rules[key];
          const isEmpty = !val || (Array.isArray(val) && val.length === 0) ||
            (typeof val === 'object' && !Array.isArray(val) && Object.keys(val).length === 0);
          const icon = isEmpty ? (required ? '❌' : '⚠️') : '✅';
          return (
            <div key={key} style={styles.complianceItem}>
              <span>{icon}</span>
              <span style={{ color: isEmpty && required ? '#ff4d4f' : isEmpty ? '#faad14' : '#52c41a' }}>
                {label}
              </span>
            </div>
          );
        })}
      </div>
      {validationResult && validationResult.errors && validationResult.errors.length > 0 && (
        <div style={styles.errorList}>
          {validationResult.errors.slice(0, 3).map((e, i) => (
            <div key={i} style={{ color: '#ff4d4f', fontSize: 12 }}>❌ {e}</div>
          ))}
          {validationResult.errors.length > 3 && (
            <div style={{ color: '#999', fontSize: 12 }}>还有 {validationResult.errors.length - 3} 个错误...</div>
          )}
        </div>
      )}
    </div>
  );
}

// ===================== Step 1: 基本信息 =====================

function Step1Basic({ rules, onChange, onAiSuggest, aiLoading }) {
  const totalDesc = rules.strategy_desc ? rules.strategy_desc.length : 0;

  return (
    <div style={styles.stepContent}>
      <h3 style={styles.stepTitle}>📝 Step 1：基本信息</h3>

      {/* 策略名称 */}
      <div style={styles.formGroup}>
        <label style={styles.label}>策略名称 <span style={styles.required}>*</span></label>
        <input
          style={styles.input}
          placeholder="如：趋势跟随均衡策略"
          value={rules.strategy_name || ''}
          onChange={e => onChange('strategy_name', e.target.value)}
          maxLength={50}
        />
      </div>

      {/* 策略简介 */}
      <div style={styles.formGroup}>
        <label style={styles.label}>
          策略简介 <span style={styles.hint}>（{totalDesc}/200字）</span>
        </label>
        <textarea
          style={{ ...styles.input, height: 80, resize: 'vertical' }}
          placeholder="简要描述策略的核心逻辑、适用市场环境和目标用户..."
          value={rules.strategy_desc || ''}
          onChange={e => onChange('strategy_desc', e.target.value)}
          maxLength={200}
        />
      </div>

      {/* 适用市场 */}
      <div style={styles.formGroup}>
        <label style={styles.label}>适用市场</label>
        <div style={styles.radioGroup}>
          {['A股', '港股（暂不支持）', '美股（暂不支持）'].map(m => (
            <label key={m} style={{ ...styles.radioLabel, opacity: m !== 'A股' ? 0.4 : 1 }}>
              <input type="radio" value={m} checked={m === 'A股'} readOnly disabled={m !== 'A股'} />
              {' '}{m}
            </label>
          ))}
        </div>
      </div>

      {/* 风格描述 + AI建议 */}
      <div style={styles.formGroup}>
        <label style={styles.label}>策略风格描述（触发AI建议）</label>
        <div style={styles.aiInputRow}>
          <input
            style={{ ...styles.input, flex: 1 }}
            placeholder="如：趋势跟随，中等风险，持仓1-3个月..."
            value={rules.style_description || ''}
            onChange={e => onChange('style_description', e.target.value)}
          />
          <button
            style={{ ...styles.btn, ...styles.btnPrimary, marginLeft: 8, whiteSpace: 'nowrap' }}
            onClick={() => onAiSuggest(rules.style_description)}
            disabled={aiLoading || !rules.style_description}
          >
            {aiLoading ? '⏳ 生成中...' : '🤖 AI建议'}
          </button>
        </div>
        <div style={styles.hint}>AI将根据描述自动填充选股规则、资金管理等参数，你可以在此基础上调整</div>
      </div>
    </div>
  );
}

// ===================== Step 2: 选股规则 =====================

function Step2StockRules({ rules, onChange }) {
  const weights = rules.dimension_weights || {};
  const totalWeight = Object.values(weights).reduce((s, v) => s + (Number(v) || 0), 0);
  const isWeightValid = Math.abs(totalWeight - 100) <= 0.1;
  const techRules = rules.technical_rules || {};

  const dimensions = [
    { key: 'technical', label: '技术面', required: true },
    { key: 'fundamental', label: '基本面', required: false },
    { key: 'sentiment', label: '舆情面', required: false },
    { key: 'capital', label: '资金面', required: false },
    { key: 'chip', label: '筹码面', required: false }
  ];

  const indicators = [
    { key: 'ma', label: '均线（MA）' },
    { key: 'macd', label: 'MACD' },
    { key: 'rsi', label: 'RSI' },
    { key: 'kdj', label: 'KDJ' },
    { key: 'volume', label: '成交量' }
  ];

  const handleWeightChange = (dim, val) => {
    onChange('dimension_weights', { ...weights, [dim]: Number(val) || 0 });
  };

  const handleIndicatorToggle = (key, enabled) => {
    onChange('technical_rules', {
      ...techRules,
      [key]: { ...(techRules[key] || {}), enabled }
    });
  };

  return (
    <div style={styles.stepContent}>
      <h3 style={styles.stepTitle}>📊 Step 2：选股规则</h3>

      {/* 维度权重配置 */}
      <div style={styles.formGroup}>
        <label style={styles.label}>
          维度权重配置{' '}
          <span style={{ color: isWeightValid ? '#52c41a' : '#ff4d4f', fontWeight: 600 }}>
            合计：{totalWeight}% {isWeightValid ? '✅' : '❌（必须=100%）'}
          </span>
        </label>
        {dimensions.map(({ key, label, required }) => (
          <div key={key} style={styles.weightRow}>
            <span style={{ width: 80, color: required ? '#1890ff' : '#333' }}>
              {label}{required ? ' *' : ''}
            </span>
            <input
              type="range" min={0} max={100} step={5}
              value={weights[key] || 0}
              onChange={e => handleWeightChange(key, e.target.value)}
              style={{ flex: 1, margin: '0 12px' }}
            />
            <span style={{ width: 48, textAlign: 'right', fontWeight: 600 }}>{weights[key] || 0}%</span>
          </div>
        ))}
      </div>

      {/* 技术面指标配置 */}
      {(weights.technical || 0) > 0 && (
        <div style={styles.formGroup}>
          <label style={styles.label}>技术面指标（至少启用2项）</label>
          <div style={styles.indicatorGrid}>
            {indicators.map(({ key, label }) => {
              const enabled = techRules[key]?.enabled !== false;
              return (
                <label key={key} style={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={e => handleIndicatorToggle(key, e.target.checked)}
                  />
                  {' '}{label}
                </label>
              );
            })}
          </div>
          <div style={styles.hint}>
            已启用：{indicators.filter(i => techRules[i.key]?.enabled !== false).length} 项
          </div>
        </div>
      )}

      {/* 基本面配置提示 */}
      {(weights.fundamental || 0) > 0 && (
        <div style={{ ...styles.formGroup, background: '#f6ffed', padding: 12, borderRadius: 8 }}>
          <label style={styles.label}>基本面规则（已启用 {weights.fundamental}% 权重）</label>
          <div style={styles.hint}>
            基本面评分将使用：PE相对行业(25%) + ROE(25%) + 营收增速(20%) + 净利增速(20%) + 财务健康(10%)
          </div>
        </div>
      )}
    </div>
  );
}

// ===================== Step 3: 资金管理 =====================

function Step3Capital({ rules, onChange }) {
  const ca = rules.capital_allocation || DEFAULT_RULES.capital_allocation;

  const handleChange = (key, val) => {
    onChange('capital_allocation', { ...ca, [key]: Number(val) || 0 });
  };

  const grades = ['s', 'a', 'b', 'c'];

  return (
    <div style={styles.stepContent}>
      <h3 style={styles.stepTitle}>💰 Step 3：资金管理</h3>

      {/* 仓位配置表格 */}
      <div style={styles.formGroup}>
        <label style={styles.label}>各级别开仓/增仓比例（占可用资金）</label>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>评级</th>
              <th style={styles.th}>开仓比例%</th>
              <th style={styles.th}>增仓比例%</th>
            </tr>
          </thead>
          <tbody>
            {grades.map(g => (
              <tr key={g}>
                <td style={styles.td}>{g.toUpperCase()}级{g === 'c' && ' (谨慎)'}</td>
                <td style={styles.td}>
                  <input
                    type="number" min={0} max={30} step={1}
                    style={{ ...styles.input, width: 80, textAlign: 'center' }}
                    value={ca[`${g}_open`] || 0}
                    onChange={e => handleChange(`${g}_open`, e.target.value)}
                    disabled={g === 'd'}
                  />
                </td>
                <td style={styles.td}>
                  <input
                    type="number" min={0} max={25} step={1}
                    style={{ ...styles.input, width: 80, textAlign: 'center' }}
                    value={ca[`${g}_add`] || 0}
                    onChange={e => handleChange(`${g}_add`, e.target.value)}
                    disabled={g === 'c' || g === 'd'}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={styles.hint}>D级评分不允许开仓/增仓</div>
      </div>

      {/* 总体限制 */}
      <div style={styles.formGroup}>
        <label style={styles.label}>风控上限</label>
        <div style={styles.inlineGroup}>
          <div style={styles.inlineItem}>
            <span>单股上限%</span>
            <input
              type="number" min={5} max={50} step={5}
              style={{ ...styles.input, width: 80 }}
              value={ca.max_single_pct || 20}
              onChange={e => handleChange('max_single_pct', e.target.value)}
            />
          </div>
          <div style={styles.inlineItem}>
            <span>总仓位上限%</span>
            <input
              type="number" min={20} max={100} step={10}
              style={{ ...styles.input, width: 80 }}
              value={ca.max_total_pct || 80}
              onChange={e => handleChange('max_total_pct', e.target.value)}
            />
          </div>
          <div style={styles.inlineItem}>
            <span>最大增仓次数</span>
            <input
              type="number" min={1} max={5} step={1}
              style={{ ...styles.input, width: 60 }}
              value={ca.max_add_times || 2}
              onChange={e => handleChange('max_add_times', e.target.value)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ===================== Step 4: 进出场规则 =====================

function Step4Exit({ rules, onChange }) {
  const stopLoss = rules.stop_loss_rules || DEFAULT_RULES.stop_loss_rules;
  const takeProfit = rules.take_profit_rules || DEFAULT_RULES.take_profit_rules;

  const handleStopLossChange = (key, val) => {
    onChange('stop_loss_rules', { ...stopLoss, [key]: val });
  };

  const handleTakeProfitChange = (idx, key, val) => {
    const updated = takeProfit.map((r, i) => i === idx ? { ...r, [key]: val } : r);
    onChange('take_profit_rules', updated);
  };

  const addTakeProfitRule = () => {
    onChange('take_profit_rules', [
      ...takeProfit,
      { type: 'fixed', trigger_pct: 30, sell_pct: 30 }
    ]);
  };

  const removeTakeProfitRule = (idx) => {
    onChange('take_profit_rules', takeProfit.filter((_, i) => i !== idx));
  };

  return (
    <div style={styles.stepContent}>
      <h3 style={styles.stepTitle}>🎯 Step 4：进出场规则</h3>

      {/* 止损规则（必填） */}
      <div style={{ ...styles.formGroup, border: '1px solid #ff7875', borderRadius: 8, padding: 12 }}>
        <label style={{ ...styles.label, color: '#ff4d4f' }}>止损规则（必填）</label>
        <div style={styles.inlineGroup}>
          <div style={styles.inlineItem}>
            <span>固定止损%</span>
            <input
              type="number" min={5} max={15} step={0.5}
              style={{ ...styles.input, width: 80, borderColor: '#ff7875' }}
              value={stopLoss.fixed_pct || 8}
              onChange={e => handleStopLossChange('fixed_pct', Number(e.target.value))}
            />
            <span style={styles.hint}>（5-15%之间）</span>
          </div>
          <div style={styles.inlineItem}>
            <span>止损后卖出%</span>
            <input
              type="number" min={50} max={100} step={10}
              style={{ ...styles.input, width: 80 }}
              value={stopLoss.sell_pct || 100}
              onChange={e => handleStopLossChange('sell_pct', Number(e.target.value))}
            />
          </div>
        </div>
        <div style={styles.inlineGroup}>
          <div style={styles.inlineItem}>
            <span>技术止损线</span>
            <select
              style={styles.select}
              value={stopLoss.tech_stop || 'MA60'}
              onChange={e => handleStopLossChange('tech_stop', e.target.value)}
            >
              {['MA20', 'MA30', 'MA60', 'MA120', 'MA250'].map(v => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </div>
          <div style={styles.inlineItem}>
            <span>时间止损（天）</span>
            <input
              type="number" min={10} max={180} step={5}
              style={{ ...styles.input, width: 80 }}
              value={stopLoss.time_stop_days || 45}
              onChange={e => handleStopLossChange('time_stop_days', Number(e.target.value))}
            />
          </div>
        </div>
      </div>

      {/* 止盈规则 */}
      <div style={styles.formGroup}>
        <label style={styles.label}>止盈规则（至少1条）</label>
        {takeProfit.map((rule, idx) => (
          <div key={idx} style={styles.ruleRow}>
            <select
              style={styles.select}
              value={rule.type}
              onChange={e => handleTakeProfitChange(idx, 'type', e.target.value)}
            >
              <option value="fixed">固定止盈</option>
              <option value="trailing">追踪止盈</option>
            </select>

            {rule.type === 'fixed' ? (
              <>
                <span>盈利达</span>
                <input
                  type="number" min={5} max={200} step={5}
                  style={{ ...styles.input, width: 70 }}
                  value={rule.trigger_pct || 15}
                  onChange={e => handleTakeProfitChange(idx, 'trigger_pct', Number(e.target.value))}
                />
                <span>%时</span>
              </>
            ) : (
              <>
                <span>从高点回落</span>
                <input
                  type="number" min={5} max={30} step={1}
                  style={{ ...styles.input, width: 70 }}
                  value={rule.drawdown_pct || 10}
                  onChange={e => handleTakeProfitChange(idx, 'drawdown_pct', Number(e.target.value))}
                />
                <span>%时</span>
              </>
            )}
            <span>卖出</span>
            <input
              type="number" min={10} max={100} step={10}
              style={{ ...styles.input, width: 70 }}
              value={rule.sell_pct || 30}
              onChange={e => handleTakeProfitChange(idx, 'sell_pct', Number(e.target.value))}
            />
            <span>%持仓</span>
            {takeProfit.length > 1 && (
              <button style={{ ...styles.btn, color: '#ff4d4f', border: 'none', background: 'none' }}
                onClick={() => removeTakeProfitRule(idx)}>✕</button>
            )}
          </div>
        ))}
        <button style={{ ...styles.btn, marginTop: 8 }} onClick={addTakeProfitRule}>
          + 添加止盈档位
        </button>
      </div>
    </div>
  );
}

// ===================== Step 5: 推送渠道 =====================

function Step5Push({ rules, onChange }) {
  const channels = rules.push_channels || [];
  const [testStatus, setTestStatus] = useState({});

  const addChannel = (type) => {
    onChange('push_channels', [...channels, { type, webhook: '', enabled: true }]);
  };

  const updateChannel = (idx, key, val) => {
    onChange('push_channels', channels.map((c, i) => i === idx ? { ...c, [key]: val } : c));
  };

  const removeChannel = (idx) => {
    onChange('push_channels', channels.filter((_, i) => i !== idx));
  };

  const testChannel = async (idx) => {
    const ch = channels[idx];
    setTestStatus(s => ({ ...s, [idx]: 'testing' }));
    // 模拟测试（实际应调用后端接口）
    setTimeout(() => {
      setTestStatus(s => ({ ...s, [idx]: ch.webhook ? 'ok' : 'fail' }));
    }, 1200);
  };

  const channelTypes = [
    { type: 'telegram', label: '📨 Telegram Bot' },
    { type: 'wecom', label: '💼 企业微信' },
    { type: 'feishu', label: '🪄 飞书' }
  ];

  return (
    <div style={styles.stepContent}>
      <h3 style={styles.stepTitle}>📡 Step 5：推送渠道</h3>
      <div style={styles.hint}>至少配置1个推送渠道，信号将实时推送到你指定的频道</div>

      {/* 已配置渠道列表 */}
      {channels.map((ch, idx) => (
        <div key={idx} style={styles.channelRow}>
          <span style={{ fontWeight: 600, width: 100 }}>
            {channelTypes.find(t => t.type === ch.type)?.label || ch.type}
          </span>
          <input
            style={{ ...styles.input, flex: 1 }}
            placeholder={ch.type === 'telegram' ? 'Bot Webhook URL（https://api.telegram.org/bot...）' : 'Webhook URL'}
            value={ch.webhook || ''}
            onChange={e => updateChannel(idx, 'webhook', e.target.value)}
          />
          <button
            style={{ ...styles.btn, marginLeft: 8 }}
            onClick={() => testChannel(idx)}
            disabled={testStatus[idx] === 'testing'}
          >
            {testStatus[idx] === 'testing' ? '⏳' : testStatus[idx] === 'ok' ? '✅' : testStatus[idx] === 'fail' ? '❌' : '测试'}
          </button>
          <button
            style={{ ...styles.btn, color: '#ff4d4f', border: 'none', background: 'none' }}
            onClick={() => removeChannel(idx)}
          >✕</button>
        </div>
      ))}

      {/* 添加渠道按钮 */}
      <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
        {channelTypes.map(({ type, label }) => (
          <button key={type} style={styles.btn} onClick={() => addChannel(type)}>
            + {label}
          </button>
        ))}
      </div>

      {channels.length === 0 && (
        <div style={{ color: '#ff4d4f', marginTop: 8 }}>⚠️ 请至少添加1个推送渠道</div>
      )}
    </div>
  );
}

// ===================== 主组件：5步向导 =====================

/**
 * StrategyRuleWizard - 策略规则创建向导
 * @param {Object} props
 * @param {string} props.strategyId - 策略ID（已有策略时传入，否则新建）
 * @param {Function} props.onComplete - 完成后的回调 fn(sessionId)
 * @param {Function} props.onCancel - 取消回调
 */
export default function StrategyRuleWizard({ strategyId, onComplete, onCancel }) {
  const [currentStep, setCurrentStep] = useState(1);
  const [rules, setRules] = useState({ ...DEFAULT_RULES, strategy_id: strategyId });
  const [aiLoading, setAiLoading] = useState(false);
  const [validationResult, setValidationResult] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [showCapitalModal, setShowCapitalModal] = useState(false);
  const [aiSuggestResult, setAiSuggestResult] = useState(null);

  const TOTAL_STEPS = 5;

  // 更新规则字段
  const handleChange = useCallback((key, value) => {
    setRules(prev => ({ ...prev, [key]: value }));
  }, []);

  // 实时合规校验（每次 rules 变化时触发）
  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        const resp = await fetch('/api/strategy/rules/validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(rules)
        });
        const data = await resp.json();
        if (data.success) setValidationResult(data.data);
      } catch {
        // 忽略网络错误，不影响向导使用
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [rules]);

  // AI 建议接口
  const handleAiSuggest = async (description) => {
    if (!description) return;
    setAiLoading(true);
    try {
      const resp = await fetch('/api/strategy/rules/ai-suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description, strategy_id: strategyId })
      });
      const data = await resp.json();
      if (data.success && data.data.draft) {
        const draft = data.data.draft;
        // 将 AI 建议的草稿合并到当前规则
        setRules(prev => ({ ...prev, ...draft }));
        setAiSuggestResult(data.data);
      }
    } catch (err) {
      console.error('AI建议接口失败:', err);
    } finally {
      setAiLoading(false);
    }
  };

  // 提交规则
  const handleSubmit = async (initialCapital) => {
    setSubmitting(true);
    try {
      // 1. 创建规则
      const ruleResp = await fetch('/api/strategy/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...rules, strategy_id: strategyId || rules.strategy_id })
      });
      const ruleData = await ruleResp.json();
      if (!ruleData.success) {
        alert('规则创建失败：' + (ruleData.error || JSON.stringify(ruleData.errors)));
        return;
      }

      // 2. 启动模拟盘
      const simResp = await fetch(`/api/strategy/${strategyId || ruleData.data.strategy_id}/start-sim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initial_capital: initialCapital, user_id: 'default-user' })
      });
      const simData = await simResp.json();
      if (!simData.success) {
        alert('启动模拟盘失败：' + simData.error);
        return;
      }

      setShowCapitalModal(false);
      onComplete && onComplete(simData.data.session_id);

    } catch (err) {
      alert('提交失败：' + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  // 是否可以进入下一步
  const canProceed = () => {
    if (currentStep === 1) return !!rules.strategy_name;
    if (currentStep === 5) return (rules.push_channels || []).length > 0;
    return true;
  };

  const stepComponents = [
    null, // 占位，步骤从1开始
    <Step1Basic key={1} rules={rules} onChange={handleChange}
      onAiSuggest={handleAiSuggest} aiLoading={aiLoading} />,
    <Step2StockRules key={2} rules={rules} onChange={handleChange} />,
    <Step3Capital key={3} rules={rules} onChange={handleChange} />,
    <Step4Exit key={4} rules={rules} onChange={handleChange} />,
    <Step5Push key={5} rules={rules} onChange={handleChange} />
  ];

  return (
    <div style={styles.wizard}>
      {/* 顶部步骤条 */}
      <div style={styles.stepBar}>
        {['基本信息', '选股规则', '资金管理', '进出场', '推送渠道'].map((label, idx) => {
          const step = idx + 1;
          const isActive = step === currentStep;
          const isDone = step < currentStep;
          return (
            <div key={step} style={styles.stepBarItem}>
              <div style={{
                ...styles.stepDot,
                background: isDone ? '#52c41a' : isActive ? '#1890ff' : '#d9d9d9'
              }}>
                {isDone ? '✓' : step}
              </div>
              <div style={{ fontSize: 12, color: isActive ? '#1890ff' : '#666' }}>{label}</div>
            </div>
          );
        })}
      </div>

      {/* AI建议提示 */}
      {aiSuggestResult && (
        <div style={styles.aiTip}>
          🤖 已应用 <strong>{aiSuggestResult.template_label}</strong> 模板
          {aiSuggestResult.matched_keywords.length > 0 && (
            <span>（匹配关键词：{aiSuggestResult.matched_keywords.join('、')}）</span>
          )}
          <button
            style={{ marginLeft: 8, border: 'none', background: 'none', cursor: 'pointer', color: '#999' }}
            onClick={() => setAiSuggestResult(null)}
          >✕</button>
        </div>
      )}

      {/* 步骤内容 */}
      <div style={styles.body}>
        {stepComponents[currentStep]}
      </div>

      {/* 底部合规检查面板 */}
      <CompliancePanel rules={rules} validationResult={validationResult} />

      {/* 底部按钮 */}
      <div style={styles.footer}>
        <button style={styles.btn} onClick={onCancel}>取消</button>
        <div style={{ flex: 1 }} />
        {currentStep > 1 && (
          <button style={styles.btn} onClick={() => setCurrentStep(s => s - 1)}>
            ← 上一步
          </button>
        )}
        {currentStep < TOTAL_STEPS ? (
          <button
            style={{ ...styles.btn, ...styles.btnPrimary, marginLeft: 8 }}
            onClick={() => setCurrentStep(s => s + 1)}
            disabled={!canProceed()}
          >
            下一步 →
          </button>
        ) : (
          <button
            style={{ ...styles.btn, ...styles.btnSuccess, marginLeft: 8 }}
            onClick={() => setShowCapitalModal(true)}
            disabled={!validationResult?.valid || submitting}
          >
            {validationResult?.valid ? '✅ 提交并启动模拟盘' : '❌ 请先修复错误'}
          </button>
        )}
      </div>

      {/* 初始资金选择弹窗 */}
      {showCapitalModal && (
        <div style={styles.modalOverlay}>
          <div style={styles.modal}>
            <h3>选择模拟盘初始资金</h3>
            <p style={styles.hint}>初始资金将用于模拟盘的仓位计算，不影响策略规则</p>
            {[
              { amount: 100000, label: '10万元（入门档）' },
              { amount: 500000, label: '50万元（标准档）' },
              { amount: 2000000, label: '200万元（高净值档）' }
            ].map(({ amount, label }) => (
              <button
                key={amount}
                style={{ ...styles.btn, ...styles.btnPrimary, display: 'block', width: '100%', marginBottom: 8 }}
                onClick={() => handleSubmit(amount)}
                disabled={submitting}
              >
                {label}
              </button>
            ))}
            <button style={styles.btn} onClick={() => setShowCapitalModal(false)}>取消</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ===================== 样式 =====================

const styles = {
  wizard: {
    maxWidth: 800, margin: '0 auto', fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
    background: '#fff', borderRadius: 12, boxShadow: '0 4px 24px rgba(0,0,0,0.1)', overflow: 'hidden'
  },
  stepBar: {
    display: 'flex', justifyContent: 'space-around', padding: '16px 24px',
    background: '#f0f5ff', borderBottom: '1px solid #d6e4ff'
  },
  stepBarItem: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 },
  stepDot: {
    width: 28, height: 28, borderRadius: '50%', display: 'flex',
    alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 600, fontSize: 13
  },
  aiTip: {
    background: '#e6f7ff', borderBottom: '1px solid #91d5ff', padding: '8px 24px', fontSize: 13, color: '#1890ff'
  },
  body: { padding: '20px 24px', minHeight: 360 },
  stepContent: {},
  stepTitle: { margin: '0 0 16px', fontSize: 16, fontWeight: 600, color: '#333' },
  formGroup: { marginBottom: 20 },
  label: { display: 'block', marginBottom: 6, fontWeight: 500, fontSize: 14, color: '#555' },
  hint: { fontSize: 12, color: '#999', marginTop: 4 },
  required: { color: '#ff4d4f' },
  input: {
    border: '1px solid #d9d9d9', borderRadius: 6, padding: '6px 10px', fontSize: 14,
    outline: 'none', width: '100%', boxSizing: 'border-box',
    transition: 'border-color 0.2s',
  },
  select: {
    border: '1px solid #d9d9d9', borderRadius: 6, padding: '6px 10px', fontSize: 14,
    background: '#fff', outline: 'none'
  },
  radioGroup: { display: 'flex', gap: 16 },
  radioLabel: { display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 14 },
  checkboxLabel: { display: 'inline-flex', alignItems: 'center', gap: 4, marginRight: 16, cursor: 'pointer', fontSize: 14 },
  aiInputRow: { display: 'flex', alignItems: 'center' },
  weightRow: { display: 'flex', alignItems: 'center', marginBottom: 8 },
  indicatorGrid: { display: 'flex', flexWrap: 'wrap', gap: 4 },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { background: '#f5f5f5', padding: '8px 12px', textAlign: 'center', border: '1px solid #e8e8e8', fontSize: 13 },
  td: { padding: '8px 12px', textAlign: 'center', border: '1px solid #e8e8e8' },
  inlineGroup: { display: 'flex', flexWrap: 'wrap', gap: 16 },
  inlineItem: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 },
  ruleRow: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' },
  channelRow: { display: 'flex', alignItems: 'center', marginBottom: 10, gap: 8 },
  btn: {
    padding: '7px 16px', border: '1px solid #d9d9d9', borderRadius: 6,
    cursor: 'pointer', background: '#fff', fontSize: 14, transition: 'all 0.2s'
  },
  btnPrimary: { background: '#1890ff', color: '#fff', border: '1px solid #1890ff' },
  btnSuccess: { background: '#52c41a', color: '#fff', border: '1px solid #52c41a' },
  compliancePanel: {
    background: '#fafafa', borderTop: '1px solid #f0f0f0',
    padding: '12px 24px'
  },
  complianceTitle: { fontWeight: 600, marginBottom: 8, fontSize: 13 },
  complianceGrid: { display: 'flex', flexWrap: 'wrap', gap: '6px 20px' },
  complianceItem: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 },
  errorList: { marginTop: 8, borderTop: '1px dashed #ffd8bf', paddingTop: 8 },
  footer: {
    display: 'flex', alignItems: 'center', padding: '12px 24px',
    borderTop: '1px solid #f0f0f0', background: '#fafafa'
  },
  modalOverlay: {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
  },
  modal: {
    background: '#fff', borderRadius: 12, padding: 32, minWidth: 320,
    boxShadow: '0 8px 32px rgba(0,0,0,0.2)'
  }
};
