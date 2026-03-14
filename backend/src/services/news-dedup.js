/**
 * @file 新闻去重服务
 * @module services/news-dedup
 *
 * 三层去重：
 * 1. 精确去重：MD5(content前200字) 查重
 * 2. 快速相似去重：关键词Jaccard相似度 > 0.7 视为重复（不引入向量库）
 * 3. 时间窗口去重：同股票代码30分钟内只保留最高分
 */

const crypto = require('crypto');

// ─────────────────────────────────────────────────────────
// 层1：精确哈希
// ─────────────────────────────────────────────────────────

/**
 * 计算内容去重hash（取前200字符的MD5）
 * @param {string} content
 * @returns {string}
 */
function computeHash(content) {
  return crypto
    .createHash('md5')
    .update(content.slice(0, 200).trim())
    .digest('hex');
}

// ─────────────────────────────────────────────────────────
// 层2：Jaccard 相似度
// ─────────────────────────────────────────────────────────

/**
 * 将文本分词为词集（按空白和中文标点分割）
 * @param {string} text
 * @returns {Set<string>}
 */
function tokenize(text) {
  // 按空格、中文标点、英文标点切分，过滤空词
  return new Set(
    text.split(/[\s，。；、！？,.;!?\n\r]+/).filter((w) => w.length > 0)
  );
}

/**
 * 计算两段文本的 Jaccard 相似度
 * @param {string} a
 * @param {string} b
 * @returns {number} 0-1
 */
function jaccardSimilarity(a, b) {
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  const intersection = [...setA].filter((x) => setB.has(x)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

// ─────────────────────────────────────────────────────────
// 层3：时间窗口去重辅助
// ─────────────────────────────────────────────────────────

const WINDOW_MS = 30 * 60 * 1000; // 30分钟

/**
 * 判断两条新闻是否在同一30分钟窗口内（按发布时间）
 * @param {string} dateA - ISO 8601
 * @param {string} dateB - ISO 8601
 * @returns {boolean}
 */
function inSameWindow(dateA, dateB) {
  return Math.abs(new Date(dateA) - new Date(dateB)) <= WINDOW_MS;
}

// ─────────────────────────────────────────────────────────
// 综合去重检查
// ─────────────────────────────────────────────────────────

/**
 * 检查新闻是否与已有新闻重复
 *
 * 检查顺序：
 *   1. 精确hash匹配 → 重复
 *   2. Jaccard ≥ 0.7 → 相似重复
 *   3. （调用方可根据 stock_codes 做时间窗口过滤，此处不查DB）
 *
 * @param {NewsItem} item           - 待检查新闻（dedup_hash 已计算）
 * @param {Array<NewsItem>} recentItems - 最近30分钟的已处理新闻
 * @returns {{isDuplicate: boolean, reason?: string, duplicateOf?: string}}
 */
function checkDuplicate(item, recentItems) {
  if (!Array.isArray(recentItems) || recentItems.length === 0) {
    return { isDuplicate: false };
  }

  for (const existing of recentItems) {
    // 层1：精确hash
    if (item.dedup_hash && existing.dedup_hash && item.dedup_hash === existing.dedup_hash) {
      return {
        isDuplicate: true,
        reason: 'exact_hash',
        duplicateOf: existing.raw_id || existing.id,
      };
    }

    // 层2：相似度（仅对30分钟内的新闻做Jaccard）
    if (
      item.published_at &&
      existing.published_at &&
      inSameWindow(item.published_at, existing.published_at)
    ) {
      const sim = jaccardSimilarity(item.content || '', existing.content || '');
      if (sim >= 0.7) {
        return {
          isDuplicate: true,
          reason: `jaccard_similarity:${sim.toFixed(2)}`,
          duplicateOf: existing.raw_id || existing.id,
        };
      }
    }
  }

  return { isDuplicate: false };
}

/**
 * 对一批新闻做批量去重（同批次内互相去重）
 * @param {Array<NewsItem>} items
 * @returns {Array<NewsItem>} 去重后（每项已附带 dedup_hash）
 */
function deduplicateBatch(items) {
  const seen = [];
  const result = [];

  for (const item of items) {
    item.dedup_hash = computeHash(item.content || '');
    const { isDuplicate } = checkDuplicate(item, seen);
    if (!isDuplicate) {
      seen.push(item);
      result.push(item);
    }
  }

  return result;
}

module.exports = {
  computeHash,
  jaccardSimilarity,
  checkDuplicate,
  deduplicateBatch,
  inSameWindow,
};
