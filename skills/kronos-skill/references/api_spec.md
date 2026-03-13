# Kronos API 规范

## 概述

Kronos金融K线预测微服务提供RESTful API接口，用于股票技术面分析和走势预测。服务支持多种部署方式（云端/本地）和多种模型大小。

## 基础信息

- **基础URL**: `http://localhost:8888`（本地部署）
- **内容类型**: `application/json`
- **响应格式**: JSON

## 健康检查

### GET /health

检查服务状态。

**响应示例**:
```json
{
  "status": "healthy",
  "timestamp": "2026-03-13T09:00:00.000Z",
  "model_loaded": true,
  "mock_mode": false
}
```

## 模型管理

### GET /models

列出所有可用模型。

**响应示例**:
```json
{
  "models": {
    "kronos-mini": {
      "name": "Kronos-mini",
      "model_id": "NeoQuasar/Kronos-mini",
      "tokenizer_id": "NeoQuasar/Kronos-Tokenizer-2k",
      "context_length": 2048,
      "params": "4.1M",
      "description": "轻量级模型，适合快速预测"
    },
    "kronos-small": {
      "name": "Kronos-small",
      "model_id": "NeoQuasar/Kronos-small",
      "tokenizer_id": "NeoQuasar/Kronos-Tokenizer-base",
      "context_length": 512,
      "params": "24.7M",
      "description": "小型模型，平衡性能与速度"
    },
    "kronos-base": {
      "name": "Kronos-base",
      "model_id": "NeoQuasar/Kronos-base",
      "tokenizer_id": "NeoQuasar/Kronos-Tokenizer-base",
      "context_length": 512,
      "params": "102.3M",
      "description": "基础模型，提供更好的预测质量"
    }
  },
  "current_model": "kronos-mini",
  "mock_mode": false,
  "recommendation": "kronos-mini（轻量快速）"
}
```

### POST /load-model

手动加载指定模型。

**请求参数**:
```json
{
  "model_name": "kronos-mini"
}
```

**响应示例**:
```json
{
  "status": "loaded",
  "model": "kronos-mini",
  "device": "mps"
}
```

## 预测接口

### POST /predict

执行K线预测。

**请求体**:
```json
{
  "code": "sh600519",
  "ohlcv": [
    [1689004800000, 150.0, 155.0, 148.0, 152.0, 1000000],
    [1689008400000, 152.0, 157.0, 150.0, 155.0, 1200000],
    [1689012000000, 155.0, 158.0, 153.0, 156.0, 1100000]
  ],
  "pred_len": 120,
  "model": "kronos-mini"
}
```

**字段说明**:
- `code`: 股票代码（仅用于标识）
- `ohlcv`: K线数据数组，每行包含[时间戳(毫秒), 开盘价, 最高价, 最低价, 收盘价, 成交量]
- `pred_len`: 预测长度（K线数量），建议1-500
- `model`: 模型名称，可选 `kronos-mini`, `kronos-small`, `kronos-base`

**响应示例**:
```json
{
  "success": true,
  "model": "kronos-mini",
  "trend": "bullish",
  "confidence": 0.72,
  "forecast": [
    [1691000000000, 156.5, 160.2, 154.8, 158.7, 950000],
    [1691003000000, 158.7, 161.5, 157.2, 160.1, 980000]
  ],
  "analysis": "模型预测sh600519未来呈上涨趋势，上涨概率72%。技术指标显示买方力量较强，建议关注支撑位。",
  "is_mock": false,
  "inference_time": 0.245
}
```

## Node.js后端集成示例

### 路由实现

