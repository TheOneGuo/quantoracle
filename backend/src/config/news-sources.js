/**
 * @file 新闻数据源配置
 * @module config/news-sources
 *
 * 分为 RSS 和 JSON API 两类
 * enabled: true 表示当前可用，false 表示已知失效
 *
 * 最后更新：2026-03-14
 * 测试方式：node scripts/test-news-sources.js
 */

module.exports = {
  /**
   * RSS XML 格式数据源（英文财经为主）
   */
  RSS_SOURCES: [
    // ===== 美股/全球财经 =====
    {
      name: 'CNBC Markets',
      url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html',
      category: 'US',
      cacheTTL: 300, // 5分钟
      enabled: true,
      notes: '美股实时资讯，无需特殊请求头',
    },
    {
      name: 'MarketWatch',
      url: 'https://feeds.content.dowjones.io/public/rss/mw_realtimeheadlines',
      category: 'US',
      cacheTTL: 300,
      enabled: true,
      notes: 'Dow Jones官方RSS，实时财经头条',
    },
    {
      name: 'Yahoo Finance',
      url: 'https://finance.yahoo.com/rss/topstories',
      category: 'US',
      cacheTTL: 300,
      enabled: true,
      notes: 'Yahoo财经头条，全球覆盖',
    },
    {
      name: 'Yahoo Finance News',
      url: 'https://finance.yahoo.com/news/rssindex',
      category: 'US',
      cacheTTL: 300,
      enabled: true,
      notes: 'Yahoo财经新闻精选',
    },
    {
      name: 'Financial Times',
      url: 'https://www.ft.com/rss/home',
      category: 'GLOBAL',
      cacheTTL: 600,
      enabled: true,
      notes: '英国金融时报，全球宏观视角',
    },
    {
      name: 'Seeking Alpha',
      url: 'https://seekingalpha.com/feed.xml',
      category: 'US',
      cacheTTL: 600,
      enabled: true,
      notes: '股票分析深度文章',
    },

    // ===== 贵金属/大宗商品 =====
    {
      name: 'Mining.com Gold',
      url: 'https://www.mining.com/feed/',
      category: 'COMMODITY',
      cacheTTL: 600,
      enabled: false, // HTTP 403 从国内服务器访问被封锁
      notes: '矿业/黄金/大宗商品新闻，Kitco RSS失效后的替代源，需要海外IP',
    },

    // ===== 加密货币 =====
    {
      name: 'CoinDesk',
      url: 'https://www.coindesk.com/arc/outboundfeeds/rss/',
      category: 'CRYPTO',
      cacheTTL: 300,
      enabled: true,
    },
    {
      name: 'CoinTelegraph',
      url: 'https://cointelegraph.com/rss',
      category: 'CRYPTO',
      cacheTTL: 300,
      enabled: true,
    },

    // ===== 央行/宏观 =====
    {
      name: '美联储',
      url: 'https://www.federalreserve.gov/feeds/press_all.xml',
      category: 'MACRO',
      cacheTTL: 1800,
      enabled: true,
      notes: '美联储官方新闻稿，低频高权威',
    },
    {
      name: 'IMF',
      url: 'https://www.imf.org/en/News/rss?language=eng',
      category: 'MACRO',
      cacheTTL: 3600,
      enabled: false, // HTTP 403 从本服务器访问被封锁
    },

    // ===== 监管 =====
    {
      name: 'SEC Press',
      url: 'https://www.sec.gov/rss/news/press.xml',
      category: 'REGULATORY',
      cacheTTL: 1800,
      enabled: false, // HTTP 403 从本服务器访问被封锁
    },
  ],

  /**
   * JSON API 格式数据源（中文财经为主）
   * 说明：中文财经平台普遍废弃了RSS，改用JSON API
   */
  JSON_API_SOURCES: [
    {
      name: '同花顺财经',
      url: 'https://news.10jqka.com.cn/tapp/news/push/stock/?page=1&tag=&track=website&pagesize=20',
      category: 'CN',
      cacheTTL: 120, // 2分钟，时效性强
      enabled: true,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      parseFunc: 'parseTHS', // 解析函数标识
      useCurl: true, // Node.js HTTPS在此服务器ETIMEDOUT，需用curl或axios
      notes: '响应格式: {code, msg, data: {list: [{id, title, digest, ...}]}}，无时间戳字段，实时性强；HTTPS地址；建议用axios+4xx重试',
    },
    // 华尔街见闻 API - 返回空数据，疑似需要认证token，暂时禁用
    {
      name: '华尔街见闻API',
      url: 'https://api.wallstreetcn.com/apiv1/content/lives?channel=news-public&pageSize=20',
      category: 'CN',
      cacheTTL: 120,
      enabled: false, // items始终为空，需要登录态cookie
      headers: {
        'Origin': 'https://wallstreetcn.com',
        'Referer': 'https://wallstreetcn.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      parseFunc: 'parseWSCN',
      notes: '返回 {code:20000, data:{items:[]}} - items为空，需要有效用户cookie',
    },
    // 腾讯财经 - 返回空数据
    {
      name: '腾讯财经API',
      url: 'https://pacaio.match.qq.com/irs/rcd?cid=137&token=&page=1&expIds=',
      category: 'CN',
      cacheTTL: 300,
      enabled: false, // data为空数组
      headers: {},
      parseFunc: 'parseTencent',
      notes: '返回 {code:0, data:[]} - 需要有效token参数',
    },
  ],

  /**
   * 已确认失效的数据源（保留记录，方便将来更新）
   */
  DISABLED_SOURCES: [
    // ===== 新浪财经 =====
    { name: '新浪财经(mix)', url: 'https://feed.sina.com.cn/news/finance/mix.xml', reason: 'HTTP 404', testedAt: '2026-03-14' },
    { name: '新浪财经(finance1)', url: 'https://rss.sina.com.cn/news/china/finance1.xml', reason: 'HTTP 404', testedAt: '2026-03-14' },
    { name: '新浪财经(gncj)', url: 'https://rss.sina.com.cn/finance/gncj.d.rss', reason: 'HTTP 404', testedAt: '2026-03-14' },
    { name: '新浪财经(cj.d)', url: 'https://feed.sina.com.cn/news/finance/cj.d.xml', reason: 'HTTP 404', testedAt: '2026-03-14' },
    { name: '新浪财经(roll)', url: 'https://news.sina.com.cn/roll/finance.d.xml', reason: 'HTTP 404', testedAt: '2026-03-14' },

    // ===== 华尔街见闻 RSS =====
    { name: '华尔街见闻RSS', url: 'https://wallstreetcn.com/feed', reason: 'HTTP 404', testedAt: '2026-03-14' },
    { name: '华尔街见闻RSS/zh', url: 'https://wallstreetcn.com/rss/zh', reason: '返回HTML非RSS', testedAt: '2026-03-14' },
    { name: '华尔街见闻RSS/rss', url: 'https://wallstreetcn.com/rss', reason: '返回HTML非RSS', testedAt: '2026-03-14' },

    // ===== 腾讯财经 =====
    { name: '腾讯财经RSS', url: 'https://new.qq.com/rss/finance.xml', reason: 'HTTP 200但非RSS XML', testedAt: '2026-03-14' },

    // ===== Kitco Gold =====
    { name: 'Kitco Gold', url: 'https://www.kitco.com/rss/News.xml', reason: 'HTTP 404', testedAt: '2026-03-14' },
    { name: 'Kitco News', url: 'https://www.kitco.com/rss/kitco-news.xml', reason: 'HTTP 404', testedAt: '2026-03-14' },
    { name: 'Kitco Gold News', url: 'https://www.kitco.com/rss/gold-news.xml', reason: 'HTTP 404', testedAt: '2026-03-14' },
    { name: 'Kitco News(sub)', url: 'https://news.kitco.com/rss', reason: 'HTTP 404', testedAt: '2026-03-14' },

    // ===== 东方财富 =====
    { name: '东方财富API', url: 'https://np-cj.eastmoney.com/cj/get_gglist?type=0&page=1&pagesize=20', reason: 'HTTP 302 持续重定向，无实际数据', testedAt: '2026-03-14' },

    // ===== 财联社 =====
    { name: '财联社API', url: 'https://www.cls.cn/api/sw?app=web&terminal=web&action=articleList&category=&page=1&ctime=&count=20', reason: 'HTTP 405 Method Not Allowed (GET)，POST返回404', testedAt: '2026-03-14' },

    // ===== 雪球 =====
    { name: '雪球动态', url: 'https://xueqiu.com/v4/statuses/public_timeline_by_category.json?since_id=-1&max_id=-1&count=20&category=-1', reason: '需要有效xq_a_token cookie，游客无法访问', testedAt: '2026-03-14' },

    // ===== 金十数据 =====
    { name: '金十数据Flash', url: 'https://flash-api.jin10.com/get_flash_list?channel=all&vip=0', reason: '需要有效X-App-Id认证，连接失败', testedAt: '2026-03-14' },

    // ===== Reuters =====
    { name: 'Reuters Business', url: 'https://feeds.reuters.com/reuters/businessNews', reason: '连接超时', testedAt: '2026-03-14' },
  ],
};
