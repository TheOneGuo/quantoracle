/**
 * @file 订阅管理服务
 * @description 处理月订阅和终身订阅，包含宽限期检查和信号推送开关
 *
 * 宽限期规则：
 *   月订阅到期后有3天宽限期，期间信号正常推送
 *   宽限期结束未续费 → signal_push_enabled = 0，停止推送
 *   随时续费可立即恢复（signal_push_enabled = 1）
 *
 * 终身订阅：无到期时间，永久推送，不受调价影响
 */

'use strict';

const pricingCaps = require('../config/pricing-caps');

// 宽限期天数（月订阅到期后的容忍期）
const GRACE_PERIOD_DAYS = 3;

// ============================================================
// 工具函数
// ============================================================

/**
 * 计算宽限期截止时间（expires_at + 3天）
 * @param {string|Date} expiresAt
 * @returns {string} ISO datetime string
 */
function calcGraceEnd(expiresAt) {
  const d = new Date(expiresAt);
  d.setDate(d.getDate() + GRACE_PERIOD_DAYS);
  return d.toISOString();
}

/**
 * 获取当前时间 ISO 字符串
 */
function now() {
  return new Date().toISOString();
}

// ============================================================
// 核心功能
// ============================================================

/**
 * 检查并处理过期订阅（宽限期逻辑）
 * 建议每小时运行一次（或在信号推送前调用）
 *
 * 处理逻辑：
 *   1. 月订阅：已过 expires_at，但未超过 grace_end_at → 保持推送（宽限期内）
 *   2. 月订阅：已过 grace_end_at → signal_push_enabled = 0，停止推送
 *   3. 终身订阅（sub_type='lifetime'）：expires_at 为 NULL，永不处理
 *
 * @param {object} db 数据库实例
 * @returns {Promise<{ stopped: number }>} 被停止推送的订阅数
 */
async function processExpiredSubscriptions(db) {
  const dbConn = db.db || db;
  const nowStr = now();

  // 找出宽限期已结束但仍在推送的月订阅
  const expired = await new Promise((resolve, reject) => {
    dbConn.all(
      `SELECT id, subscriber_id, strategy_id
       FROM subscriptions
       WHERE sub_type = 'monthly'
         AND signal_push_enabled = 1
         AND grace_end_at IS NOT NULL
         AND grace_end_at < ?`,
      [nowStr],
      (err, rows) => err ? reject(err) : resolve(rows || [])
    );
  });

  // 批量停止推送
  for (const sub of expired) {
    await new Promise((resolve, reject) => {
      dbConn.run(
        `UPDATE subscriptions SET signal_push_enabled = 0 WHERE id = ?`,
        [sub.id],
        (err) => err ? reject(err) : resolve()
      );
    });
    console.log(`[subscription-manager] 停止推送：订阅者=${sub.subscriber_id} 策略=${sub.strategy_id}`);
  }

  // 对已过期但尚未设置 grace_end_at 的月订阅，补全宽限期字段
  const needGrace = await new Promise((resolve, reject) => {
    dbConn.all(
      `SELECT id, expires_at
       FROM subscriptions
       WHERE sub_type = 'monthly'
         AND signal_push_enabled = 1
         AND expires_at < ?
         AND grace_end_at IS NULL`,
      [nowStr],
      (err, rows) => err ? reject(err) : resolve(rows || [])
    );
  });

  for (const sub of needGrace) {
    const graceEnd = calcGraceEnd(sub.expires_at);
    await new Promise((resolve, reject) => {
      dbConn.run(
        `UPDATE subscriptions SET grace_end_at = ? WHERE id = ?`,
        [graceEnd, sub.id],
        (err) => err ? reject(err) : resolve()
      );
    });
  }

  return { stopped: expired.length };
}

/**
 * 检查订阅者对某策略是否有效订阅（可以接收信号）
 *
 * @param {object} db 数据库实例
 * @param {string} subscriberId 订阅者用户ID
 * @param {number|string} strategyId 策略ID
 * @returns {Promise<{ active: boolean, type: string|null, expiresAt: string|null, inGrace: boolean }>}
 */
