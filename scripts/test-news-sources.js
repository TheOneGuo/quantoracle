#!/usr/bin/env node
// 测试所有新闻RSS源：可达性 + 响应速度 + 最新一条新闻时间
// 运行方式：node scripts/test-news-sources.js
// 更新日期：2026-03-14 - 修复中文财经新闻源

const https = require('https');
const http = require('http');

const RSS_SOURCES = [
  // ===== 中文财经（RSS格式）=====
  // 新浪财经所有RSS端点均已失效（404），暂无可用替代RSS

  // ===== 海外财经（RSS）=====
  { name: 'CNBC Markets', url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html', category: 'US' },
  { name: 'MarketWatch', url: 'https://feeds.content.dowjones.io/public/rss/mw_realtimeheadlines', category: 'US' },
  { name: 'Yahoo Finance', url: 'https://finance.yahoo.com/rss/topstories', category: 'US' },
  { name: 'Yahoo Finance News', url: 'https://finance.yahoo.com/news/rssindex', category: 'US' },
  { name: 'Financial Times', url: 'https://www.ft.com/rss/home/international', category: 'GLOBAL' },
  { name: 'Seeking Alpha', url: 'https://seekingalpha.com/feed.xml', category: 'US' },

  // ===== 贵金属/大宗（RSS）=====
  // Kitco所有RSS路径已失效，替换为 mining.com
  { name: 'Mining.com Gold', url: 'https://www.mining.com/feed/', category: 'COMMODITY', headers: { 'Referer': 'https://www.mining.com/' } },

  // ===== 加密（RSS）=====
  { name: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss', category: 'CRYPTO' },
  { name: 'CoinTelegraph', url: 'https://cointelegraph.com/rss', category: 'CRYPTO' },

  // ===== 央行/宏观（RSS）=====
  { name: '美联储', url: 'https://www.federalreserve.gov/feeds/press_all.xml', category: 'MACRO' },
  { name: 'IMF', url: 'https://www.imf.org/en/News/rss?language=eng', category: 'MACRO' },

  // ===== 监管（RSS）=====
  { name: 'SEC Press', url: 'https://www.sec.gov/rss/news/press.xml', category: 'REGULATORY' },
];

// JSON API 源（中文财经）
const JSON_API_SOURCES = [
  {
    name: '同花顺财经',
    url: 'https://news.10jqka.com.cn/tapp/news/push/stock/?page=1&tag=&track=website&pagesize=20',
    category: 'CN',
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    useCurl: true, // Node.js HTTPS 在此服务器会ETIMEDOUT，改用curl
  },
];

function fetchUrl(url, extraHeaders = {}, timeoutMs = 10000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const lib = url.startsWith('https') ? https : http;
    let done = false;

    const defaultHeaders = {
      'User-Agent': 'Mozilla/5.0 (compatible; QuantOracle/1.0; RSS Reader)',
      'Accept': 'application/rss+xml, application/xml, text/xml, application/json, */*',
    };

    const req = lib.get(url, {
      headers: { ...defaultHeaders, ...extraHeaders },
      timeout: timeoutMs,
    }, (res) => {
      if (done) return;
      const statusCode = res.statusCode;
      
      if (statusCode >= 300 && statusCode < 400 && res.headers.location) {
        done = true;
        const redirectMs = Date.now() - start;
        // Resolve relative redirects
        let redirectUrl = res.headers.location;
        if (!redirectUrl.startsWith('http')) {
          try { redirectUrl = new URL(url).origin + redirectUrl; } catch(e) {}
        }
        fetchUrl(redirectUrl, extraHeaders, timeoutMs - redirectMs).then(r => {
          resolve({ ...r, responseTime: Date.now() - start });
        }).catch(() => {
          resolve({ statusCode, responseTime: Date.now() - start, error: 'redirect failed', valid: false });
        });
        res.destroy();
        return;
      }

      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; if (body.length > 500000) res.destroy(); });
      res.on('end', () => {
        if (done) return;
        done = true;
        const responseTime = Date.now() - start;
        const isXml = body.includes('<rss') || body.includes('<feed') || body.includes('<?xml');
        const isJson = !isXml && (body.startsWith('{') || body.startsWith('['));
        
        let latestDate = null;
        let latestTitle = null;

        if (isXml) {
          const pubDateMatch = body.match(/<pubDate>([^<]+)<\/pubDate>/);
          const updatedMatch = body.match(/<updated>([^<]+)<\/updated>/);
          const raw = (pubDateMatch && pubDateMatch[1]) || (updatedMatch && updatedMatch[1]);
          if (raw) { try { latestDate = new Date(raw.trim()); } catch(e) {} }
          const titleMatch = body.match(/<item[^>]*>[\s\S]*?<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/);
          if (titleMatch) latestTitle = titleMatch[1].substring(0, 60);
        } else if (isJson) {
          try {
            const d = JSON.parse(body);
            // 同花顺格式
            if (d.data && d.data.list && d.data.list.length > 0) {
              const first = d.data.list[0];
              latestTitle = first.title;
              if (first.time) latestDate = new Date(first.time * 1000);
            }
          } catch(e) {}
        }

        const valid = statusCode === 200 && (isXml || isJson);
        resolve({ statusCode, responseTime, valid, isXml, isJson, latestDate, latestTitle, bodyLen: body.length });
      });
      res.on('error', () => {
        if (done) return;
        done = true;
        resolve({ statusCode, responseTime: Date.now() - start, error: 'read error', valid: false });
      });
    });

    req.on('error', (e) => {
      if (done) return;
      done = true;
      resolve({ statusCode: 0, responseTime: Date.now() - start, error: e.message, valid: false });
    });

    req.on('timeout', () => {
      if (done) return;
      done = true;
      req.destroy();
      resolve({ statusCode: 0, responseTime: timeoutMs, error: 'timeout', valid: false });
    });

    setTimeout(() => {
      if (done) return;
      done = true;
      req.destroy();
      resolve({ statusCode: 0, responseTime: timeoutMs, error: 'timeout', valid: false });
    }, timeoutMs);
  });
}

