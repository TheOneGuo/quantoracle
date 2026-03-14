#!/usr/bin/env node
// 测试 StepFun step-3.5-flash:free 对新闻的分析速度和质量
// 运行方式：OPENROUTER_API_KEY=xxx node scripts/test-stepfun-analysis.js

const https = require('https');

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const MODEL = 'stepfun/step-3.5-flash:free';

const TEST_NEWS = [
  {
    title: '美联储宣布降息25个基点，超市场预期',
    content: '美联储联邦公开市场委员会（FOMC）周三宣布将联邦基金利率目标区间下调25个基点至4.25%-4.50%，这是今年第三次降息。美联储主席鲍威尔表示，此次降息是基于对通胀持续回落和就业市场稳定的判断。市场此前预期降息概率约为70%，实际结果超出部分机构预期。',
    category: '宏观'
  },
  {
    title: '贵州茅台Q3净利润同比增长15%，超分析师预期',
    content: '贵州茅台发布三季度业绩公告，Q3实现营收388亿元，同比增长12%；净利润178亿元，同比增长15%，超过市场平均预期的168亿元。公司直销渠道占比进一步提升至42%，吨价同比提升约8%。管理层表示全年业绩目标完成确定性较高。',
    category: 'A股'
  },
  {
    title: '英伟达发布新一代H200 GPU，AI推理性能提升3倍',
    content: '英伟达在年度GTC大会上正式发布H200 GPU，采用新一代Hopper架构改进版，配备141GB HBM3e显存，AI推理性能较上一代H100提升3倍，能效比提升40%。该芯片将于2025年Q1量产，主要面向云计算和AI训练市场。台积电将负责代工生产，采用4nm工艺。',
    category: '美股/科技'
  },
  {
    title: '中国央行下调存款准备金率0.5个百分点',
    content: '中国人民银行宣布，自本月20日起下调金融机构存款准备金率0.5个百分点（不含已执行5%存款准备金率的金融机构），本次下调后，金融机构加权平均存款准备金率约为6.6%。此次降准预计释放长期资金约1万亿元，旨在支持实体经济发展，保持流动性合理充裕。',
    category: '宏观/A股'
  },
  {
    title: '比特币突破10万美元关口，创历史新高',
    content: '比特币价格周四突破10万美元关口，创下历史新高，24小时涨幅超过8%。此轮上涨主要受现货比特币ETF持续获批、机构资金大量流入以及市场对加密资产监管环境改善预期推动。比特币市值突破2万亿美元，超越白银成为全球第七大资产。',
    category: '加密'
  },
];

const PROMPT_TEMPLATE = `请分析以下金融新闻，以JSON格式返回：
{
  "sentiment": -1到1的浮点数（-1最负面，1最正面）,
  "sentiment_label": "利好/利空/中性",
  "affected_sectors": ["受影响的行业"],
  "beneficiaries": ["可能受益的股票/行业"],
  "losers": ["可能受损的股票/行业"],
  "importance": 1-5整数,
  "reason": "50字以内的分析理由"
}
只返回JSON，不要其他内容。

新闻标题：{title}
新闻内容：{content}`;

