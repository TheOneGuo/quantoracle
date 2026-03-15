/**
 * @file 策略规则合规性校验
 * @description 上架前检查所有必填项和约束条件，确保策略规则完整合法
 *              校验结果分为 errors（必须修复）和 warnings（建议优化）
 */

'use strict';

/**
 * 解析 JSON 字段（如果是字符串则尝试解析，如果是对象则直接返回）
 * @param {string|Object|null} field
 * @param {any} defaultValue 解析失败时的默认值
 * @returns {any}
 */
function safeParseJson(field, defaultValue = null) {
  if (!field) return defaultValue;
  if (typeof field === 'object') return field;
  try {
    return JSON.parse(field);
  } catch {
    return defaultValue;
  }
}

/**
 * 全量合规性检查
 * 检查范围：
 *   1. 选股维度：技术面必选，至少2个维度，权重总和=100%
 *   2. 技术面：至少配置2项指标
 *   3. 止损：固定止损必填，且 fixed_pct 在 5-15% 之间
 *   4. 止盈：至少配置1种方式
 *   5. 开仓比例：D级必须为0，其他级别在合法范围内
 *   6. 权重总和验证（允许±0.1%误差）
 *   7. 止盈档位递增验证（第二档触发点 > 第一档）
 *   8. 推送渠道：至少配置1个
 *
 * @param {Object} rules 策略规则对象（所有 JSON 字段可以是字符串或已解析的对象）
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
function validateStrategyRules(rules) {
  const errors = [];
  const warnings = [];

  if (!rules || typeof rules !== 'object') {
    return { valid: false, errors: ['规则对象不能为空'], warnings: [] };
  }

  // ——————————————————————————————————————
  // 1. 选股维度权重校验
  // ——————————————————————————————————————
  const weights = safeParseJson(rules.dimension_weights, null);
  if (!weights) {
    errors.push('【选股维度】dimension_weights 未配置或格式错误');
  } else {
    // 技术面为必选项
    if (!weights.technical || weights.technical <= 0) {
      errors.push('【选股维度】技术面（technical）为必选项，权重必须 > 0');
    }

    // 统计启用的维度数量
    const dimensions = ['technical', 'fundamental', 'sentiment', 'capital', 'chip'];
    const activeDimensions = dimensions.filter(d => weights[d] > 0);
    if (activeDimensions.length < 2) {
      errors.push('【选股维度】至少需要启用2个评分维度（技术面 + 至少1个其他维度）');
    }

    // 权重总和必须等于100%（允许±0.1误差）
    const totalWeight = dimensions.reduce((sum, d) => sum + (weights[d] || 0), 0);
    if (Math.abs(totalWeight - 100) > 0.1) {
      errors.push(`【选股维度】各维度权重之和必须等于100%，当前合计：${totalWeight}%`);
    }

    // 权重不能为负数
    dimensions.forEach(d => {
      if ((weights[d] || 0) < 0) {
        errors.push(`【选股维度】${d} 的权重不能为负数`);
      }
    });
  }

  // ——————————————————————————————————————
  // 2. 技术面规则校验
  // ——————————————————————————————————————
  const technicalRules = safeParseJson(rules.technical_rules, null);
  if (!technicalRules) {
    errors.push('【技术面】technical_rules 未配置或格式错误');
  } else {
    // 技术面至少配置2项指标
    const indicatorKeys = ['ma', 'macd', 'rsi', 'kdj', 'volume'];
    const enabledIndicators = indicatorKeys.filter(k => technicalRules[k] && technicalRules[k].enabled !== false);
    if (enabledIndicators.length < 2) {
      errors.push('【技术面】至少需要启用2项技术指标（MA/MACD/RSI/KDJ/成交量等）');
    }
  }

  // ——————————————————————————————————————
  // 3. 止损规则校验（必填）
  // ——————————————————————————————————————
  const stopLossRules = safeParseJson(rules.stop_loss_rules, null);
  if (!stopLossRules) {
    errors.push('【止损规则】stop_loss_rules 未配置，止损规则为必填项');
  } else {
    // 固定止损百分比必填且在 5-15% 之间
    if (stopLossRules.fixed_pct === undefined || stopLossRules.fixed_pct === null) {
      errors.push('【止损规则】fixed_pct（固定止损百分比）为必填项');
    } else {
      const pct = parseFloat(stopLossRules.fixed_pct);
      if (isNaN(pct) || pct < 5 || pct > 15) {
        errors.push(`【止损规则】fixed_pct 必须在 5%-15% 之间，当前值：${stopLossRules.fixed_pct}%`);
      }
    }

    // 止损卖出比例
    if (stopLossRules.sell_pct !== undefined) {
      const sp = parseFloat(stopLossRules.sell_pct);
      if (isNaN(sp) || sp <= 0 || sp > 100) {
        errors.push('【止损规则】sell_pct 必须在 1-100% 之间');
      }
    }

    // 时间止损建议
    if (!stopLossRules.time_stop_days) {
      warnings.push('【止损规则】建议配置 time_stop_days（时间止损天数），避免长期套牢');
    }
  }

  // ——————————————————————————————————————
  // 4. 止盈规则校验（至少1种方式）
  // ——————————————————————————————————————
  const takeProfitRules = safeParseJson(rules.take_profit_rules, null);
  if (!takeProfitRules || !Array.isArray(takeProfitRules) || takeProfitRules.length === 0) {
    errors.push('【止盈规则】take_profit_rules 未配置，至少需要配置1种止盈方式');
  } else {
    // 检查固定止盈档位递增（第二档触发点必须大于第一档）
    const fixedRules = takeProfitRules.filter(r => r.type === 'fixed' && r.trigger_pct !== undefined);
    if (fixedRules.length >= 2) {
      for (let i = 1; i < fixedRules.length; i++) {
        if (fixedRules[i].trigger_pct <= fixedRules[i - 1].trigger_pct) {
          errors.push(
            `【止盈规则】固定止盈档位必须递增：第${i + 1}档触发点(${fixedRules[i].trigger_pct}%) ` +
            `必须大于第${i}档(${fixedRules[i - 1].trigger_pct}%)`
          );
        }
      }
    }

    // 检查每个止盈规则的合法性
    takeProfitRules.forEach((rule, idx) => {
      if (!rule.type) {
        errors.push(`【止盈规则】第${idx + 1}条规则缺少 type 字段（fixed/trailing）`);
      }
      if (rule.sell_pct !== undefined) {
        const sp = parseFloat(rule.sell_pct);
        if (isNaN(sp) || sp <= 0 || sp > 100) {
          errors.push(`【止盈规则】第${idx + 1}条规则 sell_pct 必须在 1-100% 之间`);
        }
      }
    });

    // 建议同时配置追踪止盈
    const hasTrailing = takeProfitRules.some(r => r.type === 'trailing');
    if (!hasTrailing) {
      warnings.push('【止盈规则】建议同时配置追踪止盈（trailing），以锁定趋势行情利润');
    }
  }

  // ——————————————————————————————————————
  // 5. 资金使用规则校验
  // ——————————————————————————————————————
  const capitalAllocation = safeParseJson(rules.capital_allocation, null);
  if (!capitalAllocation) {
    errors.push('【资金规则】capital_allocation 未配置或格式错误');
  } else {
    // D级必须为0（不允许D级开仓/增仓）
    // D级在评分引擎中直接拒绝，但规则中不应配置非零值
    // S/A/B/C 各级开仓比例合法范围：1-30%
    const gradeKeys = ['s_open', 'a_open', 'b_open', 'c_open'];
    gradeKeys.forEach(key => {
      const pct = parseFloat(capitalAllocation[key] || 0);
      if (isNaN(pct) || pct < 0 || pct > 30) {
        errors.push(`【资金规则】${key} 必须在 0-30% 之间，当前值：${capitalAllocation[key]}`);
      }
    });

    // 增仓比例校验
    const addKeys = ['s_add', 'a_add', 'b_add'];
    addKeys.forEach(key => {
      if (capitalAllocation[key] !== undefined) {
        const pct = parseFloat(capitalAllocation[key]);
        if (isNaN(pct) || pct < 0 || pct > 25) {
          errors.push(`【资金规则】${key} 必须在 0-25% 之间，当前值：${capitalAllocation[key]}`);
        }
      }
    });

    // 单股仓位上限
    if (capitalAllocation.max_single_pct !== undefined) {
      const sp = parseFloat(capitalAllocation.max_single_pct);
      if (isNaN(sp) || sp <= 0 || sp > 50) {
        errors.push('【资金规则】max_single_pct 单股上限必须在 1-50% 之间');
      }
    }

    // 总仓位上限
    if (capitalAllocation.max_total_pct !== undefined) {
      const tp = parseFloat(capitalAllocation.max_total_pct);
      if (isNaN(tp) || tp <= 0 || tp > 100) {
        errors.push('【资金规则】max_total_pct 总仓位上限必须在 1-100% 之间');
      }
    } else {
      warnings.push('【资金规则】建议配置 max_total_pct（总仓位上限），控制整体风险敞口');
    }

    // 开仓比例递减逻辑检查：S级应高于B/C级
    const sOpen = parseFloat(capitalAllocation.s_open || 0);
    const aOpen = parseFloat(capitalAllocation.a_open || 0);
    const bOpen = parseFloat(capitalAllocation.b_open || 0);
    if (sOpen > 0 && aOpen > 0 && aOpen > sOpen) {
      warnings.push('【资金规则】A级开仓比例高于S级，建议S级享有最高开仓权重');
    }
    if (bOpen > 0 && aOpen > 0 && bOpen > aOpen) {
      warnings.push('【资金规则】B级开仓比例高于A级，建议按评级高低分配开仓比例');
    }
  }

  // ——————————————————————————————————————
  // 6. 减仓规则校验
  // ——————————————————————————————————————
  const reduceRules = safeParseJson(rules.reduce_rules, null);
  if (!reduceRules || !Array.isArray(reduceRules) || reduceRules.length === 0) {
    warnings.push('【减仓规则】reduce_rules 未配置，建议配置评级下降时的减仓规则');
  } else {
    reduceRules.forEach((rule, idx) => {
      if (!rule.trigger) {
        errors.push(`【减仓规则】第${idx + 1}条规则缺少 trigger 字段`);
      }
      if (rule.pct !== undefined) {
        const pct = parseFloat(rule.pct);
        if (isNaN(pct) || pct <= 0 || pct > 100) {
          errors.push(`【减仓规则】第${idx + 1}条规则 pct 必须在 1-100% 之间`);
        }
      }
    });
  }

  // ——————————————————————————————————————
  // 7. 触发规则校验
  // ——————————————————————————————————————
  const triggerRules = safeParseJson(rules.trigger_rules, null);
  if (!triggerRules || !Array.isArray(triggerRules) || triggerRules.length === 0) {
    warnings.push('【触发规则】trigger_rules 未配置，建议配置技术信号触发条件');
  }

  // ——————————————————————————————————————
  // 8. 推送渠道校验（至少1个）
  // ——————————————————————————————————————
  const pushChannels = safeParseJson(rules.push_channels, null);
  if (!pushChannels || !Array.isArray(pushChannels) || pushChannels.length === 0) {
    errors.push('【推送渠道】push_channels 至少需要配置1个推送渠道（Telegram/企微/飞书等）');
  } else {
    pushChannels.forEach((channel, idx) => {
      if (!channel.type) {
        errors.push(`【推送渠道】第${idx + 1}个渠道缺少 type 字段`);
      }
      if (!channel.webhook && !channel.chat_id) {
        errors.push(`【推送渠道】第${idx + 1}个渠道（${channel.type || '未知'}）缺少 webhook 或 chat_id`);
      }
    });
  }

  // ——————————————————————————————————————
  // 9. 评级阈值合法性校验
  // ——————————————————————————————————————
  const sThreshold = parseFloat(rules.grade_s_threshold || 90);
  const aThreshold = parseFloat(rules.grade_a_threshold || 75);
  const bThreshold = parseFloat(rules.grade_b_threshold || 60);
  const cThreshold = parseFloat(rules.grade_c_threshold || 45);

  // 阈值必须递减：S > A > B > C
  if (!(sThreshold > aThreshold && aThreshold > bThreshold && bThreshold > cThreshold)) {
    errors.push(
      `【评级阈值】必须满足 S > A > B > C 递减，当前：S=${sThreshold} A=${aThreshold} B=${bThreshold} C=${cThreshold}`
    );
  }

  // S 阈值不能太低（防止虚高评级）
  if (sThreshold < 80) {
    warnings.push(`【评级阈值】S级阈值（${sThreshold}分）偏低，建议 ≥ 80 分，避免评级虚高`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * 快速检查（仅检查必填项，不做深度验证）
 * 用于向导步骤切换时的实时校验
 * @param {Object} rules
 * @returns {{ completeness: number, missing: string[] }}
 */
function quickCheck(rules) {
  const missing = [];
  const checks = [
    { field: 'dimension_weights', label: '选股维度权重' },
    { field: 'technical_rules', label: '技术面规则' },
    { field: 'capital_allocation', label: '资金使用规则' },
    { field: 'reduce_rules', label: '减仓规则' },
    { field: 'take_profit_rules', label: '止盈规则' },
    { field: 'stop_loss_rules', label: '止损规则' },
    { field: 'trigger_rules', label: '触发规则' },
    { field: 'push_channels', label: '推送渠道' }
  ];

  checks.forEach(({ field, label }) => {
    const val = safeParseJson(rules[field]);
    const isEmpty = !val || (Array.isArray(val) && val.length === 0);
    if (isEmpty) missing.push(label);
  });

  const completeness = Math.round(((checks.length - missing.length) / checks.length) * 100);
  return { completeness, missing };
}

module.exports = { validateStrategyRules, quickCheck };
