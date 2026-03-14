#!/usr/bin/env node
// 测试所有新闻RSS源：可达性 + 响应速度 + 最新一条新闻时间
// 运行方式：node scripts/test-news-sources.js

const https = require('https');
const http = require('http');

const RSS_SOURCES = [
  // 中文财经
  { name: '新浪财经', url: 'https://feed.sina.com.cn/news/finance/mix.xml', category: 'CN' },
  { name: '腾讯财经', url: 'https://new.qq.com/rss/finance.xml', category: 'CN' },
  { name: '华尔街见闻', url: 'https://wallstreetcn.com/feed', category: 'CN' },
  // 海外
  { name: 'CNBC Markets', url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html', category: 'US' },
  { name: 'MarketWatch', url: 'https://feeds.content.dowjones.io/public/rss/mw_realtimeheadlines', category: 'US' },
  { name: 'Yahoo Finance', url: 'https://finance.yahoo.com/news/rssindex', category: 'US' },
  { name: 'Financial Times', url: 'https://www.ft.com/rss/home', category: 'GLOBAL' },
  { name: 'Seeking Alpha', url: 'https://seekingalpha.com/feed.xml', category: 'US' },
  // 贵金属/大宗
  { name: 'Kitco Gold', url: 'https://www.kitco.com/rss/News.xml', category: 'COMMODITY' },
  // 加密
  { name: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', category: 'CRYPTO' },
  { name: 'CoinTelegraph', url: 'https://cointelegraph.com/rss', category: 'CRYPTO' },
  // 央行/宏观
  { name: '美联储', url: 'https://www.federalreserve.gov/feeds/press_all.xml', category: 'MACRO' },
  { name: 'IMF', url: 'https://www.imf.org/en/News/rss?language=eng', category: 'MACRO' },
  // SEC
  { name: 'SEC Press', url: 'https://www.sec.gov/rss/news/press.xml', category: 'REGULATORY' },
];

function fetchUrl(url, timeoutMs = 10000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const lib = url.startsWith('https') ? https : http;
    let done = false;

    const req = lib.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; QuantOracle/1.0; RSS Reader)',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
      },
      timeout: timeoutMs,
    }, (res) => {
      if (done) return;
      const statusCode = res.statusCode;
      
      // Handle redirects
      if (statusCode >= 300 && statusCode < 400 && res.headers.location) {
        done = true;
        const redirectMs = Date.now() - start;
        // Follow redirect
        fetchUrl(res.headers.location, timeoutMs - redirectMs).then(r => {
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
        
        let latestDate = null;
        if (isXml) {
          const pubDateMatch = body.match(/<pubDate>([^<]+)<\/pubDate>/);
          const updatedMatch = body.match(/<updated>([^<]+)<\/updated>/);
          const raw = (pubDateMatch && pubDateMatch[1]) || (updatedMatch && updatedMatch[1]);
          if (raw) {
            try { latestDate = new Date(raw.trim()); } catch(e) {}
          }
        }

        resolve({ statusCode, responseTime, valid: isXml && statusCode === 200, latestDate, bodyLen: body.length });
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
  console.log('\n📡 新闻源可达性测试报告');
  console.log('========================');
  console.log(`测试时间: ${new Date().toLocaleString('zh-CN')}`);
  console.log(`总数: ${RSS_SOURCES.length} 个源\n`);

  const results = [];

  for (const src of RSS_SOURCES) {
    process.stdout.write(`  测试 ${src.name}... `);
    const r = await fetchUrl(src.url, 10000);
    results.push({ ...src, ...r });

    const icon = statusIcon(r);
    const timeStr = r.error === 'timeout' ? '超时(10s)' : `${r.responseTime}ms`;
    const statusStr = r.statusCode > 0 ? `HTTP ${r.statusCode}` : r.error;
    const ageStr = r.latestDate ? `最新: ${formatAge(r.latestDate)}` : '';

    const namePad = src.name.padEnd(16);
    if (r.valid) {
      console.log(`${icon} ${namePad} ${timeStr.padStart(7)}  ${ageStr}`);
    } else if (r.error === 'timeout') {
      console.log(`${icon} ${namePad} 超时(10s)`);
    } else {
      const extra = r.statusCode === 403 ? '付费墙/封锁' : (r.error || '');
      console.log(`${icon} ${namePad} ${statusStr}  ${extra}`);
    }
  }

  // Summary
  const available = results.filter(r => r.valid);
  const failed = results.filter(r => !r.valid);
  const availPct = Math.round(available.length / results.length * 100);
  const avgLatency = available.length > 0
    ? Math.round(available.reduce((s, r) => s + r.responseTime, 0) / available.length)
    : 0;
  const fastest = available.sort((a, b) => a.responseTime - b.responseTime)[0];
  const slowest = available.length > 0 ? available[available.length - 1] : null;

  console.log('\n📊 汇总');
  console.log('--------');
  console.log(`可用: ${available.length}/${results.length} (${availPct}%)`);
  console.log(`平均延迟: ${avgLatency}ms`);
  if (fastest) console.log(`最快: ${fastest.name} ${fastest.responseTime}ms`);
  if (slowest) console.log(`最慢: ${slowest.name} ${slowest.responseTime}ms`);

  // Priority recommendation: fastest + most recent
  const prioritized = [...available]
    .sort((a, b) => {
      // Score: lower latency = better, with freshness bonus
      const latencyScore = a.responseTime - b.responseTime;
      return latencyScore;
    })
    .slice(0, 5)
    .map(r => r.name);

  console.log(`推荐优先级: [${prioritized.join(', ')}]`);

  console.log('\n❌ 不可用源:');
  failed.forEach(r => {
    const reason = r.error === 'timeout' ? '超时' : (r.statusCode ? `HTTP ${r.statusCode}` : r.error);
    console.log(`   ${r.name}: ${reason}`);
  });

  console.log('\n✅ 测试完成');
}

main().catch(console.error);
