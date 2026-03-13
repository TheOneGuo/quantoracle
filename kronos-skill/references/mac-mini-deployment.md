# Mac Mini M4 运行 Kronos 可行性评估

## 硬件规格
- **型号**: Mac Mini M4
- **内存**: 24GB 统一内存
- **存储**: 512GB SSD
- **芯片**: Apple M4（10核CPU，10核GPU）
- **神经网络引擎**: 16核
- **操作系统**: macOS Sequoia 或更新版本

## Kronos 模型规格

| 模型 | 参数量 | 上下文长度 | 预训练数据 | 发布状态 |
|------|--------|------------|------------|----------|
| Kronos-mini | 4.1M | 2048 | 45个全球交易所 | ✅ 开源 |
| Kronos-small | 24.7M | 512 | 45个全球交易所 | ✅ 开源 |
| Kronos-base | 102.3M | 512 | 45个全球交易所 | ✅ 开源 |
| Kronos-large | 499.2M | 512 | 45个全球交易所 | ❌ 未公开 |

## 内存占用分析

### 理论计算
- **FP32 精度**: 参数量 × 4 bytes
- **FP16/混合精度**: 参数量 × 2 bytes
- **推理时额外内存**: 约模型大小的 1.5-2 倍（用于激活、缓存等）

| 模型 | 参数量 | FP32 内存 | FP16 内存 | 预估总内存（推理） |
|------|--------|-----------|-----------|-------------------|
| Kronos-mini | 4.1M | 16.4 MB | 8.2 MB | 25-35 MB |
| Kronos-small | 24.7M | 98.8 MB | 49.4 MB | 150-200 MB |
| Kronos-base | 102.3M | 409.2 MB | 204.6 MB | 600-800 MB |

**结论**: Mac Mini M4 的 24GB 内存足以运行所有开源 Kronos 模型，甚至可同时运行多个模型。

## 部署方案对比

### 方案1: PyTorch + MPS（推荐）
**MPS (Metal Performance Shaders)** 是 Apple Silicon 的 GPU 加速后端。

**优点**:
- ✅ 官方支持，PyTorch 2.0+ 内置
- ✅ 利用 M4 GPU 加速，性能提升显著
- ✅ 代码改动最小（只需设置 `device="mps"`）
- ✅ 内存统一管理，无显存限制

**安装步骤**:
```bash
# 1. 安装 PyTorch with MPS 支持
pip install torch torchvision torchaudio

# 2. 安装 Kronos 依赖
pip install pandas numpy huggingface-hub einops matplotlib tqdm safetensors

# 3. 验证 MPS 可用性
python -c "import torch; print(f'MPS available: {torch.backends.mps.is_available()}')"
```

**代码示例**:
```python
import torch

# 自动选择设备
if torch.cuda.is_available():
    device = "cuda:0"
elif torch.backends.mps.is_available():
    device = "mps"
else:
    device = "cpu"

print(f"Using device: {device}")

# 加载模型时指定设备
model = Kronos.from_pretrained("NeoQuasar/Kronos-mini")
model.to(device)
```

### 方案2: Apple MLX 框架（实验性）
**MLX** 是 Apple 为 M 系列芯片优化的机器学习框架。

**优点**:
- ✅ 专门为 Apple Silicon 优化，性能可能更好
- ✅ 内存管理更高效
- ✅ 支持动态图和无缝 CPU/GPU 切换

**挑战**:
- ❌ Kronos 需要转换为 MLX 格式，无现成工具
- ❌ 需要重写模型加载和推理代码
- ❌ 社区支持相对较少

### 方案3: 转换为 GGUF 格式 + llama.cpp（不推荐）
**GGUF** 是 llama.cpp 使用的模型格式。

**可行性分析**:
- Kronos 是 Transformer decoder 架构，理论可转换
- 但无现成转换工具（Kronos → GGUF）
- 需要开发自定义转换脚本
- 转换后可能失去 Kronos 特有的 tokenizer 和预处理逻辑

**结论**: 技术可行，但实现成本高，不建议。

### 方案4: Ollama（不支持）
**Ollama** 仅支持 LLaMA 架构的 LLM。

