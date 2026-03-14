# 智盈云 QuantOracle — 产品需求文档 (PRD v1.0)

**版本**: 1.0  
**日期**: 2026-03-13  
**作者**: 如来佛祖（主控Agent）  
**状态**: 开发中  

---

## 一、产品愿景

> 智盈云是一个 AI 驱动的量化投资全栈平台，帮助个人投资者用机构级工具做选股、择时、回测和策略管理；同时提供策略广场，让优秀策略创作者通过销售策略获得收益，平台从中抽佣，构建双边生态。

**核心闭环**：
```
选股 → 择时 → 回测验证 → 实盘执行 → 绩效追踪 → 策略发布 → 广场销售
```

---

## 二、目标用户

| 用户类型 | 描述 | 核心诉求 |
|----------|------|----------|
| 散户投资者 | 有一定投资经验，缺乏量化工具 | 找到好股票，知道什么时候买卖 |
| 策略创作者 | 有量化经验，想变现自己的策略 | 发布策略赚佣金 |
| 策略购买者 | 信任他人策略，想跟单 | 找到经过验证的好策略 |

---

## 三、核心功能模块

### 3.1 智能选股引擎（HotStockAnalysis 升级版）

**现状**：HotStockAnalysis 使用模拟数据展示10只候选股  
**目标**：接入 TradingAgents 多智能体框架，实现 AI 驱动的多维度选股

#### 3.1.1 TradingAgents 多智能体架构

```
用户请求选股
    ↓
┌─────────────────────────────────────────────┐
│           TradingAgents 核心层               │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌──────┐  │
│  │基本面  │ │技术面  │ │情绪面  │ │新闻  │  │
│  │Agent   │ │Agent   │ │Agent   │ │Agent │  │
│  └────┬───┘ └────┬───┘ └────┬───┘ └──┬───┘  │
│       └──────────┴──────────┴─────────┘      │
│                    ↓                         │
│         研究员辩论（Bull vs Bear）            │
│                    ↓                         │
│         投资组合经理（最终决策）              │
└─────────────────────────────────────────────┘
    ↓
候选股票列表（含置信度 + 理由）
    ↓
Kronos 择时分析（开仓/平仓信号）
    ↓
最终推荐（可选：提交回测验证）
```

#### 3.1.2 支持市场

| 市场 | 数据源 | 股票代码格式 | 状态 |
|------|--------|------------|------|
| A股 | 新浪财经 / 东方财富 | sh600519 / sz000001 | 已有基础 |
| 美股 | Yahoo Finance / Alpha Vantage | AAPL / TSLA | 待接入 |
| 港股 | 新浪港股 / AkShare | 00700.HK | 待接入 |

#### 3.1.3 LLM 配置（Qwen2.5:9B on Mac Mini M4）

```python
# LLM 调用链路：
# QuantOracle 后端 → Qwen2.5:9B Ollama API (Mac Mini :11434)
# 备用：OpenRouter DeepSeek-V3（云端兜底）

LLM_CONFIG = {
    "primary": {
        "provider": "ollama",
        "model": "qwen2.5:9b",
        "base_url": "http://MAC_MINI_IP:11434",  # 内网/VPN访问
        "timeout": 60
    },
    "fallback": {
        "provider": "openrouter",
        "model": "deepseek/deepseek-v3.2",
        "api_key": "from_env"
    }
}
```

#### 3.1.4 选股维度

| 维度 | 分析内容 | 权重 |
|------|----------|------|
| 基本面 | PE/PB/ROE/利润增速/负债率 | 30% |
| 技术面 | MACD/RSI/均线/量能/形态 | 25% |
| 情绪面 | 北向资金/融资余额/龙虎榜 | 20% |
| 新闻面 | 公司公告/行业政策/新闻事件 | 15% |
| 地缘政治 | 宏观事件对行业的影响（可开关） | 10% |

---

### 3.2 Kronos 择时引擎

**职责**：在候选股票上，用 Kronos K线大模型预测最佳开仓和平仓时机

#### 3.2.1 调用流程

