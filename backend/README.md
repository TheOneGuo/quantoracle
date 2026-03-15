# QuantOracle Backend

股票策略平台后端服务。

## 快速启动（开发环境）

```bash
cp .env.example .env
# 编辑 .env 填入实际配置
npm install
npm run dev
```

## 核心算法保护

本项目评分引擎、定价算法等核心逻辑经过混淆处理：

1. **开发环境**：直接运行 `npm start`，使用未混淆源码（便于调试）
2. **生产部署**：
   ```bash
   # 1. 配置真实权重到 .env（不可提交到版本库）
   # 2. 生成混淆版本
   npm run build:core
   # 3. 启动服务（自动使用 dist/services/ 下的混淆版本）
   NODE_ENV=production npm start
   ```
3. **算法权重**：存储在 `.env` 中，不出现在任何代码文件里
4. **混淆级别**：控制流扁平化 + 死代码注入 + 数字表达式化 + 字符串base64 + 自保护
