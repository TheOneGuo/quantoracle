/**
 * @file 新闻来源配置加载器
 * @module config/news-sources-loader
 *
 * 从环境变量加载新闻来源配置，支持最多16个可配置Telegram来源。
 * 真实频道信息仅存在于运行环境的 .env 文件中，不进入代码仓库。
 * 日志中使用别名，不暴露真实来源标识。
 *
 * 7种预设财经群类型（用户可按此分类配置对应Telegram群）：
 *   类型1：macro_policy   - 宏观政策/央行动态群
 *   类型2：ashare_market  - A股行情/龙虎榜群
 *   类型3：northbound     - 北向资金/外资动态群
 *   类型4：finance_flash  - 财经快讯群（类似财联社/第一财经）
 *   类型5：stock_unusual  - 个股异动/涨跌停群
 *   类型6：futures        - 期货/大宗商品群
 *   类型7：hk_us_market   - 港股/美股动态群
 *
 * 环境变量格式（在 .env 中配置，最多16个来源）：
 *   NEWS_SRC_001=@channel_username_or_-100xxxxx   # 频道ID或username
 *   NEWS_SRC_001_ALIAS=宏观政策群                 # 日志中显示的别名
 *   NEWS_SRC_001_WEIGHT=5                          # 权重 1-10（影响新闻评分）
 *   NEWS_SRC_001_TYPE=macro_policy                 # 群类型（见上方7种）
 *
 * 建议配置示例（用户需在 .env 中填写真实频道ID）：
 *   NEWS_SRC_001=@your_macro_channel    NEWS_SRC_001_ALIAS=宏观政策   NEWS_SRC_001_TYPE=macro_policy   NEWS_SRC_001_WEIGHT=5
 *   NEWS_SRC_002=@your_ashare_channel   NEWS_SRC_002_ALIAS=A股行情    NEWS_SRC_002_TYPE=ashare_market  NEWS_SRC_002_WEIGHT=4
 *   NEWS_SRC_003=@your_northbound_ch    NEWS_SRC_003_ALIAS=北向资金   NEWS_SRC_003_TYPE=northbound     NEWS_SRC_003_WEIGHT=4
 *   NEWS_SRC_004=@your_flash_channel    NEWS_SRC_004_ALIAS=财经快讯   NEWS_SRC_004_TYPE=finance_flash  NEWS_SRC_004_WEIGHT=5
 *   NEWS_SRC_005=@your_unusual_channel  NEWS_SRC_005_ALIAS=个股异动   NEWS_SRC_005_TYPE=stock_unusual  NEWS_SRC_005_WEIGHT=4
 *   NEWS_SRC_006=@your_futures_channel  NEWS_SRC_006_ALIAS=期货大宗   NEWS_SRC_006_TYPE=futures        NEWS_SRC_006_WEIGHT=3
 *   NEWS_SRC_007=@your_hkus_channel     NEWS_SRC_007_ALIAS=港美股     NEWS_SRC_007_TYPE=hk_us_market   NEWS_SRC_007_WEIGHT=3
 */

/**
 * 有效的群类型列表（7种财经群类型）
 */
const VALID_CHANNEL_TYPES = [
  'macro_policy',   // 宏观政策/央行动态群
  'ashare_market',  // A股行情/龙虎榜群
  'northbound',     // 北向资金/外资动态群
  'finance_flash',  // 财经快讯群
  'stock_unusual',  // 个股异动/涨跌停群
  'futures',        // 期货/大宗商品群
  'hk_us_market',   // 港股/美股动态群
  'general',        // 通用财经群（未分类）
];

/**
 * 群类型的默认权重映射（运营重要性）
 * 用户可通过 NEWS_SRC_XXX_WEIGHT 环境变量覆盖
 */
const DEFAULT_WEIGHTS = {
  macro_policy:  5,  // 宏观政策影响广，权重高
  finance_flash: 5,  // 财经快讯时效性强
  northbound:    4,  // 北向资金是重要指标
  ashare_market: 4,  // A股行情直接相关
  stock_unusual: 4,  // 个股异动交易机会
  futures:       3,  // 期货影响间接
  hk_us_market:  3,  // 港美股参考价值
  general:       3,  // 通用默认
};

/**
 * 加载所有已配置的新闻来源
 * 支持 NEWS_SRC_001 ~ NEWS_SRC_016（最多16个来源，满足7个群类型需求）
 *
 * @returns {Array<{
 *   id: string,       // 真实频道ID/username（来自环境变量）
 *   alias: string,    // 显示别名（日志用）
 *   weight: number,   // 权重 1-10
 *   key: string,      // 内部引用key（不含真实ID）
 *   channelType: string  // 群类型（7种之一）
 * }>}
 */
function loadNewsSources() {
  const sources = [];
  // 扩展到16个槽位，支持每种类型可配置多个群
  for (let i = 1; i <= 16; i++) {
    const key = String(i).padStart(3, '0');
    const channelId = process.env[`NEWS_SRC_${key}`];

    // 跳过未配置的槽位
    if (!channelId || !channelId.trim()) continue;

    const channelType = process.env[`NEWS_SRC_${key}_TYPE`] || 'general';
    const defaultWeight = DEFAULT_WEIGHTS[channelType] || 3;

    sources.push({
      id:          channelId.trim(),
      alias:       process.env[`NEWS_SRC_${key}_ALIAS`] || `src-${key}`,
      weight:      parseInt(process.env[`NEWS_SRC_${key}_WEIGHT`] || String(defaultWeight), 10),
      key:         `src-${key}`,
      channelType: VALID_CHANNEL_TYPES.includes(channelType) ? channelType : 'general',
    });
  }

  if (sources.length === 0) {
    console.warn('[news-sources-loader] 未配置任何新闻来源，请在 .env 中配置 NEWS_SRC_001~016');
    console.warn('[news-sources-loader] 7种群类型: macro_policy / ashare_market / northbound / finance_flash / stock_unusual / futures / hk_us_market');
  } else {
    console.log(`[news-sources-loader] 已加载 ${sources.length} 个新闻来源，类型分布:`, 
      sources.reduce((acc, s) => { acc[s.channelType] = (acc[s.channelType] || 0) + 1; return acc; }, {})
    );
  }

  return sources;
}

/**
 * 按群类型过滤来源
 * @param {string} channelType - 群类型
 * @returns {Array} 该类型的所有来源
 */
function getSourcesByType(channelType) {
  return loadNewsSources().filter((s) => s.channelType === channelType);
}

module.exports = { loadNewsSources, getSourcesByType, VALID_CHANNEL_TYPES, DEFAULT_WEIGHTS };
