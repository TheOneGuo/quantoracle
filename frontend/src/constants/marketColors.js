/**
 * 市场颜色方向配置
 * 不同市场的涨跌颜色习惯不同，必须通过配置驱动，不能硬编码
 * 
 * 颜色方向因市场而异：
 * - A股/港股/日股：红涨绿跌（红色 = 看多/上涨，绿色 = 看空/下跌）
 * - 美股/欧股：绿涨红跌（绿色 = 上涨，红色 = 下跌）
 * - 用户可在设置页覆盖每个市场的颜色
 */

// 市场颜色配置（默认值，用户可在设置页覆盖）
const MARKET_COLOR_CONFIG = {
  "A股": {
    bullish: "#e53e3e",   // 红色 = 看多（上涨）
    bearish: "#38a169",   // 绿色 = 看空（下跌）
    neutral: "#718096"
  },
  "港股": {
    bullish: "#e53e3e",   // 港股习惯与A股相同
    bearish: "#38a169",
    neutral: "#718096"
  },
  "美股": {
    bullish: "#38a169",   // 绿色 = 上涨（美股习惯）
    bearish: "#e53e3e",   // 红色 = 下跌
    neutral: "#718096"
  },
  "日股": {
    bullish: "#e53e3e",   // 日本与A股相同（红涨绿跌）
    bearish: "#38a169",
    neutral: "#718096"
  },
  "欧股": {
    bullish: "#38a169",   // 欧洲与美股相同
    bearish: "#e53e3e",
    neutral: "#718096"
  }
};

/**
 * 获取市场颜色
 * @param {string} market - 市场名称（A股/美股/港股/日股/欧股）
 * @param {string} direction - 方向（bullish/bearish/neutral）
 * @returns {string} 颜色值
 */
export function getMarketColor(market, direction) {
  const config = MARKET_COLOR_CONFIG[market] || MARKET_COLOR_CONFIG["A股"];
  return config[direction] || config.neutral;
}

/**
 * 获取涨跌颜色（根据市场习惯）
 * @param {string} market - 市场名称
 * @param {boolean} isPositive - 是否为正数（上涨/看多）
 * @returns {string} 颜色值
 */
export function getChangeColor(market, isPositive) {
  return getMarketColor(market, isPositive ? "bullish" : "bearish");
}

/**
 * 保存用户自定义颜色配置到 localStorage
 * @param {string} market - 市场名称
 * @param {Object} colors - 颜色配置 {bullish, bearish, neutral}
 */
export function saveCustomColors(market, colors) {
  try {
    const saved = getUserColors();
    saved[market] = colors;
    localStorage.setItem('marketColorConfig', JSON.stringify(saved));
  } catch (e) {
    console.error('保存颜色配置失败:', e);
  }
}

/**
 * 获取用户自定义颜色配置
 * @returns {Object} 用户颜色配置
 */
export function getUserColors() {
  try {
    const saved = localStorage.getItem('marketColorConfig');
    return saved ? JSON.parse(saved) : {};
  } catch (e) {
    console.error('读取颜色配置失败:', e);
    return {};
  }
}

/**
 * 获取最终颜色配置（合并默认和用户自定义）
 * @param {string} market - 市场名称
 * @returns {Object} 合并后的颜色配置
 */
export function getMergedColors(market) {
  const defaultConfig = MARKET_COLOR_CONFIG[market] || MARKET_COLOR_CONFIG["A股"];
  const userColors = getUserColors();
  const userMarketColors = userColors[market];
  
  if (!userMarketColors) {
    return defaultConfig;
  }
  
  return {
    bullish: userMarketColors.bullish || defaultConfig.bullish,
    bearish: userMarketColors.bearish || defaultConfig.bearish,
    neutral: userMarketColors.neutral || defaultConfig.neutral
  };
}

export default MARKET_COLOR_CONFIG;