/**
 * @file db/index.js
 * @description SQLite 数据库封装，提供持仓、交易、预警、Token、策略广场等所有数据操作。
 * @module db
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

class Database {
  /**
   * 构造函数：打开数据库文件并初始化所有表结构
   */
  constructor() {
    const dbPath = path.join(__dirname, '../../data/stock.db');
    // 确保目录存在
    const fs = require('fs');
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    // 以读写模式打开数据库
    this.db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
      if (err) {
        console.error('Database open error:', err);
      }
    });
    this.init();
  }

  /**
   * 初始化所有数据库表并插入默认数据
   * 使用 CREATE TABLE IF NOT EXISTS 保证幂等性
   */
  init() {
    // 启用外键约束（SQLite 默认关闭）
    this.db.run('PRAGMA foreign_keys = ON');

    // 用户主表（支持多用户认证，默认用户 'default-user' 兼容现有数据）
    this.db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL DEFAULT 'admin',
        role TEXT DEFAULT 'investor',
        balance REAL DEFAULT 0,
        token_balance INTEGER DEFAULT 0,
        password_hash TEXT,                -- 允许 NULL，兼容旧默认用户（bcrypt 哈希）
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    // M6: 迁移现有 users 表，新增 password_hash 列（已有表不受影响）
    this.db.run(`ALTER TABLE users ADD COLUMN password_hash TEXT`, () => {/* 忽略"列已存在"错误 */});

    // 插入默认用户（单用户模式）
    this.db.run(`INSERT OR IGNORE INTO users (id, username) VALUES ('default-user', 'admin')`);

    // Token 余额表（记录 AI 调用消耗，与 users.balance 用途不同）
    this.db.run(`
      CREATE TABLE IF NOT EXISTS user_tokens (
        user_id TEXT PRIMARY KEY,
        balance INTEGER DEFAULT 0,
        purchased_total INTEGER DEFAULT 0,
        consumed_total INTEGER DEFAULT 0,
        last_purchase_date DATETIME,
        last_consumption_date DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    // Token 使用记录表
    this.db.run(`
      CREATE TABLE IF NOT EXISTS token_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        function_name TEXT NOT NULL,       -- 功能名称（如 "ai_screen", "kronos_predict"）
        model_id TEXT NOT NULL,            -- 使用的模型ID
        tokens_input INTEGER NOT NULL,     -- 输入token数
        tokens_output INTEGER NOT NULL,    -- 输出token数
        tokens_total INTEGER NOT NULL,     -- 总token数
        cost_usd REAL,                     -- 成本（美元）
        request_id TEXT,                   -- 请求ID（用于追踪）
        metadata TEXT,                     -- 额外元数据（JSON格式）
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES user_tokens(user_id)
      )
    `);

    // Migration: 为旧版 token_usage 表添加 user_id 列（若已存在则忽略）
    // 确保所有历史数据库都具备用户隔离能力
    this.db.run(`ALTER TABLE token_usage ADD COLUMN IF NOT EXISTS user_id TEXT DEFAULT 'default-user'`, () => {});

    // 持仓表（M6: 新增 user_id 字段实现数据隔离）
    this.db.run(`
      CREATE TABLE IF NOT EXISTS holdings (
        code TEXT NOT NULL,
        user_id TEXT NOT NULL DEFAULT 'default-user',
        name TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (code, user_id)
      )
    `);
    // M6: 为旧 holdings 表迁移（添加 user_id 列）
    this.db.run(`ALTER TABLE holdings ADD COLUMN user_id TEXT DEFAULT 'default-user'`, () => {});

    // 交易记录表（M6: 新增 user_id 字段实现数据隔离）
    this.db.run(`
      CREATE TABLE IF NOT EXISTS trades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL,
        user_id TEXT NOT NULL DEFAULT 'default-user',
        type TEXT DEFAULT 'buy',
        buy_price REAL,
        sell_price REAL,
        quantity INTEGER NOT NULL,
        buy_date DATE,
        sell_date DATE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (code) REFERENCES holdings(code) ON DELETE CASCADE
      )
    `);
    // M6: 为旧 trades 表迁移（添加 user_id 列）
    this.db.run(`ALTER TABLE trades ADD COLUMN user_id TEXT DEFAULT 'default-user'`, () => {});

    // 预警记录表
    this.db.run(`
      CREATE TABLE IF NOT EXISTS alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL,
        action TEXT NOT NULL,
        action_desc TEXT NOT NULL,
        reason TEXT NOT NULL,
        current_price REAL,
        avg_cost REAL,
        change_percent REAL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 翻倍推荐股票表（AI推荐 + 手动添加）
    this.db.run(`
      CREATE TABLE IF NOT EXISTS doubling_recommendations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        current_price REAL,
        target_price REAL,
        buy_range TEXT,
        upside TEXT,
        probability TEXT,
        logic TEXT,
        source TEXT DEFAULT 'ai',
        model_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 意向分析股票表（从翻倍推荐添加的）
    this.db.run(`
      CREATE TABLE IF NOT EXISTS analysis_stocks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        current_price REAL,
        target_price REAL,
        buy_range TEXT,
        logic TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS watchlist (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        note TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // =====================
    // AI 提供商管理表
    // =====================

    /** AI提供商配置表（平台级，安全存储API Key） */
    this.db.run(`
      CREATE TABLE IF NOT EXISTS ai_providers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        provider_type TEXT NOT NULL,
        base_url TEXT NOT NULL,
        api_key TEXT,
        is_active BOOLEAN DEFAULT TRUE,
        is_default BOOLEAN DEFAULT FALSE,
        models TEXT DEFAULT '[]',
        extra_config TEXT DEFAULT '{}',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    /** 预置模型配置表 */
    this.db.run(`
      CREATE TABLE IF NOT EXISTS ai_models (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider_id INTEGER REFERENCES ai_providers(id),
        model_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        tier TEXT DEFAULT 'standard',
        token_cost_per_1k REAL DEFAULT 0,
        context_length INTEGER DEFAULT 8192,
        is_enabled BOOLEAN DEFAULT TRUE,
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 插入默认提供商（仅当表为空时）
    this.db.get('SELECT COUNT(*) as cnt FROM ai_providers', (err, row) => {
      if (!err && row && row.cnt === 0) {
        this.db.run(`
          INSERT INTO ai_providers (id, name, provider_type, base_url, is_default, models)
          VALUES
            (1, 'OpenRouter', 'openrouter', 'https://openrouter.ai/api/v1', TRUE, '[]'),
            (2, 'Ollama本地', 'ollama', 'http://localhost:11434/v1', FALSE, '[]')
        `);
        // 插入默认模型
        this.db.run(`
          INSERT INTO ai_models (provider_id, model_id, display_name, tier, token_cost_per_1k, context_length, description)
          VALUES
            (1, 'stepfun/step-3.5-flash:free', 'StepFun Flash', 'free', 0, 8192, '快速响应，适合日常分析'),
            (1, 'deepseek/deepseek-v3.2', 'DeepSeek V3', 'standard', 0.015, 65536, '平衡性能与成本，推荐使用'),
            (1, 'anthropic/claude-sonnet-4-5', 'Claude Sonnet', 'premium', 0.06, 200000, '高质量分析，适合复杂推理')
        `);
      }
    });

    // =====================
    // 策略广场核心表
    // =====================

    // 策略表
    this.db.run(`
      CREATE TABLE IF NOT EXISTS strategies (
        id TEXT PRIMARY KEY,              -- UUID
        creator_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        strategy_code TEXT,               -- Lean策略代码（加密可选）
        market TEXT NOT NULL,             -- A股/美股/港股
        style TEXT NOT NULL,              -- conservative/neutral/aggressive
        tags TEXT,                        -- JSON数组，如 ["动量","成长"]
        backtest_metrics TEXT,            -- JSON，回测指标
        live_metrics TEXT,                -- JSON，实盘指标（定期更新）
        grade TEXT DEFAULT 'C',           -- S/A/B/C/D
        price_monthly REAL DEFAULT 0,     -- 月度订阅价（0=免费）
        price_yearly REAL DEFAULT 0,
        commission_rate REAL DEFAULT 0.20,-- 平台抽佣率（默认20%）
        status TEXT DEFAULT 'pending',    -- pending/active/warning/delisted
        subscribers INTEGER DEFAULT 0,   -- 订阅人数缓存
        total_revenue REAL DEFAULT 0,    -- 总收入缓存
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 订阅表
    this.db.run(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        strategy_id TEXT NOT NULL,
        plan TEXT NOT NULL,               -- monthly/yearly/per_signal/buyout
        start_date TEXT NOT NULL,
        end_date TEXT,
        amount_paid REAL NOT NULL,
        platform_fee REAL NOT NULL,
        creator_revenue REAL NOT NULL,
        status TEXT DEFAULT 'active',     -- active/expired/cancelled
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (strategy_id) REFERENCES strategies(id)
      )
    `);

    // 实盘跟踪表（记录购买用户的实际盈亏）
    // subscription_id 允许 NULL，纸交易时填 NULL（不关联具体订阅）
    this.db.run(`
      CREATE TABLE IF NOT EXISTS live_tracking (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        subscription_id INTEGER,
        strategy_id TEXT NOT NULL,
        signal_id TEXT,
        action TEXT NOT NULL,             -- buy/sell
        code TEXT NOT NULL,
        code_name TEXT,
        price REAL,
        quantity INTEGER,
        pnl REAL,
        pnl_percent REAL,
        executed_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 策略评价表
    this.db.run(`
      CREATE TABLE IF NOT EXISTS strategy_reviews (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        strategy_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        rating INTEGER CHECK(rating BETWEEN 1 AND 5),
        comment TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(strategy_id, user_id),
        FOREIGN KEY (strategy_id) REFERENCES strategies(id),
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    // =====================
    // 新闻管道表（Telegram抓取）
    // =====================

    // 原始新闻表（存所有抓取到的消息，含重复）
    this.db.run(`
      CREATE TABLE IF NOT EXISTS news_raw (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_key TEXT NOT NULL,         -- 来源别名，不存真实频道
        raw_id TEXT,                       -- Telegram消息ID或RSS guid
        content TEXT NOT NULL,
        url TEXT,
        published_at DATETIME,
        views INTEGER DEFAULT 0,
        source_weight INTEGER DEFAULT 3,
        dedup_hash TEXT,
        is_duplicate BOOLEAN DEFAULT FALSE,
        duplicate_of INTEGER,             -- 指向 news_processed.id
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 处理后新闻表（去重后，等待评分）
    this.db.run(`
      CREATE TABLE IF NOT EXISTS news_processed (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        raw_id INTEGER REFERENCES news_raw(id),
        content TEXT NOT NULL,
        url TEXT,
        published_at DATETIME,
        source_key TEXT NOT NULL,
        source_weight INTEGER DEFAULT 3,
        asset_type TEXT,                  -- A股/港股/美股/数字货币/大宗/宏观
        event_type TEXT,                  -- 财报/政策/人事/并购/市场数据/突发
        stock_codes TEXT DEFAULT '[]',    -- JSON数组，涉及的股票代码
        score REAL,                        -- 评分 0-10
        score_reason TEXT,                -- 评分理由（50字以内）
        status TEXT DEFAULT 'pending',    -- pending/scored/analyzed/dismissed
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    this.db.run(`CREATE INDEX IF NOT EXISTS idx_news_raw_hash ON news_raw(dedup_hash)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_news_raw_source ON news_raw(source_key, created_at)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_news_processed_score ON news_processed(score DESC)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_news_processed_status ON news_processed(status)`);

    // 迁移 news_processed：新增评分附属字段（已有表忽略错误）
    this.db.run(`ALTER TABLE news_processed ADD COLUMN sentiment TEXT`, () => {});
    this.db.run(`ALTER TABLE news_processed ADD COLUMN urgency TEXT`, () => {});
    this.db.run(`ALTER TABLE news_processed ADD COLUMN scored_at DATETIME`, () => {});
    this.db.run(`ALTER TABLE news_processed ADD COLUMN title TEXT`, () => {});

    // 新闻范式分析结果表
    this.db.run(`
      CREATE TABLE IF NOT EXISTS news_analysis (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        news_id INTEGER NOT NULL REFERENCES news_processed(id),
        paradigm_ids TEXT DEFAULT '[]',          -- 触发的范式ID列表（JSON）
        analysis TEXT NOT NULL,                  -- LLM分析结果（JSON字符串）
        model_used TEXT,                         -- 使用的模型
        confidence REAL,                         -- 置信度 0-1
        stock_recommendations TEXT DEFAULT '[]', -- 推荐标的JSON
        action TEXT,                             -- buy/watch/avoid
        time_window TEXT,                        -- immediate/1-3days/1-2weeks
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_news_analysis_news_id ON news_analysis(news_id)`);

    // ── 去重日志表（记录每次去重决策，方便审计和调优）
    this.db.run(`
      CREATE TABLE IF NOT EXISTS news_dedup_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content_hash TEXT NOT NULL,          -- MD5哈希
        source_key TEXT NOT NULL,            -- 来源别名
        raw_id TEXT,                         -- 原始消息ID
        content_preview TEXT,                -- 内容前100字（审计用）
        dedup_method TEXT NOT NULL,          -- 去重方式: exact_hash/jaccard/time_window
        similarity_score REAL,               -- Jaccard相似度（仅jaccard时有值）
        duplicate_of_raw_id TEXT,            -- 与哪条消息重复（raw_id）
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_news_dedup_log_hash ON news_dedup_log(content_hash)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_news_dedup_log_time ON news_dedup_log(created_at)`);

    // ── 迁移 news_processed：新增 sentiment / urgency / channel_type 字段
    this.db.run(`ALTER TABLE news_processed ADD COLUMN channel_type TEXT DEFAULT 'general'`, () => {});
    // sentiment 和 urgency 字段在更早的 migration 中可能已存在，这里幂等执行
    this.db.run(`ALTER TABLE news_processed ADD COLUMN sentiment TEXT DEFAULT '中性'`, () => {});
    this.db.run(`ALTER TABLE news_processed ADD COLUMN urgency TEXT DEFAULT 'normal'`, () => {});
  }

  /**
   * 添加或更新持仓（UPSERT）
   * @param {string} code - 股票代码
   * @param {string} name - 股票名称
   * @param {string} [userId='default-user'] - 用户ID（M6 多用户隔离）
   * @returns {Promise<{code: string, name: string}>}
   */
  async addHolding(code, name, userId = 'default-user') {
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT INTO holdings (code, user_id, name, updated_at) 
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(code, user_id) DO UPDATE SET 
         name = excluded.name, updated_at = CURRENT_TIMESTAMP`,
        [code, userId, name],
        function(err) {
          if (err) {
            // 兼容旧表结构（主键只有 code）
            this.db ? this.db.run(
              `INSERT INTO holdings (code, name, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
               ON CONFLICT(code) DO UPDATE SET name = excluded.name, updated_at = CURRENT_TIMESTAMP`,
              [code, name],
              function(err2) {
                if (err2) reject(err2);
                else resolve({ code, name });
              }
            ) : reject(err);
          }
          else resolve({ code, name });
        }
      );
    });
  }

  /**
   * 添加买入交易记录
   * @param {string} code - 股票代码
   * @param {number} buyPrice - 买入价格
   * @param {number} quantity - 数量
   * @param {string} buyDate - 买入日期（YYYY-MM-DD）
   * @param {string} [userId='default-user'] - 用户ID（M6 多用户隔离）
   * @returns {Promise<{id: number, code: string, buyPrice: number, quantity: number, buyDate: string, type: 'buy'}>}
   */
  async addTrade(code, buyPrice, quantity, buyDate, userId = 'default-user') {
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT INTO trades (code, user_id, type, buy_price, quantity, buy_date) 
         VALUES (?, ?, 'buy', ?, ?, ?)`,
        [code, userId, buyPrice, quantity, buyDate],
        function(err) {
          if (err) reject(err);
          else resolve({ id: this.lastID, code, buyPrice, quantity, buyDate, type: 'buy' });
        }
      );
    });
  }

  /**
   * 添加卖出交易记录
   * @param {string} code - 股票代码
   * @param {number} sellPrice - 卖出价格
   * @param {number} quantity - 数量
   * @param {string} sellDate - 卖出日期（YYYY-MM-DD）
   * @param {string} [userId='default-user'] - 用户ID（M6 多用户隔离）
   * @returns {Promise<{id: number, code: string, sellPrice: number, quantity: number, sellDate: string, type: 'sell'}>}
   */
  async addSellTrade(code, sellPrice, quantity, sellDate, userId = 'default-user') {
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT INTO trades (code, user_id, type, sell_price, quantity, sell_date) 
         VALUES (?, ?, 'sell', ?, ?, ?)`,
        [code, userId, sellPrice, quantity, sellDate],
        function(err) {
          if (err) reject(err);
          else resolve({ id: this.lastID, code, sellPrice, quantity, sellDate, type: 'sell' });
        }
      );
    });
  }

  /**
   * 获取所有持仓（含交易明细，按更新时间降序）
   * @param {string} [userId='default-user'] - 用户ID（M6 多用户隔离）
   * @returns {Promise<Array>} 持仓数组，每项含 trades 子数组
   */
  async getHoldings(userId = 'default-user') {
    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT h.*, 
          GROUP_CONCAT(t.id || ':' || t.type || ':' || COALESCE(t.buy_price, 'null') || ':' || COALESCE(t.sell_price, 'null') || ':' || t.quantity || ':' || COALESCE(t.buy_date, 'null') || ':' || COALESCE(t.sell_date, 'null'), ';') as trades
         FROM holdings h
         LEFT JOIN trades t ON h.code = t.code AND t.user_id = h.user_id
         WHERE h.user_id = ?
         GROUP BY h.code
         ORDER BY h.updated_at DESC`,
        [userId],
        (err, rows) => {
          if (err) {
            reject(err);
          } else {
            // 解析 trades 字符串
            const holdings = rows.map(row => ({
              code: row.code,
              name: row.name,
              addedAt: row.created_at,
              updatedAt: row.updated_at,
              trades: row.trades ? row.trades.split(';').map(t => {
                const [id, type, buyPrice, sellPrice, quantity, buyDate, sellDate] = t.split(':');
                const trade = { 
                  id: parseInt(id), 
                  type: type,
                  quantity: parseInt(quantity)
                };
                if (type === 'buy') {
                  trade.buyPrice = buyPrice !== 'null' ? parseFloat(buyPrice) : null;
                  trade.buyDate = buyDate !== 'null' ? buyDate : null;
                } else {
                  trade.sellPrice = sellPrice !== 'null' ? parseFloat(sellPrice) : null;
                  trade.sellDate = sellDate !== 'null' ? sellDate : null;
                }
                return trade;
              }) : []
            }));
            resolve(holdings);
          }
        }
      );
    });
  }

  /**
   * 删除持仓（级联删除关联交易记录）
   * @param {string} code - 股票代码
   * @param {string} [userId='default-user'] - 用户ID（M6 多用户隔离）
   * @returns {Promise<{deleted: boolean}>}
   */
  async deleteHolding(code, userId = 'default-user') {
    return new Promise((resolve, reject) => {
      this.db.run('DELETE FROM holdings WHERE code = ? AND user_id = ?', [code, userId], function(err) {
        if (err) reject(err);
        else resolve({ deleted: this.changes > 0 });
      });
    });
  }

  /**
   * 删除单条交易记录
   * @param {number} tradeId - 交易记录 ID
   * @returns {Promise<{deleted: boolean}>}
   */
  async deleteTrade(tradeId) {
    return new Promise((resolve, reject) => {
      this.db.run('DELETE FROM trades WHERE id = ?', [tradeId], function(err) {
        if (err) reject(err);
        else resolve({ deleted: this.changes > 0 });
      });
    });
  }

  /**
   * 记录预警到数据库
   * @param {Object} alert - 预警对象
   * @param {string} alert.code - 股票代码
   * @param {string} alert.action - 动作（如 BUY/SELL/HOLD）
   * @param {string} alert.actionDesc - 动作描述
   * @param {string} alert.reason - 触发原因
   * @param {number} alert.currentPrice - 当前价格
   * @param {number} alert.avgCost - 平均成本
   * @param {number} alert.changePercent - 涨跌幅
   * @returns {Promise<{id: number}>}
   */
  async addAlert(alert) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT INTO alerts (code, action, action_desc, reason, current_price, avg_cost, change_percent) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [alert.code, alert.action, alert.actionDesc, alert.reason, alert.currentPrice, alert.avgCost, alert.changePercent],
        function(err) {
          if (err) reject(err);
          else resolve({ id: this.lastID });
        }
      );
    });
  }

  /**
   * 获取最近的预警记录（含股票名称）
   * @param {number} [limit=50] - 最大返回条数
   * @returns {Promise<Array>}
   */
  async getRecentAlerts(limit = 50) {
    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT a.*, h.name as stock_name 
         FROM alerts a
         LEFT JOIN holdings h ON a.code = h.code
         ORDER BY a.created_at DESC
         LIMIT ?`,
        [limit],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });
  }

  /**
   * 检查是否在最近1小时内已发送过相同预警（防重复通知）
   * @param {string} code - 股票代码
   * @param {string} action - 动作
   * @returns {Promise<boolean>}
   */
  async hasRecentAlert(code, action) {
    return new Promise((resolve, reject) => {
      this.db.get(
        `SELECT COUNT(*) as count FROM alerts 
         WHERE code = ? AND action = ? 
         AND datetime(created_at) > datetime('now', '-1 hour')`,
        [code, action],
        (err, row) => {
          if (err) reject(err);
          else resolve(row.count > 0);
        }
      );
    });
  }

  // ========== 翻倍推荐股票相关操作 ==========

  /** 添加或更新翻倍推荐股票（UPSERT）
   * @param {Object} stock - 股票数据
   * @returns {Promise<{id: number, code: string}>}
   */
  async addDoublingRecommendation(stock) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT INTO doubling_recommendations 
         (code, name, current_price, target_price, buy_range, upside, probability, logic, source, model_id, updated_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(code) DO UPDATE SET 
         name = excluded.name,
         current_price = excluded.current_price,
         target_price = excluded.target_price,
         buy_range = excluded.buy_range,
         upside = excluded.upside,
         probability = excluded.probability,
         logic = excluded.logic,
         source = excluded.source,
         model_id = excluded.model_id,
         updated_at = CURRENT_TIMESTAMP`,
        [stock.code, stock.name, stock.current, stock.target, stock.buy, stock.upside, stock.prob, stock.logic, stock.source || 'ai', stock.modelId],
        function(err) {
          if (err) reject(err);
          else resolve({ id: this.lastID, code: stock.code });
        }
      );
    });
  }

  /** 获取所有翻倍推荐股票（按添加时间降序）
   * @returns {Promise<Array>}
   */
  async getDoublingRecommendations() {
    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT * FROM doubling_recommendations ORDER BY created_at DESC`,
        [],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });
  }

  /** 删除翻倍推荐股票
   * @param {string} code
   * @returns {Promise<{deleted: boolean}>}
   */
  async deleteDoublingRecommendation(code) {
    return new Promise((resolve, reject) => {
      this.db.run('DELETE FROM doubling_recommendations WHERE code = ?', [code], function(err) {
        if (err) reject(err);
        else resolve({ deleted: this.changes > 0 });
      });
    });
  }

  /** 清空所有翻倍推荐（重新分析时使用）
   * @returns {Promise<{deleted: number}>}
   */
  async clearDoublingRecommendations() {
    return new Promise((resolve, reject) => {
      this.db.run('DELETE FROM doubling_recommendations', function(err) {
        if (err) reject(err);
        else resolve({ deleted: this.changes });
      });
    });
  }

  // ========== 意向分析股票相关操作 ==========

  /** 添加或更新意向分析股票（UPSERT）
   * @param {Object} stock
   * @returns {Promise<{id: number, code: string}>}
   */
  async addAnalysisStock(stock) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT INTO analysis_stocks 
         (code, name, current_price, target_price, buy_range, logic) 
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(code) DO UPDATE SET 
         name = excluded.name,
         current_price = excluded.current_price,
         target_price = excluded.target_price,
         buy_range = excluded.buy_range,
         logic = excluded.logic`,
        [stock.code, stock.name, stock.currentPrice, stock.targetPrice, stock.buy, stock.logic],
        function(err) {
          if (err) reject(err);
          else resolve({ id: this.lastID, code: stock.code });
        }
      );
    });
  }

  /** 获取所有意向分析股票（按添加时间降序）
   * @returns {Promise<Array>}
   */
  async getAnalysisStocks() {
    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT * FROM analysis_stocks ORDER BY created_at DESC`,
        [],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });
  }

  /** 删除意向分析股票
   * @param {string} code
   * @returns {Promise<{deleted: boolean}>}
   */
  async deleteAnalysisStock(code) {
    return new Promise((resolve, reject) => {
      this.db.run('DELETE FROM analysis_stocks WHERE code = ?', [code], function(err) {
        if (err) reject(err);
        else resolve({ deleted: this.changes > 0 });
      });
    });
  }

  // ========== Token 管理相关操作 ==========

  /**
   * 获取用户 Token 余额
   * @param {string} [userId='default-user'] - 用户ID
   * @returns {Promise<{balance: number, purchased_total: number, consumed_total: number, last_purchase_date: string|null, last_consumption_date: string|null}>}
   */
  async getUserTokenBalance(userId = 'default-user') {
    return new Promise((resolve, reject) => {
      this.db.get(
        `SELECT balance, purchased_total, consumed_total, last_purchase_date, last_consumption_date
         FROM user_tokens WHERE user_id = ?`,
        [userId],
        (err, row) => {
          if (err) reject(err);
          else if (row) {
            resolve(row);
          } else {
            // 如果用户不存在，创建默认记录
            this.initializeUserTokens(userId).then(resolve).catch(reject);
          }
        }
      );
    });
  }

  /**
   * 初始化用户 Token 记录（默认赠送 10000 个 Token）
   * @param {string} [userId='default-user'] - 用户ID
   * @returns {Promise<{balance: number, purchased_total: number, consumed_total: number}>}
   */
  async initializeUserTokens(userId = 'default-user') {
    return new Promise((resolve, reject) => {
      // 默认赠送10000个token
      const initialBalance = 10000;
      this.db.run(
        `INSERT INTO user_tokens (user_id, balance, purchased_total) VALUES (?, ?, ?)`,
        [userId, initialBalance, initialBalance],
        function(err) {
          if (err) reject(err);
          else resolve({
            balance: initialBalance,
            purchased_total: initialBalance,
            consumed_total: 0,
            last_purchase_date: null,
            last_consumption_date: null
          });
        }
      );
    });
  }

  /**
   * 扣除 Token（写入使用记录并更新余额，事务操作）
   * @param {string} userId - 用户ID
   * @param {Object} usageData - 使用数据
   * @param {string} usageData.function_name - 功能名称
   * @param {string} usageData.model_id - 使用的模型ID
   * @param {number} [usageData.tokens_input] - 输入Token数
   * @param {number} [usageData.tokens_output] - 输出Token数
   * @param {number} [usageData.tokens_total] - 总Token数
   * @param {number} [usageData.cost_usd] - 美元成本
   * @param {string} [usageData.request_id] - 请求追踪ID
   * @param {Object} [usageData.metadata] - 额外元数据
   * @returns {Promise<{usage_id: number, new_balance: number, tokens_deducted: number}>}
   * @throws {Error} 余额不足时抛出 'Insufficient token balance'
   */
  async deductTokens(userId, usageData) {
    return new Promise((resolve, reject) => {
      // 开始事务
      this.db.serialize(() => {
        this.db.run('BEGIN TRANSACTION');

        // 1. 插入使用记录
        this.db.run(
          `INSERT INTO token_usage 
           (user_id, function_name, model_id, tokens_input, tokens_output, tokens_total, cost_usd, request_id, metadata) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            userId,
            usageData.function_name,
            usageData.model_id,
            usageData.tokens_input || 0,
            usageData.tokens_output || 0,
            usageData.tokens_total || (usageData.tokens_input || 0) + (usageData.tokens_output || 0),
            usageData.cost_usd || null,
            usageData.request_id || null,
            usageData.metadata ? JSON.stringify(usageData.metadata) : null
          ],
          function(err) {
            if (err) {
              this.db.run('ROLLBACK');
              reject(err);
              return;
            }

            const usageId = this.lastID;

            // 2. 更新用户余额
            this.db.run(
              `UPDATE user_tokens 
               SET balance = balance - ?, 
                   consumed_total = consumed_total + ?,
                   last_consumption_date = CURRENT_TIMESTAMP,
                   updated_at = CURRENT_TIMESTAMP
               WHERE user_id = ? AND balance >= ?`,
              [
                usageData.tokens_total || (usageData.tokens_input || 0) + (usageData.tokens_output || 0),
                usageData.tokens_total || (usageData.tokens_input || 0) + (usageData.tokens_output || 0),
                userId,
                usageData.tokens_total || (usageData.tokens_input || 0) + (usageData.tokens_output || 0)
              ],
              function(updateErr) {
                if (updateErr) {
                  this.db.run('ROLLBACK');
                  reject(updateErr);
                  return;
                }

                if (this.changes === 0) {
                  // 余额不足
                  this.db.run('ROLLBACK');
                  reject(new Error('Insufficient token balance'));
                  return;
                }

                // 提交事务
                this.db.run('COMMIT', (commitErr) => {
                  if (commitErr) {
                    this.db.run('ROLLBACK');
                    reject(commitErr);
                    return;
                  }

                  // 获取更新后的余额
                  this.db.get(
                    'SELECT balance FROM user_tokens WHERE user_id = ?',
                    [userId],
                    (selectErr, row) => {
                      if (selectErr) {
                        reject(selectErr);
                      } else {
                        resolve({
                          usage_id: usageId,
                          new_balance: row.balance,
                          tokens_deducted: usageData.tokens_total || (usageData.tokens_input || 0) + (usageData.tokens_output || 0)
                        });
                      }
                    }
                  );
                });
              }
            );
          }
        );
      });
    });
  }

  /**
   * 充值 Token（UPSERT：首次创建记录或增加余额）
   * @param {string} userId - 用户ID
   * @param {number} tokens - 充值数量
   * @param {string} [purchaseMethod='system'] - 充值方式
   * @returns {Promise<{new_balance: number, tokens_added: number, purchase_method: string}>}
   */
  async addTokens(userId, tokens, purchaseMethod = 'system') {
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT INTO user_tokens (user_id, balance, purchased_total) 
         VALUES (?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET 
         balance = balance + ?,
         purchased_total = purchased_total + ?,
         last_purchase_date = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP`,
        [userId, tokens, tokens, tokens, tokens],
        function(err) {
          if (err) reject(err);
          else {
            this.db.get(
              'SELECT balance FROM user_tokens WHERE user_id = ?',
              [userId],
              (selectErr, row) => {
                if (selectErr) reject(selectErr);
                else resolve({
                  new_balance: row.balance,
                  tokens_added: tokens,
                  purchase_method: purchaseMethod
                });
              }
            );
          }
        }
      );
    });
  }

  /**
   * 获取 Token 使用历史记录（分页）
   * @param {string} [userId='default-user'] - 用户ID
   * @param {number} [limit=50] - 最大返回条数
   * @param {number} [offset=0] - 分页偏移量
   * @returns {Promise<Array>} 使用记录数组（metadata 已解析为对象）
   */
  async getTokenUsageHistory(userId = 'default-user', limit = 50, offset = 0) {
    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT * FROM token_usage 
         WHERE user_id = ? 
         ORDER BY created_at DESC 
         LIMIT ? OFFSET ?`,
        [userId, limit, offset],
        (err, rows) => {
          if (err) reject(err);
          else {
            // 解析metadata JSON
            const parsedRows = rows.map(row => ({
              ...row,
              metadata: row.metadata ? JSON.parse(row.metadata) : null
            }));
            resolve(parsedRows);
          }
        }
      );
    });
  }

  /**
   * 获取 Token 使用统计（按日期/模型/功能分组聚合）
   * @param {string} [userId='default-user'] - 用户ID
   * @param {number} [days=30] - 统计最近多少天
   * @returns {Promise<Array>} 统计数组
   */
  async getTokenUsageStats(userId = 'default-user', days = 30) {
    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT 
           date(created_at) as date,
           model_id,
           function_name,
           SUM(tokens_total) as total_tokens,
           COUNT(*) as request_count
         FROM token_usage 
         WHERE user_id = ? AND datetime(created_at) > datetime('now', ?)
         GROUP BY date(created_at), model_id, function_name
         ORDER BY date DESC`,
        [userId, `-${days} days`],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });
  }

  /** 关闭数据库连接
   * @returns {void}
   */
  close() {
    this.db.close();
  }
}

module.exports = Database;
