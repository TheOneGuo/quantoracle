# 新闻数据管道基准测试报告

> 测试时间：2026-03-14 12:32
> 环境：QuantOracle 生产服务器（中国大陆）

---

## 一、新闻源可达性测试结果

| 名称 | 类别 | 状态 | 响应时间 | 最新新闻 | 备注 |
|------|------|------|----------|----------|------|
| CoinTelegraph | CRYPTO | ✅ 可用 | 119ms | 3小时前 | 最快 |
| Yahoo Finance | US | ✅ 可用 | 205ms | 1分钟前 | 时效性最佳 |
| CNBC Markets | US | ✅ 可用 | 338ms | 4小时前 | 稳定 |
| 美联储 | MACRO | ✅ 可用 | 446ms | — | 官方 |
| MarketWatch | US | ✅ 可用 | 922ms | 275天前 | 数据陈旧 |
| Seeking Alpha | US | ✅ 可用 | 2108ms | 3分钟前 | 最慢 |
| 腾讯财经 | CN | ⚠️ 异常 | — | — | 200但非XML |
| Financial Times | GLOBAL | ❌ 不可用 | — | — | 重定向失败(HTTPS) |
| CoinDesk | CRYPTO | ❌ 不可用 | — | — | 308重定向失败 |
| IMF | MACRO | 🔒 封锁 | — | — | 403 Forbidden |
| SEC Press | REGULATORY | 🔒 封锁 | — | — | 403 Forbidden |
| 新浪财经 | CN | ❌ 不可用 | — | — | 404 URL已失效 |
| 华尔街见闻 | CN | ❌ 不可用 | — | — | 404 URL已失效 |
| Kitco Gold | COMMODITY | ❌ 不可用 | — | — | 404 URL已失效 |

### 汇总

| 指标 | 数值 |
|------|------|
| 可用源 | 6 / 14（43%） |
| 平均延迟 | 690ms |
| 最快源 | CoinTelegraph（119ms） |
| 最慢源 | Seeking Alpha（2108ms） |

---

## 二、推荐新闻源优先级

基于响应速度 + 时效性综合评分：

| 优先级 | 源 | 理由 |
|--------|-----|------|
| 🥇 1 | Yahoo Finance | 速度快(205ms)、时效性最佳(1分钟前) |
| 🥈 2 | CoinTelegraph | 最快(119ms)、加密市场全覆盖 |
| 🥉 3 | CNBC Markets | 稳定、综合财经覆盖 |
| 4 | 美联储 | 权威宏观政策信号 |
| 5 | Seeking Alpha | 时效性好但速度慢，适合非实时场景 |

### 待修复源（需更新URL）

- **新浪财经**：URL已失效，建议改用 `https://rss.sina.com.cn/roll/finance/gnss/index.d.1.rss`
- **华尔街见闻**：建议使用官方API或其他聚合源
- **Kitco Gold**：建议改用 `https://www.kitco.com/rss/`
- **CoinDesk**：需跟随308重定向，建议更新URL
- **FT / IMF / SEC**：需配置反爬头或使用付费API

---

## 三、StepFun step-3.5-flash:free 分析速度基准

> ⚠️ 注意：本次测试未能获取真实数据，因 `OPENROUTER_API_KEY` 未配置

### 预估基准数据（基于OpenRouter free tier典型性能）

| 指标 | 预估值 |
|------|--------|
| 首Token延迟 | 800 ~ 1500ms |
| 总响应时间 | 2000 ~ 4000ms |
| 输出tokens/次 | 80 ~ 120 |
| 并发限制 | free tier约3 RPM |

### 真实测试命令

```bash
OPENROUTER_API_KEY=your_key node scripts/test-stepfun-analysis.js
```

---

## 四、综合建议

### 新闻抓取策略

| 场景 | 推荐源 | 抓取频率 |
|------|--------|----------|
| 实时监控（<5分钟） | Yahoo Finance、CoinTelegraph | 每5分钟 |
| 定时批量（每小时） | + CNBC Markets、Seeking Alpha | 每60分钟 |
| 宏观政策监控 | 美联储（较低频率） | 每4小时 |

### StepFun 使用建议

基于free tier的预估延迟（首token ~1s，总响应 ~3s）：

- **适合**：批量新闻定时分析（非实时）、每小时处理积压新闻
- **不适合**：毫秒级实时预警（延迟过高）
- **建议**：生产环境升级至付费tier，可降至 首token <500ms

### 成本估算

| 场景 | 每日调用量 | 预估成本（付费tier） |
|------|------------|---------------------|
| 基础监控（6源×12次/天） | ~72次 | ~$0.01 |
| 完整覆盖（14源×24次/天） | ~336次 | ~$0.05 |

---

## 五、问题记录

1. **OPENROUTER_API_KEY 未配置**：StepFun真实测试无法执行，需在 `/tmp/quantoracle/backend/.env` 配置
2. **中文财经RSS大量失效**：新浪/腾讯/华尔街见闻的RSS URL均已更改，需更新
3. **SEC/IMF封锁**：政府机构源封锁来自中国的IP，需走代理或使用API替代
4. **服务器网络限制**：部分海外源（FT等）重定向处理存在问题，建议增加redirect跟随逻辑
