/**
 * @file 选股评分引擎
 * @description 按策略规则对股票进行五维度综合评分，输出评级 S/A/B/C/D
 *              评级标准：S≥90、A≥75、B≥60、C≥45、D<45
 */

'use strict';

/**
 * 从环境变量加载选股评分引擎权重配置
 * 生产环境必须在 .env 中配置真实权重，否则使用混淆默认值
 * 权重精确值属于平台核心机密，不出现在代码仓库中
 */
function loadScorerWeights() {
  return {
    technical:   parseFloat(process.env.RANK_W1 || '0.20'),
    fundamental: parseFloat(process.env.RANK_W2 || '0.20'),
    sentiment:   parseFloat(process.env.RANK_W3 || '0.20'),
    capital:     parseFloat(process.env.RANK_W4 || '0.20'),
    chip:        parseFloat(process.env.RANK_W5 || '0.20'),
    // 评级阈值
    gradeS: parseFloat(process.env.RANK_G1 || '85'),
    gradeA: parseFloat(process.env.RANK_G2 || '70'),
    gradeB: parseFloat(process.env.RANK_G3 || '55'),
    gradeC: parseFloat(process.env.RANK_G4 || '40'),
  };
}

/**
 * 限制数值在 [min, max] 区间内
 */
function clamp(value, min = 0, max = 100) {
  return Math.min(Math.max(value, min), max);
}

/**
 * 技术面评分（满分100）
 * 子权重：均线30% + MACD25% + RSI20% + KDJ15% + 成交量10%
 *
 * @param {Object} indicators 技术指标数据
 *   - ma5, ma10, ma20, ma60: 均线价格
 *   - macd_dif, macd_dea, macd_hist: MACD三值
 *   - rsi14: 相对强弱指标(0-100)
 *   - kdj_k, kdj_d, kdj_j: KDJ三值
 *   - volume_ratio: 量比（当日成交量/过去5日平均量）
 *   - current_price: 当前价格
 * @param {Object} rules 策略配置的技术面规则
 * @returns {number} 0-100 的技术面得分
 */