```javascript
// routes/kronos.js
const axios = require('axios');
const NodeCache = require('node-cache');

// 缓存1小时
const cache = new NodeCache({ stdTTL: 3600 });

const KRONOS_API_URL = process.env.KRONOS_API_URL || 'http://localhost:8888';

/**
 * 调用Kronos进行预测
 * @param {string} code - 股票代码
 * @param {Array} ohlcvData - K线数据
 * @param {number} predLen - 预测长度
 * @param {string} model - 模型名称
 * @returns {Promise<Object>} 预测结果
 */
async function predictWithKronos(code, ohlcvData, predLen = 120, model = 'kronos-mini') {
  // 生成缓存键（股票代码+日期+模型）
  const today = new Date().toISOString().split('T')[0];
  const cacheKey = `kronos:${code}:${today}:${model}:${predLen}`;
  
  // 检查缓存
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log(`使用缓存预测结果 for ${code}`);
    return cached;
  }
  
  try {
    const response = await axios.post(`${KRONOS_API_URL}/predict`, {
      code,
      ohlcv: ohlcvData,
      pred_len: predLen,
      model
    }, {
      timeout: 30000 // 30秒超时
    });
    
    // 缓存成功结果
    if (response.data.success) {
      cache.set(cacheKey, response.data);
    }
    
    return response.data;
  } catch (error) {
    console.error('Kronos预测失败:', error.message);
    
    // 返回降级结果
    return {
      success: false,
      model,
      trend: 'neutral',
      confidence: 0.5,
      forecast: [],
      analysis: '预测服务暂时不可用',
      is_mock: true,
      inference_time: 0
    };
  }
}

/**
 * 从数据库获取K线数据并预测
 * @param {string} code - 股票代码
 * @param {number} lookback - 历史K线数量
 * @returns {Promise<Object>} 预测结果
 */
async function getStockPrediction(code, lookback = 400) {
  // 1. 从数据库或API获取历史数据
  const historicalData = await getHistoricalKlineData(code, lookback);
  
  if (!historicalData || historicalData.length < 50) {
    throw new Error('历史数据不足，至少需要50根K线');
  }
  
  // 2. 调用Kronos预测
  const prediction = await predictWithKronos(
    code,
    historicalData,
    120, // 预测120根K线
    'kronos-mini' // 使用轻量模型
  );
  
  // 3. 补充股票信息
  return {
    ...prediction,
    stock_code: code,
    timestamp: new Date().toISOString(),
    data_points: {
      historical: historicalData.length,
      predicted: prediction.forecast.length
    }
  };
}

// Express路由
app.get('/api/kronos/predict/:code', async (req, res) => {
  try {
    const { code } = req.params;
    const { lookback = 400, model = 'kronos-mini' } = req.query;
    
    const result = await getStockPrediction(code, parseInt(lookback));
    res.json(result);
  } catch (error) {
    console.error('预测处理失败:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      is_mock: true
    });
  }
});

// 批量预测接口
app.post('/api/kronos/batch-predict', async (req, res) => {
  try {
    const { codes, lookback = 200 } = req.body;
    
    if (!Array.isArray(codes) || codes.length === 0) {
      return res.status(400).json({ error: '需要提供股票代码数组' });
    }
    
    // 限制并发数量
    const batchSize = 5;
    const results = [];
    
    for (let i = 0; i < codes.length; i += batchSize) {
      const batch = codes.slice(i, i + batchSize);
      const batchPromises = batch.map(code => 
        getStockPrediction(code, lookback).catch(err => ({
          code,
          success: false,
          error: err.message
        }))
      );
      
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
      
      // 批次间延迟，避免过载
      if (i + batchSize < codes.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    res.json({
      success: true,
      count: results.length,
      results
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

### 环境变量配置

```env
# .env文件
KRONOS_API_URL=http://localhost:8888
KRONOS_CACHE_TTL=3600
KRONOS_DEFAULT_MODEL=kronos-mini
KRONOS_TIMEOUT=30000

# 降级配置
KRONOS_FALLBACK_ENABLED=true
KRONOS_MAX_RETRIES=3
```

## Python客户端示例

```python
# kronos_client.py
import requests
import pandas as pd
from typing import List, Dict, Any
import time
import hashlib
import json

