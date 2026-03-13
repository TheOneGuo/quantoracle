"""
Kronos金融K线预测微服务 (FastAPI版本)
支持本地模型推理和云端API回退
"""

import os
import sys
import logging
import json
import time
from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta

import pandas as pd
import numpy as np
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import uvicorn

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# 尝试导入Kronos，如果失败则使用mock模式
try:
    from model.kronos import Kronos, KronosTokenizer, KronosPredictor
    KRONOS_AVAILABLE = True
    logger.info("Kronos模型库导入成功")
except ImportError as e:
    logger.warning(f"无法导入Kronos模型库: {e}")
    logger.warning("将使用mock模式运行")
    KRONOS_AVAILABLE = False

# 全局变量
app = FastAPI(title="Kronos K线预测API", version="1.0.0")
predictor = None
current_model = None
use_mock = not KRONOS_AVAILABLE

# CORS配置
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 模型配置
MODEL_CONFIGS = {
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
}

# 请求/响应模型
class OHLCVItem(BaseModel):
    """单根K线数据"""
    timestamp: int = Field(..., description="时间戳（毫秒）")
    open: float = Field(..., description="开盘价")
    high: float = Field(..., description="最高价")
    low: float = Field(..., description="最低价")
    close: float = Field(..., description="收盘价")
    volume: float = Field(0.0, description="成交量（可选）")

class PredictionRequest(BaseModel):
    """预测请求"""
    code: str = Field(..., description="股票代码")
    ohlcv: List[List[float]] = Field(..., description="K线数据列表，每行[timestamp, open, high, low, close, volume]")
    pred_len: int = Field(120, description="预测长度（K线数量）")
    model: str = Field("kronos-mini", description="模型名称: kronos-mini, kronos-small, kronos-base")

class PredictionResponse(BaseModel):
    """预测响应"""
    success: bool = Field(..., description="是否成功")
    model: str = Field(..., description="使用的模型")
    trend: str = Field(..., description="趋势: bullish/bearish/neutral")
    confidence: float = Field(..., description="置信度 0-1")
    forecast: List[List[float]] = Field(..., description="预测的K线数据")
    analysis: str = Field(..., description="文字分析")
    is_mock: bool = Field(False, description="是否是mock数据")
    inference_time: float = Field(..., description="推理时间（秒）")

# 辅助函数
def get_device():
    """自动选择设备：CUDA -> MPS -> CPU"""
    try:
        import torch
        if torch.cuda.is_available():
            return "cuda:0"
        elif hasattr(torch.backends, 'mps') and torch.backends.mps.is_available():
            return "mps"
        else:
            return "cpu"
    except ImportError:
        return "cpu"

def load_kronos_model(model_key: str = "kronos-mini"):
    """加载Kronos模型"""
    global predictor, current_model, use_mock
    
    if not KRONOS_AVAILABLE:
        use_mock = True
        return {"status": "mock", "message": "Kronos库不可用，使用mock模式"}
    
    if model_key not in MODEL_CONFIGS:
        return {"error": f"未知模型: {model_key}"}
    
    if predictor and current_model == model_key:
        return {"status": "already_loaded", "model": model_key}
    
    try:
        import torch
        from huggingface_hub import hf_hub_download
        
        model_config = MODEL_CONFIGS[model_key]
        device = get_device()
        
        logger.info(f"加载模型 {model_key}，使用设备: {device}")
        
        # 加载模型和tokenizer
        model = Kronos.from_pretrained(model_config["model_id"])
        tokenizer = KronosTokenizer.from_pretrained(model_config["tokenizer_id"])
        
        # 创建predictor
        predictor = KronosPredictor(
            model, 
            tokenizer, 
            device=device,
            max_context=model_config["context_length"]
        )
        current_model = model_key
        
        logger.info(f"模型 {model_key} 加载成功")
        return {"status": "loaded", "model": model_key, "device": device}
    
    except Exception as e:
        logger.error(f"加载模型失败: {e}")
        use_mock = True
        return {"error": str(e), "fallback": "mock"}

