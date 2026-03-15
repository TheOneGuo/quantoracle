/**
 * @file 新闻轮询管理器
 * @module services/news-poller
 *
 * 定时从各新闻源拉取消息，去重后分类入库，等待AI评分。
 * 使用 node-cron 调度（已有依赖）。
 *
 * 优先使用 Bot API，若 Bot API 失败则降级至 RSS。
 * 每个来源单独维护 updateOffset，存储在内存中（重启后从0开始）。
 */

const cron = require('node-cron');
const { loadNewsSources } = require('../config/news-sources-loader');
const { fetchFromBotAPI, fetchFromRSS, normalizeMessage, normalizeRSSItem } = require('./tg-news-fetcher');
const { computeHash, checkDuplicate, deduplicateBatch } = require('./news-dedup');
const { classifyNews } = require('./news-classifier');

class NewsPoller {
  /**
   * @param {import('../db').default} db - Database 实例
   */
  constructor(db) {
    this.db = db;
    this._cronTask = null;
    this._running = false;
    // 每个来源的 Bot API update offset（内存级）
    this._offsets = {};
  }

  // ─────────────────────────────────────────────────────
  // 调度控制
  // ─────────────────────────────────────────────────────

  /** 启动定时轮询（每2分钟） */
  start() {
    if (this._cronTask) {
      console.log('[NewsPoller] 已在运行，跳过重复启动');
      return;
    }
    console.log('[NewsPoller] 启动新闻轮询，间隔: 每2分钟');
    this._cronTask = cron.schedule('*/2 * * * *', async () => {
      if (this._running) {
        console.log('[NewsPoller] 上一轮尚未完成，跳过本次');
        return;
      }
      this._running = true;
      try {
        await this.pollAll();
      } catch (e) {
        console.error('[NewsPoller] pollAll 异常:', e.message);
      } finally {
        this._running = false;
      }
    });
  }

  /** 停止定时轮询 */
  stop() {
    if (this._cronTask) {
      this._cronTask.stop();
      this._cronTask = null;
      console.log('[NewsPoller] 已停止轮询');
    }
  }

  // ─────────────────────────────────────────────────────
  // 单次拉取全部来源
  // ─────────────────────────────────────────────────────

  /** 单次拉取所有配置来源 */
  async pollAll() {
    const sources = loadNewsSources();
    if (sources.length === 0) {
      console.log('[NewsPoller] 未配置任何新闻来源（NEWS_SRC_001~008）');
      return { total: 0, saved: 0, sources: 0 };
    }

    let totalSaved = 0;
    for (const source of sources) {
      try {
        const saved = await this.pollSource(source);
        totalSaved += saved;
      } catch (e) {
        console.error(`[NewsPoller] 来源 ${source.alias} 拉取失败: ${e.message}`);
      }
    }
    console.log(`[NewsPoller] 本轮完成，共入库 ${totalSaved} 条`);
    return { total: totalSaved, sources: sources.length };
  }

  // ─────────────────────────────────────────────────────
  // 单来源拉取（Bot API → RSS 降级）
  // ─────────────────────────────────────────────────────

  /**
   * 拉取单个来源，优先Bot API，失败则RSS
   * @param {{id: string, alias: string, weight: number, key: string}} source
   * @returns {Promise<number>} 实际入库数量
   */
  async pollSource(source) {
    let rawItems = [];
    let usedMethod = 'bot';

    // 尝试 Bot API
    try {
      const offset = this._offsets[source.key] || 0;
      const { messages, nextOffset } = await fetchFromBotAPI(source.id, 20, offset);
      this._offsets[source.key] = nextOffset;
      rawItems = messages.map((m) => normalizeMessage(m, source.alias, source.weight));
    } catch (botErr) {
      console.warn(`[NewsPoller][${source.alias}] Bot API失败，降级RSS: ${botErr.message}`);
      usedMethod = 'rss';
      // 降级RSS（仅当频道ID是username时可用）
      const username = source.id.replace(/^@/, '');
      if (/^-?\d+$/.test(username)) {
        // 纯数字ID，无法走RSS
        throw new Error('数字ID无法走RSS降级，请配置username');
      }
      const { items } = await fetchFromRSS(username);
      rawItems = items.map((item) => normalizeRSSItem(item, source.alias, source.weight));
    }

    if (rawItems.length === 0) return 0;

    // 批次内去重
    const deduped = deduplicateBatch(rawItems);
    console.log(`[NewsPoller][${source.alias}] ${usedMethod.toUpperCase()} 拉取 ${rawItems.length} 条，批次内去重后 ${deduped.length} 条`);

    // 入库
    let saved = 0;
    for (const item of deduped) {
      try {
        const n = await this._saveItem(item, source);
        saved += n;
      } catch (e) {
        console.error(`[NewsPoller][${source.alias}] 入库失败: ${e.message}`);
      }
    }
    return saved;
  }

