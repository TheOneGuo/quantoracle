/**
 * @file broker-video-routes.js
 * @description 视频OCR实盘数据识别 API 路由
 * 提供挑战码获取、视频上传、帧提取、OCR识别、持仓入库等接口。
 * 一期支持：同花顺、东方财富。
 * @module broker/broker-video-routes
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

const { recognizeFrames } = require('../services/broker-vision');

// ──────────────────────────────────────────────────────────────────────────────
// ffmpeg 可用性检测
// ──────────────────────────────────────────────────────────────────────────────
let ffmpegAvailable = false;
(async () => {
  try {
    await execAsync('which ffmpeg');
    ffmpegAvailable = true;
    console.log('[BrokerVideo] ffmpeg 可用');
  } catch {
    ffmpegAvailable = false;
    console.warn('[BrokerVideo] ffmpeg 不可用，视频帧提取功能受限，用户可上传截图代替视频');
  }
})();

// ──────────────────────────────────────────────────────────────────────────────
// 文件上传配置（multer）
// ──────────────────────────────────────────────────────────────────────────────
const VIDEOS_BASE_DIR = path.join(__dirname, '../../data/videos');

// 确保视频存储目录存在
fs.mkdirSync(VIDEOS_BASE_DIR, { recursive: true });

/**
 * multer 存储引擎：按用户ID分目录存储
 */
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const userId = req.user?.id || 'anonymous';
    const userDir = path.join(VIDEOS_BASE_DIR, String(userId));
    fs.mkdirSync(userDir, { recursive: true });
    cb(null, userDir);
  },
  filename: (req, file, cb) => {
    // 文件名：时间戳 + 原始扩展名
    const ext = path.extname(file.originalname).toLowerCase() || '.mp4';
    cb(null, `${Date.now()}${ext}`);
  }
});

/**
 * 文件类型过滤：仅接受视频文件（mp4/mov/avi）和图片（jpg/png，降级截图模式）
 */
const fileFilter = (req, file, cb) => {
  const allowed = ['.mp4', '.mov', '.avi', '.jpg', '.jpeg', '.png'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowed.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error(`不支持的文件类型 ${ext}，仅接受 mp4/mov/avi/jpg/png`), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 50 * 1024 * 1024 } // 最大 50MB
});

// ──────────────────────────────────────────────────────────────────────────────
// 工具函数
// ──────────────────────────────────────────────────────────────────────────────

/**
 * 获取视频时长（秒）
 * @param {string} videoPath - 视频文件路径
 * @returns {Promise<number>} 时长（秒），失败时返回 -1
 */