```
候选股票（来自 TradingAgents）
    ↓
获取历史 OHLCV 数据（240根K线，约1年）
    ↓
Kronos 预测（Kronos-base on Mac Mini M4 MPS）
    ↓
输出：{
    trend: "bullish/bearish/neutral",
    confidence: 0.0-1.0,
    entry_signal: true/false,
    exit_signal: true/false,
    forecast_klines: [...],  // 未来20根预测K线
    analysis: "文字分析"
}
    ↓
结合 TradingAgents 置信度，综合评分
    ↓
最终建议：立即买入 / 等待 / 不建议
```

#### 3.2.2 开仓/平仓逻辑

```
开仓信号 = TradingAgents置信度 > 0.6 AND Kronos趋势 = bullish AND Kronos置信度 > 0.5
平仓信号 = Kronos趋势 = bearish AND Kronos置信度 > 0.65
        OR 持仓亏损 > 用户止损线
        OR 持仓盈利 > 用户止盈线
```

---

### 3.3 回测引擎

**工具**：QuantConnect Lean（Docker 容器运行）  
**数据**：A股用东方财富历史数据 → 转换为 Lean 格式；美股用 Lean 原生数据

#### 3.3.1 回测参数

```python
BACKTEST_CONFIG = {
    "start_date": "2020-01-01",      # 可自定义
    "end_date": "今天",               # 可自定义
    "initial_capital": 100_000,       # 初始资金（可配置）
    "commission_rate": 0.0003,        # A股佣金（万三）
    "stamp_tax": 0.0005,              # A股印花税（卖出）
    "slippage": 0.001,                # 滑点估算
}
```

#### 3.3.2 回测输出指标

| 指标 | 描述 |
|------|------|
| 年化收益率 | 策略年化回报 |
| 最大回撤 | 峰值到谷值最大跌幅 |
| 夏普比率 | 风险调整后收益 |
| 胜率 | 盈利交易次数/总交易次数 |
| 盈亏比 | 平均盈利/平均亏损 |
| 卡玛比率 | 年化收益/最大回撤 |
| 基准对比 | 相对沪深300/标普500超额收益 |

#### 3.3.3 回测可视化

- 净值曲线（策略 vs 基准）
- 月度收益热力图
- 持仓分布图
- 买卖点标记（在K线图上）

---

### 3.4 新闻因子模块（可插拔）

**默认状态**：关闭  
**触发方式**：手动开启 或 自动触发（检测到关键词：战争/制裁/危机/...）

#### 3.4.1 知识库（RAG）设计

```
事件类型库（结构化）：
├── 地缘冲突
│   ├── 战争爆发 → 受益：军工/黄金/石油；受损：消费/旅游/航空
│   ├── 制裁措施 → 受益：替代品供应商；受损：被制裁行业
│   └── 地区紧张 → 受益：避险资产；受损：风险资产
├── 宏观政策
│   ├── 美联储加息/降息 → 影响：全球流动性
│   ├── 中国财政政策 → 影响：A股相关板块
│   ├── 关税政策（中美欧日韩）→ 影响：进出口相关股
│   └── 产业政策 → 影响：受扶持/受限行业
├── 自然灾害
│   ├── 地震/洪水 → 受益：建材/救援；受损：当地企业
│   └── 疫情 → 受益：医药/线上；受损：线下消费
└── 金融市场事件
    ├── 金融危机 → 全面风险规避
    └── 汇率异动 → 影响：出口/进口企业
```

**第一期**：规则引擎（人工配置映射关系）  
**第二期**：向量数据库（ChromaDB/Milvus）存储历史事件案例，LLM 检索增强

---

### 3.5 策略广场（核心商业模式）

**定位**：量化策略的 AppStore

#### 3.5.1 核心功能

| 功能 | 描述 |
|------|------|
| 策略发布 | 策略创作者上传策略（代码 + 回测报告） |
| 策略展示 | 展示回测指标、实盘跟踪盈亏 |
| 策略购买 | 用户付费订阅策略信号 |
| 策略跟踪 | 记录购买用户的实际盈亏 |
| 排行榜 | 按收益/夏普/信用评级排名 |
| 抽佣机制 | 平台抽取策略收入的 20%（可配置） |

