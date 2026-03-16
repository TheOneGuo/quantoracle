# 东方财富金融数据集成

## 概述

本模块集成东方财富官方数据 API，为 QuantOracle 提供权威的中文金融数据支持。

## 功能

| 功能 | 接口 | 说明 |
|------|------|------|
| 金融数据查询 | `POST /api/eastmoney/query` | 行情、财务、关系数据的自然语言查询 |
| 智能选股 | `POST /api/eastmoney/screen` | 基于自然语言条件筛选A股/港股/美股 |
| 单股行情 | `GET /api/eastmoney/quote/:code` | 快捷获取单只股票行情 |

## 配置

在 `.env` 中添加：

```
EASTMONEY_APIKEY=your_api_key_here
```

获取 API Key：https://marketing.dfcfs.com/views/finskillshub/indexuNdYscEA?appfenxiang=1

## 使用示例

### 金融数据查询

```bash
curl -X POST http://localhost:3001/api/eastmoney/query \
  -H 'Content-Type: application/json' \
  -d '{"query": "茅台最新股价和市盈率"}'
```

### 智能选股

```bash
curl -X POST http://localhost:3001/api/eastmoney/screen \
  -H 'Content-Type: application/json' \
  -d '{"keyword": "市盈率低于10的银行股", "pageNo": 1, "pageSize": 20}'
```

### 单股行情

```bash
curl http://localhost:3001/api/eastmoney/quote/600519.SH
```

## 数据源

- **行情类**：实时股价、涨跌幅、成交量、主力资金流向、估值等
- **财务类**：上市公司财务指标、高管信息、股东结构等
- **选股类**：条件选股、板块成分股、指数成分股、行业筛选