function scoreTechnical(indicators, rules = {}) {
  const {
    ma5 = 0, ma10 = 0, ma20 = 0, ma60 = 0,
    macd_dif = 0, macd_dea = 0, macd_hist = 0,
    rsi14 = 50,
    kdj_k = 50, kdj_d = 50, kdj_j = 50,
    volume_ratio = 1,
    current_price = 0
  } = indicators;

  // ——————————————————————————————————————
  // 1. 均线得分（30分）
  //    多头排列（ma5>ma10>ma20>ma60）加满分，价格在ma20上方加分
  // ——————————————————————————————————————
  let maScore = 0;
  // 短期趋势：ma5 > ma20（10分）
  if (ma5 > 0 && ma20 > 0 && ma5 > ma20) maScore += 10;
  // 中期趋势：ma20 > ma60（10分）
  if (ma20 > 0 && ma60 > 0 && ma20 > ma60) maScore += 10;
  // 价格站上 ma5（5分）
  if (current_price > 0 && ma5 > 0 && current_price > ma5) maScore += 5;
  // 价格站上 ma20（5分）
  if (current_price > 0 && ma20 > 0 && current_price > ma20) maScore += 5;
  maScore = clamp(maScore, 0, 30);

  // ——————————————————————————————————————
  // 2. MACD得分（25分）
  //    金叉+HIST红柱+DIF>0
  // ——————————————————————————————————————
  let macdScore = 0;
  // DIF > DEA（金叉或金叉后）（10分）
  if (macd_dif > macd_dea) macdScore += 10;
  // MACD柱为正（红柱，上升动能）（8分）
  if (macd_hist > 0) macdScore += 8;
  // DIF > 0（整体在零轴上方，多头市场）（7分）
  if (macd_dif > 0) macdScore += 7;
  macdScore = clamp(macdScore, 0, 25);

  // ——————————————————————————————————————
  // 3. RSI得分（20分）
  //    理想区间 40-70，过热>80惩罚，超卖<20给机会分
  // ——————————————————————————————————————
  let rsiScore = 0;
  if (rsi14 >= 40 && rsi14 <= 70) {
    // 黄金区间，满分
    rsiScore = 20;
  } else if (rsi14 > 70 && rsi14 <= 80) {
    // 偏热，但还可接受
    rsiScore = 12;
  } else if (rsi14 > 80) {
    // 过热，有回调风险
    rsiScore = 4;
  } else if (rsi14 >= 20 && rsi14 < 40) {
    // 偏弱
    rsiScore = 10;
  } else {
    // 超卖区间，反弹机会
    rsiScore = 8;
  }
  rsiScore = clamp(rsiScore, 0, 20);

  // ——————————————————————————————————————
  // 4. KDJ得分（15分）
  //    K>D 且 J<90 为较优，J<20 超卖给机会分
  // ——————————————————————————————————————
  let kdjScore = 0;
  // K > D（金叉或金叉后）（7分）
  if (kdj_k > kdj_d) kdjScore += 7;
  // J 在合理区间（8-80）（5分）
  if (kdj_j >= 8 && kdj_j <= 80) kdjScore += 5;
  // J > 0（不在超卖深坑）（3分）
  if (kdj_j > 0) kdjScore += 3;
  kdjScore = clamp(kdjScore, 0, 15);

  // ——————————————————————————————————————
  // 5. 成交量得分（10分）
  //    量比1.5-3为放量突破，量比>3为异动
  // ——————————————————————————————————————
  let volScore = 0;
  if (volume_ratio >= 1.5 && volume_ratio <= 3) {
    // 温和放量，最佳
    volScore = 10;
  } else if (volume_ratio > 3) {
    // 极度放量，可能是异动
    volScore = 6;
  } else if (volume_ratio >= 1) {
    // 平量
    volScore = 5;
  } else {
    // 缩量
    volScore = 2;
  }
  volScore = clamp(volScore, 0, 10);

  const total = maScore + macdScore + rsiScore + kdjScore + volScore;
  return clamp(total, 0, 100);
}

/**
 * 基本面评分（满分100）
 * 子权重：PE相对行业25% + ROE25% + 营收增速20% + 净利增速20% + 财务健康10%
 *
 * @param {Object} financials 财务数据
 *   - pe: 市盈率
 *   - pb: 市净率
 *   - roe: 净资产收益率（%）
 *   - revenue_growth: 营收同比增速（%）
 *   - profit_growth: 净利润同比增速（%）
 *   - debt_ratio: 资产负债率（%）
 *   - cashflow: 经营性现金流（正数为佳）
 * @param {Object} industryAvg 行业均值 { pe: 行业均值PE }
 * @param {Object} rules 基本面规则配置
 * @returns {number} 0-100 的基本面得分
 */