async function checkSubscriptionActive(db, subscriberId, strategyId) {
  const dbConn = db.db || db;
  const nowStr = now();

  const sub = await new Promise((resolve, reject) => {
    dbConn.get(
      `SELECT sub_type, expires_at, grace_end_at, signal_push_enabled
       FROM subscriptions
       WHERE subscriber_id = ? AND strategy_id = ?
       ORDER BY id DESC
       LIMIT 1`,
      [subscriberId, strategyId],
      (err, row) => err ? reject(err) : resolve(row)
    );
  });

  // 未找到订阅记录
  if (!sub) {
    return { active: false, type: null, expiresAt: null, inGrace: false };
  }

  // 终身订阅：永远有效
  if (sub.sub_type === 'lifetime') {
    return { active: true, type: 'lifetime', expiresAt: null, inGrace: false };
  }

  // 月订阅：检查信号推送开关（已由 processExpiredSubscriptions 维护）
  if (sub.signal_push_enabled === 0) {
    return { active: false, type: 'monthly', expiresAt: sub.expires_at, inGrace: false };
  }

  // 检查是否处于宽限期
  const inGrace = sub.expires_at && sub.expires_at < nowStr && sub.grace_end_at >= nowStr;

  return {
    active: true,
    type: 'monthly',
    expiresAt: sub.expires_at,
    inGrace: !!inGrace,
  };
}

/**
 * 设置终身定价（发布者操作，仅S/S+可用）
 *
 * @param {object} db 数据库实例
 * @param {string} publisherId 发布者用户ID
 * @param {number|string} strategyId 策略ID
 * @param {number} lifetimePrice 目标终身定价（元）
 * @returns {Promise<{ success: boolean, lifetimePrice: number, suggested: object, reason?: string }>}
 */
async function setLifetimePricing(db, publisherId, strategyId, lifetimePrice) {
  const dbConn = db.db || db;

  // 1. 验证发布者评级是否为 S 或 S+
  const gradeRow = await new Promise((resolve, reject) => {
    dbConn.get(
      `SELECT grade FROM publisher_ratings WHERE publisher_id = ? ORDER BY calculated_at DESC LIMIT 1`,
      [publisherId],
      (err, row) => err ? reject(err) : resolve(row)
    );
  });
  const grade = gradeRow?.grade || 'B';

  if (!pricingCaps.canSetLifetimePricing(grade)) {
    return {
      success: false,
      reason: `终身定价仅限 S 及以上评级发布者使用，当前评级：${grade}`,
    };
  }

  // 2. 验证该策略属于此发布者
  const strategy = await new Promise((resolve, reject) => {
    dbConn.get(
      `SELECT id, price_monthly FROM strategies WHERE id = ? AND publisher_id = ?`,
      [strategyId, publisherId],
      (err, row) => err ? reject(err) : resolve(row)
    );
  });
  if (!strategy) {
    return { success: false, reason: '策略不存在或不属于当前发布者' };
  }

  // 3. 验证终身定价在合理范围（月价×8 ~ 月价×12）
  const monthlyPrice = strategy.price_monthly || 0;
  const suggested = pricingCaps.calcLifetimePrice(monthlyPrice);

  if (lifetimePrice < suggested.min || lifetimePrice > suggested.max) {
    return {
      success: false,
      reason: `终身定价须在 ${suggested.min} ~ ${suggested.max} 元之间（月价×8 至 月价×12）`,
      suggested,
    };
  }

  // 4. 更新策略的终身定价和定价模式
  await new Promise((resolve, reject) => {
    dbConn.run(
      `UPDATE strategies SET lifetime_price = ?, pricing_mode = 'dual', updated_at = datetime('now')
       WHERE id = ?`,
      [lifetimePrice, strategyId],
      (err) => err ? reject(err) : resolve()
    );
  });

  console.log(`[subscription-manager] 终身定价设置成功：策略=${strategyId} 价格=${lifetimePrice}元`);

  return { success: true, lifetimePrice, suggested };
}

