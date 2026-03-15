/**
 * @file 核心算法混淆脚本
 * @description 对核心评分引擎做重度混淆后输出到 dist/services/
 * 只混淆列出的白名单文件；其他业务代码不混淆（保持可调试性）
 *
 * 使用方式：node scripts/obfuscate-core.js
 * 构建产物：backend/dist/services/（混淆后文件，供生产环境使用）
 */

const JavaScriptObfuscator = require('javascript-obfuscator');
const fs = require('fs');
const path = require('path');

// 需要保护的核心算法文件列表
const PROTECTED_FILES = [
  'src/services/pricing-engine.js',
  'src/services/credit-scorer.js',
  'src/services/publisher-rating.js',
  'src/services/stock-scorer.js',
];

// 混淆配置（重度混淆）
const OBFUSCATOR_OPTIONS = {
  compact: true,
  controlFlowFlattening: true,          // 控制流扁平化（最难还原）
  controlFlowFlatteningThreshold: 0.9,  // 90%节点扁平化
  deadCodeInjection: true,              // 注入大量无用代码干扰阅读
  deadCodeInjectionThreshold: 0.5,
  debugProtection: true,                // 防止断点调试还原
  debugProtectionInterval: 2000,
  disableConsoleOutput: false,          // 保留console（便于生产日志）
  identifierNamesGenerator: 'hexadecimal', // 变量名全部改为十六进制
  log: false,
  numbersToExpressions: true,           // 数字常量变成表达式（权重数字混淆关键！）
  renameGlobals: false,                 // 不改全局名（保持require/module兼容）
  rotateStringArray: true,
  selfDefending: true,                  // 代码自保护，检测到被修改则失效
  shuffleStringArray: true,
  simplify: true,
  splitStrings: true,
  splitStringsChunkLength: 8,
  stringArray: true,
  stringArrayCallsTransform: true,
  stringArrayEncoding: ['base64'],      // 字符串base64编码
  stringArrayIndexShift: true,
  stringArrayWrappersCount: 3,
  stringArrayWrappersChainedCalls: true,
  stringArrayWrappersParametersMaxCount: 5,
  stringArrayWrappersType: 'function',
  stringArrayThreshold: 0.9,
  transformObjectKeys: true,            // 对象key混淆（权重对象关键！）
  unicodeEscapeSequence: false,
};

// 确保输出目录存在
const distDir = path.join(__dirname, '..', 'dist', 'services');
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

let successCount = 0;
for (const relPath of PROTECTED_FILES) {
  const srcPath = path.join(__dirname, '..', relPath);
  const fileName = path.basename(relPath);
  const destPath = path.join(distDir, fileName);

  if (!fs.existsSync(srcPath)) {
    console.warn(`[跳过] 文件不存在: ${srcPath}`);
    continue;
  }

  const sourceCode = fs.readFileSync(srcPath, 'utf8');
  const obfuscated = JavaScriptObfuscator.obfuscate(sourceCode, OBFUSCATOR_OPTIONS);
  fs.writeFileSync(destPath, obfuscated.getObfuscatedCode(), 'utf8');
  console.log(`[完成] ${fileName} → dist/services/${fileName}`);
  successCount++;
}

console.log(`\n混淆完成：${successCount}/${PROTECTED_FILES.length} 个文件`);
console.log('生产环境请使用 dist/services/ 下的文件');

// 混淆完成后追加生成聚合文件
const aggregatorContent = `// 此文件由 obfuscate-core.js 自动生成，勿手动修改
// 生成时间：${new Date().toISOString()}
module.exports = {
  pricingEngine: require('./pricing-engine'),
  creditScorer: require('./credit-scorer'),
  publisherRating: require('./publisher-rating'),
  stockScorer: require('./stock-scorer'),
};`;
fs.writeFileSync(path.join(distDir, 'index.js'), aggregatorContent, 'utf8');
console.log('[完成] dist/services/index.js 聚合入口已生成');
