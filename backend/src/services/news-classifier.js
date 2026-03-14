/**
 * @file 新闻分类服务
 * @module services/news-classifier
 *
 * 纯规则引擎分类，不调用LLM，快速低成本。
 * 输出 assetType / eventType / stockCodes。
 */

// ─────────────────────────────────────────────────────────
// 规则表
// ─────────────────────────────────────────────────────────

/** 资产类型规则（按优先级排列，靠前的优先匹配） */
const ASSET_RULES = [
  { type: '数字货币', keywords: ['比特币', 'BTC', 'ETH', '以太坊', '加密货币', 'USDT', 'Web3', '链上', '矿工', 'DeFi', 'NFT'] },
  { type: '美股',     keywords: ['纳斯达克', '道琼斯', '标普', '纽交所', '美股', 'NYSE', 'NASDAQ', 'S&P', '美联储'] },
  { type: '港股',     keywords: ['港股', '恒指', '港交所', '联交所', '.HK', '恒生指数'] },
  { type: '大宗商品', keywords: ['黄金', '原油', '铜', '铁矿石', '大宗', '期货', '焦煤', '螺纹钢', '天然气', '白银', '铝'] },
  { type: '宏观',     keywords: ['央行', '美联储', 'GDP', 'CPI', 'PPI', '降息', '加息', '货币政策', '财政政策', '通胀', '汇率', '外汇储备'] },
  // A股放最后，因为6位数字也很泛，容易误匹配
  { type: 'A股',      keywords: ['沪指', 'A股', '创业板', '科创板', '沪深', '上证', '深证', '北证', '主板'] },
];

/** 事件类型规则 */
const EVENT_RULES = [
  { type: '财报',     keywords: ['净利润', '营收', '业绩', '财报', '年报', '季报', '中报', '归母净利', '毛利率'] },
  { type: '政策',     keywords: ['政策', '监管', '发改委', '证监会', '央行', '国务院', '工信部', '财政部', '法规', '条例', '规定'] },
  { type: '人事',     keywords: ['董事长', 'CEO', '总经理', '辞职', '任命', '留置', '离职', '接任', '换帅'] },
  { type: '并购重组', keywords: ['收购', '并购', '重组', '合并', '股权转让', '要约', '资产注入', '战略投资'] },
  { type: '市场数据', keywords: ['涨停', '跌停', '成交量', '换手率', '主力资金', '北向资金', '南向资金', '融资融券'] },
  { type: '突发',     keywords: ['紧急', '重大', '突发', '最新', '刚刚', '速报', '快讯', '打响', '爆发'] },
];

// ─────────────────────────────────────────────────────────
// 匹配工具
// ─────────────────────────────────────────────────────────

/**
 * 在文本中匹配关键词列表（支持字符串和正则）
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

// ─────────────────────────────────────────────────────────
// 主分类函数
// ─────────────────────────────────────────────────────────

/**
 * 基于关键词的快速分类
 * @param {string} content
 * @returns {{assetType: string, eventType: string, stockCodes: string[]}}
 */
function classifyNews(content) {
  if (!content || typeof content !== 'string') {
    return { assetType: '未知', eventType: '未知', stockCodes: [] };
  }

  // ── 资产类型
  let assetType = '其他';
  for (const rule of ASSET_RULES) {
    if (matchesAny(content, rule.keywords)) {
      assetType = rule.type;
      break;
    }
  }

  // ── 事件类型（可多匹配，取第一个）
  let eventType = '其他';
  for (const rule of EVENT_RULES) {
    if (matchesAny(content, rule.keywords)) {
      eventType = rule.type;
      break;
    }
  }

  // ── A股代码提取（6位纯数字，限定60/00/30/68/43/83开头，避免误匹配年份等）
  const rawCodes = content.match(/\b(?:60|00|30|68|43|83)\d{4}\b/g) || [];
  // 去重
  const stockCodes = [...new Set(rawCodes)];

  // 有股票代码时，若资产类型为"其他"则强制推定为A股
  if (stockCodes.length > 0 && assetType === '其他') {
    assetType = 'A股';
  }

  return { assetType, eventType, stockCodes };
}

module.exports = { classifyNews, matchesAny };