function formatAge(date) {
  if (!date || isNaN(date.getTime())) return '未知';
  const ageMs = Date.now() - date.getTime();
  const mins = Math.floor(ageMs / 60000);
  if (mins < 60) return `${mins}分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}小时前`;
  return `${Math.floor(hours / 24)}天前`;
}

function statusIcon(r) {
  if (r.error === 'timeout') return '⏱️ ';
  if (r.valid) return '✅';
  if (r.statusCode === 403 || r.statusCode === 401) return '🔒';
  if (r.statusCode === 404) return '❓';
  if (r.statusCode >= 200 && r.statusCode < 300) return '⚠️ ';
  return '❌';
}

async function main() {
  console.log('\n📡 新闻源可达性测试报告 v2');
  console.log('============================');
  console.log(`测试时间: ${new Date().toLocaleString('zh-CN')}`);
  console.log(`RSS源: ${RSS_SOURCES.length} 个 | JSON API源: ${JSON_API_SOURCES.length} 个\n`);

  const results = [];

  console.log('--- RSS 源 ---');
  for (const src of RSS_SOURCES) {
    process.stdout.write(`  测试 ${src.name}... `);
    const r = await fetchUrl(src.url, {}, 10000);
    results.push({ ...src, ...r, format: 'RSS' });

    const icon = statusIcon(r);
    const timeStr = r.error === 'timeout' ? '超时(10s)' : `${r.responseTime}ms`;
    const statusStr = r.statusCode > 0 ? `HTTP ${r.statusCode}` : r.error;
    const ageStr = r.latestDate ? `最新: ${formatAge(r.latestDate)}` : '';
    const titleStr = r.latestTitle ? `"${r.latestTitle.substring(0,40)}"` : '';

    const namePad = src.name.padEnd(18);
    if (r.valid) {
      console.log(`${icon} ${namePad} ${timeStr.padStart(7)}  ${ageStr}  ${titleStr}`);
    } else if (r.error === 'timeout') {
      console.log(`${icon} ${namePad} 超时(10s)`);
    } else {
      const extra = r.statusCode === 403 ? '付费墙/封锁' : (r.error || '');
      console.log(`${icon} ${namePad} ${statusStr}  ${extra}`);
    }
  }

  console.log('\n--- JSON API 源（中文财经）---');
  for (const src of JSON_API_SOURCES) {
    process.stdout.write(`  测试 ${src.name}... `);
    // 部分中文源需要用 curl（Node.js HTTPS 在当前服务器环境会 ETIMEDOUT）
    let r;
    if (src.useCurl) {
      const { execSync } = require('child_process');
      try {
        const start = Date.now();
        const headerArgs = Object.entries(src.headers || {}).map(([k,v]) => `-H "${k}: ${v}"`).join(' ');
        const body = execSync(`curl -s --max-time 10 -A "Mozilla/5.0" ${headerArgs} "${src.url}"`, { timeout: 12000 }).toString();
        const responseTime = Date.now() - start;
        const isJson = body.startsWith('{') || body.startsWith('[');
        let latestTitle = null;
        if (isJson) {
          try {
            const d = JSON.parse(body);
            if (d.data && d.data.list && d.data.list.length > 0) latestTitle = d.data.list[0].title;
          } catch(e) {}
        }
        r = { statusCode: 200, responseTime, valid: isJson, isJson, latestTitle, bodyLen: body.length };
      } catch(e) {
        r = { statusCode: 0, responseTime: 10000, error: 'curl failed: ' + e.message.substring(0,50), valid: false };
      }
    } else {
      r = await fetchUrl(src.url, src.headers || {}, 10000);
    }
    results.push({ ...src, ...r, format: 'JSON' });

    const icon = statusIcon(r);
    const timeStr = r.error === 'timeout' ? '超时(10s)' : `${r.responseTime}ms`;
    const statusStr = r.statusCode > 0 ? `HTTP ${r.statusCode}` : r.error;
    const ageStr = r.latestDate ? `最新: ${formatAge(r.latestDate)}` : '';
    const titleStr = r.latestTitle ? `"${(r.latestTitle||'').substring(0,40)}"` : '';

    const namePad = src.name.padEnd(18);
    if (r.valid) {
      console.log(`${icon} ${namePad} ${timeStr.padStart(7)}  ${ageStr}  ${titleStr}`);
    } else {
      console.log(`${icon} ${namePad} ${statusStr}  ${r.error || ''}`);
    }
  }

  // Summary
  const available = results.filter(r => r.valid);
  const failed = results.filter(r => !r.valid);
  const cnAvailable = available.filter(r => r.category === 'CN');
  const avgLatency = available.length > 0
    ? Math.round(available.reduce((s, r) => s + r.responseTime, 0) / available.length)
    : 0;
  const fastest = [...available].sort((a, b) => a.responseTime - b.responseTime)[0];
  const slowest = [...available].sort((a, b) => b.responseTime - a.responseTime)[0];

  console.log('\n📊 汇总');
  console.log('--------');
  console.log(`总可用: ${available.length}/${results.length}`);
  console.log(`中文源可用: ${cnAvailable.length} 个 (JSON API)`);
  console.log(`英文源可用: ${available.filter(r => r.category !== 'CN').length} 个 (RSS)`);
  console.log(`平均延迟: ${avgLatency}ms`);
  if (fastest) console.log(`最快: ${fastest.name} ${fastest.responseTime}ms`);
  if (slowest) console.log(`最慢: ${slowest.name} ${slowest.responseTime}ms`);

  console.log('\n❌ 不可用源:');
  failed.forEach(r => {
    const reason = r.error === 'timeout' ? '超时' : (r.statusCode ? `HTTP ${r.statusCode}` : r.error);
    console.log(`   ${r.name}: ${reason}`);
  });

  console.log('\n✅ 测试完成');
}

main().catch(console.error);