class KronosClient:
    def __init__(self, base_url: str = "http://localhost:8888", api_key: str = None):
        self.base_url = base_url.rstrip('/')
        self.api_key = api_key
        self.session = requests.Session()
        self.cache = {}  # 简单内存缓存
        
    def _get_cache_key(self, data: Dict) -> str:
        """生成缓存键"""
        data_str = json.dumps(data, sort_keys=True)
        return hashlib.md5(data_str.encode()).hexdigest()
    
    def predict(
        self,
        code: str,
        ohlcv_data: List[List[float]],
        pred_len: int = 120,
        model: str = "kronos-mini",
        use_cache: bool = True
    ) -> Dict[str, Any]:
        """
        执行预测
        
        Args:
            code: 股票代码
            ohlcv_data: K线数据
            pred_len: 预测长度
            model: 模型名称
            use_cache: 是否使用缓存
            
        Returns:
            预测结果字典
        """
        # 准备请求数据
        request_data = {
            "code": code,
            "ohlcv": ohlcv_data,
            "pred_len": pred_len,
            "model": model
        }
        
        # 检查缓存
        if use_cache:
            cache_key = self._get_cache_key(request_data)
            if cache_key in self.cache:
                cache_entry = self.cache[cache_key]
                if time.time() - cache_entry["timestamp"] < 300:  # 5分钟
                    print(f"使用缓存结果 for {code}")
                    return cache_entry["data"]
        
        # 发送请求
        headers = {}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        
        try:
            response = self.session.post(
                f"{self.base_url}/predict",
                json=request_data,
                headers=headers,
                timeout=30
            )
            response.raise_for_status()
            result = response.json()
            
            # 缓存结果
            if use_cache and result.get("success"):
                cache_key = self._get_cache_key(request_data)
                self.cache[cache_key] = {
                    "timestamp": time.time(),
                    "data": result
                }
            
            return result
            
        except requests.exceptions.RequestException as e:
            print(f"API请求失败: {e}")
            # 返回降级结果
            return {
                "success": False,
                "model": model,
                "trend": "neutral",
                "confidence": 0.5,
                "forecast": [],
                "analysis": "预测服务暂时不可用",
                "is_mock": True,
                "inference_time": 0
            }
    
    def batch_predict(
        self,
        predictions: List[Dict],
        max_concurrent: int = 3
    ) -> List[Dict]:
        """
        批量预测
        
        Args:
            predictions: 预测请求列表
            max_concurrent: 最大并发数
            
        Returns:
            预测结果列表
        """
        results = []
        
        for i in range(0, len(predictions), max_concurrent):
            batch = predictions[i:i + max_concurrent]
            batch_results = []
            
            for pred in batch:
                result = self.predict(**pred)
                batch_results.append(result)
            
            results.extend(batch_results)
            
            # 批次间延迟
            if i + max_concurrent < len(predictions):
                time.sleep(1)
        
        return results
    
    def get_model_info(self) -> Dict:
        """获取模型信息"""
        response = self.session.get(f"{self.base_url}/models")
        response.raise_for_status()
        return response.json()
    
    def health_check(self) -> bool:
        """健康检查"""
        try:
            response = self.session.get(f"{self.base_url}/health", timeout=5)
            return response.status_code == 200
        except:
            return False

# 使用示例
if __name__ == "__main__":
    # 创建客户端
    client = KronosClient()
    
    # 检查服务状态
    if not client.health_check():
        print("服务不可用")
        exit(1)
    
    # 获取模型信息
    models = client.get_model_info()
    print(f"可用模型: {list(models['models'].keys())}")
    
    # 准备测试数据
    test_data = [
        [1689004800000, 150.0, 155.0, 148.0, 152.0, 1000000],
        [1689008400000, 152.0, 157.0, 150.0, 155.0, 1200000],
        [1689012000000, 155.0, 158.0, 153.0, 156.0, 1100000],
        [1689015600000, 156.0, 159.0, 154.0, 157.0, 1050000],
        [1689019200000, 157.0, 160.0, 155.0, 158.0, 1150000]
    ]
    
    # 执行预测
    result = client.predict(
        code="sh600519",
        ohlcv_data=test_data,
        pred_len=10,
        model="kronos-mini"
    )
    
    if result["success"]:
        print(f"预测趋势: {result['trend']} (置信度: {result['confidence']:.1%})")
        print(f"分析: {result['analysis']}")
        print(f"预测数量: {len(result['forecast'])}")
        
        # 转换为DataFrame
        if result["forecast"]:
            df = pd.DataFrame(
                result["forecast"],
                columns=["timestamp", "open", "high", "low", "close", "volume"]
            )
            df["timestamp"] = pd.to_datetime(df["timestamp"], unit="ms")
            print("\n预测数据:")
            print(df.head())
    else:
        print(f"预测失败: {result.get('error', '未知错误')}")
```

## 错误处理

### HTTP状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 请求成功 |
| 400 | 请求参数错误 |
| 500 | 服务器内部错误 |
| 503 | 服务不可用 |

### 错误响应格式

```json
{
  "error": "错误描述",
  "detail": "详细错误信息（可选）",
  "timestamp": "2026-03-13T09:00:00.000Z"
}
```

## 性能优化建议

1. **启用缓存**: 同一股票同一交易日的预测结果应该缓存
2. **批量处理**: 多个预测请求可以批量发送
3. **模型选择**: 根据需求选择合适模型（mini适合实时，base适合深度分析）
4. **数据预处理**: 确保输入数据格式正确，避免不必要的转换
5. **连接复用**: 使用HTTP连接池减少连接开销

## 安全建议

1. **API密钥**: 生产环境应配置API密钥验证
2. **访问限制**: 限制API访问频率和并发数
3. **输入验证**: 验证输入数据范围和格式
4. **错误处理**: 避免泄露内部错误信息
5. **HTTPS**: 生产环境必须使用HTTPS