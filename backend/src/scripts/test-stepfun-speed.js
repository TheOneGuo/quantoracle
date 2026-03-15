#!/usr/bin/env node
/**
 * @file test-stepfun-speed.js
 * @description StepFun Step-3.5-Flash 分析速度测试脚本
 * 
 * 连续发送10次"分析贵州茅台基本面"请求，统计：
 *   - 平均响应时间
 *   - P95 / P99 响应时间
 *   - 成功率
 * 
 * 用法：
 *   OPENROUTER_API_KEY=<your_key> node test-stepfun-speed.js
 *   或配置 .env 后直接执行
 * 
 * @requires dotenv
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

// ─────────────────────────────────────────────────────────────────────────────
// 配置
// ─────────────────────────────────────────────────────────────────────────────
const API_KEY    = process.env.OPENROUTER_API_KEY || process.env.OPENROUTER_KEY || '';
const BASE_URL   = 'https://openrouter.ai/api/v1';
const MODEL      = 'stepfun/step-3.5-flash:free';
const ROUNDS     = 10;   // 测试轮次
const TIMEOUT_MS = 30000; // 单次超时（毫秒）

/** 测试用的简单提示词：要求一句话结论 */
const TEST_PROMPT = '请用一句话（不超过50字）分析贵州茅台(600519)的基本面投资价值。';

// ─────────────────────────────────────────────────────────────────────────────
// 单次请求
// ─────────────────────────────────────────────────────────────────────────────
async function singleRequest(round) {
  const start = Date.now();
  try {
    const resp = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
        'HTTP-Referer': 'https://quantoracle.local',
        'X-Title': 'QuantOracle Speed Test',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'user', content: TEST_PROMPT }],
        max_tokens: 100,
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const latency = Date.now() - start;

    if (!resp.ok) {
      const errText = await resp.text();
      return { round, ok: false, latency, error: `HTTP ${resp.status}: ${errText.slice(0, 120)}` };
    }

    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content || '(空响应)';
    return { round, ok: true, latency, content };
  } catch (e) {
    return { round, ok: false, latency: Date.now() - start, error: e.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 统计工具
// ─────────────────────────────────────────────────────────────────────────────
/**
 * 计算百分位数（线性插值）
 * @param {number[]} sorted - 已排序数组
 * @param {number} p - 百分位 0-100
 */
function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lo  = Math.floor(idx);
  const hi  = Math.ceil(idx);
  return Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo));
}

// ─────────────────────────────────────────────────────────────────────────────
// 主流程
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║     StepFun Step-3.5-Flash 速度测试（QuantOracle）    ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log(`模型：${MODEL}`);
  console.log(`接口：${BASE_URL}`);
  console.log(`轮次：${ROUNDS}  超时：${TIMEOUT_MS}ms`);
  console.log(`提示：${TEST_PROMPT}`);
  console.log('────────────────────────────────────────────────────────');

  if (!API_KEY) {
    console.error('⚠️  未检测到 OPENROUTER_API_KEY，请设置环境变量后重试。');
    process.exit(1);
  }

  const results = [];

  for (let i = 1; i <= ROUNDS; i++) {
    process.stdout.write(`  第 ${String(i).padStart(2)} 轮...  `);
    const res = await singleRequest(i);
    results.push(res);

    if (res.ok) {
      console.log(`✅ ${res.latency}ms  "${res.content?.slice(0, 40)}..."`);
    } else {
      console.log(`❌ ${res.latency}ms  错误：${res.error}`);
    }

    // 轮次之间短暂休息，避免被限速
    if (i < ROUNDS) await new Promise(r => setTimeout(r, 500));
  }

  // ──────────────── 汇总统计 ────────────────
  const successful = results.filter(r => r.ok);
  const failCount  = results.length - successful.length;
  const successRate = (successful.length / results.length * 100).toFixed(1);

  const latencies  = successful.map(r => r.latency).sort((a, b) => a - b);
  const avgLatency = latencies.length
    ? Math.round(latencies.reduce((s, v) => s + v, 0) / latencies.length)
    : 0;
  const p95 = percentile(latencies, 95);
  const p99 = percentile(latencies, 99);
  const minL = latencies[0] ?? 0;
  const maxL = latencies[latencies.length - 1] ?? 0;

  console.log('════════════════════════════════════════════════════════');
  console.log('📊 测试结果汇总');
  console.log('────────────────────────────────────────────────────────');
  console.log(`  成功率：${successRate}%  （${successful.length}/${results.length}，失败 ${failCount} 次）`);
  if (latencies.length > 0) {
    console.log(`  平均响应：${avgLatency}ms`);
    console.log(`  最快：${minL}ms  最慢：${maxL}ms`);
    console.log(`  P95：${p95}ms`);
    console.log(`  P99：${p99}ms`);
  }
  console.log('════════════════════════════════════════════════════════');

  // 输出机器可读 JSON（重定向到文件时有用）
  const summary = {
    model: MODEL,
    rounds: ROUNDS,
    success_count: successful.length,
    fail_count: failCount,
    success_rate_pct: parseFloat(successRate),
    avg_ms: avgLatency,
    min_ms: minL,
    max_ms: maxL,
    p95_ms: p95,
    p99_ms: p99,
    tested_at: new Date().toISOString(),
  };

  if (process.env.OUTPUT_JSON) {
    const fs = require('fs');
    const outPath = process.env.OUTPUT_JSON;
    fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));
    console.log(`\nJSON 已写入: ${outPath}`);
  }

  return summary;
}

main().catch(e => {
  console.error('测试脚本异常退出:', e);
  process.exit(1);
});
