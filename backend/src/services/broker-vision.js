/**
 * @file broker-vision.js
 * @description 视频OCR实盘数据识别服务
 * 使用 OpenRouter GPT-4o-mini Vision 识别券商App持仓截图中的持仓数据。
 * 支持同花顺和东方财富两款App。
 * @module services/broker-vision
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');

// OpenRouter API 配置
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const VISION_MODEL = 'openai/gpt-4o-mini'; // 最便宜的多模态模型

/**
 * 识别图片所属的券商App类型
 * 通过 Vision AI 判断是同花顺还是东方财富
 * @param {string} base64Image - 图片的 base64 编码
 * @returns {Promise<string>} 'tonghuashun' | 'eastmoney' | 'unknown'
 */
async function detectAppType(base64Image) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.warn('[BrokerVision] OPENROUTER_API_KEY 未配置，默认返回 unknown');
    return 'unknown';
  }

  try {
    const response = await axios.post(
      OPENROUTER_API_URL,
      {
        model: VISION_MODEL,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: { url: `data:image/jpeg;base64,${base64Image}` }
              },
              {
                type: 'text',
                text: `请判断这张截图来自哪个券商App：
- 同花顺（tonghuashun）：橙红色主调，界面含"顺"字Logo，或界面风格为橙色系
- 东方财富（eastmoney）：绿色主调，界面含"东方财富"字样，或界面风格为绿色系
- 未知（unknown）：无法确认

只返回一个词：tonghuashun 或 eastmoney 或 unknown`
              }
            ]
          }
        ],
        max_tokens: 20
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );

    const text = response.data.choices[0]?.message?.content?.trim().toLowerCase() || 'unknown';
    if (text.includes('tonghuashun')) return 'tonghuashun';
    if (text.includes('eastmoney')) return 'eastmoney';
    return 'unknown';
  } catch (err) {
    console.error('[BrokerVision] detectAppType 失败:', err.message);
    return 'unknown';
  }
}

/**
 * 对单帧图片进行OCR识别，提取持仓数据
 * @param {string} base64Image - 图片的 base64 编码
 * @param {string} appType - App类型 'tonghuashun' | 'eastmoney' | 'unknown'
 * @returns {Promise<Object>} { holdings: Array, videoTime: string|null, challengeCode: string|null }
 */
async function ocrSingleFrame(base64Image, appType) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY 未配置');
  }

  // 根据App类型定制提示词
  const appName = appType === 'tonghuashun' ? '同花顺' : appType === 'eastmoney' ? '东方财富' : '券商';

  const prompt = `你是专业的股票持仓数据识别助手。请从这张${appName}券商App持仓截图中提取以下信息：

必填字段（每只持仓股票）：
- stock_name: 股票名称（中文）
- stock_code: 股票代码（6位数字）
- quantity: 持有数量（整数，单位：股）
- avg_cost: 持仓均价（元，保留2位小数）
- current_price: 最新价（元，保留2位小数）
- profit_amount: 盈亏金额（元，带+/-号，如 +1234.56 或 -567.89）
- profit_pct: 盈亏比例（百分比数值，带+/-号，如 +5.23 或 -2.11）
- market_value: 持仓市值（元）

可选字段（全局，不属于单个持仓）：
- video_time: 手机状态栏系统时间（格式 HH:MM，如 14:30），不可见填 null
- challenge_code: 视频中展示的4位数字挑战码（如 4821），不可见填 null

注意事项：
- ${appName}为 红涨绿跌 配色
- 数字请去除千分位逗号（如 1,234.56 → 1234.56）
- 如果某字段不可见或无法识别，填 null
- profit_pct 只填数字部分（不含%符号）

返回格式（纯JSON，不要markdown代码块）：
{
  "holdings": [
    {
      "stock_name": "贵州茅台",
      "stock_code": "600519",
      "quantity": 100,
      "avg_cost": 1800.00,
      "current_price": 1850.00,
      "profit_amount": 5000.00,
      "profit_pct": 2.78,
      "market_value": 185000.00
    }
  ],
  "video_time": "14:30",
  "challenge_code": "4821"
}`;

  const response = await axios.post(
    OPENROUTER_API_URL,
    {
      model: VISION_MODEL,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: `data:image/jpeg;base64,${base64Image}` }
            },
            { type: 'text', text: prompt }
          ]
        }
      ],
      max_tokens: 2000
    },
    {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 60000
    }
  );

  const rawText = response.data.choices[0]?.message?.content || '{}';

  // 解析JSON，容忍markdown代码块包裹
  let parsed;
  try {
    const jsonStr = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    console.error('[BrokerVision] JSON解析失败，原始内容:', rawText);
    parsed = { holdings: [], video_time: null, challenge_code: null };
  }

  return {
    holdings: Array.isArray(parsed.holdings) ? parsed.holdings : [],
    videoTime: parsed.video_time || null,
    challengeCode: parsed.challenge_code || null
  };
}

/**
 * 对多帧图片取众数（投票机制）
 * 对数字字段取出现次数最多的值，提高识别准确率
 * @param {Array} frameResults - 各帧OCR结果数组
 * @returns {Object} { holdings: Array, videoTime: string|null, challengeCode: string|null, confidence: number }
 */