function scoreFundamental(financials = {}, industryAvg = {}, rules = {}) {
  const {
    pe = 20, pb = 2, roe = 10,
    revenue_growth = 0, profit_growth = 0,
    debt_ratio = 50, cashflow = 0
  } = financials;
  const { pe: industryPe = 20 } = industryAvg;

  // ——————————————————————————————————————
  // 1. PE相对行业估值（25分）
  //    低于行业均值越多越好
  // ——————————————————————————————————————
  let peScore = 0;
  if (pe > 0 && industryPe > 0) {
    const peRatio = pe / industryPe;
    if (peRatio <= 0.7) peScore = 25;      // 远低于行业
    else if (peRatio <= 0.9) peScore = 20; // 低于行业
    else if (peRatio <= 1.1) peScore = 15; // 持平
    else if (peRatio <= 1.3) peScore = 8;  // 略高
    else peScore = 3;                       // 明显偏高
  } else if (pe < 0) {
    // 亏损股
    peScore = 0;
  } else {
    peScore = 12; // 数据缺失给中间值
  }

  // ——————————————————————————————————————
  // 2. ROE得分（25分）
  //    A股优质公司 ROE > 15% 为佳
  // ——————————————————————————————————————
  let roeScore = 0;
  if (roe >= 20) roeScore = 25;
  else if (roe >= 15) roeScore = 20;
  else if (roe >= 10) roeScore = 15;
  else if (roe >= 5) roeScore = 8;
  else if (roe >= 0) roeScore = 3;
  else roeScore = 0; // 亏损

  // ——————————————————————————————————————
  // 3. 营收增速（20分）
  // ——————————————————————————————————————
  let revScore = 0;
  if (revenue_growth >= 30) revScore = 20;
  else if (revenue_growth >= 20) revScore = 16;
  else if (revenue_growth >= 10) revScore = 12;
  else if (revenue_growth >= 0) revScore = 7;
  else revScore = 0; // 营收下滑

  // ——————————————————————————————————————
  // 4. 净利润增速（20分）
  // ——————————————————————————————————————
  let profScore = 0;
  if (profit_growth >= 30) profScore = 20;
  else if (profit_growth >= 20) profScore = 16;
  else if (profit_growth >= 10) profScore = 12;
  else if (profit_growth >= 0) profScore = 6;
  else profScore = 0;

  // ——————————————————————————————————————
  // 5. 财务健康度（10分）
  //    负债率 + 现金流为正
  // ——————————————————————————————————————
  let healthScore = 0;
  // 负债率（5分）
  if (debt_ratio <= 40) healthScore += 5;
  else if (debt_ratio <= 60) healthScore += 3;
  else if (debt_ratio <= 80) healthScore += 1;
  // 经营现金流为正（5分）
  if (cashflow > 0) healthScore += 5;

  const total = peScore + roeScore + revScore + profScore + healthScore;
  return clamp(total, 0, 100);
}

/**
 * 舆情评分（满分100）
 * 子权重：情绪倾向40% + 重大事件30% + 政策关联20% + 热度10%
 *
 * @param {Object} newsData 舆情数据
 *   - positive_ratio: 正面新闻占比（0-1）
 *   - has_major_positive: 是否有重大利好事件（bool）
 *   - has_major_negative: 是否有重大利空事件（bool）
 *   - has_regulatory_penalty: 是否有监管处罚（bool）
 *   - policy_related: 是否有政策利好关联（bool）
 *   - weekly_count: 近7日新闻条数
 * @param {Object} rules 舆情规则配置
 * @returns {number} 0-100 的舆情得分
 */
function scoreSentiment(newsData = {}, rules = {}) {
  const {
    positive_ratio = 0.5,
    has_major_positive = false,
    has_major_negative = false,
    has_regulatory_penalty = false,
    policy_related = false,
    weekly_count = 5
  } = newsData;

  // 重大利空/监管处罚 直接给低分
  if (has_regulatory_penalty) return 10;
  if (has_major_negative) return 20;

  // ——————————————————————————————————————
  // 1. 情绪倾向（40分）
  // ——————————————————————————————————————
  const sentScore = clamp(Math.round(positive_ratio * 40), 0, 40);

  // ——————————————————————————————————————
  // 2. 重大事件（30分）
  // ——————————————————————————————————————
  const eventScore = has_major_positive ? 30 : 15;

  // ——————————————————————————————————————
  // 3. 政策关联（20分）
  // ——————————————————————————————————————
  const policyScore = policy_related ? 20 : 10;

  // ——————————————————————————————————————
  // 4. 热度（10分）
  //    新闻条数 5-20 条为适中，太少或太多都扣分
  // ——————————————————————————————————————
  let heatScore = 0;
  if (weekly_count >= 5 && weekly_count <= 20) heatScore = 10;
  else if (weekly_count > 20) heatScore = 6; // 过热，可能有炒作
  else heatScore = 4; // 冷清

  const total = sentScore + eventScore + policyScore + heatScore;
  return clamp(total, 0, 100);
}