**不兼容原因**:
1. Kronos 不是语言模型，是时序预测模型
2. Ollama 仅支持 GGUF 格式
3. Kronos 的架构和训练目标与 LLM 不同

## 性能预估

### 推理速度对比
| 场景 | Kronos-mini | Kronos-small | Kronos-base |
|------|-------------|--------------|-------------|
| M4 MPS (GPU加速) | 50-100 ms | 200-300 ms | 800-1200 ms |
| M4 CPU (神经网络引擎) | 100-200 ms | 400-600 ms | 2000-3000 ms |
| 云端 GPU (A10G) | 30-50 ms | 100-150 ms | 300-500 ms |

**注**: 基于类似规模模型的实测数据估算。

### 能耗评估
- **MPS GPU加速**: 能效高，推理时功耗约 5-10W
- **CPU模式**: 功耗较高，约 10-15W
- **持续运行成本**: 可忽略不计（相比云端）

## 安装部署指南

### 完整部署脚本
```bash
#!/bin/bash
# deploy_kronos_mac.sh

echo "=== Kronos Mac Mini M4 部署脚本 ==="

# 1. 创建虚拟环境
python3 -m venv kronos_env
source kronos_env/bin/activate

# 2. 安装 PyTorch with MPS
pip install torch torchvision torchaudio

# 3. 克隆 Kronos 仓库
git clone https://github.com/shiyu-coder/Kronos.git
cd Kronos

# 4. 安装依赖
pip install -r requirements.txt

# 5. 测试 MPS 加速
python -c "
import torch
print(f'PyTorch version: {torch.__version__}')
print(f'MPS available: {torch.backends.mps.is_available()}')
print(f'MPS built: {torch.backends.mps.is_built()}')
if torch.backends.mps.is_available():
    x = torch.rand(1000, 1000, device='mps')
    y = torch.rand(1000, 1000, device='mps')
    z = x @ y
    print('MPS 矩阵乘法测试成功')
"

# 6. 测试 Kronos 加载
python -c "
try:
    from model.kronos import Kronos, KronosTokenizer, KronosPredictor
    import torch
    
    device = 'mps' if torch.backends.mps.is_available() else 'cpu'
    print(f'使用设备: {device}')
    
    # 加载轻量模型测试
    tokenizer = KronosTokenizer.from_pretrained('NeoQuasar/Kronos-Tokenizer-2k')
    model = Kronos.from_pretrained('NeoQuasar/Kronos-mini')
    model.to(device)
    
    print('✅ Kronos-mini 加载成功')
    
except Exception as e:
    print(f'❌ 加载失败: {e}')
"

echo "=== 部署完成 ==="
```

### 系统要求检查
```bash
# 检查 macOS 版本
sw_vers -productVersion  # 需要 macOS 13.0+

# 检查内存
sysctl hw.memsize  # 显示字节数，应 ≥ 16GB

# 检查 Python
python3 --version  # 需要 Python 3.10+

# 检查磁盘空间
df -h /  # 需要至少 10GB 可用空间
```

## 与云端方案的对比

### 成本对比
| 方面 | Mac Mini M4 本地 | 云端 GPU 实例 | HuggingFace Endpoints |
|------|------------------|---------------|----------------------|
| 初始成本 | $799-$1299 | $0 | $0 |
| 持续成本 | 电费 (~$2/月) | $0.5-$2/小时 | $0.03-$0.10/千次调用 |
| 1年总成本 | ~$24 + 硬件 | $4380-$17520 | $262-$876（10万次/天） |
| 3年总成本 | 硬件成本 | $13140-$52560 | $787-$2628 |

### 性能对比
| 指标 | Mac Mini M4 | 云端 GPU | 说明 |
|------|-------------|----------|------|
| 延迟 | 100-1000ms | 50-500ms | 云端网络额外 +10-50ms |
| 吞吐量 | 10-50 req/s | 100-500 req/s | 取决于模型和批量大小 |
| 可用性 | 依赖本地电力 | 99.9% SLA | 云端更可靠 |
| 数据隐私 | 完全本地 | 数据传输风险 | 合规性要求 |

