/**
 * @file 新闻分类服务
 * @module services/news-classifier
 *
 * 纯规则引擎分类，不调用LLM，快速低成本。
 * 输出 assetType / eventType / sentiment / urgency / stockCodes。
 *
 * 分类维度：
 *   - 市场类型（assetType）：A股/港股/美股/期货/外汇/加密货币/宏观/其他
 *   - 事件类型（eventType）：政策/财报/并购重组/涨跌停/龙虎榜/北向资金/宏观经济/行业动态/突发事件/其他
 *   - 情绪倾向（sentiment）：利好/利空/中性
 *   - 紧急程度（urgency）：breaking/important/normal
 *   - 相关股票（stockCodes）：从文中提取A股代码
 */

// ─────────────────────────────────────────────────────────
// 资产类型规则（按优先级排列，靠前的优先匹配）
// ─────────────────────────────────────────────────────────

const ASSET_RULES = [
  { type: '加密货币', keywords: ['比特币', 'BTC', 'ETH', '以太坊', '加密货币', 'USDT', 'Web3', '链上', '矿工', 'DeFi', 'NFT', '代币', '区块链'] },
  { type: '美股',     keywords: ['纳斯达克', '道琼斯', '标普', '纽交所', '美股', 'NYSE', 'NASDAQ', 'S&P', '美联储', '美股市场'] },
  { type: '港股',     keywords: ['港股', '恒指', '港交所', '联交所', '.HK', '恒生指数', '港交所主板'] },
  { type: '期货',     keywords: ['期货', '黄金', '原油', '铜', '铁矿石', '大宗', '焦煤', '螺纹钢', '天然气', '白银', '铝', '玉米', '大豆', '期权'] },
  { type: '外汇',     keywords: ['外汇', '汇率', '美元', '欧元', '日元', '人民币汇率', '外汇储备', '中间价', '离岸', '在岸'] },
  { type: '宏观',     keywords: ['央行', 'GDP', 'CPI', 'PPI', '降息', '加息', '货币政策', '财政政策', '通胀', '宏观经济', '美联储'] },
  // A股放最后，6位数字容易误匹配
  { type: 'A股',      keywords: ['沪指', 'A股', '创业板', '科创板', '沪深', '上证', '深证', '北证', '主板', '两市'] },
];

// ─────────────────────────────────────────────────────────
// 事件类型规则
// ─────────────────────────────────────────────────────────

const EVENT_RULES = [
  { type: '财报',     keywords: ['净利润', '营收', '业绩', '财报', '年报', '季报', '中报', '归母净利', '毛利率', '业绩预告', '业绩快报'] },
  { type: '政策',     keywords: ['政策', '监管', '发改委', '证监会', '央行', '国务院', '工信部', '财政部', '法规', '条例', '规定', '出台', '发布'] },
  { type: '并购重组', keywords: ['收购', '并购', '重组', '合并', '股权转让', '要约', '资产注入', '战略投资', '定增', '借壳'] },
  { type: '涨跌停',   keywords: ['涨停', '跌停', '一字板', '炸板', '连板', '涨幅', '跌幅'] },
  { type: '龙虎榜',   keywords: ['龙虎榜', '游资', '机构席位', '营业部', '大宗交易'] },
  { type: '北向资金', keywords: ['北向资金', '外资', '沪股通', '深股通', '南向资金', '港股通', '陆股通'] },
  { type: '宏观经济', keywords: ['宏观', 'GDP', 'CPI', 'PPI', '降息', '加息', '货币政策', '财政政策', '就业数据', '非农', 'PMI'] },
  { type: '行业动态', keywords: ['行业', '板块', '赛道', '产业链', '龙头', '景气', '复苏', '扩张', '萎缩'] },
  { type: '突发事件', keywords: ['紧急', '重大', '突发', '最新', '刚刚', '速报', '快讯', '打响', '爆发', '震惊', '重磅'] },
];

// ─────────────────────────────────────────────────────────
// 情绪倾向规则
// ─────────────────────────────────────────────────────────

/** 利好关键词 */
const POSITIVE_KEYWORDS = [
  '利好', '大涨', '飙升', '暴涨', '涨停', '创新高', '超预期', '净流入', '增持', '回购',
  '上调', '扩张', '增长', '盈利', '受益', '突破', '新高', '做多', '推荐', '买入',
  '政策支持', '补贴', '免税', '减税', '降息', '宽松', '刺激', '利好消息',
  '外资流入', '北向净买入', '机构增持', '业绩超预期', '分红', '高送转',
];