/**
 * 资金流向评分（满分100）
 * 子权重：主力净流入40% + 超大单25% + 北向资金20% + 集中度15%
 *
 * @param {Object} capitalData 资金流向数据
 *   - consecutive_inflow_days: 连续净流入天数
 *   - daily_net_inflow: 当日主力净流入（元，正为流入）
 *   - super_large_net: 超大单净流入（元）
 *   - northbound_5d_change: 北向资金5日变动（元）
 *   - main_capital_ratio: 主力资金占总成交比例（0-1）
 * @param {Object} rules 资金规则配置
 * @returns {number} 0-100 的资金面得分
 */
function scoreCapitalFlow(capitalData = {}, rules = {}) {
  const {
    consecutive_inflow_days = 0,
    daily_net_inflow = 0,
    super_large_net = 0,
    northbound_5d_change = 0,
    main_capital_ratio = 0.3
  } = capitalData;

  // ——————————————————————————————————————
  // 1. 主力净流入（40分）
  //    连续流入天数越多越好
  // ——————————————————————————————————————
  let mainScore = 0;
  if (consecutive_inflow_days >= 5) mainScore = 40;
  else if (consecutive_inflow_days >= 3) mainScore = 30;
  else if (consecutive_inflow_days >= 1) mainScore = 20;
  else if (daily_net_inflow > 0) mainScore = 15; // 当日流入但不连续
  else mainScore = 0;

  // ——————————————————————————————————————
  // 2. 超大单（25分）
  // ——————————————————————————————————————
  let superScore = super_large_net > 0 ? 25 : (super_large_net === 0 ? 12 : 0);

  // ——————————————————————————————————————
  // 3. 北向资金（20分）
  // ——————————————————————————————————————
  let northScore = northbound_5d_change > 0 ? 20 : (northbound_5d_change === 0 ? 10 : 3);

  // ——————————————————————————————————————
  // 4. 主力资金集中度（15分）
  //    主力占比30-50%为佳
  // ——————————————————————————————————————
  let concScore = 0;
  const ratio = main_capital_ratio;
  if (ratio >= 0.3 && ratio <= 0.5) concScore = 15;
  else if (ratio > 0.5) concScore = 10; // 过度集中，风险稍高
  else concScore = 5;

  const total = mainScore + superScore + northScore + concScore;
  return clamp(total, 0, 100);
}

/**
 * 筹码分布评分（满分100）
 * 子权重：获利盘35% + 套牢压力25% + 主力成本25% + 集中度15%
 *
 * @param {Object} chipData 筹码分布数据
 *   - profit_ratio: 获利盘比例（0-1，即当前价格以下的筹码占比）
 *   - overhead_pressure_pct: 上方套牢压力区间厚度（%，越小越好）
 *   - cost_deviation_pct: 当前价格偏离主力建仓成本的幅度（%）
 *   - concentration_ratio: 筹码集中度（0-1，越大越集中）
 * @param {Object} rules 筹码规则配置
 * @returns {number} 0-100 的筹码面得分
 */