function callOpenRouter(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: MODEL,
      messages: [{ role: 'user', content: prompt }],
      stream: true,
      max_tokens: 300,
    });

    const options = {
      hostname: 'openrouter.ai',
      path: '/api/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'HTTP-Referer': 'https://github.com/TheOneGuo/quantoracle',
        'X-Title': 'QuantOracle',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const startTime = Date.now();
    let firstTokenTime = null;
    let fullText = '';
    let tokenCount = 0;

    const req = https.request(options, (res) => {
      if (res.statusCode !== 200) {
        let errBody = '';
        res.on('data', c => errBody += c);
        res.on('end', () => reject(new Error(`HTTP ${res.statusCode}: ${errBody.slice(0, 200)}`)));
        return;
      }

      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        if (!firstTokenTime) firstTokenTime = Date.now();
        
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              fullText += delta;
              tokenCount++;
            }
          } catch (e) {}
        }
      });

      res.on('end', () => {
        const totalTime = Date.now() - startTime;
        resolve({
          text: fullText,
          firstTokenMs: firstTokenTime ? firstTokenTime - startTime : totalTime,
          totalMs: totalTime,
          tokenCount,
        });
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

async function analyzeNews(news, index) {
  const prompt = PROMPT_TEMPLATE
    .replace('{title}', news.title)
    .replace('{content}', news.content);

  console.log(`\n测试${index + 1}: ${news.title}`);
  console.log(`  类别: ${news.category}`);

  try {
    const result = await callOpenRouter(prompt);
    
    console.log(`  首Token延迟: ${result.firstTokenMs}ms`);
    console.log(`  总响应时间: ${result.totalMs}ms`);
    console.log(`  输出tokens: ${result.tokenCount} (chunks)`);

    // Parse JSON
    let analysis = null;
    try {
      const jsonMatch = result.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) analysis = JSON.parse(jsonMatch[0]);
    } catch (e) {}

    if (analysis) {
      console.log(`  情感评分: ${analysis.sentiment} (${analysis.sentiment_label})`);
      console.log(`  重要性: ${analysis.importance}/5`);
      console.log(`  受益: [${(analysis.beneficiaries || []).slice(0,3).join(', ')}]`);
      console.log(`  受损: [${(analysis.losers || []).slice(0,3).join(', ')}]`);
      console.log(`  分析: ${analysis.reason}`);
    } else {
      console.log(`  原始响应: ${result.text.slice(0, 100)}`);
    }

    return { ...result, analysis, success: true };
  } catch (e) {
    console.log(`  ❌ 失败: ${e.message}`);
    return { success: false, error: e.message, firstTokenMs: 0, totalMs: 0, tokenCount: 0 };
  }
}

async function main() {
  console.log('\n🤖 StepFun step-3.5-flash:free 分析速度测试');
  console.log('==========================================');
  console.log(`模型: ${MODEL}`);
  console.log(`测试时间: ${new Date().toLocaleString('zh-CN')}`);

  if (!OPENROUTER_API_KEY) {
    console.log('\n❌ 错误: OPENROUTER_API_KEY 环境变量未设置');
    console.log('运行方式: OPENROUTER_API_KEY=your_key node scripts/test-stepfun-analysis.js');
    console.log('\n📋 测试脚本已就绪，等待API Key配置后可运行');
    console.log('\n模拟基准数据（仅供参考）:');
    console.log('  预估首Token延迟: 800-1500ms（free tier）');
    console.log('  预估总响应时间: 2000-4000ms（free tier）');
    console.log('  预估输出tokens: 80-120 tokens/次');
    console.log('\n💡 建议: 配置OPENROUTER_API_KEY后运行真实基准测试');
    process.exit(0);
  }

  const results = [];
  for (let i = 0; i < TEST_NEWS.length; i++) {
    const r = await analyzeNews(TEST_NEWS[i], i);
    results.push(r);
    // Rate limit buffer
    if (i < TEST_NEWS.length - 1) await new Promise(r => setTimeout(r, 1000));
  }

  const successful = results.filter(r => r.success);
  
  console.log('\n📊 基准汇总');
  console.log('----------');
  console.log(`成功: ${successful.length}/${results.length}`);
  
  if (successful.length > 0) {
    const avgFirst = Math.round(successful.reduce((s, r) => s + r.firstTokenMs, 0) / successful.length);
    const avgTotal = Math.round(successful.reduce((s, r) => s + r.totalMs, 0) / successful.length);
    const avgTokens = Math.round(successful.reduce((s, r) => s + r.tokenCount, 0) / successful.length);
    
    console.log(`平均首Token延迟: ${avgFirst}ms`);
    console.log(`平均总响应时间: ${avgTotal}ms`);
    console.log(`平均输出chunks: ${avgTokens}`);
    
    let speedLabel, sceneLabel;
    if (avgFirst < 1000) { speedLabel = '良好'; sceneLabel = '实时/接近实时'; }
    else if (avgFirst < 2000) { speedLabel = '一般'; sceneLabel = '批量处理'; }
    else { speedLabel = '较慢'; sceneLabel = '定时批量'; }
    
    console.log(`推荐: StepFun分析速度[${speedLabel}]，适合[${sceneLabel}]场景`);
  }

  console.log('\n✅ 测试完成');
}

main().catch(console.error);
