/**
 * @file auth/auth-middleware.js
 * @description JWT 认证中间件：authRequired（强制认证）和 authOptional（可选认证）
 * @module auth/auth-middleware
 */

const AuthService = require('./auth-service');

/**
 * 从请求头提取 Bearer Token
 * @param {import('express').Request} req
 * @returns {string|null}
 */
function extractToken(req) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  return authHeader.slice(7).trim() || null;
}

/**
 * 工厂：创建认证中间件（需要注入数据库实例）
 * @param {import('../db').default} db
 * @returns {{ authRequired: Function, authOptional: Function }}
 */
function createAuthMiddleware(db) {
  const authService = new AuthService(db);

  /**
   * 强制认证中间件
   * - 验证 JWT，注入 req.user
   * - 验证失败返回 401
   * @type {import('express').RequestHandler}
   */
  function authRequired(req, res, next) {
    const token = extractToken(req);
    if (!token) {
      return res.status(401).json({ success: false, error: '未提供认证 Token，请先登录' });
    }
    try {
      req.user = authService.verifyToken(token);
      next();
    } catch (err) {
      return res.status(401).json({ success: false, error: err.message });
    }
  }

  /**
   * 可选认证中间件（向后兼容）
   * - 有 Token 则验证并注入 req.user
   * - 无 Token 或 Token 无效则继续（req.user 为 undefined）
   * @type {import('express').RequestHandler}
   */
  function authOptional(req, res, next) {
    const token = extractToken(req);
    if (token) {
      try {
        req.user = authService.verifyToken(token);
      } catch (_) {
        // Token 无效，当做未登录处理，继续执行
      }
    }
    next();
  }

  return { authRequired, authOptional, authService };
}

module.exports = createAuthMiddleware;
