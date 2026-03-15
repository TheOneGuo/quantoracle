/**
 * @file Telegram公开频道新闻抓取服务（RSS优先版）
 * @module services/tg-news-fetcher
 *
 * 主方式：RSS（通过公共RSSHub实例，无需Bot Token）
 * 备用方式：Telegram Bot API（需配置TG_BOT_TOKEN，可选）
 *
 * RSS实例轮询顺序：
 *   1. rsshub.rssforever.com（默认主力）
 *   2. rsshub.app（备用，有限流风险）
 *   3. 其他环境变量配置的实例
 */

const https = require('https');
const http = require('http');

// ─────────────────────────────────────────────────────────
// 内存缓存（5分钟内同频道不重复拉取）
// ─────────────────────────────────────────────────────────

/** @type {Map<string, {ts: number, items: Array}>} */
const _rssCache = new Map();

/** 缓存有效期：5分钟 */
const CACHE_TTL_MS = 5 * 60 * 1000;

// ─────────────────────────────────────────────────────────
// RSSHub 实例列表
// 优先从环境变量读取（逗号分隔URL前缀），fallback 到默认顺序
// ─────────────────────────────────────────────────────────

/** 将URL前缀转换为完整路径模板 */
function buildRSSInstances() {
  if (process.env.RSS_HUB_INSTANCES) {
    return process.env.RSS_HUB_INSTANCES.split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .map(base => `${base}/telegram/channel/{channel}`);
  }
  // 默认实例列表（经测试可用的排在前面）
  return [
    'https://rsshub.rssforever.com/telegram/channel/{channel}',
    'https://rsshub.app/telegram/channel/{channel}',
  ];
}

// ─────────────────────────────────────────────────────────
// 内部工具
// ─────────────────────────────────────────────────────────

/**
 * 简单 HTTP GET，返回响应体字符串
 * @param {string} url
 * @param {number} [timeoutMs=10000]
 * @returns {Promise<string>}
 */
function httpGet(url, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { timeout: timeoutMs }, (res) => {
      // 跟随3xx重定向（最多1次）
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(httpGet(res.headers.location, timeoutMs));
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout: ${url}`)); });
  });
}

/**
 * 极简 RSS/Atom XML 解析（无外部依赖）
 * 提取 <item> 或 <entry> 节点的常用字段
 * @param {string} xml
 * @returns {Array<{title,link,description,pubDate,guid}>}
 */
function parseRSS(xml) {
  const items = [];
  // 匹配 <item> 或 <entry> 块
  const itemRe = /<(?:item|entry)>([\s\S]*?)<\/(?:item|entry)>/gi;
  let match;
  while ((match = itemRe.exec(xml)) !== null) {
    const block = match[1];
    const get = (tag) => {
      // 优先抓 CDATA，然后普通文本
      const re = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))<\\/${tag}>`, 'i');
      const m = block.match(re);
      if (!m) return '';
      return (m[1] || m[2] || '').trim();
    };
    // pubDate / updated
    const dateStr = get('pubDate') || get('updated') || get('dc:date');
    // link 可能是属性形式 <link href="..."/>
    let link = get('link');
    if (!link) {
      const hrefM = block.match(/<link[^>]+href="([^"]+)"/i);
      if (hrefM) link = hrefM[1];
    }
    items.push({
      title: get('title'),
      link,
      description: get('description') || get('content') || get('summary'),
      pubDate: dateStr ? new Date(dateStr) : new Date(),
      guid: get('guid') || get('id') || link,
    });
  }
  return items;
}

// ─────────────────────────────────────────────────────────
// 3.2 RSS 主要方式（多实例轮询）
// ─────────────────────────────────────────────────────────

/**
 * 通过公共 RSSHub 抓取 Telegram 公开频道（无需 Bot Token）
 * 按顺序尝试各实例，成功即停；全部失败返回空数组并记录日志。
 * 5分钟内对同一频道使用内存缓存，避免重复拉取。
 *
 * @param {string} channelUsername - 频道用户名（含或不含@均可，如 jin10light 或 @jin10light）
 * @returns {Promise<{items: Array<Object>, endpoint: string}>}
 */
async function fetchFromRSS(channelUsername) {
  // 去掉可能带的 @
  const name = channelUsername.replace(/^@/, '');

  // 检查内存缓存
  const cached = _rssCache.get(name);
  if (cached && (Date.now() - cached.ts) < CACHE_TTL_MS) {
    console.log(`[tg-news-fetcher] RSS缓存命中: ${name}，${cached.items.length} 条`);
    return { items: cached.items, endpoint: cached.endpoint, fromCache: true };
  }

  const instances = buildRSSInstances();
  const errors = [];

  for (const template of instances) {
    const url = template.replace('{channel}', name);
    try {
      console.log(`[tg-news-fetcher] 尝试RSS实例: ${url}`);
      const xml = await httpGet(url, 10000);

      // 检测是否为限流提示（rsshub.app 的纯文本提示）
      if (!xml.trim().startsWith('<') && xml.includes('restrict')) {
        throw new Error('RSS实例返回限流提示，非有效XML');
      }

      const items = parseRSS(xml);
      if (items.length > 0) {
        // 写入缓存
        _rssCache.set(name, { ts: Date.now(), items, endpoint: url });
        console.log(`[tg-news-fetcher] RSS成功: ${url}，获取 ${items.length} 条`);
        return { items, endpoint: url };
      }
      errors.push(`${url}: 解析到0条（可能频道不公开或格式异常）`);
    } catch (e) {
      errors.push(`${url}: ${e.message}`);
      console.warn(`[tg-news-fetcher] RSS实例失败: ${url} → ${e.message}`);
    }
  }

  // 全部失败，记录日志，返回空数组（不抛异常，避免中断整体轮询）
  console.error(`[tg-news-fetcher] 频道 ${name} 所有RSS端点均失败:\n  ${errors.join('\n  ')}`);
  return { items: [], endpoint: null, errors };
}

