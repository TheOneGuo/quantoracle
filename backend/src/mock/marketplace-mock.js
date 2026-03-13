/**
 * 策略广场 Mock 数据
 * 当数据库为空时使用，保证前端正常展示
 * 覆盖：A股/美股/港股，S/A/B/C 各等级，不同风格
 */

const MOCK_STRATEGIES = [
  {
    id: "strat-001",
    creator_id: "creator-001",
    creator_name: "量化老鹰",
    name: "A股动量龙头策略",
    description: "基于价格动量+资金流向+基本面过滤，选取细分行业龙头，历史年化32%",
    market: "A股",
    style: "aggressive",
    tags: ["动量", "龙头", "成长"],
    grade: "S",
    price_monthly: 299,
    price_yearly: 2388,
    subscribers: 1284,
    backtest_metrics: {
      annual_return: 0.325,
      max_drawdown: -0.123,
      sharpe: 1.92,
      win_rate: 0.68,
      profit_factor: 2.35,
      calmar: 2.64,
      benchmark_excess: 0.21,
      period: "2020-01-01 ~ 2024-12-31"
    },
    live_metrics: {
      users: 1284,
      avg_profit: 23450,
      profit_user_rate: 0.78,
      tracked_days: 365
    },
    status: "active",
    created_at: "2023-06-15"
  },
  {
    id: "strat-002",
    creator_id: "creator-002",
    creator_name: "价值猎人007",
    name: "A股低估价值掘金",
    description: "PE<15 + ROE>15% + 净利润连续3年增长，持有3-6个月，穿越牛熊",
    market: "A股",
    style: "conservative",
    tags: ["价值", "低估", "长线"],
    grade: "A",
    price_monthly: 199,
    price_yearly: 1588,
    subscribers: 876,
    backtest_metrics: {
      annual_return: 0.224,
      max_drawdown: -0.089,
      sharpe: 1.76,
      win_rate: 0.72,
      profit_factor: 2.10,
      calmar: 2.51,
      benchmark_excess: 0.16,
      period: "2020-01-01 ~ 2024-12-31"
    },
    live_metrics: {
      users: 876,
      avg_profit: 18200,
      profit_user_rate: 0.74,
      tracked_days: 280
    },
    status: "active",
    created_at: "2023-09-20"
  },
  {
    id: "strat-003",
    creator_id: "creator-003",
    creator_name: "硅谷量化",
    name: "美股科技动量策略",
    description: "NASDAQ100成分股动量轮动，RSI+MACD+均线三重过滤，年化28%",
    market: "美股",
    style: "neutral",
    tags: ["动量", "科技", "轮动"],
    grade: "A",
    price_monthly: 399,
    price_yearly: 3188,
    subscribers: 542,
    backtest_metrics: {
      annual_return: 0.281,
      max_drawdown: -0.156,
      sharpe: 1.65,
      win_rate: 0.61,
      profit_factor: 1.98,
      calmar: 1.80,
      benchmark_excess: 0.08,
      period: "2020-01-01 ~ 2024-12-31"
    },
    live_metrics: {
      users: 542,
      avg_profit: 31200,
      profit_user_rate: 0.71,
      tracked_days: 180
    },
    status: "active",
    created_at: "2024-01-10"
  },
  {
    id: "strat-004",
    creator_id: "creator-004",
    creator_name: "QuantMaster",
    name: "美股标普500增强策略",
    description: "标普500基础上叠加因子选股，相对指数超额收益，适合长期配置",
    market: "美股",
    style: "conservative",
    tags: ["指数增强", "标普500", "稳健"],
    grade: "B",
    price_monthly: 149,
    price_yearly: 1188,
    subscribers: 318,
    backtest_metrics: {
      annual_return: 0.158,
      max_drawdown: -0.112,
      sharpe: 1.22,
      win_rate: 0.64,
      profit_factor: 1.65,
      calmar: 1.41,
      benchmark_excess: 0.05,
      period: "2021-01-01 ~ 2024-12-31"
    },
    live_metrics: {
      users: 318,
      avg_profit: 12400,
      profit_user_rate: 0.64,
      tracked_days: 120
    },
    status: "active",
    created_at: "2024-03-05"
  },
  {
    id: "strat-005",
    creator_id: "creator-005",
    creator_name: "港股通研究员",
    name: "港股红利低波策略",
    description: "恒指成分股中高股息+低波动组合，防御性强，适合震荡市",
    market: "港股",
    style: "conservative",
    tags: ["红利", "低波", "防御"],
    grade: "B",
    price_monthly: 99,
    price_yearly: 788,
    subscribers: 203,
    backtest_metrics: {
      annual_return: 0.127,
      max_drawdown: -0.078,
      sharpe: 1.08,
      win_rate: 0.66,
      profit_factor: 1.52,
      calmar: 1.63,
      benchmark_excess: 0.09,
      period: "2021-01-01 ~ 2024-12-31"
    },
    live_metrics: {
      users: 203,
      avg_profit: 8900,
      profit_user_rate: 0.61,
      tracked_days: 90
    },
    status: "active",
    created_at: "2024-05-18"
  },
  {
    id: "strat-006",
    creator_id: "creator-006",
    creator_name: "新手量化",
    name: "A股均线突破策略",
    description: "20日均线突破+量能确认，简单有效，适合趋势行情",
    market: "A股",
    style: "neutral",
    tags: ["均线", "趋势", "简单"],
    grade: "C",
    price_monthly: 0,
    price_yearly: 0,
    subscribers: 89,
    backtest_metrics: {
      annual_return: 0.098,
      max_drawdown: -0.187,
      sharpe: 0.82,
      win_rate: 0.55,
      profit_factor: 1.28,
      calmar: 0.52,
      benchmark_excess: 0.01,
      period: "2022-01-01 ~ 2024-12-31"
    },
    live_metrics: {
      users: 89,
      avg_profit: 2100,
      profit_user_rate: 0.52,
      tracked_days: 45
    },
    status: "active",
    created_at: "2024-08-22"
  }
];

module.exports = { MOCK_STRATEGIES };
