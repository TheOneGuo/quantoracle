/**
 * @file Telegram公开频道新闻抓取服务
 * @module services/tg-news-fetcher
 *
 * 主方式：Telegram Bot API getChatHistory（Bot需已加入频道）
 * 备用方式：RSS（通过公共RSSHub实例，无需Bot Token）
 */

const https = require('https');
const http = require('http');

// ─────────────────────────────────────────────────────────
// 内部工具
// ─────────────────────────────────────────────────────────

/**
 * 简单 HTTP GET，返回响应体字符串
 * @param {string} url
 * @param {number} [timeoutMs=8000]
 * @returns {Promise<string>}
 */
function httpGet(url, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { timeout: timeoutMs }, (res) => {
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
// 3.3 消息标准化
// ─────────────────────────────────────────────────────────

/**
 * 将Telegram Bot API 消息标准化为 NewsItem
 * @param {Object} rawMsg  - Bot API Message 对象
 * @param {string} sourceAlias
 * @param {number} sourceWeight
 * @returns {NewsItem}
 */
function normalizeMessage(rawMsg, sourceAlias, sourceWeight) {
  return {
    id: null,
    raw_id: String(rawMsg.message_id || rawMsg.id || ''),
    source_key: sourceAlias,                          // 别名，不存真实频道ID
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
  // 优先使用 description（含正文），title 作为补充
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
// 3.1 Bot API 方式（主）
// ─────────────────────────────────────────────────────────

/**
 * 从Telegram公开频道/群组抓取最新消息（Bot必须已是成员）
 *
 * Telegram Bot API 无「getHistory」端点；
 * 实践上使用 forwardMessages（Bot 转发消息给自己）或
 * 通过 getUpdates 被动接收频道推送。
 *
 * 此函数采用「copyMessage 探测 + getUpdates 滚动」策略：
 *  - 若 offsetId = 0，通过 getUpdates 拿最新批次
 *  - 若 offsetId > 0，使用 allowed_updates + offset 继续
 *
 * 注意：对于纯公开频道，Bot 加入后会在 getUpdates 中收到
 * channel_post 事件，这是最可靠的实时方式。
 *
 * @param {string} channelId - 频道username（含@）或数字ID（如 -100xxx）
 * @param {number} limit
 * @param {number} updateOffset - getUpdates offset（非消息ID）
 * @returns {Promise<{messages: Array<NewsItem>, nextOffset: number}>}
 */
async function fetchFromBotAPI(channelId, limit = 20, updateOffset = 0) {
  const token = process.env.TG_BOT_TOKEN;
  if (!token) throw new Error('TG_BOT_TOKEN 未配置');

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
// 3.2 RSS 备用方式
// ─────────────────────────────────────────────────────────

/** 公共 RSSHub 实例列表（按优先级排序，支持 {channel} 占位符）
 * 优先从环境变量 RSS_HUB_INSTANCES 读取（逗号分隔）
 * fallback 到硬编码顺序：tg.i-c-a.su 排第一（Financial_Express 仅此可用）
 */
const RSS_INSTANCES = process.env.RSS_HUB_INSTANCES
  ? process.env.RSS_HUB_INSTANCES.split(',')
  : [
      'https://tg.i-c-a.su/rss/{channel}',
      'https://rsshub.rssforever.com/telegram/channel/{channel}',
      'https://rsshub.app/telegram/channel/{channel}',
    ];

/**
 * 通过公共 RSSHub 抓取 Telegram 公开频道（无需 Bot Token）
 * 逐个尝试，返回第一个成功的结果
 *
 * @param {string} channelUsername - 不含@的频道用户名（如 caixin）
 * @returns {Promise<Array<Object>>} 原始 RSS 条目
 */
async function fetchFromRSS(channelUsername) {
  // 去掉可能带的 @
  const name = channelUsername.replace(/^@/, '');
  const errors = [];

  for (const instance of RSS_INSTANCES) {
    const url = instance.replace('{channel}', name);
    try {
      const xml = await httpGet(url, 10000);
      const items = parseRSS(xml);
      if (items.length > 0) {
        return { items, endpoint: url };
      }
    } catch (e) {
      errors.push(`${url}: ${e.message}`);
    }
  }

  throw new Error(`所有RSS端点均失败: ${errors.join(' | ')}`);
}

// ─────────────────────────────────────────────────────────
// 对外导出
// ─────────────────────────────────────────────────────────

module.exports = {
  fetchFromBotAPI,
  fetchFromRSS,
  normalizeMessage,
  normalizeRSSItem,
  // 内部工具也暴露，方便测试
  parseRSS,
  httpGet,
};
