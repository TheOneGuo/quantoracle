# kronos-technical-analysis

使用 Kronos 金融K线大模型对股票进行技术面分析和走势预测。

## 简介

Kronos 是首个开源金融K线（K-line）基础模型，在45个全球交易所的超120亿条K线记录上预训练。它将多维K线数据（OHLCV）量化为层次化离散token，使用自回归Transformer架构进行预测，支持价格序列预测、波动率预测和合成数据生成等多种金融任务。

## 模型规格

| 模型 | 参数量 | 上下文长度 | 适用场景 | HF模型ID |
|------|--------|------------|----------|-----------|
| Kronos-mini | 4.1M | 2048 | 轻量快速预测 | `NeoQuasar/Kronos-mini` |
| Kronos-small | 24.7M | 512 | 平衡性能与速度 | `NeoQuasar/Kronos-small` |
| Kronos-base | 102.3M | 512 | 高质量预测 | `NeoQuasar/Kronos-base` |
| Kronos-large | 499.2M | 512 | 研究用途（未公开） | 不可用 |

## 部署选项

### 选项1：云端API（推荐）
**适用于 QuantOracle 后端，无需本地GPU**

**方案A：使用现有 HuggingFace Space API**
- 社区已部署的API服务：`yangyang158/kronos`（可能休眠）
- 接口：`POST /api/predict`，输入K线数据，返回预测结果
- 可自行fork并部署到HuggingFace Spaces（免费GPU资源）

**方案B：HuggingFace Inference Endpoints（付费）**
- 按需部署`NeoQuasar/Kronos-mini`或`Kronos-base`
- 费用：约$0.03-$0.10/千次调用（取决于模型大小）
- 优点：免维护，高可用，自动扩缩容

**方案C：自建 FastAPI 微服务（需要GPU服务器）**
- 部署在云服务器（AWS/GCP/Azure GPU实例）
- 提供统一API供Node.js后端调用

### 选项2：本地部署（Mac Mini M4）
**适用于隐私敏感场景，24GB统一内存足够运行**

**推荐方案：PyTorch + MPS（Apple Silicon GPU加速）**
- 使用`torch.device("mps")`利用M4 GPU
- 内存占用估算：
  - Kronos-mini: ~16MB (FP32) / ~8MB (FP16)
  - Kronos-small: ~99MB (FP32) / ~49MB (FP16)
  - Kronos-base: ~409MB (FP32) / ~205MB (FP16)

**备选方案：转换到MLX框架（实验性）**
- 使用Apple MLX框架获得最佳M系列芯片性能
- 需要模型转换脚本（目前无官方支持）

**不支持方案：Ollama**
- Kronos是PyTorch模型，非GGUF格式
- 无现成转换工具到llama.cpp格式
- Ollama仅支持LLaMA架构的LLM，不适用于时序Transformer

## SETUP

### 云端API部署（FastAPI微服务）

```bash
# 1. 克隆仓库
git clone https://github.com/quantoracle/kronos-skill.git
cd kronos-skill/scripts

# 2. 安装依赖
pip install -r requirements.txt

# 3. 启动服务
uvicorn kronos_service:app --host 0.0.0.0 --port 8888
```

### 本地Mac部署

```bash
# 1. 安装PyTorch with MPS支持
pip install torch torchvision torchaudio

# 2. 安装其他依赖
pip install pandas numpy fastapi uvicorn huggingface-hub einops matplotlib tqdm safetensors

# 3. 验证MPS可用性
python -c "import torch; print(f'MPS available: {torch.backends.mps.is_available()}')"

# 4. 启动服务（自动使用MPS）
python scripts/kronos_service.py
```

## USAGE

### API接口规范

**POST /predict**
```json
{
  "code": "sh600519",
  "ohlcv": [
    [1689004800000, 150.0, 155.0, 148.0, 152.0, 1000000],
    [1689008400000, 152.0, 157.0, 150.0, 155.0, 1200000],
    // ... 更多K线数据
  ],
  "pred_len": 120,
  "model": "kronos-mini"  // 可选：kronos-mini, kronos-small, kronos-base
}
```

**响应格式**
```json
{
  "success": true,
  "model": "kronos-mini",
  "trend": "bullish",  // bullish/bearish/neutral
  "confidence": 0.72,
  "forecast": [
    [1691000000000, 156.5, 160.2, 154.8, 158.7, 950000],
    // ... 预测的K线数据
  ],
  "analysis": "模型预测未来120根K线呈上涨趋势，上涨概率72%，建议关注...",
  "is_mock": false  // 如果是mock数据则为true
}
```

### Node.js后端集成示例

```javascript
// routes/kronos.js
const axios = require('axios');
const NodeCache = require('node-cache');
const cache = new NodeCache({ stdTTL: 3600 }); // 缓存1小时

async function predictKronos(code, ohlcvData) {
  const cacheKey = `kronos:${code}:${new Date().toISOString().split('T')[0]}`;
  
  // 检查缓存
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  
  try {
    const response = await axios.post('http://localhost:8888/predict', {
      code,
      ohlcv: ohlcvData,
      pred_len: 120,
      model: 'kronos-mini'
    });
    
    // 缓存结果
    cache.set(cacheKey, response.data);
    return response.data;
  } catch (error) {
    console.error('Kronos预测失败:', error.message);
    // 返回mock数据
    return {
      success: false,
      trend: 'neutral',
      confidence: 0.5,
      forecast: [],
      analysis: '模型服务暂时不可用',
      is_mock: true
    };
  }
}

// Express路由
app.get('/api/kronos/predict/:code', async (req, res) => {
  const { code } = req.params;
  // 从数据库或API获取历史K线数据
  const historicalData = await getKlineData(code, 400); // 获取最近400根K线
  
  const result = await predictKronos(code, historicalData);
  res.json(result);
});
```