// ─────────────────────────────────────────────────────────
// 3.1 Bot API 方式（可选备用，需 TG_BOT_TOKEN）
// ─────────────────────────────────────────────────────────

/**
 * 通过 Telegram Bot API 的 getUpdates 接口拉取频道消息
 * 仅当环境变量 TG_BOT_TOKEN 已配置时有效。
 *
 * 注意：Bot需已加入目标频道，且会收到所有频道的 channel_post 事件。
 * 建议仅在 RSS 不可用时作为备选。
 *
 * @param {string} channelId - 频道username（含@）或数字ID
 * @param {number} [limit=20]
 * @param {number} [updateOffset=0] - getUpdates offset
 * @returns {Promise<{messages: Array, nextOffset: number}>}
 */
async function fetchFromBotAPI(channelId, limit = 20, updateOffset = 0) {
  const token = process.env.TG_BOT_TOKEN;
  if (!token) throw new Error('TG_BOT_TOKEN 未配置，Bot API不可用');

  const base = `https://api.telegram.org/bot${token}`;
  const url = `${base}/getUpdates?offset=${updateOffset}&limit=${limit}&timeout=0&allowed_updates=["channel_post","message"]`;

  let body;
  try {
    body = await httpGet(url, 10000);
  } catch (e) {
    throw new Error(`Bot API getUpdates 失败: ${e.message}`);
  }

  const resp = JSON.parse(body);
  if (!resp.ok) throw new Error(`Telegram API error: ${resp.description}`);

  const updates = resp.result || [];
  let nextOffset = updateOffset;

  const messages = [];
  for (const update of updates) {
    nextOffset = Math.max(nextOffset, update.update_id + 1);
    const msg = update.channel_post || update.message;
    if (!msg) continue;

    // 过滤指定频道（若传入了具体ID）
    if (channelId) {
      const chatId = String(msg.chat?.id || '');
      const chatUsername = msg.chat?.username ? `@${msg.chat.username}` : '';
      if (chatId !== String(channelId) && chatUsername !== channelId) continue;
    }

    // 只保留有文字内容的消息
    if (msg.text || msg.caption) {
      messages.push(msg);
    }
  }

  return { messages, nextOffset };
}

// ─────────────────────────────────────────────────────────
// 3.3 消息标准化
// ─────────────────────────────────────────────────────────

/**
 * 将 Telegram Bot API 消息标准化为 NewsItem
 * @param {Object} rawMsg  - Bot API Message 对象
 * @param {string} sourceAlias
 * @param {number} sourceWeight
 * @returns {NewsItem}
 */
function normalizeMessage(rawMsg, sourceAlias, sourceWeight) {
  return {
    id: null,
    raw_id: String(rawMsg.message_id || rawMsg.id || ''),
    source_key: sourceAlias,
    content: rawMsg.text || rawMsg.caption || '',
    url: rawMsg.link || null,
    published_at: rawMsg.date
      ? new Date(rawMsg.date * 1000).toISOString()
      : new Date().toISOString(),
    views: rawMsg.views || 0,
    source_weight: sourceWeight,
    score: null,
    category: null,
    dedup_hash: null,
  };
}

/**
 * 将 RSS 条目标准化为 NewsItem
 * @param {Object} item  - parseRSS 返回的条目
 * @param {string} sourceAlias
 * @param {number} sourceWeight
 * @returns {NewsItem}
 */
function normalizeRSSItem(item, sourceAlias, sourceWeight) {
  // 优先使用 description（含正文），title 作为补充，去除HTML标签
  const content = (item.description || item.title || '').replace(/<[^>]+>/g, '').trim();
  return {
    id: null,
    raw_id: item.guid || item.link || '',
    source_key: sourceAlias,
    content,
    url: item.link || null,
    published_at: item.pubDate instanceof Date
      ? item.pubDate.toISOString()
      : new Date().toISOString(),
    views: 0,
    source_weight: sourceWeight,
    score: null,
    category: null,
    dedup_hash: null,
  };
}

// ─────────────────────────────────────────────────────────
// 对外导出
// ─────────────────────────────────────────────────────────

module.exports = {
  fetchFromRSS,
  fetchFromBotAPI,
  normalizeMessage,
  normalizeRSSItem,
  // 内部工具也暴露，方便测试
  parseRSS,
  httpGet,
};
