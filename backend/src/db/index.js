const sqlite3 = require('sqlite3').verbose();
const path = require('path');

class Database {
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

  init() {
    // Token 余额表
    this.db.run(`
      CREATE TABLE IF NOT EXISTS user_tokens (
        user_id TEXT PRIMARY KEY,
        balance INTEGER DEFAULT 0,
        purchased_total INTEGER DEFAULT 0,
        consumed_total INTEGER DEFAULT 0,
        last_purchase_date DATETIME,
        last_consumption_date DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
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

    // 持仓表
    this.db.run(`
      CREATE TABLE IF NOT EXISTS holdings (
        code TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 交易记录表（支持买入和卖出）
    this.db.run(`
      CREATE TABLE IF NOT EXISTS trades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL,
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
  }

  // 添加或更新持仓
  async addHolding(code, name) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT INTO holdings (code, name, updated_at) 
         VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(code) DO UPDATE SET 
         name = excluded.name, updated_at = CURRENT_TIMESTAMP`,
        [code, name],
        function(err) {
          if (err) reject(err);
          else resolve({ code, name });
        }
      );
    });
  }

  // 添加买入交易记录
  async addTrade(code, buyPrice, quantity, buyDate) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT INTO trades (code, type, buy_price, quantity, buy_date) 
         VALUES (?, 'buy', ?, ?, ?)`,
        [code, buyPrice, quantity, buyDate],
        function(err) {
          if (err) reject(err);
          else resolve({ id: this.lastID, code, buyPrice, quantity, buyDate, type: 'buy' });
        }
      );
    });
  }

  // 添加卖出交易记录
  async addSellTrade(code, sellPrice, quantity, sellDate) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT INTO trades (code, type, sell_price, quantity, sell_date) 
         VALUES (?, 'sell', ?, ?, ?)`,
        [code, sellPrice, quantity, sellDate],
        function(err) {
          if (err) reject(err);
          else resolve({ id: this.lastID, code, sellPrice, quantity, sellDate, type: 'sell' });
        }
      );
    });
  }

  // 获取所有持仓
  async getHoldings() {
    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT h.*, 
          GROUP_CONCAT(t.id || ':' || t.type || ':' || COALESCE(t.buy_price, 'null') || ':' || COALESCE(t.sell_price, 'null') || ':' || t.quantity || ':' || COALESCE(t.buy_date, 'null') || ':' || COALESCE(t.sell_date, 'null'), ';') as trades
         FROM holdings h
         LEFT JOIN trades t ON h.code = t.code
         GROUP BY h.code
         ORDER BY h.updated_at DESC`,
        [],
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

  // 删除持仓
  async deleteHolding(code) {
    return new Promise((resolve, reject) => {
      this.db.run('DELETE FROM holdings WHERE code = ?', [code], function(err) {
        if (err) reject(err);
        else resolve({ deleted: this.changes > 0 });
      });
    });
  }

  // 删除单条交易记录
  async deleteTrade(tradeId) {
    return new Promise((resolve, reject) => {
      this.db.run('DELETE FROM trades WHERE id = ?', [tradeId], function(err) {
        if (err) reject(err);
        else resolve({ deleted: this.changes > 0 });
      });
    });
  }

  // 记录预警
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

  // 获取最近的预警
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

  // 检查是否最近已发送相同提醒（1小时内）
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

  // 添加或更新翻倍推荐股票
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

  // 获取所有翻倍推荐股票
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

  // 删除翻倍推荐股票
  async deleteDoublingRecommendation(code) {
    return new Promise((resolve, reject) => {
      this.db.run('DELETE FROM doubling_recommendations WHERE code = ?', [code], function(err) {
        if (err) reject(err);
        else resolve({ deleted: this.changes > 0 });
      });
    });
  }

  // 清空所有翻倍推荐（用于重新分析时）
  async clearDoublingRecommendations() {
    return new Promise((resolve, reject) => {
      this.db.run('DELETE FROM doubling_recommendations', function(err) {
        if (err) reject(err);
        else resolve({ deleted: this.changes });
      });
    });
  }

  // ========== 意向分析股票相关操作 ==========

  // 添加意向分析股票
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

  // 获取所有意向分析股票
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

  // 删除意向分析股票
  async deleteAnalysisStock(code) {
    return new Promise((resolve, reject) => {
      this.db.run('DELETE FROM analysis_stocks WHERE code = ?', [code], function(err) {
        if (err) reject(err);
        else resolve({ deleted: this.changes > 0 });
      });
    });
  }

  // ========== Token 管理相关操作 ==========

  // 获取用户Token余额
  async getUserTokenBalance(userId = 'default') {
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

  // 初始化用户Token记录
  async initializeUserTokens(userId = 'default') {
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

  // 扣除Token（记录使用）
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

  // 充值Token
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

  // 获取Token使用历史记录
  async getTokenUsageHistory(userId = 'default', limit = 50, offset = 0) {
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

  // 获取Token使用统计
  async getTokenUsageStats(userId = 'default', days = 30) {
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

  // 关闭数据库
  close() {
    this.db.close();
  }
}

module.exports = Database;