### Python客户端示例

```python
import requests
import pandas as pd

def predict_with_kronos(ohlcv_df, model='kronos-mini', pred_len=120):
    """
    ohlcv_df: DataFrame with columns ['timestamp', 'open', 'high', 'low', 'close', 'volume']
    """
    # 转换数据格式
    data = {
        'ohlcv': ohlcv_df[['timestamp', 'open', 'high', 'low', 'close', 'volume']].values.tolist(),
        'pred_len': pred_len,
        'model': model
    }
    
    response = requests.post('http://localhost:8888/predict', json=data)
    if response.status_code == 200:
        return response.json()
    else:
        raise Exception(f'Kronos API错误: {response.text}')
```

## LIMITATIONS

### 硬件要求
- **云端部署**：需要GPU服务器（至少4GB显存）运行Kronos-base
- **Mac M4部署**：Kronos-base可运行，但推理速度可能较慢（~2-5秒/预测）
- **CPU-only模式**：仅推荐Kronos-mini（4.1M参数），Kronos-small以上延迟较高

### 模型限制
- 最大上下文长度：Kronos-small/base为512，Kronos-mini为2048
- 仅支持OHLCV格式输入（volume可选）
- 预测长度建议不超过120根K线（~2天，5分钟级别）
- 对于A股数据，建议先进行微调以获得更好效果

### 性能预期
| 模型 | GPU推理时间 | CPU推理时间 | M4 MPS推理时间 |
|------|------------|-------------|----------------|
| Kronos-mini | ~50ms | ~200ms | ~100ms |
| Kronos-small | ~200ms | ~800ms | ~300ms |
| Kronos-base | ~500ms | ~3s | ~1s |

### 成本考虑
- HuggingFace Inference Endpoints：约$0.03-$0.10/千次调用
- 自建GPU服务器：$0.5-$2/小时（取决于实例类型）
- Mac Mini本地：一次性硬件成本，无持续费用

## 快速开始

1. **选择部署方案**
   - 开发测试：使用Mac Mini本地运行Kronos-mini
   - 生产环境：部署HuggingFace Inference Endpoints或自建GPU服务器

2. **启动服务**
   ```bash
   cd scripts
   python kronos_service.py
   ```

3. **测试API**
   ```bash
   curl -X POST http://localhost:8888/predict \
     -H "Content-Type: application/json" \
     -d '{"code": "test", "ohlcv": [[1691000000000, 150, 155, 148, 152, 1000000]], "pred_len": 10}'
   ```

4. **集成到QuantOracle**
   - 修改后端路由，调用Kronos微服务
   - 实现结果缓存（同一股票同一交易日只预测一次）
   - 前端展示智能分析卡片

## 故障排除

### 常见问题
1. **模型加载失败（CUDA out of memory）**
   - 改用Kronos-mini或Kronos-small
   - 启用CPU-only模式：修改代码使用`device="cpu"`

2. **MPS加速不可用（Mac）**
   - 确认PyTorch版本≥2.0.0
   - 运行`python -c "import torch; print(torch.backends.mps.is_available())"`
   - 升级macOS到最新版本

3. **API响应慢**
   - 减少`pred_len`参数（默认120）
   - 使用Kronos-mini替代base模型
   - 启用结果缓存

4. **预测结果不准确**
   - 确保输入数据格式正确（timestamp为毫秒）
   - 增加历史数据长度（建议≥200根K线）
   - 考虑对A股数据进行微调

## 进阶配置

### 微调Kronos（A股适配）
参考官方finetune流程：
```bash
# 1. 准备Qlib数据
pip install pyqlib
python finetune/qlib_data_preprocess.py

# 2. 微调tokenizer
torchrun --standalone --nproc_per_node=1 finetune/train_tokenizer.py

# 3. 微调predictor
torchrun --standalone --nproc_per_node=1 finetune/train_predictor.py
```

### 批处理预测
Kronos支持batch预测，适合批量分析：
```python
# 同时预测多只股票
pred_results = predictor.predict_batch(
    df_list=[df1, df2, df3],
    x_timestamp_list=[ts1, ts2, ts3],
    y_timestamp_list=[yts1, yts2, yts3],
    pred_len=120
)
```

### 监控与日志
```python
# 启用详细日志
import logging
logging.basicConfig(level=logging.INFO)

# 性能监控
import time
start = time.time()
prediction = predictor.predict(...)
print(f"推理时间: {time.time() - start:.2f}s")
```

## 参考资源
- [GitHub仓库](https://github.com/shiyu-coder/Kronos)
- [HuggingFace模型](https://huggingface.co/NeoQuasar/Kronos-base)
- [论文](https://arxiv.org/abs/2508.02739)
- [官方Demo](https://shiyu-coder.github.io/Kronos-demo/)
- [社区API示例](https://huggingface.co/spaces/yangyang158/kronos)

---

**注意**：本Skill提供的金融预测仅供参考，不构成投资建议。实际交易请结合更多因素综合分析。