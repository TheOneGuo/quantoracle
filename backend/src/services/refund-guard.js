/**
 * @file 退款保护与黑名单服务
 * @description
 * 7日内退款规则：
 *   - 订阅后7天内可退款，退款后停止信号推送
 *   - 梯度惩罚：每累积10次7日内退款→禁订阅1个月；累积50次→永久封禁
 *
 * 退款不影响发布者策略逻辑（仅停止信号推送）
 */

const { deductRefundFromPublisher } = require('./publisher-ledger');

const EARLY_REFUND_WINDOW_DAYS = 7;   // 7日内退款窗口（天）
const TEMP_BAN_THRESHOLD = 10;         // 每满10次触发临时封禁
const PERMANENT_BAN_THRESHOLD = 50;   // 累积50次永久封禁
const TEMP_BAN_DAYS = 30;             // 临时封禁天数

/**
 * 辅助：Promise 封装 db.get
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
 * 辅助：Promise 封装 db.run
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
 * 辅助：Promise 封装 db.all
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
 * 检查用户是否在封禁期内
 * @param {object} db 数据库实例
 * @param {string} userId 用户ID
 * @returns {{ banned: boolean, type: string|null, until: string|null }}
 */
async function checkUserBanStatus(db, userId) {
  const ban = await dbGet(db,
    `SELECT * FROM user_subscription_bans WHERE user_id = ?`,
    [userId]
  );

  if (!ban) return { banned: false, type: null, until: null };

  // 永久封禁（ban_until 为 NULL 且 ban_type = 'permanent'）
  if (ban.ban_type === 'permanent') {
    return { banned: true, type: 'permanent', until: null };
  }

  // 临时封禁：检查是否已过期
  if (ban.ban_until && new Date(ban.ban_until) > new Date()) {
    return { banned: true, type: 'temp_1month', until: ban.ban_until };
  }

  return { banned: false, type: null, until: null };
}

/**
 * 处理7日内退款申请
 * @param {object} db 数据库实例
 * @param {string} userId 用户ID
 * @param {number} subscriptionId 订阅ID
 * @returns {{ approved: boolean, refundAmount: number, reason: string }}
 */
async function processEarlyRefund(db, userId, subscriptionId) {
  // 1. 查询订阅信息
  const sub = await dbGet(db,
    `SELECT s.*, st.publisher_id FROM subscriptions s
     LEFT JOIN strategies st ON s.strategy_id = st.id
     WHERE s.id = ? AND s.subscriber_id = ?`,
    [subscriptionId, userId]
  );

  if (!sub) {
    return { approved: false, refundAmount: 0, reason: '订阅记录不存在' };
  }

  // 2. 检查是否在7日退款窗口内
  const startedAt = new Date(sub.started_at);
  const windowEnd = new Date(startedAt.getTime() + EARLY_REFUND_WINDOW_DAYS * 86400000);
  const now = new Date();

  if (now > windowEnd) {
    return { approved: false, refundAmount: 0, reason: '已超出7日退款窗口' };
  }

  // 3. 检查是否已经退款过（每个订阅只能退一次）
  const existingRefund = await dbGet(db,
    `SELECT id FROM user_refund_records WHERE subscription_id = ? AND refund_type = 'early_7d'`,
    [subscriptionId]
  );
  if (existingRefund) {
    return { approved: false, refundAmount: 0, reason: '该订阅已申请过退款' };
  }

  // 4. 按剩余天数比例计算退款金额（月订阅按30天计算）
  const elapsedMs = now - startedAt;
  const elapsedDays = elapsedMs / 86400000;
  const totalDays = sub.sub_type === 'lifetime' ? 365 : 30;
  const remainRatio = Math.max(0, (totalDays - elapsedDays) / totalDays);
  const refundAmount = parseFloat((sub.price_paid * remainRatio).toFixed(2));

  // 5. 停止信号推送
  await dbRun(db,
    `UPDATE subscriptions SET signal_push_enabled = 0 WHERE id = ?`,
    [subscriptionId]
  );

  // 6. 写入退款记录
  await dbRun(db,
    `INSERT INTO user_refund_records (user_id, subscription_id, refund_type, refund_amount)
     VALUES (?, ?, 'early_7d', ?)`,
    [userId, subscriptionId, refundAmount]
  );

  // 7. 更新黑名单表的退款次数（UPSERT）
  const banRecord = await dbGet(db,
    `SELECT id, early_refund_count FROM user_subscription_bans WHERE user_id = ?`,
    [userId]
  );

  let newCount;
  if (banRecord) {
    newCount = banRecord.early_refund_count + 1;
    await dbRun(db,
      `UPDATE user_subscription_bans
       SET early_refund_count = ?, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ?`,
      [newCount, userId]
    );
  } else {
    newCount = 1;
    await dbRun(db,
      `INSERT INTO user_subscription_bans (user_id, ban_type, early_refund_count, ban_reason)
       VALUES (?, 'none', 1, '7日内退款记录')`,
      [userId]
    );
  }

  // 8. 检查是否触发惩罚阈值
  await checkAndApplyPenalty(db, userId, newCount);

  // 9. 触发对发布者的扣款（退款金额从发布者保证金/余额中扣除）
  if (sub.publisher_id) {
    await deductRefundFromPublisher(db, sub.publisher_id, null, refundAmount);
  }

  return { approved: true, refundAmount, reason: '退款成功，已停止信号推送' };
}

/**
 * 检查并应用退款惩罚：触发阈值则写入封禁记录
 * @param {object} db 数据库实例
 * @param {string} userId 用户ID
 * @param {number} newCount 最新退款累积次数
 */
async function checkAndApplyPenalty(db, userId, newCount) {
  if (newCount >= PERMANENT_BAN_THRESHOLD) {
    // 永久封禁
    await dbRun(db,
      `UPDATE user_subscription_bans
       SET ban_type = 'permanent', ban_until = NULL, ban_count = ban_count + 1,
           ban_reason = '累计7日内退款达50次，永久封禁', updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ?`,
      [userId]
    );

    // 停止该用户所有订阅的信号推送
    await dbRun(db,
      `UPDATE subscriptions SET signal_push_enabled = 0 WHERE subscriber_id = ?`,
      [userId]
    );

    console.warn(`[refund-guard] 用户 ${userId} 已永久封禁（退款次数：${newCount}）`);
  } else if (newCount % TEMP_BAN_THRESHOLD === 0) {
    // 每满10次临时封禁1个月
    const banUntil = new Date(Date.now() + TEMP_BAN_DAYS * 86400000).toISOString();
    await dbRun(db,
      `UPDATE user_subscription_bans
       SET ban_type = 'temp_1month', ban_until = ?, ban_count = ban_count + 1,
           ban_reason = ?, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ?`,
      [banUntil, `累计7日内退款达${newCount}次，临时封禁1个月`, userId]
    );

    console.warn(`[refund-guard] 用户 ${userId} 临时封禁至 ${banUntil}（退款次数：${newCount}）`);
  }
}

module.exports = {
  checkUserBanStatus,
  processEarlyRefund,
  checkAndApplyPenalty,
};