async function getVideoDuration(videoPath) {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v quiet -print_format json -show_format "${videoPath}"`
    );
    const info = JSON.parse(stdout);
    return parseFloat(info.format?.duration || -1);
  } catch {
    return -1;
  }
}

/**
 * 用 ffmpeg 提取视频帧
 * 跳过前1秒和后1秒，取中间部分，每秒1帧，最多取5帧
 * @param {string} videoPath - 视频文件路径
 * @param {string} outputDir - 帧图片输出目录
 * @param {number} duration - 视频总时长（秒）
 * @returns {Promise<string[]>} 帧图片路径数组（最多5帧）
 */
async function extractFrames(videoPath, outputDir, duration) {
  fs.mkdirSync(outputDir, { recursive: true });

  // 计算有效区间（跳过首尾各1秒）
  const startTime = Math.min(1, duration * 0.1); // 跳过前1秒
  const endTime = Math.max(startTime + 1, duration - 1); // 跳过后1秒
  const validDuration = endTime - startTime;

  // 先提取所有帧（fps=1），然后取中间的5帧
  const outputPattern = path.join(outputDir, 'frame_%03d.jpg');
  const cmd = `ffmpeg -ss ${startTime.toFixed(2)} -i "${videoPath}" -t ${validDuration.toFixed(2)} -vf "fps=1" -q:v 3 "${outputPattern}" -y`;

  console.log('[BrokerVideo] ffmpeg 命令:', cmd);
  await execAsync(cmd, { timeout: 60000 }); // 最长等60秒

  // 读取已提取的帧文件列表，排序
  const files = fs.readdirSync(outputDir)
    .filter(f => f.startsWith('frame_') && f.endsWith('.jpg'))
    .sort()
    .map(f => path.join(outputDir, f));

  // 取中间的最多5帧
  if (files.length <= 5) return files;
  const mid = Math.floor(files.length / 2);
  const half = 2;
  return files.slice(Math.max(0, mid - half), Math.min(files.length, mid - half + 5));
}

/**
 * 计算帧间差异（简单判断是否为静态图）
 * 通过比较帧文件大小的方差来估算差异
 * @param {string[]} framePaths - 帧图片路径数组
 * @returns {boolean} true=检测到静态图（帧间无差异）
 */
function detectStaticFrames(framePaths) {
  if (framePaths.length < 2) return false;

  // 获取各帧文件大小
  const sizes = framePaths.map(fp => {
    try { return fs.statSync(fp).size; } catch { return 0; }
  });

  // 计算文件大小的最大差异比例
  const maxSize = Math.max(...sizes);
  const minSize = Math.min(...sizes);
  if (maxSize === 0) return true;

  // 差异小于1%则认为是静态图
  const diffRatio = (maxSize - minSize) / maxSize;
  console.log(`[BrokerVideo] 帧差异比例: ${(diffRatio * 100).toFixed(2)}%`);
  return diffRatio < 0.01; // 阈值：1%
}

// ──────────────────────────────────────────────────────────────────────────────
// 路由：GET /api/broker/challenge
// 生成挑战码（防伪验证）
// ──────────────────────────────────────────────────────────────────────────────
router.get('/challenge', async (req, res) => {
  const db = req.app.locals.db;
  const userId = req.user?.id || 'anonymous';

  // 生成4位随机数字码
  const challengeCode = String(Math.floor(1000 + Math.random() * 9000));
  // 有效期10分钟
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  try {
    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO broker_challenges (user_id, challenge_code, expires_at) VALUES (?, ?, ?)`,
        [userId, challengeCode, expiresAt],
        function(err) { if (err) reject(err); else resolve(this.lastID); }
      );
    });

    console.log(`[BrokerVideo] 为用户 ${userId} 生成挑战码: ${challengeCode}`);
    res.json({ success: true, challenge_code: challengeCode, expires_at: expiresAt });
  } catch (err) {
    console.error('[BrokerVideo] 生成挑战码失败:', err.message);
    res.status(500).json({ success: false, error: '生成挑战码失败' });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// 路由：POST /api/broker/upload-video
// 接受视频上传，执行帧提取 + OCR识别 + 数据入库
// ──────────────────────────────────────────────────────────────────────────────
router.post('/upload-video', upload.single('video'), async (req, res) => {
  const db = req.app.locals.db;
  const userId = req.user?.id || 'anonymous';
  const challengeCodeInput = req.body.challenge_code || null;

  if (!req.file) {
    return res.status(400).json({ success: false, error: '请上传视频或截图文件' });
  }

  const filePath = req.file.path;
  const fileExt = path.extname(filePath).toLowerCase();
  const isImage = ['.jpg', '.jpeg', '.png'].includes(fileExt);

  console.log(`[BrokerVideo] 用户 ${userId} 上传文件: ${filePath} (${isImage ? '截图' : '视频'})`);

  // 创建帧输出目录
  const frameDir = filePath.replace(/\.[^.]+$/, '_frames');
  let framePaths = [];
  let videoDuration = -1;
  let isStaticDetected = false;
  let appType = 'unknown';
  let challengeVerified = 0;
  let timeVerified = 0;
  let ocrResult = null;
  let confidenceScore = 0;
  let videoRecordId = null;

  try {
    // ── Step 1: 帧提取 ─────────────────────────────────────────────────────
    if (isImage) {
      // 降级模式：直接使用上传的图片作为"帧"
      console.log('[BrokerVideo] 截图模式：直接OCR识别，跳过帧提取');
      framePaths = [filePath];
    } else {
      // 视频模式
      if (!ffmpegAvailable) {
        return res.status(400).json({
          success: false,
          error: '服务器暂未安装 ffmpeg，请直接上传持仓截图（jpg/png）进行识别'
        });
      }

      // 获取视频时长
      videoDuration = await getVideoDuration(filePath);
      console.log(`[BrokerVideo] 视频时长: ${videoDuration}秒`);

      // 时长验证：至少5秒（防止静态截图伪造）
      if (videoDuration >= 0 && videoDuration < 5) {
        return res.status(400).json({
          success: false,
          error: `视频时长 ${videoDuration.toFixed(1)}秒，至少需要5秒以通过真实性验证`
        });
      }

      // 提取帧
      framePaths = await extractFrames(filePath, frameDir, videoDuration);
      console.log(`[BrokerVideo] 提取 ${framePaths.length} 帧`);

      if (framePaths.length === 0) {
        return res.status(400).json({ success: false, error: '视频帧提取失败，请检查视频格式' });
      }

      // 静态图检测（帧间差异）
      isStaticDetected = detectStaticFrames(framePaths);
      if (isStaticDetected) {
        console.warn('[BrokerVideo] 检测到静态图！疑似截图伪造为视频');
      }
    }

    // ── Step 2: OCR识别 ────────────────────────────────────────────────────
    ocrResult = await recognizeFrames(framePaths);
    appType = ocrResult.appType;
    confidenceScore = ocrResult.confidence;

    console.log(`[BrokerVideo] OCR完成: appType=${appType}, 持仓数=${ocrResult.holdings.length}, 置信度=${confidenceScore}`);

    // ── Step 3: 防伪验证 ───────────────────────────────────────────────────

    // 3a. 挑战码验证
    if (challengeCodeInput && ocrResult.challengeCode) {
      if (String(ocrResult.challengeCode).trim() === String(challengeCodeInput).trim()) {
        // 检查数据库中挑战码是否有效
        const challenge = await new Promise((resolve, reject) => {
          db.get(
            `SELECT * FROM broker_challenges 
             WHERE user_id = ? AND challenge_code = ? AND used = 0 
               AND datetime(expires_at) > datetime('now')
             ORDER BY created_at DESC LIMIT 1`,
            [userId, challengeCodeInput],
            (err, row) => { if (err) reject(err); else resolve(row); }
          );
        });

        if (challenge) {
          challengeVerified = 1;
          // 标记为已使用
          db.run(`UPDATE broker_challenges SET used = 1 WHERE id = ?`, [challenge.id]);
          console.log('[BrokerVideo] 挑战码验证通过');
        } else {
          console.warn('[BrokerVideo] 挑战码已过期或不存在');
        }
      } else {
        console.warn(`[BrokerVideo] 挑战码不匹配: 视频中=${ocrResult.challengeCode}, 用户提交=${challengeCodeInput}`);
      }
    }

    // 3b. 时间戳验证
    if (ocrResult.videoTime) {
      // 解析视频中的时间（HH:MM）
      const [hh, mm] = ocrResult.videoTime.split(':').map(Number);
      const now = new Date();
      const videoDate = new Date(now);
      videoDate.setHours(hh, mm, 0, 0);

      // 允许 ±60分钟误差
      const diffMs = Math.abs(now - videoDate);
      const diffMin = diffMs / 60000;
      timeVerified = diffMin <= 60 ? 1 : 0;
      console.log(`[BrokerVideo] 时间差: ${diffMin.toFixed(1)}分钟，验证${timeVerified ? '通过' : '失败'}`);
    }

    // ── Step 4: 数据入库 ───────────────────────────────────────────────────

    // 插入视频记录
    videoRecordId = await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO broker_video_records 
          (user_id, video_path, app_type, video_time, challenge_code, challenge_verified, 
           time_verified, is_static_detected, ocr_raw, confidence_score, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          userId,
          filePath,
          appType,
          ocrResult.videoTime,
          challengeCodeInput,
          challengeVerified,
          timeVerified,
          isStaticDetected ? 1 : 0,
          JSON.stringify(ocrResult),
          confidenceScore,
          'pending' // 初始状态
        ],
        function(err) { if (err) reject(err); else resolve(this.lastID); }
      );
    });

    // 如果OCR成功且通过基本验证，写入持仓记录
    const canInsertHoldings = ocrResult.holdings.length > 0 && !isStaticDetected;
    if (canInsertHoldings) {
      for (const h of ocrResult.holdings) {
        await new Promise((resolve, reject) => {
          db.run(
            `INSERT INTO broker_holdings 
              (user_id, video_record_id, stock_code, stock_name, quantity, avg_cost, 
               current_price, profit_amount, profit_pct, market_value)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              userId,
              videoRecordId,
              h.stock_code,
              h.stock_name,
              h.quantity,
              h.avg_cost,
              h.current_price,
              h.profit_amount,
              h.profit_pct,
              h.market_value
            ],
            function(err) { if (err) reject(err); else resolve(); }
          );
        });
      }

      // 更新视频记录状态为 verified
      db.run(`UPDATE broker_video_records SET status = 'verified' WHERE id = ?`, [videoRecordId]);

      // 触发策略信用评级重算（调用现有 gradeCalculator）
      try {
        const { calculateGrade } = require('../services/gradeCalculator');
        // 统计该用户的实盘数据（简单汇总）
        const liveStats = await new Promise((resolve, reject) => {
          db.get(
            `SELECT 
               COUNT(DISTINCT DATE(recorded_at)) as tracked_days,
               AVG(profit_pct) as avg_profit_pct
             FROM broker_holdings WHERE user_id = ?`,
            [userId],
            (err, row) => { if (err) reject(err); else resolve(row); }
          );
        });

        // 获取用户关联的策略并重算评级
        const strategies = await new Promise((resolve, reject) => {
          db.all(
            `SELECT * FROM strategies WHERE creator_id = ? OR id IN 
              (SELECT strategy_id FROM subscriptions WHERE user_id = ?)`,
            [userId, userId],
            (err, rows) => { if (err) reject(err); else resolve(rows || []); }
          );
        });

        for (const strategy of strategies) {
          const grade = calculateGrade(strategy, {
            profit_user_rate: liveStats.avg_profit_pct > 0 ? 0.7 : 0.3,
            annual_return: (liveStats.avg_profit_pct || 0) * 12,
            tracked_days: liveStats.tracked_days || 0
          });
          db.run(`UPDATE strategies SET grade = ? WHERE id = ?`, [grade, strategy.id]);
          console.log(`[BrokerVideo] 策略 ${strategy.id} 评级更新为: ${grade}`);
        }
      } catch (gradeErr) {
        // 评级计算失败不影响主流程
        console.error('[BrokerVideo] 评级重算失败（非致命）:', gradeErr.message);
      }
    }

    // ── 返回结果 ───────────────────────────────────────────────────────────
    res.json({
      success: true,
      video_record_id: videoRecordId,
      app_type: appType,
      ffmpeg_available: ffmpegAvailable,
      is_image_mode: isImage,
      duration_seconds: videoDuration,
      frame_count: framePaths.length,
      is_static_detected: isStaticDetected,
      challenge_verified: !!challengeVerified,
      time_verified: !!timeVerified,
      video_time: ocrResult.videoTime,
      challenge_code_ocr: ocrResult.challengeCode,
      confidence_score: confidenceScore,
      holdings: ocrResult.holdings,
      holdings_saved: canInsertHoldings,
      warnings: [
        isStaticDetected ? '检测到静态图，可能为截图伪造' : null,
        !challengeVerified && challengeCodeInput ? '挑战码验证未通过' : null,
        !ffmpegAvailable ? '服务器未安装ffmpeg，建议使用截图模式' : null
      ].filter(Boolean)
    });

  } catch (err) {
    console.error('[BrokerVideo] 处理失败:', err.message, err.stack);
    // 更新记录状态为 rejected
    if (videoRecordId) {
      db.run(`UPDATE broker_video_records SET status = 'rejected' WHERE id = ?`, [videoRecordId]);
    }
    res.status(500).json({ success: false, error: `处理失败: ${err.message}` });
  } finally {
    // 清理临时帧文件（保留视频文件）
    if (framePaths.length > 0 && !framePaths.includes(filePath)) {
      try {
        fs.rmSync(frameDir, { recursive: true, force: true });
      } catch { /* 忽略清理错误 */ }
    }
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// 路由：GET /api/broker/video-records
// 获取用户的历史视频记录
// ──────────────────────────────────────────────────────────────────────────────
router.get('/video-records', async (req, res) => {
  const db = req.app.locals.db;
  const userId = req.user?.id || 'anonymous';

  try {
    const records = await new Promise((resolve, reject) => {
      db.all(
        `SELECT id, app_type, upload_time, video_time, challenge_verified, 
                time_verified, is_static_detected, confidence_score, status
         FROM broker_video_records 
         WHERE user_id = ? 
         ORDER BY upload_time DESC 
         LIMIT 20`,
        [userId],
        (err, rows) => { if (err) reject(err); else resolve(rows || []); }
      );
    });
    res.json({ success: true, data: records });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// 路由：GET /api/broker/live-holdings
// 获取用户最新一次视频识别的持仓数据
// ──────────────────────────────────────────────────────────────────────────────
router.get('/live-holdings', async (req, res) => {
  const db = req.app.locals.db;
  const userId = req.user?.id || 'anonymous';

  try {
    const holdings = await new Promise((resolve, reject) => {
      db.all(
        `SELECT bh.* FROM broker_holdings bh
         INNER JOIN broker_video_records bvr ON bh.video_record_id = bvr.id
         WHERE bh.user_id = ? AND bvr.status = 'verified'
         ORDER BY bh.recorded_at DESC
         LIMIT 100`,
        [userId],
        (err, rows) => { if (err) reject(err); else resolve(rows || []); }
      );
    });
    res.json({ success: true, data: holdings });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
