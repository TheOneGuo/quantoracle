# 智盈云 ZhiYingYun | QuantOracle

> AI驱动的多资产智能增值管理平台

**智盈云**是一个面向个人投资者和专业机构的多资产智能管理平台，集成AI策略输出、资产精选推荐、个性化投资组合定制服务，帮助用户实现跨资产的稳健增值。

---

## ✨ 核心功能

- 📊 **多资产监控** — 实时追踪A股、港股、数字资产等多类资产
- 🤖 **AI策略输出** — 基于DeepSeek/Kimi/豆包等大模型生成交易策略
- 🎯 **资产精选推荐** — 智能筛选推荐潜力标的
- 🔔 **个性化预警** — 自定义规则引擎，支持均线、止盈止损等多维度预警
- 📱 **飞书通知推送** — 实时策略信号推送至飞书
- 🖥️ **可视化大盘** — K线图、持仓监控、市场云图一体化看板

---

## 🚀 快速开始

```bash
# 克隆仓库
git clone https://github.com/TheOneGuo/quantoracle.git
cd quantoracle

# 安装依赖
npm install
cd backend && npm install && cd ..
cd frontend && npm install && npm run build && cd ..

# 配置环境变量（可选）
cp .env.example .env
# 编辑 .env 填写 FEISHU_WEBHOOK_URL 等

# 启动开发环境
npm run dev
```

---

## 🛠 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React + Vite + ECharts |
| 后端 | Node.js + Express |
| 数据库 | SQLite |
| AI代理 | DeepSeek / Kimi / 豆包 |
| 数据源 | 新浪财经 / 腾讯财经（双源切换） |
| 通知 | 飞书 Webhook |
| 桌面端 | Electron |

---

## 📁 项目结构

```
quantoracle/
├── backend/          # Express API 服务
├── frontend/         # React 前端
├── financial_brain/  # AI 策略分析引擎
├── main.js           # Electron 入口
└── package.json
```

---

## 📄 License

MIT

---

> **智盈云** — 让每一个投资决策都有智慧支撑