function mergeFrameResults(frameResults) {
  if (!frameResults || frameResults.length === 0) {
    return { holdings: [], videoTime: null, challengeCode: null, confidence: 0 };
  }

  // 取视频时间众数
  const videoTimes = frameResults.map(r => r.videoTime).filter(Boolean);
  const videoTime = mostCommon(videoTimes) || null;

  // 取挑战码众数
  const challengeCodes = frameResults.map(r => r.challengeCode).filter(Boolean);
  const challengeCode = mostCommon(challengeCodes) || null;

  // 合并持仓数据：按股票代码分组，对数字字段取众数
  const holdingsMap = {}; // { stockCode: [holding, holding, ...] }

  for (const result of frameResults) {
    for (const h of result.holdings) {
      if (!h.stock_code) continue;
      if (!holdingsMap[h.stock_code]) holdingsMap[h.stock_code] = [];
      holdingsMap[h.stock_code].push(h);
    }
  }

  const mergedHoldings = [];
  for (const [code, items] of Object.entries(holdingsMap)) {
    // 该股票必须在多数帧中出现（至少出现在一半帧中）
    if (items.length < Math.ceil(frameResults.length / 2)) continue;

    mergedHoldings.push({
      stock_code: code,
      stock_name: mostCommon(items.map(i => i.stock_name).filter(Boolean)) || items[0].stock_name,
      quantity: mostCommonNumber(items.map(i => i.quantity)),
      avg_cost: mostCommonNumber(items.map(i => i.avg_cost)),
      current_price: mostCommonNumber(items.map(i => i.current_price)),
      profit_amount: mostCommonNumber(items.map(i => i.profit_amount)),
      profit_pct: mostCommonNumber(items.map(i => i.profit_pct)),
      market_value: mostCommonNumber(items.map(i => i.market_value))
    });
  }

  // 置信度：成功识别帧数 / 总帧数
  const validFrames = frameResults.filter(r => r.holdings.length > 0).length;
  const confidence = validFrames / frameResults.length;

  return { holdings: mergedHoldings, videoTime, challengeCode, confidence };
}

/**
 * 对字符串数组取众数
 */
function mostCommon(arr) {
  if (!arr || arr.length === 0) return null;
  const count = {};
  for (const v of arr) count[v] = (count[v] || 0) + 1;
  return Object.entries(count).sort((a, b) => b[1] - a[1])[0][0];
}

/**
 * 对数字数组取众数（精确到小数点2位后四舍五入比较）
 */
function mostCommonNumber(arr) {
  const validArr = arr.filter(v => v !== null && v !== undefined && !isNaN(v));
  if (validArr.length === 0) return null;
  // 转为字符串（精度截断）进行众数计算
  const strArr = validArr.map(v => String(Math.round(parseFloat(v) * 100)));
  const common = mostCommon(strArr);
  return common !== null ? parseFloat(common) / 100 : null;
}

/**
 * 主入口：对多个帧图片文件进行OCR识别
 * @param {string[]} framePaths - 帧图片文件路径数组
 * @param {string} [appType] - 可选，已知App类型
 * @returns {Promise<Object>} 识别结果
 */
async function recognizeFrames(framePaths, appType = null) {
  if (!framePaths || framePaths.length === 0) {
    throw new Error('没有可识别的帧图片');
  }

  console.log(`[BrokerVision] 开始识别 ${framePaths.length} 帧图片`);

  // 读取第一帧用于App类型检测
  const firstFrameBase64 = fs.readFileSync(framePaths[0]).toString('base64');

  // 如果未指定App类型，自动检测
  if (!appType) {
    appType = await detectAppType(firstFrameBase64);
    console.log(`[BrokerVision] 检测到App类型: ${appType}`);
  }

  // 对每帧进行OCR
  const frameResults = [];
  for (let i = 0; i < framePaths.length; i++) {
    const framePath = framePaths[i];
    console.log(`[BrokerVision] 识别第 ${i + 1}/${framePaths.length} 帧: ${path.basename(framePath)}`);
    try {
      const base64 = fs.readFileSync(framePath).toString('base64');
      const result = await ocrSingleFrame(base64, appType);
      frameResults.push(result);
      console.log(`[BrokerVision] 第 ${i + 1} 帧识别到 ${result.holdings.length} 只持仓`);
    } catch (err) {
      console.error(`[BrokerVision] 第 ${i + 1} 帧识别失败:`, err.message);
      frameResults.push({ holdings: [], videoTime: null, challengeCode: null });
    }
  }

  // 多帧取众数合并
  const merged = mergeFrameResults(frameResults);
  console.log(`[BrokerVision] 最终识别: ${merged.holdings.length} 只持仓，置信度: ${merged.confidence.toFixed(2)}`);

  return {
    appType,
    ...merged,
    frameCount: framePaths.length,
    frameResults // 保留原始结果用于调试
  };
}

module.exports = { recognizeFrames, detectAppType, ocrSingleFrame, mergeFrameResults };
