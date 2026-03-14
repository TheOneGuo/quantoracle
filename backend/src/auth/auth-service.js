/**
 * @file auth/auth-service.js
 * @description JWT 认证服务：用户注册、登录、Token 验证
 * @module auth/auth-service
 *
 * 安全说明：
 * - 密码使用 bcrypt 哈希存储，默认 salt rounds 为 12
 * - JWT 签名密钥从环境变量读取，生产环境必须设置 JWT_SECRET
 * - Token 有效期 7 天，需要在前端安全存储
 */

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

/** JWT 签名密钥，生产环境请设置 JWT_SECRET 环境变量 */
const JWT_SECRET = process.env.JWT_SECRET || 'quantoracle-dev-secret';
/** Token 有效期 7 天 */
const TOKEN_EXPIRES_IN = '7d';
/** bcrypt 盐轮数，12 对安全/性能有合适平衡 */
const BCRYPT_ROUNDS = 12;

/**
 * 认证服务类（依赖数据库实例）
 */
class AuthService {
  /**
   * @param {import('../db').default} db - 数据库实例
   */
  constructor(db) {
    this.db = db;
  }

  /**
   * 注册新用户
   * @param {string} username - 用户名（3-20字符）
   * @param {string} password - 明文密码（至少6字符）
   * @returns {Promise<{token: string, user: {id: string, username: string, role: string}}>}
   * @throws {Error} 用户名已存在 | 参数无效
   */
  async register(username, password) {
    // 参数验证
    if (!username || username.length < 3 || username.length > 20) {
      throw new Error('用户名长度必须为 3-20 字符');
    }
    if (!password || password.length < 6) {
      throw new Error('密码长度至少 6 字符');
    }

    // 检查用户名是否已存在
    const existing = await this._getUserByUsername(username);
    if (existing) {
      throw new Error('用户名已存在');
    }

    // 安全：使用 bcrypt 哈希密码，绝不存储明文
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const userId = `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // 创建用户记录
    await new Promise((resolve, reject) => {
      this.db.db.run(
        `INSERT INTO users (id, username, role, password_hash) VALUES (?, ?, 'investor', ?)`,
        [userId, username, passwordHash],
        function(err) {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    // 初始化 token 余额
    await this.db.initializeUserTokens(userId);

    const user = { id: userId, username, role: 'investor' };
    const token = this._signToken(user);
    return { token, user };
  }

  /**
   * 用户登录
   * @param {string} username - 用户名
   * @param {string} password - 明文密码
   * @returns {Promise<{token: string, user: {id: string, username: string, role: string}}>}
   * @throws {Error} 用户名或密码错误
   */
  async login(username, password) {
    if (!username || !password) {
      throw new Error('用户名和密码不能为空');
    }

    const user = await this._getUserByUsername(username);
    if (!user) {
      // 安全：不暴露用户名是否存在，统一返回相同错误
      throw new Error('用户名或密码错误');
    }

    // 若该用户没有密码哈希（旧默认用户），不允许登录
    if (!user.password_hash) {
      throw new Error('该账号未设置密码，请联系管理员');
    }

    // 安全：使用 bcrypt 比较，防止时序攻击
    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      throw new Error('用户名或密码错误');
    }

    const payload = { id: user.id, username: user.username, role: user.role };
    const token = this._signToken(payload);
    return { token, user: payload };
  }

  /**
   * 验证 JWT Token
   * @param {string} token - JWT Token 字符串
   * @returns {{id: string, username: string, role: string}} Token payload
   * @throws {Error} Token 无效或已过期
   */
  verifyToken(token) {
    try {
      return jwt.verify(token, JWT_SECRET);
    } catch (err) {
      throw new Error('Token 无效或已过期');
    }
  }

  /**
   * 生成 JWT Token
   * @private
   * @param {{id: string, username: string, role: string}} payload
   * @returns {string} JWT Token
   */
  _signToken(payload) {
    return jwt.sign(
      { id: payload.id, username: payload.username, role: payload.role },
      JWT_SECRET,
      { expiresIn: TOKEN_EXPIRES_IN }
    );
  }

  /**
   * 按用户名查询用户（含密码哈希）
   * @private
   * @param {string} username
   * @returns {Promise<Object|null>}
   */
  _getUserByUsername(username) {
    return new Promise((resolve, reject) => {
      this.db.db.get(
        'SELECT id, username, role, password_hash FROM users WHERE username = ?',
        [username],
        (err, row) => {
          if (err) reject(err);
          else resolve(row || null);
        }
      );
    });
  }

  /**
   * 按用户 ID 查询用户（不含密码哈希）
   * @param {string} userId
   * @returns {Promise<Object|null>}
   */
  getUserById(userId) {
    return new Promise((resolve, reject) => {
      this.db.db.get(
        'SELECT id, username, role, balance, token_balance, created_at FROM users WHERE id = ?',
        [userId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row || null);
        }
      );
    });
  }
}

module.exports = AuthService;