def generate_mock_prediction(ohlcv_data: List[List[float]], pred_len: int = 120):
    """生成mock预测数据"""
    if not ohlcv_data:
        return []
    
    # 基于最后一条数据生成趋势
    last_row = ohlcv_data[-1]
    last_close = last_row[4]  # close price
    
    # 模拟轻微上涨趋势
    forecast = []
    current_timestamp = last_row[0] + 5 * 60 * 1000  # 5分钟间隔
    
    for i in range(pred_len):
        # 随机波动
        change = np.random.normal(0.001, 0.005)  # 均值0.1%，标准差0.5%
        predicted_close = last_close * (1 + change * (i + 1))
        
        # 生成OHLC
        high = predicted_close * (1 + abs(np.random.normal(0, 0.002)))
        low = predicted_close * (1 - abs(np.random.normal(0, 0.002)))
        open_price = predicted_close * (1 + np.random.normal(0, 0.001))
        
        # 确保 high >= low, high >= open, high >= close 等
        high = max(open_price, predicted_close, high)
        low = min(open_price, predicted_close, low)
        
        forecast.append([
            current_timestamp,
            float(open_price),
            float(high),
            float(low),
            float(predicted_close),
            float(last_row[5] * 0.8) if len(last_row) > 5 else 1000000.0
        ])
        
        current_timestamp += 5 * 60 * 1000  # 5分钟间隔
    
    return forecast

def analyze_trend(forecast_data: List[List[float]]) -> Dict[str, Any]:
    """分析预测结果的趋势"""
    if not forecast_data:
        return {"trend": "neutral", "confidence": 0.5}
    
    # 提取收盘价
    closes = [row[4] for row in forecast_data]
    
    # 计算趋势
    start_price = closes[0]
    end_price = closes[-1]
    
    price_change = (end_price - start_price) / start_price
    
    if price_change > 0.02:  # 上涨超过2%
        trend = "bullish"
        confidence = min(0.3 + abs(price_change) * 10, 0.95)
    elif price_change < -0.02:  # 下跌超过2%
        trend = "bearish"
        confidence = min(0.3 + abs(price_change) * 10, 0.95)
    else:
        trend = "neutral"
        confidence = 0.5
    
    return {"trend": trend, "confidence": confidence}

def generate_analysis(trend: str, confidence: float, code: str) -> str:
    """生成文字分析"""
    if trend == "bullish":
        return f"模型预测{code}未来呈上涨趋势，上涨概率{confidence:.1%}。技术指标显示买方力量较强，建议关注支撑位。"
    elif trend == "bearish":
        return f"模型预测{code}未来呈下跌趋势，下跌概率{confidence:.1%}。技术指标显示卖方压力较大，建议注意风险。"
    else:
        return f"模型预测{code}未来呈震荡整理趋势，方向性不明显。建议观望等待明确信号。"

# API端点
@app.get("/")
async def root():
    """API根目录"""
    return {
        "service": "Kronos K线预测API",
        "version": "1.0.0",
        "models_available": list(MODEL_CONFIGS.keys()),
        "model_loaded": current_model,
        "using_mock": use_mock,
        "device": get_device()
    }

@app.get("/health")
async def health_check():
    """健康检查"""
    return {
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "model_loaded": current_model is not None,
        "mock_mode": use_mock
    }