/** 利空关键词 */
const NEGATIVE_KEYWORDS = [
  '利空', '大跌', '暴跌', '跌停', '创新低', '低于预期', '净流出', '减持', '抛售',
  '下调', '收缩', '亏损', '亏损', '风险', '跌破', '空头', '卖出', '警示', '退市',
  '处罚', '罚款', '调查', '违规', '诉讼', '债务危机', '流动性危机', '破产', '违约',
  '外资流出', '北向净卖出', '机构减持', '业绩低于预期', '净利润下滑', '收入下降',
];

// ─────────────────────────────────────────────────────────
// 紧急程度规则
// ─────────────────────────────────────────────────────────

/** breaking（突发）关键词 */
const BREAKING_KEYWORDS = [
  '突发', '刚刚', '速报', '快讯', '最新', '紧急', '重大', '震惊', '打响',
  '爆发', '重磅', '突然', '意外', '最新消息', '突破性',
];

/** important（重要）关键词 */
const IMPORTANT_KEYWORDS = [
  '重要', '关注', '提示', '公告', '发布', '出台', '政策', '监管',
  '财报', '业绩', '收购', '并购', '定增', '涨停', '跌停',
];

// ─────────────────────────────────────────────────────────
// 匹配工具函数
// ─────────────────────────────────────────────────────────

/**
 * 在文本中匹配关键词列表
 * @param {string} content
 * @param {Array<string|RegExp>} keywords
 * @returns {boolean}
 */
function matchesAny(content, keywords) {
  for (const kw of keywords) {
    if (typeof kw === 'string') {
      if (content.includes(kw)) return true;
    } else if (kw instanceof RegExp) {
      if (kw.test(content)) return true;
    }
  }
  return false;
}

/**
 * 统计命中关键词数量
 * @param {string} content
 * @param {string[]} keywords
 * @returns {number}
 */
function countMatches(content, keywords) {
  return keywords.filter((kw) => content.includes(kw)).length;
}

// ─────────────────────────────────────────────────────────
// 主分类函数
// ─────────────────────────────────────────────────────────

/**
 * 基于关键词的快速分类（规则引擎，无LLM调用）
 *
 * @param {string} content - 新闻正文
 * @returns {{
 *   assetType: string,   // 市场类型
 *   eventType: string,   // 事件类型
 *   sentiment: string,   // 情绪倾向：利好/利空/中性
 *   urgency: string,     // 紧急程度：breaking/important/normal
 *   stockCodes: string[] // 相关A股代码
 * }}
 */
function classifyNews(content) {
  if (!content || typeof content !== 'string') {
    return { assetType: '未知', eventType: '未知', sentiment: '中性', urgency: 'normal', stockCodes: [] };
  }

  // ── 资产类型（按优先级，首个匹配）
  let assetType = '其他';
  for (const rule of ASSET_RULES) {
    if (matchesAny(content, rule.keywords)) {
      assetType = rule.type;
      break;
    }
  }

  // ── 事件类型（首个匹配）
  let eventType = '其他';
  for (const rule of EVENT_RULES) {
    if (matchesAny(content, rule.keywords)) {
      eventType = rule.type;
      break;
    }
  }

  // ── 情绪倾向（利好/利空/中性，比较命中数量）
  const posCount = countMatches(content, POSITIVE_KEYWORDS);
  const negCount = countMatches(content, NEGATIVE_KEYWORDS);
  let sentiment = '中性';
  if (posCount > negCount && posCount > 0) {
    sentiment = '利好';
  } else if (negCount > posCount && negCount > 0) {
    sentiment = '利空';
  }

  // ── 紧急程度
  let urgency = 'normal';
  if (matchesAny(content, BREAKING_KEYWORDS)) {
    urgency = 'breaking';
  } else if (matchesAny(content, IMPORTANT_KEYWORDS)) {
    urgency = 'important';
  }

  // ── A股代码提取（6位，限定60/00/30/68/43/83开头）
  const rawCodes = content.match(/\b(?:60|00|30|68|43|83)\d{4}\b/g) || [];
  const stockCodes = [...new Set(rawCodes)];

  // 有股票代码时，若资产类型为"其他"则推定为A股
  if (stockCodes.length > 0 && assetType === '其他') {
    assetType = 'A股';
  }

  return { assetType, eventType, sentiment, urgency, stockCodes };
}

module.exports = { classifyNews, matchesAny, countMatches };