#### 3.5.2 策略卡片展示

```
┌────────────────────────────────────┐
│  🏆 量化动量策略 v2.1              │
│  作者：@quantmaster ⭐ 4.8         │
├────────────────────────────────────┤
│  回测数据（2020-2024）             │
│  年化收益: +32.5%  夏普: 1.85     │
│  最大回撤: -12.3%  胜率: 68%      │
├────────────────────────────────────┤
│  实盘跟踪（近90天）                │
│  126位用户 · 平均盈利 +¥23,450    │
│  盈利用户占比: 78%                 │
├────────────────────────────────────┤
│  适用市场: A股  风险等级: ★★★☆☆  │
│  订阅费: ¥299/月                   │
│  [免费试用7天]  [立即订阅]         │
└────────────────────────────────────┘
```

#### 3.5.3 收费模式

| 收费类型 | 说明 | 平台抽佣 |
|----------|------|---------|
| 月度订阅 | 用户按月付费获取信号 | 20% |
| 年度订阅 | 年付享折扣 | 18% |
| 按信号付费 | 每条交易信号单独收费 | 25% |
| 策略授权 | 一次性买断策略代码 | 30% |
| 跟单分润 | 按实际盈利比例分成（高端功能） | 15% of 20% |

#### 3.5.4 策略审核机制

```
创作者提交策略
    ↓
自动审核（代码安全扫描 + 回测数据验证）
    ↓
AI 审核（如来佛祖审核合规性 + 逻辑合理性）
    ↓
沙盒运行30天（纸交易验证）
    ↓
发布到广场
    ↓
持续监控（实盘表现 vs 回测预期，偏差过大则下架警告）
```

#### 3.5.5 信用评级体系

| 评级 | 条件 |
|------|------|
| S 级 | 年化>30%，夏普>2，实盘用户盈利>80%，运行>1年 |
| A 级 | 年化>20%，夏普>1.5，实盘用户盈利>70% |
| B 级 | 年化>10%，夏普>1，实盘用户盈利>60% |
| C 级 | 新上架，数据不足 |
| D 级 | 实盘表现严重偏离回测，警告状态 |

---

## 四、技术架构

```
┌─────────────────────────────────────────────────────────────┐
│                    用户层（浏览器/App）                      │
│         React前端  +  WebSocket实时推送                     │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTP / WebSocket
┌──────────────────────────▼──────────────────────────────────┐
│                  API 网关层（Node.js :3001）                 │
│   路由 / 鉴权 / 限流 / 缓存 / 日志                          │
└────┬──────────────┬──────────────┬───────────────┬──────────┘
     │              │              │               │
┌────▼────┐  ┌──────▼──────┐ ┌────▼────┐  ┌──────▼──────┐
│选股引擎  │  │ 回测引擎    │ │策略广场  │  │ 数据服务   │
│(Python) │  │(Lean Docker)│ │(Node.js)│  │(Python)    │
│TradingA │  │             │ │SQLite   │  │新浪/东财   │
│gents    │  │ :5000       │ │+ 用户DB │  │AkShare     │
│:8765    │  └─────────────┘ └─────────┘  └─────────────┘
└────┬────┘
     │
┌────▼──────────────────────────────────────────┐
│              Mac Mini M4（私有AI服务器）        │
│  Qwen2.5:9B (Ollama :11434)                   │
│  Kronos-base (FastAPI :8888)                  │
└───────────────────────────────────────────────┘
```

### 4.1 数据库设计

