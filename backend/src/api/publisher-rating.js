/**
 * @file 发布者综合评级 API 路由
 * @description
 *   GET  /api/publisher/my-rating            - 发布者查看自己的评级（隐藏权重）
 *   GET  /api/publisher/publish-quota        - 查看本月发布额度
 *   GET  /api/marketplace/:id/publisher-badge - 订阅者可见的发布者评级徽章
 *
 * 此文件的路由需在 backend/src/index.js 中挂载：
 *   const publisherRatingRouter = require('./api/publisher-rating');
 *   app.use('/api', publisherRatingRouter);
 *
 * 新建策略时需在 strategy create 路由中调用 checkPublishQuota，示例见底部注释。
 */

'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db');  // 统一使用 db 模块，与其他 API 文件一致
const { calcAndSaveRating, checkPublishQuota, incrementPublishedCount } = require('../services/publisher-rating');
// 引入定价矩阵，用于发布策略时验证定价合法性
const pricingCaps = require('../config/pricing-caps');

/**
 * 中间件：简单的身份校验（从请求头或 session 取 publisherId）
 * 实际项目中替换为 JWT 验证中间件
 */
function requirePublisher(req, res, next) {
  // 从 Authorization 头或 session 获取用户ID
  const publisherId = req.headers['x-user-id'] || (req.session && req.session.userId);
  if (!publisherId) {
    return res.status(401).json({ error: '未授权，请先登录' });
  }
  req.publisherId = publisherId;
  next();
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/publisher/my-rating
// 发布者查看自己的综合评级
// 返回：评级字母、综合得分、各维度得分（不含权重）、月度额度
// ─────────────────────────────────────────────────────────────────────────────
router.get('/publisher/my-rating', requirePublisher, async (req, res) => {
  try {


    // 实时重算（或从缓存取，视业务需求）
    const result = await calcAndSaveRating(db, req.publisherId);

    // 仅返回维度得分，不暴露权重和分位值
    const { grade, score, monthly_quota, breakdown } = result;
    const dimScores = breakdown.scores; // { d1, d2, d3, d4, d5 }

    // 维度名称映射（用户友好展示）
    const dimLabels = {
      d1: '历史发布成功率',
      d2: '定价合理程度',
      d3: '用户口碑综合',
      d4: '调价行为规范',
      d5: '返款及时程度',
    };

    res.json({
      grade,
      score,
      monthly_quota: monthly_quota === -1 ? '不限' : monthly_quota,
      dimensions: Object.entries(dimScores).map(([key, val]) => ({
        label: dimLabels[key] || key,
        score: Math.round(val * 10) / 10, // 保留1位小数
        // 不返回权重和分位值
      })),
      note: '各维度得分由平台AI综合评估，具体计算方式不对外公开。',
    });
  } catch (err) {
    console.error('[publisher-rating] my-rating error:', err);
    res.status(500).json({ error: '评级计算失败，请稍后重试' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/publisher/publish-quota
// 查看本月发布额度
// ─────────────────────────────────────────────────────────────────────────────
router.get('/publisher/publish-quota', requirePublisher, async (req, res) => {
  try {

    const quota = await checkPublishQuota(db, req.publisherId);

    res.json({
      allowed: quota.allowed,
      reason: quota.reason,
      remaining: quota.remaining === -1 ? '不限' : quota.remaining,
    });
  } catch (err) {
    console.error('[publisher-rating] publish-quota error:', err);
    res.status(500).json({ error: '额度查询失败，请稍后重试' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/marketplace/:id/publisher-badge
// 订阅者可见：发布者评级徽章（只显示评级字母，不显示分数）
// ─────────────────────────────────────────────────────────────────────────────
router.get('/marketplace/:id/publisher-badge', async (req, res) => {
  try {

    const strategyId = req.params.id;

    // 查找策略的发布者
    const strategy = await db.get(
      `SELECT publisher_id FROM strategies WHERE id = ?`,
      [strategyId]
    );

    if (!strategy) {
      return res.status(404).json({ error: '策略不存在' });
    }

    // 查询发布者评级（只返回徽章级别，不返回分数）
    const rating = await db.get(
      `SELECT grade, calculated_at FROM publisher_ratings WHERE publisher_id = ?`,
      [strategy.publisher_id]
    );

    // 评级徽章颜色配置（供前端渲染）
    const badgeColors = {
      'S+': '#FFD700', // 金色
      'S':  '#C0C0C0', // 银色
      'A':  '#4CAF50', // 绿色
      'B':  '#2196F3', // 蓝色
      'C':  '#FF9800', // 橙色
      'D':  '#F44336', // 红色
    };

    const grade = rating ? rating.grade : '—';
    res.json({
      grade,
      color: badgeColors[grade] || '#9E9E9E',
      label: `发布者信用：${grade}`,
      updated_at: rating ? rating.calculated_at : null,
    });
  } catch (err) {
    console.error('[publisher-rating] publisher-badge error:', err);
    res.status(500).json({ error: '获取徽章失败' });
  }
});

module.exports = router;

// ─────────────────────────────────────────────────────────────────────────────
// 在 strategy create 路由中集成额度检查示例：
//
// const { checkPublishQuota, incrementPublishedCount } = require('../services/publisher-rating');
//
// router.post('/strategy/create', requirePublisher, async (req, res) => {
//   const db = req.app.locals.db;
//
//   // 先检查发布额度
//   const quota = await checkPublishQuota(db, req.publisherId);
//   if (!quota.allowed) {
//     return res.status(403).json({ error: quota.reason });
//   }
//
//   // ... 创建策略逻辑 ...
//
//   // 策略成功发布后递增计数
//   await incrementPublishedCount(db, req.publisherId);
//
//   res.json({ success: true, strategy: newStrategy });
// });
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/strategy/create
// 发布新策略：额度检查 + 定价矩阵约束
// ─────────────────────────────────────────────────────────────────────────────
router.post('/strategy/create', requirePublisher, async (req, res) => {
  try {
    const dbConn = req.app.locals.db || db;
    const publisherId = req.publisherId;

    // 第一步：检查发布额度（C级当月禁止，D级3个月禁止）
    const quota = await checkPublishQuota(dbConn, publisherId);
    if (!quota.allowed) {
      return res.status(403).json({ success: false, error: quota.reason });
    }

    // 获取发布者当前评级
    const { grade } = await calcAndSaveRating(dbConn, publisherId).catch(() => ({ grade: 'B' }));
    // 优先使用已有评级记录，避免重复计算
    const ratingRow = await new Promise((resolve, reject) => {
      (dbConn.db || dbConn).get(
        `SELECT grade FROM publisher_ratings WHERE publisher_id = ? ORDER BY calculated_at DESC LIMIT 1`,
        [publisherId],
        (err, row) => err ? reject(err) : resolve(row)
      );
    }).catch(() => null);
    const publisherGrade = ratingRow?.grade || grade || 'B';

    // 第二步：定价矩阵约束验证
    const { capital_tier, initial_price } = req.body;

    // 检查该评级×档次是否允许发布
    const cap = pricingCaps.getInitialPriceCap(publisherGrade, capital_tier);
    if (cap === null) {
      return res.status(403).json({
        success: false,
        error: `当前评级（${publisherGrade}）本月禁止发布策略`,
      });
    }

    // D级策略强制免费，不需要用户填写价格；其他等级截断至上限
    const finalPrice = cap === 0 ? 0 : Math.min(initial_price || cap, cap);

    // 构造策略数据（其余字段由请求体传入）
    const strategyData = {
      ...req.body,
      publisher_id: publisherId,
      price_monthly: finalPrice,
      price_yearly: finalPrice * 10,
      capital_tier,
      status: 'pending', // 新策略进入待审核状态
    };

    // 插入策略记录
    const newStrategyId = await new Promise((resolve, reject) => {
      (dbConn.db || dbConn).run(
        `INSERT INTO strategies
           (publisher_id, name, description, capital_tier, price_monthly, price_yearly, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        [strategyData.publisher_id, strategyData.name, strategyData.description,
         strategyData.capital_tier, strategyData.price_monthly, strategyData.price_yearly,
         strategyData.status],
        function (err) { err ? reject(err) : resolve(this.lastID); }
      );
    });

    // 递增发布计数（消耗本月额度）
    await incrementPublishedCount(dbConn, publisherId);

    res.json({
      success: true,
      strategy: {
        id: newStrategyId,
        ...strategyData,
        priceAdjusted: finalPrice !== (initial_price || cap), // 是否被矩阵截断
        priceCap: cap, // 当前评级×档次的初始定价上限
      },
    });
  } catch (err) {
    console.error('[publisher-rating] strategy/create error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});
