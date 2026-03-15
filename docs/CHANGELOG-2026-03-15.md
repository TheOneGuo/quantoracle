# 变更日志 2026-03-15

## 策略广场 M1-M4 完整实现

---

### 新增文件（按模块）

#### M2 策略规则引擎

- `backend/src/services/stock-scorer.js` — 选股五维度评分引擎（技术/基本面/情绪/资金/筹码）
- `backend/src/services/order-calculator.js` — 开仓数量计算器（含T+1锁定和涨跌停验证）
- `backend/src/services/rule-validator.js` — 策略规则合规性校验器
- `frontend/src/components/StrategyRuleWizard.jsx` — 策略创建向导前端（5步流程含AI建议）
- `frontend/src/components/StrategyRuleSummary.jsx` — 策略规则摘要展示组件

#### M3 信号推送与执行监督

- `backend/src/services/signal-pusher.js` — 信号推送服务（Telegram/企微/飞书多渠道）
- `backend/src/services/pricing-engine.js` — AI定价引擎（初始定价+动态调价+抽成档位）
- `backend/src/api/signal-confirm.js` — 执行确认API（含T+1顺延信号生成）
- `backend/src/api/reviews.js` — 评价系统API（含AI审核和返现管理）
- `frontend/src/components/SignalConfirmPage.jsx` — 信号确认页前端（含倒计时和未响应进度条）

#### M4 监督展示与信用评级

- `backend/src/services/credit-scorer.js` — 发布者信用评级计算服务（4维度+分级阈值）
- `backend/src/services/publisher-rating.js` — 发布者综合评级服务（5维度平滑曲线+发布额度限制）
- `backend/src/api/execution-history.js` — 订阅者端执行记录展示API（时间线/未响应摘要/风险仪表盘）
- `backend/src/api/marketplace.js` — 策略广场列表API（排序+筛选+推荐得分计算）
- `backend/src/api/publisher-rating.js` — 发布者评级API（my-rating/publish-quota/publisher-badge）
- `frontend/src/components/StrategyMarketplace.jsx` — 策略广场列表（排序/筛选/分页）
- `frontend/src/components/ExecutionTimeline.jsx` — 执行时间线组件
- `frontend/src/components/RiskDashboard.jsx` — 风险仪表盘（资金使用率折线图+风险徽章）
- `frontend/src/components/MarketplacePage.jsx` — 策略广场页面容器

#### 算法保护

- `backend/scripts/obfuscate-core.js` — 核心算法混淆脚本（javascript-obfuscator重度配置）
- `backend/.env.example` — 环境变量示例（变量名模糊化+诱饵变量+分组混淆）

#### 文档

- `docs/PUBLISHER_GUIDE.md` — 策略发布者帮助文档
- `docs/SUBSCRIBER_GUIDE.md` — 策略订阅者帮助文档

---

### 数据库新增表

| 表名 | 说明 | 引入版本 |
|------|------|----------|
| `strategy_pricing` | 定价历史记录（AI初始/AI调价/手动调价） | M3 |
| `strategy_reviews` | 用户评价（好评/差评+AI审核+返现状态） | M3（替换旧版简单表） |
| `publisher_settlements` | 发布者月度收入结算 | M3 |
| `incident_log` | 系统异常审计日志 | M3 |
| `strategy_miss_stats` | 策略未响应月度统计 | M2/M4 |
| `publisher_ratings` | 发布者综合评级（5维+额度控制） | M4 |
| `position_snapshots` | 每日收盘持仓快照（资金使用率） | M4补充 |
| `strategy_monthly_returns` | 策略月度收益率缓存 | M4补充 |
| `publisher_credit_cache` | 发布者信用评级缓存（广场列表加速） | M4补充 |
| `signals` | 订阅者侧信号执行视图 | M4补充 |

---

### 核心算法变更

- **调价算法升级**：由线性映射升级为三层平滑曲线（边际递减幂函数），调价幅度随净评价数增加呈衰减趋势
- **所有权重参数抽离**：`COEFF_A/B/C/D`（调价引擎）、`EVL_P/Q/R/S`（信用评分）、`DIM_X1-X5`（发布者评级）、`RANK_W1-W5`（选股权重）全部移入环境变量
- **诱饵保护**：变量名语义与实际用途隔离，`.env.example` 含假变量混淆实际配置结构

---

### 部署流程变更

- **开发**：`npm start` → 直接运行 `src/index.js`（使用真实源码，便于调试）
- **生产**：`npm run build:core` 生成混淆文件 → `NODE_ENV=production npm start` 自动加载 `dist/services/`
- 新增 `loadCoreService()` 函数在 `backend/src/index.js`，根据 `NODE_ENV` 动态切换算法路径
- 混淆完成后自动生成 `dist/services/index.js` 聚合入口

---

### 一致性修复（2026-03-15 晚）

- 注册三个新 API 路由（execution-history / marketplace / publisher-rating）
- 修复 `strategy_reviews` 双重定义，移除旧版简单表定义
- 修复策略详情查询中 `reviewer_id` → `user_id`、`comment` → `review_text` 字段名错误
- 修复 `publisher-rating.js` 使用统一 `require('../db')` 替代 `req.app.locals.db`
- 新增 4 张 API 依赖但 db 中缺失的表（position_snapshots / strategy_monthly_returns / publisher_credit_cache / signals）
