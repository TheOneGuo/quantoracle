# 新闻数据管道基准测试报告

> 最后更新：2026-03-14 12:45 CST
> 测试环境：Linux (阿里云 iZ0joezeoknnd7zq4s73yxZ)，Node.js v22.22.1

## 测试概况

| 项目 | 值 |
|------|-----|
| 总测试源数 | 13 (12 RSS + 1 JSON API) |
| 可用源数 | **10** |
| 不可用源数 | 3 (IP封锁) |
| 中文源可用 | 1（同花顺 JSON API） |
| 英文源可用 | 9（RSS） |
| 平均延迟 | 647ms |
| 最快源 | Yahoo Finance News (50ms) |
| 最慢源 | 同花顺财经 (2244ms, curl) |

---

## ✅ 可用数据源详情

### RSS 格式（英文）

| 源名称 | URL | 分类 | 延迟 | 最新内容时间 | 备注 |
|--------|-----|------|------|-------------|------|
| CNBC Markets | `https://www.cnbc.com/id/100003114/device/rss/rss.html` | US | ~340ms | 4小时前 | 稳定，无需特殊头 |
| MarketWatch | `https://feeds.content.dowjones.io/public/rss/mw_realtimeheadlines` | US | ~1600ms | -（pubDate异常） | Dow Jones官方，内容实时 |
| **Yahoo Finance** | `https://finance.yahoo.com/rss/topstories` | US | ~172ms | **5分钟前** | 推荐，实时性最佳 |
| **Yahoo Finance News** | `https://finance.yahoo.com/news/rssindex` | US | **50ms** | **4分钟前** | **最快+最新，首选** |
| Financial Times | `https://www.ft.com/rss/home/international` | GLOBAL | ~529ms | 4小时前 | 需跟随301重定向 |
| Seeking Alpha | `https://seekingalpha.com/feed.xml` | US | ~846ms | 13分钟前 | 分析深度好 |
| CoinDesk | `https://www.coindesk.com/arc/outboundfeeds/rss` | CRYPTO | ~153ms | 1小时前 | 需跟随308重定向 |
| CoinTelegraph | `https://cointelegraph.com/rss` | CRYPTO | ~138ms | 3小时前 | 稳定 |
| 美联储 | `https://www.federalreserve.gov/feeds/press_all.xml` | MACRO | ~394ms | N/A | 低频高权威 |

### JSON API 格式（中文）

| 源名称 | URL | 分类 | 延迟 | 数据格式 | 特殊要求 |
|--------|-----|------|------|---------|---------|
| **同花顺财经** | `https://news.10jqka.com.cn/tapp/news/push/stock/?page=1&tag=&track=website&pagesize=20` | CN | ~2244ms | JSON `{code, data:{list}}` | 需curl或特定HTTP客户端，Node.js直连ETIMEDOUT |

---

## ❌ 不可用源 - 此轮新测结果

### 服务器IP封锁（403）
| 源 | URL | 原因 |
|----|-----|------|
| Mining.com Gold | `https://www.mining.com/feed/` | HTTP 403（国内IP被封锁，需海外代理） |
| IMF | `https://www.imf.org/en/News/rss?language=eng` | HTTP 403（IP封锁） |
| SEC Press | `https://www.sec.gov/rss/news/press.xml` | HTTP 403（IP封锁） |

### 彻底失效的旧URL

| 源 | 旧URL | 状态 | 测试日期 |
|----|-------|------|---------|
| 新浪财经 | `https://feed.sina.com.cn/news/finance/mix.xml` | 404 | 2026-03-14 |
| 新浪财经(所有备选) | `rss.sina.com.cn/*` | 404 | 2026-03-14 |
| 华尔街见闻RSS | `https://wallstreetcn.com/feed` | 404 | 2026-03-14 |
| 华尔街见闻API | `https://api.wallstreetcn.com/apiv1/content/lives` | 200 但items为空（需cookie） | 2026-03-14 |
| 腾讯财经RSS | `https://new.qq.com/rss/finance.xml` | 200 但非RSS XML | 2026-03-14 |
| 腾讯财经API | `https://pacaio.match.qq.com/irs/rcd?cid=137` | 200 但data为空（需token） | 2026-03-14 |
| Kitco Gold（所有路径） | `https://www.kitco.com/rss/*` | 404 | 2026-03-14 |
| 东方财富 | `https://np-cj.eastmoney.com/cj/get_gglist` | 302循环重定向 | 2026-03-14 |
| 财联社 | `https://www.cls.cn/api/sw?...` | 405 Method Not Allowed | 2026-03-14 |
| 雪球 | `https://xueqiu.com/v4/statuses/...` | 需xq_a_token cookie | 2026-03-14 |
| 金十数据 | `https://flash-api.jin10.com/get_flash_list` | 需认证App-Id，连接失败 | 2026-03-14 |
| Reuters | `https://feeds.reuters.com/reuters/businessNews` | 连接超时 | 2026-03-14 |

---

## 🏗️ 推荐实时数据流方案

### 方案一：混合拉取（推荐，当前可实现）

```
┌─────────────────────────────────────────────────────┐
│  QuantOracle 新闻聚合管道                             │
├─────────────────────────────────────────────────────┤
│  英文RSS（每5分钟轮询）                               │
│  ├── Yahoo Finance News（50ms，最快）                  │
│  ├── CNBC Markets（340ms）                            │
│  ├── CoinDesk / CoinTelegraph（加密）                  │
│  └── Financial Times / Seeking Alpha（深度）           │
│                                                     │
│  中文JSON（每2分钟轮询，curl方式）                     │
│  └── 同花顺财经（实时财经快讯）                        │
│                                                     │
│  低频权威源（每30分钟）                               │
│  └── 美联储（监管/政策）                              │
└─────────────────────────────────────────────────────┘
```

### 方案二：WebSocket/SSE 实时推送（高级，待接入）

- **华尔街见闻** - 支持WebSocket，需用户认证token
- **财联社** - 有内部WS接口，需逆向或合作
- **同花顺** - 移动端有长连接推送

### 方案三：第三方新闻聚合API

| 服务 | 优点 | 缺点 |
|------|------|------|
| [NewsAPI.org](https://newsapi.org) | 覆盖广，有中文源 | 免费版100次/天 |
| [RapidAPI Finance](https://rapidapi.com) | 多种金融新闻API | 收费 |
| [Alpha Vantage News](https://www.alphavantage.co) | 含情感分析 | API Key，限速 |

---

## 📝 已修复内容（2026-03-14）

1. **新浪财经** → 所有RSS备选URL均404，无可用替代（新浪已全面关闭RSS服务）
2. **华尔街见闻** → RSS下线，API需登录cookie，暂标记为disabled
3. **腾讯财经** → RSS失效，API需token，暂标记为disabled
4. **Kitco Gold** → 所有RSS路径404，替换为 Mining.com（但国内IP 403，需代理）
5. **新增同花顺财经** → JSON API可用，已接入，需curl方式获取
6. **Financial Times** → URL修正为 `/rss/home/international`（原URL 301重定向）
7. **CoinDesk** → URL修正（去掉末尾斜杠）解决308重定向问题

---

## 🔧 运行测试

```bash
cd /tmp/quantoracle
node scripts/test-news-sources.js
```

配置文件：`backend/src/config/news-sources.js`