@app.post("/predict", response_model=PredictionResponse)
async def predict(request: PredictionRequest):
    """K线预测主端点"""
    start_time = time.time()
    
    # 验证输入
    if not request.ohlcv:
        raise HTTPException(status_code=400, detail="ohlcv数据不能为空")
    
    if request.pred_len <= 0 or request.pred_len > 500:
        raise HTTPException(status_code=400, detail="pred_len必须在1-500之间")
    
    if request.model not in MODEL_CONFIGS:
        raise HTTPException(status_code=400, detail=f"不支持的模型: {request.model}")
    
    # 加载模型（如果不是mock模式）
    if not use_mock:
        load_result = load_kronos_model(request.model)
        if "error" in load_result:
            logger.warning(f"模型加载失败，切换到mock模式: {load_result['error']}")
            use_mock = True
    
    # 准备数据
    try:
        # 转换数据为DataFrame
        columns = ['timestamp', 'open', 'high', 'low', 'close', 'volume']
        df = pd.DataFrame(request.ohlcv, columns=columns[:len(request.ohlcv[0])])
        
        # 确保有volume列
        if 'volume' not in df.columns:
            df['volume'] = 0.0
        
        # 转换时间戳
        df['timestamp'] = pd.to_datetime(df['timestamp'], unit='ms')
        
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"数据格式错误: {str(e)}")
    
    # 执行预测
    forecast_data = []
    inference_time = 0
    
    if not use_mock and predictor:
        try:
            # 使用真实模型预测
            pred_start = time.time()
            
            # 准备时间戳
            x_timestamp = df['timestamp']
            if len(x_timestamp) > 1:
                interval = x_timestamp.iloc[-1] - x_timestamp.iloc[-2]
            else:
                interval = pd.Timedelta(minutes=5)
            
            y_timestamp = pd.date_range(
                start=x_timestamp.iloc[-1] + interval,
                periods=request.pred_len,
                freq=interval
            )
            y_timestamp = pd.Series(y_timestamp, name='timestamp')
            
            # 执行预测
            pred_df = predictor.predict(
                df=df[['open', 'high', 'low', 'close', 'volume']],
                x_timestamp=x_timestamp,
                y_timestamp=y_timestamp,
                pred_len=request.pred_len,
                T=1.0,
                top_p=0.9,
                sample_count=1,
                verbose=False
            )
            
            # 格式化结果
            pred_df_reset = pred_df.reset_index()
            pred_df_reset['timestamp'] = (pred_df_reset['timestamp'].astype('int64') / 10**6).astype('int64')
            
            forecast_data = pred_df_reset[['timestamp', 'open', 'high', 'low', 'close', 'volume']].values.tolist()
            inference_time = time.time() - pred_start
            
            logger.info(f"模型预测完成，耗时: {inference_time:.2f}s")
            
        except Exception as e:
            logger.error(f"模型预测失败: {e}")
            use_mock = True
    
    # 如果mock模式或预测失败，生成mock数据
    if use_mock or not forecast_data:
        mock_start = time.time()
        forecast_data = generate_mock_prediction(request.ohlcv, request.pred_len)
        inference_time = time.time() - mock_start
        logger.info(f"Mock预测生成完成，耗时: {inference_time:.2f}s")
    
    # 分析趋势
    trend_info = analyze_trend(forecast_data)
    analysis_text = generate_analysis(trend_info["trend"], trend_info["confidence"], request.code)
    
    total_time = time.time() - start_time
    
    # 返回结果
    return PredictionResponse(
        success=True,
        model=request.model,
        trend=trend_info["trend"],
        confidence=trend_info["confidence"],
        forecast=forecast_data,
        analysis=analysis_text,
        is_mock=use_mock,
        inference_time=inference_time
    )

@app.get("/models")
async def list_models():
    """列出可用模型"""
    return {
        "models": MODEL_CONFIGS,
        "current_model": current_model,
        "mock_mode": use_mock,
        "recommendation": "kronos-mini（轻量快速）" if use_mock else current_model
    }

@app.post("/load-model")
async def load_model(model_name: str = "kronos-mini"):
    """手动加载模型"""
    if model_name not in MODEL_CONFIGS:
        raise HTTPException(status_code=400, detail=f"未知模型: {model_name}")
    
    result = load_kronos_model(model_name)
    if "error" in result:
        raise HTTPException(status_code=500, detail=result["error"])
    
    return result

# 缓存管理（简单实现）
prediction_cache = {}

@app.middleware("http")
async def cache_middleware(request, call_next):
    """简单的缓存中间件，同一请求缓存5分钟"""
    if request.method == "POST" and request.url.path == "/predict":
        # 获取请求体
        body = await request.body()
        cache_key = hash(body)
        
        # 检查缓存
        if cache_key in prediction_cache:
            cache_entry = prediction_cache[cache_key]
            if time.time() - cache_entry["timestamp"] < 300:  # 5分钟
                logger.info(f"使用缓存结果 for key {cache_key}")
                return cache_entry["response"]
        
        # 继续处理请求
        response = await call_next(request)
        
        # 缓存成功的响应
        if response.status_code == 200:
            response_body = b""
            async for chunk in response.body_iterator:
                response_body += chunk
            
            prediction_cache[cache_key] = {
                "timestamp": time.time(),
                "response": response
            }
            
            # 需要重新创建响应
            from starlette.responses import Response
            return Response(
                content=response_body,
                status_code=response.status_code,
                headers=dict(response.headers),
                media_type=response.media_type
            )
        
        return response
    
    return await call_next(request)

if __name__ == "__main__":
    # 自动加载默认模型
    if KRONOS_AVAILABLE:
        logger.info("尝试自动加载默认模型...")
        load_result = load_kronos_model("kronos-mini")
        if "error" in load_result:
            logger.warning(f"自动加载失败: {load_result['error']}")
    
    # 启动服务器
    logger.info("启动Kronos预测服务...")
    logger.info(f"Mock模式: {use_mock}")
    logger.info(f"可用设备: {get_device()}")
    
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8888,
        log_level="info",
        access_log=True
    )