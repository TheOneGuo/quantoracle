/**
 * @file 发布者评级×资金档次定价矩阵
 * @description 定义各评级在不同资金档次下的初始定价上限和动态调价天花板
 *
 * 规则说明：
 * - 初始定价上限：AI建议价不超过此值，发布者只能在此范围内设定价格
 * - 动态调价天花板：任意时刻的价格绝对上限，无论好评多少都不可突破
 * - D级：所有策略强制免费（0元），已有订阅者剩余周期不受影响
 * - C级：当月禁止发布新策略，已有策略价格维持不变（但不能上调）
 */

// 资金档次枚举
const CAPITAL_TIERS = {
  TEN_W:         '10w',   // 10万档
  FIFTY_W:       '50w',   // 50万档
  TWO_HUNDRED_W: '200w',  // 200万档
};

// 初始定价上限矩阵（月订阅价，单位：元）
// null = 禁止发布，0 = 强制免费
const INITIAL_PRICE_CAPS = {
  'S+': { '10w': 588,  '50w': 988,  '200w': 1888 },
  'S':  { '10w': 388,  '50w': 688,  '200w': 1288 },
  'A':  { '10w': 188,  '50w': 388,  '200w': 688  },
  'B':  { '10w': 88,   '50w': 188,  '200w': 388  },
  'C':  { '10w': null, '50w': null,  '200w': null }, // 当月禁止发布
  'D':  { '10w': 0,    '50w': 0,    '200w': 0    }, // 强制免费
};

// 动态调价天花板（任意时刻价格绝对上限，单位：元）
const PRICE_CEILINGS = {
  'S+': { '10w': 2888, '50w': 5888, '200w': 8888 },
  'S':  { '10w': 1888, '50w': 3888, '200w': 5888 },
  'A':  { '10w': 888,  '50w': 1888, '200w': 3888 },
  'B':  { '10w': 388,  '50w': 688,  '200w': 1288 },
  'C':  { '10w': null, '50w': null,  '200w': null },
  'D':  { '10w': 0,    '50w': 0,    '200w': 0    },
};

// 价格地板：同档次初始定价的30%（防止恶意差评归零），D级除外
const PRICE_FLOOR_RATIO = 0.30;

/**
 * 获取发布者在指定档次下的初始定价上限
 * @param {string} grade 发布者评级（S+/S/A/B/C/D）
 * @param {string} tier 资金档次（10w/50w/200w）
 * @returns {number|null} 上限金额（null=禁止发布，0=强制免费）
 */
function getInitialPriceCap(grade, tier) {
  return INITIAL_PRICE_CAPS[grade]?.[tier] ?? null;
}

/**
 * 获取发布者在指定档次下的动态调价天花板
 * @param {string} grade 发布者评级
 * @param {string} tier 资金档次
 * @returns {number|null} 天花板金额（null=禁止，0=强制免费）
 */
function getPriceCeiling(grade, tier) {
  return PRICE_CEILINGS[grade]?.[tier] ?? null;
}

/**
 * 验证价格是否合法（不超过天花板，不低于地板）
 * @param {number} price 目标价格
 * @param {string} grade 发布者评级
 * @param {string} tier 资金档次
 * @param {number} initialPrice 策略初始定价（用于计算地板）
 * @returns {{ valid: boolean, price: number, reason: string }}
 */
function validatePrice(price, grade, tier, initialPrice) {
  const ceiling = getPriceCeiling(grade, tier);
  const floor = grade === 'D' ? 0 : Math.floor(initialPrice * PRICE_FLOOR_RATIO);

  if (ceiling === null) {
    return { valid: false, price: 0, reason: '当前评级禁止发布策略' };
  }
  if (ceiling === 0) {
    return { valid: true, price: 0, reason: 'D级发布者策略强制免费' };
  }

  // 截断至天花板（不拒绝，截断）
  const capped = Math.min(price, ceiling);
  // 不低于地板
  const floored = Math.max(capped, floor);

  return {
    valid: true,
    price: floored,
    reason: capped < price
      ? `已截断至评级天花板 ${ceiling} 元`
      : floored > capped
        ? `已提升至价格地板 ${floor} 元`
        : '价格合法',
  };
}

/**
 * 当发布者评级变动时，检查并截断超出新天花板的策略价格
 * @param {number} currentPrice 当前价格
 * @param {string} newGrade 新评级
 * @param {string} tier 资金档次
 * @returns {{ newPrice: number, truncated: boolean, diff: number }}
 */
function applyGradeChange(currentPrice, newGrade, tier) {
  const ceiling = getPriceCeiling(newGrade, tier);

  // C级禁止发布 / D级强制免费：统一归零
  if (ceiling === null || ceiling === 0) {
    return { newPrice: 0, truncated: currentPrice > 0, diff: currentPrice };
  }
  // 当前价格未超出天花板，无需截断
  if (currentPrice <= ceiling) {
    return { newPrice: currentPrice, truncated: false, diff: 0 };
  }
  // 超出天花板，截断至天花板
  return { newPrice: ceiling, truncated: true, diff: currentPrice - ceiling };
}

/**
 * 计算终身定价建议值（月价×10）
 * S/S+发布者可在建议值±20%范围内微调（月价×8 至 月价×12）
 *
 * @param {number} monthlyPrice 月订阅价格（元）
 * @returns {{ suggested: number, min: number, max: number }}
 */
function calcLifetimePrice(monthlyPrice) {
  return {
    suggested: monthlyPrice * 10,               // 建议值（相当于10个月费）
    min: Math.floor(monthlyPrice * 8),           // 最低可设（月价×8，约打83折）
    max: Math.ceil(monthlyPrice * 12),           // 最高可设（月价×12，约有溢价）
  };
}

/**
 * 检查发布者是否有权开启终身定价
 * 仅 S 及以上评级（S/S+）可开启双重定价模式
 *
 * @param {string} grade 发布者评级（S+/S/A/B/C/D）
 * @returns {boolean}
 */
function canSetLifetimePricing(grade) {
  return grade === 'S+' || grade === 'S';
}

module.exports = {
  CAPITAL_TIERS,
  INITIAL_PRICE_CAPS,
  PRICE_CEILINGS,
  PRICE_FLOOR_RATIO,
  getInitialPriceCap,
  getPriceCeiling,
  validatePrice,
  applyGradeChange,
  calcLifetimePrice,
  canSetLifetimePricing,
};