  // ─────────────────────────────────────────────────────
  // 数据库操作
  // ─────────────────────────────────────────────────────

  /**
   * 将单条新闻写入 news_raw，若非重复则写入 news_processed
   * @returns {Promise<number>} 1=已入库处理表，0=重复跳过
   */
  async _saveItem(item, source) {
    const db = this.db.db; // 底层 sqlite3 实例

    // 查询DB中最近30分钟已处理新闻，用于跨批次去重
    const recentItems = await this._getRecentProcessed(30);
    const { isDuplicate, reason, duplicateOf } = checkDuplicate(item, recentItems);

    // 写入 news_raw（无论是否重复都记录）
    const rawId = await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO news_raw (source_key, raw_id, content, url, published_at, views, source_weight, dedup_hash, is_duplicate, duplicate_of)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          item.source_key,
          item.raw_id,
          item.content,
          item.url,
          item.published_at,
          item.views,
          item.source_weight,
          item.dedup_hash,
          isDuplicate ? 1 : 0,
          duplicateOf || null,
        ],
        function (err) {
          if (err) reject(err);
          else resolve(this.lastID);
        }
      );
    });

    if (isDuplicate) {
      console.log(`[NewsPoller][${source.alias}] 重复跳过 (${reason})`);
      // 记录去重日志（方便后续审计和调优）
      await new Promise((resolve) => {
        const method = reason && reason.startsWith('jaccard') ? 'jaccard' : 'exact_hash';
        const sim = method === 'jaccard' ? parseFloat(reason.split(':')[1] || '0') : null;
        db.run(
          `INSERT INTO news_dedup_log (content_hash, source_key, raw_id, content_preview, dedup_method, similarity_score, duplicate_of_raw_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [item.dedup_hash, item.source_key, item.raw_id, (item.content || '').slice(0, 100), method, sim, duplicateOf || null],
          () => resolve()
        );
      });
      return 0;
    }

    // 分类（规则引擎，含情绪和紧急程度）
    const { assetType, eventType, sentiment, urgency, stockCodes } = classifyNews(item.content);

    // 写入 news_processed（含新增的 sentiment / urgency / channel_type 字段）
    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO news_processed (raw_id, content, url, published_at, source_key, source_weight, asset_type, event_type, stock_codes, sentiment, urgency, channel_type, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [
          rawId,
          item.content,
          item.url,
          item.published_at,
          item.source_key,
          item.source_weight,
          assetType,
          eventType,
          JSON.stringify(stockCodes),
          sentiment,
          urgency,
          source.channelType || 'general',
        ],
        function (err) {
          if (err) reject(err);
          else resolve(this.lastID);
        }
      );
    });

    return 1;
  }

  /**
   * 查询最近N分钟内已处理新闻（用于跨批次去重）
   * @param {number} minutes
   * @returns {Promise<Array>}
   */
  _getRecentProcessed(minutes) {
    const db = this.db.db;
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT id, content, published_at, dedup_hash, raw_id
         FROM news_raw
         WHERE datetime(created_at) > datetime('now', ?)
           AND is_duplicate = 0`,
        [`-${minutes} minutes`],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });
  }
}

module.exports = NewsPoller;