/**
 * 续费处理（月订阅）
 * 更新到期时间，恢复信号推送
 *
 * @param {object} db 数据库实例
 * @param {string} subscriberId 订阅者用户ID
 * @param {number|string} strategyId 策略ID
 * @returns {Promise<{ success: boolean, newExpiresAt: string, reason?: string }>}
 */
async function renewSubscription(db, subscriberId, strategyId) {
  const dbConn = db.db || db;
  const nowStr = now();

  // 查询当前订阅记录
  const sub = await new Promise((resolve, reject) => {
    dbConn.get(
      `SELECT id, sub_type, expires_at, signal_push_enabled FROM subscriptions
       WHERE subscriber_id = ? AND strategy_id = ?
       ORDER BY id DESC LIMIT 1`,
      [subscriberId, strategyId],
      (err, row) => err ? reject(err) : resolve(row)
    );
  });

  if (!sub) {
    return { success: false, reason: '未找到订阅记录，请先订阅' };
  }
  if (sub.sub_type === 'lifetime') {
    return { success: false, reason: '终身订阅无需续费' };
  }

  // 续费起点：取当前 expires_at（若已过期则从现在起算）
  const baseDate = sub.expires_at && sub.expires_at > nowStr ? sub.expires_at : nowStr;
  const newExpires = new Date(baseDate);
  newExpires.setDate(newExpires.getDate() + 30); // 续费一个月
  const newExpiresAt = newExpires.toISOString();
  const newGraceEnd = calcGraceEnd(newExpiresAt);

  await new Promise((resolve, reject) => {
    dbConn.run(
      `UPDATE subscriptions
       SET expires_at = ?, grace_end_at = ?, signal_push_enabled = 1, auto_renew = 1
       WHERE id = ?`,
      [newExpiresAt, newGraceEnd, sub.id],
      (err) => err ? reject(err) : resolve()
    );
  });

  console.log(`[subscription-manager] 续费成功：订阅者=${subscriberId} 策略=${strategyId} 到期=${newExpiresAt}`);

  return { success: true, newExpiresAt };
}

/**
 * 续费时检查是否触发终身升级弹窗
 * 条件：连续第4次续费（consecutive_months >= 3）+ 发布者已开启终身定价 + 未曾弹出过升级弹窗
 * @param {object} db 数据库实例
 * @param {string} subscriberId 订阅者ID
 * @param {number} strategyId 策略ID
 * @returns {{ showUpgradeOffer: boolean, offerPrice: number }}
 */
async function checkUpgradeOffer(db, subscriberId, strategyId) {
  return new Promise((resolve) => {
    db.db.get(
      `SELECT s.consecutive_months, s.upgrade_offer_shown,
              sp.lifetime_price, sp.pricing_mode
       FROM subscriptions s
       LEFT JOIN strategy_pricing sp ON sp.strategy_id = s.strategy_id
       WHERE s.subscriber_id = ? AND s.strategy_id = ?`,
      [subscriberId, strategyId],
      (err, row) => {
        if (err || !row) return resolve({ showUpgradeOffer: false });

        // 条件：连续月数>=3，未弹出过升级弹窗，且策略已开启终身定价
        if (
          row.consecutive_months >= 3 &&
          row.upgrade_offer_shown === 0 &&
          row.pricing_mode === 'dual' &&
          row.lifetime_price > 0
        ) {
          const offerPrice = parseFloat((row.lifetime_price * 0.6).toFixed(2));
          resolve({ showUpgradeOffer: true, offerPrice, lifetimePrice: row.lifetime_price });
        } else {
          resolve({ showUpgradeOffer: false });
        }
      }
    );
  });
}

/**
 * 用户接受终身升级
 * 将月订阅转换为终身订阅，计算差价
 * @param {object} db 数据库实例
 * @param {string} subscriberId 订阅者ID
 * @param {number} strategyId 策略ID
 * @returns {{ success: boolean, upgradeCost: number, error?: string }}
 */