function scoreChipDistribution(chipData = {}, rules = {}) {
  const {
    profit_ratio = 0.5,
    overhead_pressure_pct = 20,
    cost_deviation_pct = 10,
    concentration_ratio = 0.5
  } = chipData;

  // ——————————————————————————————————————
  // 1. 获利盘比例（35分）
  //    获利盘>70%说明大部分持有者盈利，筹码稳定
  // ——————————————————————————————————————
  let profitScore = 0;
  if (profit_ratio >= 0.7) profitScore = 35;
  else if (profit_ratio >= 0.5) profitScore = 25;
  else if (profit_ratio >= 0.3) profitScore = 15;
  else profitScore = 5;

  // ——————————————————————————————————————
  // 2. 上方套牢压力（25分）
  //    压力越小越好，超过30%压力区间满分打折
  // ——————————————————————————————————————
  let overheadScore = 0;
  if (overhead_pressure_pct <= 5) overheadScore = 25;
  else if (overhead_pressure_pct <= 15) overheadScore = 18;
  else if (overhead_pressure_pct <= 30) overheadScore = 10;
  else overheadScore = 3;

  // ——————————————————————————————————————
  // 3. 主力成本偏离（25分）
  //    当前价格略高于主力成本（5-20%）为最佳持仓阶段
  // ——————————————————————————————————————
  let costScore = 0;
  if (cost_deviation_pct >= 5 && cost_deviation_pct <= 20) costScore = 25;
  else if (cost_deviation_pct >= 0 && cost_deviation_pct < 5) costScore = 15; // 成本区附近
  else if (cost_deviation_pct > 20 && cost_deviation_pct <= 40) costScore = 12; // 主力盈利丰厚，可能出货
  else if (cost_deviation_pct < 0) costScore = 5; // 价格低于主力成本
  else costScore = 5;

  // ——————————————————————————————————————
  // 4. 筹码集中度（15分）
  //    适度集中（0.5-0.8）说明主力控盘
  // ——————————————————————————————————————
  let concScore = 0;
  if (concentration_ratio >= 0.5 && concentration_ratio <= 0.8) concScore = 15;
  else if (concentration_ratio > 0.8) concScore = 10; // 过度集中风险
  else concScore = 6;

  const total = profitScore + overheadScore + costScore + concScore;
  return clamp(total, 0, 100);
}

/**
 * 综合评分与评级
 * @param {Object} allScores 各维度得分 { technical, fundamental, sentiment, capital, chip }
 * @param {Object} weights 各维度权重（百分比整数，合计100）
 * @param {Object} thresholds 评级阈值 { s:90, a:75, b:60, c:45 }
 * @returns {{ score: number, grade: 'S'|'A'|'B'|'C'|'D', breakdown: Object }}
 */
function calcFinalScore(allScores, weights, thresholds = {}) {
  const { technical = 0, fundamental = 0, sentiment = 0, capital = 0, chip = 0 } = allScores;
  const {
    technical: wTech = 40,
    fundamental: wFund = 30,
    sentiment: wSent = 10,
    capital: wCap = 10,
    chip: wChip = 10
  } = weights;

  // 按权重加权求和，权重总和应等于100
  const score = clamp(
    (technical * wTech + fundamental * wFund + sentiment * wSent + capital * wCap + chip * wChip) / 100,
    0,
    100
  );

  const { s = 90, a = 75, b = 60, c = 45 } = thresholds;

  let grade;
  if (score >= s) grade = 'S';
  else if (score >= a) grade = 'A';
  else if (score >= b) grade = 'B';
  else if (score >= c) grade = 'C';
  else grade = 'D';

  return {
    score: Math.round(score * 10) / 10, // 保留一位小数
    grade,
    breakdown: { technical, fundamental, sentiment, capital, chip, weights }
  };
}

/**
 * 获取 mock 行情数据（用于数据源缺失时的兜底）
 * 实际生产中应对接 AkShare 或 Tushare
 * @param {string} stockCode 股票代码
 * @returns {Object} mock 数据
 */
function getMockMarketData(stockCode) {
  return {
    indicators: {
      current_price: 15.8,
      ma5: 15.5, ma10: 15.0, ma20: 14.5, ma60: 13.0,
      macd_dif: 0.25, macd_dea: 0.18, macd_hist: 0.07,
      rsi14: 58,
      kdj_k: 62, kdj_d: 55, kdj_j: 76,
      volume_ratio: 1.8
    },
    financials: {
      pe: 18, pb: 2.2, roe: 14,
      revenue_growth: 15, profit_growth: 18,
      debt_ratio: 45, cashflow: 5000000
    },
    industryAvg: { pe: 22 },
    newsData: {
      positive_ratio: 0.65,
      has_major_positive: false,
      has_major_negative: false,
      has_regulatory_penalty: false,
      policy_related: false,
      weekly_count: 8
    },
    capitalData: {
      consecutive_inflow_days: 2,
      daily_net_inflow: 3000000,
      super_large_net: 1500000,
      northbound_5d_change: 800000,
      main_capital_ratio: 0.38
    },
    chipData: {
      profit_ratio: 0.62,
      overhead_pressure_pct: 12,
      cost_deviation_pct: 8,
      concentration_ratio: 0.60
    }
  };
}