```sql
-- 策略表
CREATE TABLE strategies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    creator_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    code TEXT,                      -- 策略代码（加密存储）
    market TEXT,                     -- A股/美股/港股
    style TEXT,                      -- conservative/neutral/aggressive
    backtest_metrics JSON,           -- 回测指标（JSON）
    live_metrics JSON,               -- 实盘指标（JSON，定期更新）
    grade TEXT DEFAULT 'C',          -- S/A/B/C/D
    price_monthly REAL,              -- 月度订阅价
    price_yearly REAL,               -- 年度订阅价
    commission_rate REAL DEFAULT 0.2,-- 平台抽佣率
    status TEXT DEFAULT 'pending',   -- pending/active/warning/delisted
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 订阅表
CREATE TABLE subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    strategy_id INTEGER NOT NULL,
    plan TEXT NOT NULL,              -- monthly/yearly/per_signal
    start_date DATE NOT NULL,
    end_date DATE,
    amount_paid REAL,
    platform_fee REAL,              -- 平台抽佣金额
    creator_revenue REAL,           -- 创作者收入
    FOREIGN KEY (strategy_id) REFERENCES strategies(id)
);

-- 实盘跟踪表（记录购买用户的实际盈亏）
CREATE TABLE live_tracking (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subscription_id INTEGER NOT NULL,
    signal_id TEXT,                  -- 对应的交易信号ID
    action TEXT,                     -- buy/sell
    code TEXT,                       -- 股票代码
    price REAL,                      -- 执行价格
    quantity INTEGER,
    pnl REAL,                        -- 该笔盈亏
    pnl_percent REAL,               -- 盈亏比例
    executed_at DATETIME,
    FOREIGN KEY (subscription_id) REFERENCES subscriptions(id)
);

-- 用户表
CREATE TABLE users (
    id TEXT PRIMARY KEY,             -- UUID
    username TEXT UNIQUE NOT NULL,
    role TEXT DEFAULT 'investor',    -- investor/creator/admin
    balance REAL DEFAULT 0,          -- 平台余额
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## 五、开发阶段规划

### 第一期（P0，当前冲刺）：AI选股 + Kronos择时集成

**工期估计**：2周

| 任务 | 优先级 | 负责 |
|------|--------|------|
| TradingAgents Python 服务封装（:8765） | P0 | 悟空 |
| 接入 Qwen2.5:9B（Ollama API，带 fallback） | P0 | 悟空 |
| A股选股流程：基本面+技术面+新闻（初版） | P0 | 悟空 |
| Kronos 服务集成（Mac Mini MPS，开仓/平仓信号） | P0 | 悟空 |
| HotStockAnalysis 前端升级（显示AI分析 + Kronos信号） | P0 | 悟空 |
| 后端路由：/api/ai/screen + /api/kronos/predict | P0 | 悟空 |
| 新闻因子规则引擎（初版，规则表驱动） | P1 | 悟空 |

### 第二期（P1）：回测引擎 + 策略管理

**工期估计**：3周

| 任务 | 优先级 |
|------|--------|
| QuantConnect Lean Docker 部署脚本 | P0 |
| A股历史数据 → Lean 格式转换工具 | P0 |
| 回测执行 API（/api/backtest） | P0 |
| 回测结果可视化（净值曲线/月度热力图） | P1 |
| 策略保存/管理（用户私有策略库） | P1 |
| 美股/港股回测支持 | P2 |

### 第三期（P2）：策略广场

**工期估计**：4周

| 任务 | 优先级 |
|------|--------|
| 策略广场前端（展示/搜索/筛选/排行） | P0 |
| 策略发布流程（上传/审核/沙盒） | P0 |
| 订阅支付（微信/支付宝集成，或平台积分） | P0 |
| 实盘跟踪系统（记录用户实际盈亏） | P0 |
| 抽佣结算系统（月度结算到创作者账户） | P1 |
| 信用评级自动计算 | P1 |
| 策略订阅信号推送（WebSocket + 飞书通知） | P1 |

### 第四期（P3）：知识库增强 + 高级功能

| 任务 |
|------|
| 新闻事件知识库（ChromaDB/RAG） |
| 自动新闻采集（RSS + NewsAPI） |
| 多市场联动分析（港股/美股影响 A 股传导） |
| 策略组合优化（多策略资金分配） |
| 移动端 App |

---

## 六、API 接口规范

### 6.1 AI 选股

```
POST /api/ai/screen
Body: {
    "market": "A股",              // A股/美股/港股
    "style": "neutral",           // conservative/neutral/aggressive
    "count": 10,                  // 返回候选股数量
    "use_news_factor": false,     // 是否启用新闻因子
    "filters": {                  // 额外过滤条件（可选）
        "pe_max": 30,
        "market_cap_min": 50,     // 亿
        "market_cap_max": 5000
    }
}

