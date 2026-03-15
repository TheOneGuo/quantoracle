/**
 * @file 发布者对账与提现服务
 * @description
 * 资金流转：用户付款→T+7解冻→发布者可提现→提现申请→实到90%，10%保证金留存1个月
 *
 * 关键规则：
 * - T+7：用户付款后第7天资金解冻进入可提现余额
 * - 提现：实到90%，10%保证金（1个月后自动释放）
 * - 评价退款：优先从保证金扣除，不足时从可提现余额扣，再不足则冻结下笔收入
 * - 最小提现额：100元；每月最多提现3次
 */

const WITHDRAWAL_RATIO = 0.90;       // 提现实到比例
const BOND_RATIO = 0.10;             // 保证金比例
const BOND_HOLD_DAYS = 30;           // 保证金持有天数（天）
const LOCK_DAYS = 7;                 // 收入锁定天数（T+7）
const MIN_WITHDRAWAL = 100;          // 最小提现额（元）
const MAX_WITHDRAWALS_PER_MONTH = 3; // 每月最多提现次数

/**
 * 辅助：将数据库 run 封装为 Promise
 */
function dbRun(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

/**
 * 辅助：将数据库 get 封装为 Promise
 */
function dbGet(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

/**
 * 辅助：将数据库 all 封装为 Promise
 */
function dbAll(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

/**
 * 确保发布者钱包记录存在（首次初始化）
 */
async function ensureWallet(db, publisherId) {
  await dbRun(db,
    `INSERT OR IGNORE INTO publisher_wallet (publisher_id) VALUES (?)`,
    [publisherId]
  );
}

/**
 * 记录新收入（用户订阅付款）
 * @param {object} db 数据库实例
 * @param {string} publisherId 发布者ID
 * @param {number} subscriptionId 订阅记录ID
 * @param {number} grossAmount 用户实付金额（含平台抽成）
 * @param {number} platformFeeRatio 平台抽成比例（0.10-0.20）
 */
async function recordIncome(db, publisherId, subscriptionId, grossAmount, platformFeeRatio) {
  const platformFee = grossAmount * platformFeeRatio;
  const netAmount = grossAmount - platformFee;
  const lockUntil = new Date(Date.now() + LOCK_DAYS * 86400000).toISOString();

  await ensureWallet(db, publisherId);

  // 1. 记录平台抽成（负项，已解冻无需锁定）
  await dbRun(db,
    `INSERT INTO publisher_ledger (publisher_id, entry_type, amount, related_subscription_id, status, note)
     VALUES (?, 'platform_fee', ?, ?, 'available', '平台服务费')`,
    [publisherId, -platformFee, subscriptionId]
  );

  // 2. 记录发布者净收入（锁定7天，T+7解冻）
  await dbRun(db,
    `INSERT INTO publisher_ledger (publisher_id, entry_type, amount, related_subscription_id, lock_until, status, note)
     VALUES (?, 'income', ?, ?, ?, 'pending', 'T+7锁定中')`,
    [publisherId, netAmount, subscriptionId, lockUntil]
  );

  // 3. 更新钱包：总收入累加，锁定余额增加
  await dbRun(db,
    `UPDATE publisher_wallet
     SET total_earned = total_earned + ?,
         locked_balance = locked_balance + ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE publisher_id = ?`,
    [netAmount, netAmount, publisherId]
  );

  return { platformFee, netAmount, lockUntil };
}

/**
 * 每日任务：解冻到期的锁定收入（T+7）
 * 建议每天凌晨1点运行
 */
async function unlockMaturedFunds(db) {
  const now = new Date().toISOString();

  // 查找所有到期且仍为 pending 状态的收入记录
  const matured = await dbAll(db,
    `SELECT id, publisher_id, amount FROM publisher_ledger
     WHERE entry_type = 'income' AND status = 'pending' AND lock_until <= ?`,
    [now]
  );

  for (const row of matured) {
    // 更新账本记录为 available
    await dbRun(db,
      `UPDATE publisher_ledger SET status = 'available', note = 'T+7已解冻' WHERE id = ?`,
      [row.id]
    );

    // 更新钱包：锁定余额转为可提现余额
    await dbRun(db,
      `UPDATE publisher_wallet
       SET locked_balance = locked_balance - ?,
           available_balance = available_balance + ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE publisher_id = ?`,
      [row.amount, row.amount, row.publisher_id]
    );
  }

  console.log(`[publisher-ledger] 解冻完成，共解冻 ${matured.length} 笔收入`);
  return matured.length;
}

/**
 * 每日任务：释放到期保证金（保证金持有满30天后自动释放）
 */
async function releaseMatureBonds(db) {
  const now = new Date().toISOString();

  // 查找所有到期且仍为 pending 状态的保证金账本记录
  const maturedBonds = await dbAll(db,
    `SELECT id, publisher_id, ABS(amount) as bond_amount FROM publisher_ledger
     WHERE entry_type = 'bond_release' AND status = 'pending' AND bond_release_at <= ?`,
    [now]
  );

  // 同时检查提现表中已到期的保证金
  const maturedWithdrawals = await dbAll(db,
    `SELECT id, publisher_id, bond_amount FROM publisher_withdrawals
     WHERE status = 'completed' AND bond_release_at <= ?`,
    [now]
  );

  for (const row of maturedWithdrawals) {
    // 写入账本：保证金释放（正项入账）
    await dbRun(db,
      `INSERT OR IGNORE INTO publisher_ledger
       (publisher_id, entry_type, amount, bond_release_at, status, note)
       VALUES (?, 'bond_release', ?, ?, 'available', '保证金到期释放')`,
      [row.publisher_id, row.bond_amount, now]
    );

    // 更新钱包：保证金→可提现余额
    await dbRun(db,
      `UPDATE publisher_wallet
       SET bond_balance = bond_balance - ?,
           available_balance = available_balance + ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE publisher_id = ?`,
      [row.bond_amount, row.bond_amount, row.publisher_id]
    );

    // 将提现记录标记为已释放保证金（避免重复释放）
    await dbRun(db,
      `UPDATE publisher_withdrawals SET bond_release_at = '1970-01-01' WHERE id = ?`,
      [row.id]
    );
  }

  console.log(`[publisher-ledger] 保证金释放完成，共释放 ${maturedWithdrawals.length} 笔`);
  return maturedWithdrawals.length;
}

/**
 * 申请提现
 * @param {object} db 数据库实例
 * @param {string} publisherId 发布者ID
 * @param {number} amount 申请提现金额
 * @returns {{ success: boolean, actualAmount: number, bondAmount: number, error?: string }}
 */
async function applyWithdrawal(db, publisherId, amount) {
  // 1. 验证最小提现额
  if (amount < MIN_WITHDRAWAL) {
    return { success: false, error: `最小提现金额为 ${MIN_WITHDRAWAL} 元` };
  }

  // 2. 验证本月提现次数
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const monthCount = await dbGet(db,
    `SELECT COUNT(*) as cnt FROM publisher_withdrawals
     WHERE publisher_id = ? AND applied_at >= ? AND status != 'rejected'`,
    [publisherId, monthStart]
  );
  if (monthCount.cnt >= MAX_WITHDRAWALS_PER_MONTH) {
    return { success: false, error: `本月提现次数已达上限（${MAX_WITHDRAWALS_PER_MONTH} 次）` };
  }

  // 3. 验证可提现余额
  const wallet = await dbGet(db,
    `SELECT available_balance FROM publisher_wallet WHERE publisher_id = ?`,
    [publisherId]
  );
  if (!wallet || wallet.available_balance < amount) {
    return { success: false, error: '可提现余额不足' };
  }

  // 4. 计算实到金额和保证金
  const actualAmount = amount * WITHDRAWAL_RATIO;
  const bondAmount = amount * BOND_RATIO;
  const bondReleaseAt = new Date(Date.now() + BOND_HOLD_DAYS * 86400000).toISOString();

  // 5. 写入提现申请
  await dbRun(db,
    `INSERT INTO publisher_withdrawals
     (publisher_id, apply_amount, actual_amount, bond_amount, bond_release_at, status)
     VALUES (?, ?, ?, ?, ?, 'pending')`,
    [publisherId, amount, actualAmount, bondAmount, bondReleaseAt]
  );

  // 6. 从可提现余额扣除
  await dbRun(db,
    `UPDATE publisher_wallet
     SET available_balance = available_balance - ?,
         total_withdrawn = total_withdrawn + ?,
         bond_balance = bond_balance + ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE publisher_id = ?`,
    [amount, actualAmount, bondAmount, publisherId]
  );

  // 7. 写入账本记录
  await dbRun(db,
    `INSERT INTO publisher_ledger
     (publisher_id, entry_type, amount, bond_release_at, status, note)
     VALUES (?, 'withdrawal', ?, ?, 'withdrawn', '提现申请')`,
    [publisherId, -amount, bondReleaseAt]
  );

  return { success: true, actualAmount, bondAmount, bondReleaseAt };
}

/**
 * 评价退款扣款（从发布者资金中扣除）
 * 优先顺序：保证金→可提现余额→冻结下笔收入
 * @param {object} db 数据库实例
 * @param {string} publisherId 发布者ID
 * @param {number} reviewId 关联评价ID
 * @param {number} refundAmount 退款金额
 */
async function deductRefundFromPublisher(db, publisherId, reviewId, refundAmount) {
  await ensureWallet(db, publisherId);

  const wallet = await dbGet(db,
    `SELECT bond_balance, available_balance FROM publisher_wallet WHERE publisher_id = ?`,
    [publisherId]
  );

  let deductSource = '';
  let note = '';

  if (wallet && wallet.bond_balance >= refundAmount) {
    // 1. 从保证金扣除
    await dbRun(db,
      `UPDATE publisher_wallet
       SET bond_balance = bond_balance - ?, updated_at = CURRENT_TIMESTAMP
       WHERE publisher_id = ?`,
      [refundAmount, publisherId]
    );
    deductSource = 'bond';
    note = '退款从保证金扣除';
  } else if (wallet && wallet.available_balance >= refundAmount) {
    // 2. 从可提现余额扣除
    await dbRun(db,
      `UPDATE publisher_wallet
       SET available_balance = available_balance - ?, updated_at = CURRENT_TIMESTAMP
       WHERE publisher_id = ?`,
      [refundAmount, publisherId]
    );
    deductSource = 'available';
    note = '退款从可提现余额扣除';
  } else {
    // 3. 余额不足：记录欠款，标记该发布者下笔解冻收入优先偿还
    deductSource = 'debt';
    note = '余额不足，下笔解冻收入优先偿还';
    console.warn(`[publisher-ledger] 发布者 ${publisherId} 余额不足以偿还退款 ${refundAmount}`);
  }

  // 写入账本
  await dbRun(db,
    `INSERT INTO publisher_ledger
     (publisher_id, entry_type, amount, related_review_id, status, note)
     VALUES (?, 'refund_deduct', ?, ?, 'deducted', ?)`,
    [publisherId, -refundAmount, reviewId, note]
  );

  return { deductSource, refundAmount };
}

/**
 * 获取发布者钱包汇总
 * @param {object} db 数据库实例
 * @param {string} publisherId 发布者ID
 * @returns {object} 钱包汇总信息
 */
async function getWalletSummary(db, publisherId) {
  await ensureWallet(db, publisherId);
  return await dbGet(db,
    `SELECT * FROM publisher_wallet WHERE publisher_id = ?`,
    [publisherId]
  );
}

/**
 * 获取发布者账本流水（分页）
 * @param {object} db 数据库实例
 * @param {string} publisherId 发布者ID
 * @param {number} page 页码（从1开始）
 * @param {number} pageSize 每页条数
 * @param {string|null} month 月份筛选（格式：2026-03）
 * @returns {{ total: number, entries: Array }}
 */
async function getLedgerEntries(db, publisherId, page = 1, pageSize = 20, month = null) {
  const offset = (page - 1) * pageSize;
  let whereClause = `publisher_id = ?`;
  const params = [publisherId];

  if (month) {
    whereClause += ` AND strftime('%Y-%m', created_at) = ?`;
    params.push(month);
  }

  const countRow = await dbGet(db,
    `SELECT COUNT(*) as total FROM publisher_ledger WHERE ${whereClause}`,
    params
  );

  const entries = await dbAll(db,
    `SELECT * FROM publisher_ledger WHERE ${whereClause}
     ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );

  return { total: countRow.total, page, pageSize, entries };
}

module.exports = {
  recordIncome,
  unlockMaturedFunds,
  releaseMatureBonds,
  applyWithdrawal,
  deductRefundFromPublisher,
  getWalletSummary,
  getLedgerEntries,
};