### 选择建议
| 使用场景 | 推荐方案 | 理由 |
|----------|----------|------|
| 开发测试 | Mac Mini 本地 | 成本低，快速迭代 |
| 小型生产 | Mac Mini + 云端备份 | 平衡成本与可靠性 |
| 大型生产 | 云端 GPU 集群 | 弹性扩展，高可用 |
| 隐私敏感 | Mac Mini 本地 | 数据不出本地 |
| 研究用途 | Mac Mini 本地 | 完全控制，无使用限制 |

## 优化建议

### 1. 内存优化
```python
# 使用混合精度推理
from torch.cuda.amp import autocast

with autocast():
    predictions = model(input_data)

# 及时释放内存
import gc
del model
gc.collect()
```

### 2. 批量处理优化
```python
# 利用 M4 统一内存优势，批量处理
batch_size = 8  # 根据内存调整
predictions = predictor.predict_batch(
    df_list=batch_data,
    x_timestamp_list=batch_timestamps,
    y_timestamp_list=batch_future_timestamps,
    pred_len=120,
    verbose=False
)
```

### 3. 缓存策略
```python
# 磁盘缓存预测结果
import pickle
import hashlib

def get_prediction_cache_key(code, data):
    data_hash = hashlib.md5(pickle.dumps(data)).hexdigest()
    return f"{code}_{data_hash}"

# 缓存到文件
cache_dir = "~/Library/Caches/Kronos"
```

### 4. 监控与日志
```python
import psutil
import time

def monitor_inference():
    start_time = time.time()
    start_memory = psutil.Process().memory_info().rss / 1024 / 1024
    
    # 执行预测
    result = predictor.predict(...)
    
    end_time = time.time()
    end_memory = psutil.Process().memory_info().rss / 1024 / 1024
    
    print(f"推理时间: {end_time - start_time:.2f}s")
    print(f"内存增加: {end_memory - start_memory:.1f}MB")
    return result
```

## 故障排除

### 常见问题

1. **MPS 不可用**
   ```bash
   # 解决方案
   pip install --upgrade torch
   # 确保 macOS ≥ 13.0
   ```

2. **内存不足**
   ```python
   # 解决方案：使用更小模型或减小批量大小
   model = Kronos.from_pretrained("NeoQuasar/Kronos-mini")
   ```

3. **推理速度慢**
   ```python
   # 解决方案：启用 MPS 和优化设置
   torch.set_num_threads(8)  # 设置 CPU 线程数
   torch.backends.mps.enabled = True
   ```

4. **模型加载失败**
   ```bash
   # 解决方案：设置代理（如果需要）
   export HTTP_PROXY=http://your-proxy:port
   export HTTPS_PROXY=http://your-proxy:port
   ```

## 性能测试结果（预估）

| 测试项目 | Kronos-mini | Kronos-small | Kronos-base |
|----------|-------------|--------------|-------------|
| 模型加载时间 | 2-3s | 5-8s | 15-25s |
| 单次推理时间 | 50-100ms | 200-300ms | 800-1200ms |
| 内存峰值 | 25-35MB | 150-200MB | 600-800MB |
| 连续推理 100次 | 8-12s | 25-35s | 90-130s |
| 温度升高 | 2-3°C | 4-6°C | 8-12°C |

## 结论

**Mac Mini M4 完全有能力运行 Kronos 模型**，具体建议如下：

1. **模型选择**: 从 Kronos-mini 开始，逐步测试更大模型
2. **部署方案**: 使用 PyTorch + MPS 方案，平衡性能和开发成本
3. **使用场景**: 适合开发测试、小型生产、隐私敏感应用
4. **扩展性**: 24GB 内存可支持多个模型同时运行

对于 QuantOracle 项目，**推荐采用混合架构**：
- 开发阶段使用 Mac Mini 本地部署
- 生产环境使用云端 GPU 服务
- 重要客户可提供本地部署选项

**最终建议**: 立即在 Mac Mini M4 上部署 Kronos-mini 进行验证，确认性能满足需求后，再评估是否需要升级到 Kronos-base 或云端方案。