Response: {
    "success": true,
    "model": "qwen2.5:9b",
    "is_fallback": false,         // 是否使用了兜底模型
    "stocks": [
        {
            "code": "sh600519",
            "name": "贵州茅台",
            "confidence": 0.85,   // 综合置信度
            "scores": {           // 各维度得分
                "fundamental": 0.90,
                "technical": 0.82,
                "sentiment": 0.78,
                "news": 0.85
            },
            "reason": "...",      // AI分析理由
            "risk": "medium",
            "kronos_signal": null // 需单独调用获取
        }
    ],
    "active_events": [],          // 活跃地缘政治事件（新闻因子开启时）
    "duration_ms": 8500
}
```

### 6.2 Kronos 择时

```
GET /api/kronos/predict/:code?model=kronos-base&pred_len=20

Response: {
    "success": true,
    "code": "sh600519",
    "model": "kronos-base",
    "is_mock": false,
    "trend": "bullish",
    "confidence": 0.73,
    "entry_signal": true,         // 建议开仓
    "exit_signal": false,         // 建议平仓
    "forecast": [...],            // 未来20根K线预测
    "analysis": "技术面分析文字",
    "cached": false,
    "inference_ms": 850
}
```

### 6.3 回测

```
POST /api/backtest/run
Body: {
    "strategy_id": null,          // 已保存策略ID（可选）
    "signals": [...],             // 或直接传入信号列表
    "market": "A股",
    "start_date": "2020-01-01",
    "end_date": "2024-12-31",
    "initial_capital": 100000,
    "style": "neutral"
}

Response: {
    "success": true,
    "job_id": "bt_xxx",           // 异步任务ID
    "status": "running"           // 回测可能需要数分钟
}

GET /api/backtest/result/:job_id
Response: {
    "status": "completed",
    "metrics": {
        "annual_return": 0.325,
        "max_drawdown": -0.123,
        "sharpe": 1.85,
        "win_rate": 0.68,
        "profit_factor": 2.1,
        "calmar": 2.64,
        "benchmark_excess": 0.18
    },
    "equity_curve": [...],        // 净值曲线数据
    "trades": [...]               // 交易记录
}
```

### 6.4 策略广场

```
GET /api/marketplace/strategies
Query: ?market=A股&grade=A&sort=annual_return&page=1&limit=20

POST /api/marketplace/strategies          // 发布策略
POST /api/marketplace/subscribe           // 订阅策略
GET  /api/marketplace/my-subscriptions    // 我的订阅
GET  /api/marketplace/my-strategies       // 我发布的策略
POST /api/marketplace/track               // 记录实盘跟踪
GET  /api/marketplace/leaderboard         // 排行榜
```

---

## 七、前端页面规划

### 7.1 主页（现有）
- 三列布局（智能分析 / 持仓 / 交易）
- 新增：Kronos 择时信号标注在持仓卡片上

### 7.2 AI 选股页（升级）
- 选股参数配置（市场/风格/条件）
- 多维度评分雷达图
- 新闻事件面板（可开关）
- 候选股列表（含 Kronos 信号）
- 一键提交回测

### 7.3 回测工作台（新增）
- 策略参数配置
- 回测进度条（WebSocket 实时更新）
- 结果展示（净值曲线 + 指标卡片）
- 买卖点可视化（K线图上标注）
- 一键发布到策略广场

### 7.4 策略广场（新增）
- 策略卡片列表（筛选/搜索/排序）
- 策略详情页（完整回测报告 + 实盘数据）
- 订阅管理
- 我的创作（发布/管理/收益结算）
- 排行榜

### 7.5 个人中心（新增）
- 持仓概览
- 订阅的策略信号
- 收益追踪
- 创作者收益（余额 + 提现记录）

---

## 八、非功能需求

| 类别 | 要求 |
|------|------|
| 性能 | AI 选股响应 < 30秒；Kronos 单股 < 2秒 |
| 可用性 | 99% 月度可用率；Qwen 离线时自动切换云端 |
| 安全 | 策略代码加密存储；用户数据不出境 |
| 注释规范 | 每个函数必须有 JSDoc/docstring；每个复杂逻辑块有行注释 |
| 测试 | 关键路径单元测试；回测引擎集成测试 |
| 日志 | 结构化日志（JSON格式）；AI 调用记录 token 消耗 |
| 扩展性 | 数据源 / LLM 提供商 / 市场均通过配置切换，不硬编码 |

---

## 九、代码规范（开发者须知）

```javascript
/**
 * 所有函数必须包含：
 * 1. 功能描述（一句话）
 * 2. 参数说明（类型 + 含义）
 * 3. 返回值说明
 * 4. 异常处理说明
 * 5. 复杂逻辑块的行内注释
 * 
 * 示例：
 * 
 * /**
 *  * 调用 Kronos 微服务预测股票走势
 *  * @param {string} code - 股票代码（如 sh600519）
 *  * @param {Array} ohlcv - OHLCV 数据数组，每项 [open,high,low,close,volume]
 *  * @param {string} model - 模型规格（kronos-mini/small/base）
 *  * @returns {Promise<Object>} 预测结果，含 trend/confidence/entry_signal/exit_signal
 *  * @throws {Error} Kronos 服务不可达时抛出，由调用方处理降级逻辑
 *  *\/
 * async function kronosPredict(code, ohlcv, model = 'kronos-base') { ... }
 */