/**
 * 主入口：对一只股票按策略规则打分
 * @param {string} stockCode 股票代码（如 '000001'）
 * @param {Object} strategyRule 策略规则对象（从 strategy_rules 表读取，JSON字段已解析）
 * @returns {Promise<{ score: number, grade: string, breakdown: Object, signal_type: string|null }>}
 */
async function scoreStock(stockCode, strategyRule) {
  // 解析策略规则中的权重和阈值
  const weights = typeof strategyRule.dimension_weights === 'string'
    ? JSON.parse(strategyRule.dimension_weights)
    : strategyRule.dimension_weights;

  const thresholds = {
    s: strategyRule.grade_s_threshold || 90,
    a: strategyRule.grade_a_threshold || 75,
    b: strategyRule.grade_b_threshold || 60,
    c: strategyRule.grade_c_threshold || 45
  };

  // 解析各维度规则
  const technicalRules = typeof strategyRule.technical_rules === 'string'
    ? JSON.parse(strategyRule.technical_rules) : (strategyRule.technical_rules || {});
  const fundamentalRules = typeof strategyRule.fundamental_rules === 'string'
    ? JSON.parse(strategyRule.fundamental_rules) : (strategyRule.fundamental_rules || {});
  const sentimentRules = typeof strategyRule.sentiment_rules === 'string'
    ? JSON.parse(strategyRule.sentiment_rules) : (strategyRule.sentiment_rules || {});
  const capitalRules = typeof strategyRule.capital_rules === 'string'
    ? JSON.parse(strategyRule.capital_rules) : (strategyRule.capital_rules || {});
  const chipRules = typeof strategyRule.chip_rules === 'string'
    ? JSON.parse(strategyRule.chip_rules) : (strategyRule.chip_rules || {});

  // TODO: 实际环境中此处调用 AkShare 获取真实行情
  // 当前使用 mock 数据兜底
  const marketData = getMockMarketData(stockCode);

  // 各维度评分
  const techScore = weights.technical > 0
    ? scoreTechnical(marketData.indicators, technicalRules) : 0;
  const fundScore = weights.fundamental > 0
    ? scoreFundamental(marketData.financials, marketData.industryAvg, fundamentalRules) : 0;
  const sentScore = weights.sentiment > 0
    ? scoreSentiment(marketData.newsData, sentimentRules) : 0;
  const capScore = weights.capital > 0
    ? scoreCapitalFlow(marketData.capitalData, capitalRules) : 0;
  const chipScore = weights.chip > 0
    ? scoreChipDistribution(marketData.chipData, chipRules) : 0;

  const allScores = {
    technical: techScore,
    fundamental: fundScore,
    sentiment: sentScore,
    capital: capScore,
    chip: chipScore
  };

  const result = calcFinalScore(allScores, weights, thresholds);

  // 根据评级判断信号类型（简单规则：S/A可以买，C/D建议减仓）
  let signal_type = null;
  if (result.grade === 'S' || result.grade === 'A') signal_type = 'buy';
  else if (result.grade === 'D') signal_type = 'reduce';

  return { ...result, signal_type, stock_code: stockCode, is_mock: true };
}

module.exports = {
  scoreStock,
  scoreTechnical,
  scoreFundamental,
  scoreSentiment,
  scoreCapitalFlow,
  scoreChipDistribution,
  calcFinalScore
};
