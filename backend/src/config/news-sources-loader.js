/**
 * @file 新闻来源配置加载器
 * @module config/news-sources-loader
 *
 * 从环境变量加载新闻来源配置。
 * 真实频道信息仅存在于运行环境的 .env 文件中，不进入代码仓库。
 * 日志中使用别名，不暴露真实来源标识。
 */

/**
 * 加载所有已配置的新闻来源
 * @returns {Array<{id: string, alias: string, weight: number, key: string}>}
 */
function loadNewsSources() {
  const sources = [];
  for (let i = 1; i <= 8; i++) {
    const key = String(i).padStart(3, '0');
    const channelId = process.env[`NEWS_SRC_${key}`];
    if (channelId && channelId.trim()) {
      sources.push({
        id: channelId.trim(),                                            // 真实频道ID/username
        alias: process.env[`NEWS_SRC_${key}_ALIAS`] || `src-${key}`,   // 日志显示用别名
        weight: parseInt(process.env[`NEWS_SRC_${key}_WEIGHT`] || '3', 10),
        key: `src-${key}`,                                              // 代码内部引用key，不含真实ID
      });
    }
  }
  return sources;
}

module.exports = { loadNewsSources };