// Python 侧同样要求：
# 所有类和函数必须有 docstring
# 复杂算法必须有行内注释说明意图（而不是说明做什么）
# 配置参数必须注释说明取值范围和默认值
```

---

## 十、里程碑

| 里程碑 | 目标 | 预计完成 |
|--------|------|---------|
| M1 | AI 选股 + Kronos 择时端到端跑通（A股） | 第1-2周 |
| M2 | 回测引擎集成（Lean Docker + A股数据） | 第3-5周 |
| M3 | 策略广场 MVP（发布/展示/订阅） | 第6-9周 |
| M4 | 美股/港股支持 + 知识库新闻因子 | 第10-14周 |
| M5 | 移动端 + 实盘对接 | TBD |

---

*本文档由如来佛祖（主控Agent）起草，作为孙悟空开发的行动指南。所有实现细节以本文档为准，如有变更请更新本文档。*

**文档版本**：v1.0  
**下次审阅**：M1 完成后

---

## 十一、AI 中转站商业模式（新增）

> 智盈云作为 AI Token 中转平台，用户使用 AI 功能消耗平台 Token，平台向大模型厂商批量采购后加价转售，形成稳定收益流。

### 11.1 用户侧：模型选择权

用户在使用 TradingAgents 选股/分析时，可自主选择 AI 大模型：

| 模型等级 | 示例模型 | Token 单价 | 适用场景 |
|----------|----------|-----------|---------|
| 免费（受限） | StepFun step-3.5-flash | 0 | 体验/低频 |
| 标准 | DeepSeek V3 / Qwen2.5 | ¥0.05/千token | 日常选股 |
| 高级 | Claude Sonnet / GPT-4o | ¥0.2/千token | 深度研究 |
| 旗舰 | Claude Opus / GPT-4 | ¥0.8/千token | 重大决策分析 |

**实现方式**：
- 前端 AI 功能页面顶部提供模型选择器（下拉/卡片切换）
- 用户选择后记录偏好（localStorage + 账户设置）
- 后端根据选择路由到对应模型（通过 OpenRouter 统一接入）
- 每次调用记录 token 消耗 → 计入账户余额扣减

### 11.2 平台侧：Token 转售盈利

```
用户充值（微信/支付宝） → 平台余额
    ↓ 用户调用 AI 功能
平台向 OpenRouter/大模型厂商 按原价采购
    ↓ 加价策略
平台售价 = 原价 × (1.3 ~ 2.0)  // 30%-100% 加价，视模型和套餐
    ↓ 差价即利润