async function acceptLifetimeUpgrade(db, subscriberId, strategyId) {
  const { recordIncome } = require('./publisher-ledger');

  return new Promise((resolve, reject) => {
    // 1. 查询当前月价和终身价
    db.db.get(
      `SELECT s.id as sub_id, s.price_paid, sp.lifetime_price, sp.pricing_mode,
              st.publisher_id
       FROM subscriptions s
       LEFT JOIN strategy_pricing sp ON sp.strategy_id = s.strategy_id
       LEFT JOIN strategies st ON st.id = s.strategy_id
       WHERE s.subscriber_id = ? AND s.strategy_id = ?`,
      [subscriberId, strategyId],
      async (err, row) => {
        if (err) return reject(err);
        if (!row || !row.lifetime_price) {
          return resolve({ success: false, error: '该策略未开启终身定价' });
        }

        // 2. 优惠价 = 终身价 × 0.6
        const offerPrice = parseFloat((row.lifetime_price * 0.6).toFixed(2));

        // 3. 差价 = 优惠价 - 当月已付月费（抵扣）
        const upgradeCost = Math.max(0, parseFloat((offerPrice - row.price_paid).toFixed(2)));

        try {
          // 4. 更新订阅：转为终身订阅
          await new Promise((res, rej) => {
            db.db.run(
              `UPDATE subscriptions
               SET sub_type = 'lifetime', expires_at = NULL,
                   upgrade_offer_accepted = 1, upgrade_offer_shown = 1,
                   price_paid = price_paid + ?
               WHERE subscriber_id = ? AND strategy_id = ?`,
              [upgradeCost, subscriberId, strategyId],
              (e) => e ? rej(e) : res()
            );
          });

          // 5. 如有差价，记录发布者收入
          if (upgradeCost > 0 && row.publisher_id) {
            await recordIncome(db, row.publisher_id, row.sub_id, upgradeCost, 0.10);
          }

          resolve({ success: true, upgradeCost, offerPrice });
        } catch (e) {
          reject(e);
        }
      }
    );
  });
}

/**
 * 续费处理（月订阅），同时更新连续月数并检查升级弹窗
 * @param {object} db 数据库实例
 * @param {string} subscriberId 订阅者ID
 * @param {number} strategyId 策略ID
 * @returns {{ renewed: boolean, upgradeOffer: object }}
 */
async function renewAndCheckUpgrade(db, subscriberId, strategyId) {
  // 1. 执行续费（更新 expires_at + 30天，grace_end_at，signal_push_enabled）
  const renewResult = await renewSubscription(db, subscriberId, strategyId);
  if (!renewResult.success) {
    return { renewed: false, error: renewResult.error };
  }

  // 2. consecutive_months += 1（连续订阅月数累加）
  await new Promise((resolve, reject) => {
    db.db.run(
      `UPDATE subscriptions
       SET consecutive_months = consecutive_months + 1
       WHERE subscriber_id = ? AND strategy_id = ?`,
      [subscriberId, strategyId],
      (err) => err ? reject(err) : resolve()
    );
  });

  // 3. 检查是否触发升级弹窗
  const upgradeOffer = await checkUpgradeOffer(db, subscriberId, strategyId);

  // 如果触发升级弹窗，标记已弹出（避免重复弹出）
  if (upgradeOffer.showUpgradeOffer) {
    await new Promise((resolve, reject) => {
      db.db.run(
        `UPDATE subscriptions SET upgrade_offer_shown = 1
         WHERE subscriber_id = ? AND strategy_id = ?`,
        [subscriberId, strategyId],
        (err) => err ? reject(err) : resolve()
      );
    });
  }

  // 4. 返回续费结果和升级弹窗信息
  return { renewed: true, newExpiresAt: renewResult.newExpiresAt, upgradeOffer };
}

module.exports = {
  processExpiredSubscriptions,
  checkSubscriptionActive,
  setLifetimePricing,
  renewSubscription,
  checkUpgradeOffer,
  acceptLifetimeUpgrade,
  renewAndCheckUpgrade,
  GRACE_PERIOD_DAYS,
};