平台毛利 = 售价 - 采购成本
```

**套餐设计**：
| 套餐 | 价格 | Token 额度 | 模型权限 | 有效期 |
|------|------|-----------|---------|--------|
| 试用 | 免费 | 10万 token | 免费模型 | 永久 |
| 基础 | ¥29/月 | 500万 token | 标准模型 | 月度 |
| 专业 | ¥99/月 | 2000万 token | 高级模型 | 月度 |
| 团队 | ¥299/月 | 1亿 token | 全部模型 | 月度 |
| 年付 | 8折优惠 | 同上 | 同上 | 年度 |

### 11.3 用户数据变现（合规前提）

**数据类型与价值**：
| 数据类型 | 用途 | 变现方式 |
|----------|------|---------|
| 匿名化选股偏好 | 行为数据分析 | 卖给量化研究机构 |
| 聚合持仓分布 | 市场情绪指标 | 作为平台增值数据产品销售 |
| 策略绩效数据 | 策略评级依据 | 提升策略广场信誉 |
| 匿名化交易信号 | 量化因子研究 | 与学术机构/券商合作 |

**合规要求**（必须满足）：
- 用户注册时明确告知数据使用方式并获得同意
- 数据脱敏处理，不包含个人身份信息
- 用户可在设置页关闭数据共享（并说明关闭后的功能影响）
- 遵守《数据安全法》《个人信息保护法》

### 11.4 模型选择器前端组件

```jsx
/**
 * AI 模型选择器组件
 * 供 TradingAgents 选股、Kronos分析等 AI 功能复用
 * 
 * Props:
 * - selectedModel: string - 当前选中模型ID
 * - onSelect: function - 选中回调
 * - userBalance: number - 用户余额（显示预计消耗）
 * - feature: string - 当前功能（"screening"/"analysis"/"news"）
 */

const MODEL_CATALOG = [
  {
    id: "stepfun/step-3.5-flash:free",
    name: "StepFun Flash",
    badge: "免费",
    badgeColor: "#48bb78",
    desc: "适合体验，速度快",
    tokenCost: 0,        // 每次选股消耗的平台 token 估算
    quality: 3           // 1-5星
  },
  {
    id: "deepseek/deepseek-v3.2",
    name: "DeepSeek V3",
    badge: "标准",
    badgeColor: "#4299e1",
    desc: "性价比最高，日常使用",
    tokenCost: 15000,
    quality: 4
  },
  {
    id: "anthropic/claude-sonnet-4-5",
    name: "Claude Sonnet",
    badge: "高级",
    badgeColor: "#9f7aea",
    desc: "分析深度更强",
    tokenCost: 60000,
    quality: 5
  },
  // 后续可动态从后端拉取模型列表
];
```

### 11.5 Token 计量系统

后端需要实现：
```javascript
// 每次 AI 调用记录 token 消耗
// GET /api/usage/balance    用户余额查询
// GET /api/usage/history    消耗记录
// POST /api/usage/recharge  充值接口（接入支付）
// POST /api/usage/deduct    内部扣减（AI调用时自动调用）
```

数据库新增：
```sql
-- 用户余额和充值记录
CREATE TABLE user_tokens (
    user_id TEXT PRIMARY KEY,
    balance INTEGER DEFAULT 0,       -- 剩余 token 数
    total_purchased INTEGER DEFAULT 0,
    total_used INTEGER DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Token 消耗明细
CREATE TABLE token_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    feature TEXT,                    -- "screening"/"analysis"/"backtest"
    model TEXT,                      -- 使用的模型
    tokens_in INTEGER,               -- 输入 token 数
    tokens_out INTEGER,              -- 输出 token 数
    cost_tokens INTEGER,             -- 扣减平台 token 数
    cost_usd REAL,                   -- 实际采购成本（USD）
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## 十二、M6 用户认证系统（2026-03-14）

### 实现内容
- JWT 认证（7天有效期，bcrypt密码哈希）
- 注册/登录/登出/用户信息 API
- 前端登录界面（AuthPanel.jsx）
- 渐进式路由保护（敏感路由强制认证）
- 持仓/交易数据按用户隔离
