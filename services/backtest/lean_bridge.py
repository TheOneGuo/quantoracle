"""
QuantConnect Lean 回测桥接器
提供 REST API，Node.js 后端通过此服务提交回测任务

接口：
- POST /backtest/run     提交回测任务（异步，返回 job_id）
- GET  /backtest/:job_id 查询回测状态和结果
- GET  /backtest/list    列出历史回测
- POST /strategy/generate 根据 AI 选股信号生成 Lean 策略代码
"""

import os
import uuid
import json
import asyncio
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
from enum import Enum

from fastapi import FastAPI, HTTPException, BackgroundTasks, Query
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import httpx
import pandas as pd
import numpy as np

from data_converter.ashare_to_lean import fetch_ashare_history, convert_to_lean_format, save_lean_data

# 初始化 FastAPI 应用
app = FastAPI(
    title="QuantOracle 回测桥接器",
    description="连接 QuantOracle 后端与 QuantConnect Lean 回测引擎",
    version="1.0.0"
)

# 配置 CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 配置
LEAN_API_URL = os.getenv("LEAN_API_URL", "http://lean:5000")
BACKEND_API_URL = os.getenv("DATA_SOURCE_BACKEND", "http://quantoracle-backend:3001/api/kline/")
DATA_DIR = os.getenv("LEAN_DATA_DIR", "/Lean/Data")
RESULTS_DIR = os.getenv("LEAN_RESULTS_DIR", "/Lean/Results")
MAX_CONCURRENT_BACKTESTS = int(os.getenv("MAX_CONCURRENT_BACKTESTS", "2"))

# 内存中的任务存储（生产环境应使用Redis或数据库）
backtest_jobs: Dict[str, Dict[str, Any]] = {}
job_lock = asyncio.Lock()

# 数据模型
class StockSignal(BaseModel):
    """AI 选股信号"""
    code: str = Field(..., description="股票代码，如 sh600519")
    name: str = Field(..., description="股票名称")
    confidence: float = Field(..., ge=0.0, le=1.0, description="综合置信度")
    scores: Dict[str, float] = Field(..., description="各维度得分")
    reason: Optional[str] = Field(None, description="AI分析理由")
    risk: Optional[str] = Field("medium", description="风险等级")

class BacktestRequest(BaseModel):
    """回测请求参数"""
    signals: List[StockSignal] = Field(..., description="AI选股信号列表")
    market: str = Field("A股", description="市场（A股/美股/港股）")
    style: str = Field("neutral", description="策略风格（conservative/neutral/aggressive）")
    start_date: str = Field(..., description="回测开始日期 YYYY-MM-DD")
    end_date: str = Field(..., description="回测结束日期 YYYY-MM-DD")
    initial_capital: float = Field(100000.0, description="初始资金")
    benchmark: Optional[str] = Field(None, description="基准指数代码")

class StrategyGenerationRequest(BaseModel):
    """策略生成请求参数"""
    signals: List[StockSignal] = Field(..., description="AI选股信号列表")
    market: str = Field("A股", description="市场（A股/美股/港股）")
    style: str = Field("neutral", description="策略风格（conservative/neutral/aggressive）")
    start_date: str = Field(..., description="回测开始日期 YYYY-MM-DD")
    end_date: str = Field(..., description="回测结束日期 YYYY-MM-DD")

# 策略模板导入
from strategy_templates.base_strategy import BaseStrategy
from strategy_templates.momentum import MomentumStrategy
from strategy_templates.value import ValueStrategy

# ============== 工具函数 ==============

async def ensure_data_exists(code: str, start_date: str, end_date: str, market: str) -> bool:
    """
    确保股票的历史数据存在，如果不存在则从后端获取并转换
    
    Args:
        code: 股票代码
        start_date: 开始日期 YYYY-MM-DD
        end_date: 结束日期 YYYY-MM-DD
        market: 市场类型
        
    Returns:
        bool: 数据是否准备成功
    """
    try:
        if market == "A股":
            # 检查是否已存在Lean格式数据
            lean_data_path = os.path.join(DATA_DIR, "equity", "china", "daily")
            code_clean = code.replace(".", "_").replace("/", "_")
            expected_file = f"{code_clean}.csv"
            
            if os.path.exists(os.path.join(lean_data_path, expected_file)):
                return True
            
            # 如果不存在，则从后端获取并转换
            print(f"正在获取 {code} 的历史数据...")
            df = await fetch_ashare_history(code, start_date, end_date)
            if df is None or df.empty:
                print(f"无法获取 {code} 的历史数据")
                return False
            
            # 转换为Lean格式并保存
            lean_df = convert_to_lean_format(df)
            save_lean_data(code, lean_df, lean_data_path)
            return True
            
        elif market == "美股":
            # TODO: 美股数据获取
            pass
        elif market == "港股":
            # TODO: 港股数据获取
            pass
            
        return False
    except Exception as e:
        print(f"确保数据存在时出错: {e}")
        return False

def generate_strategy_code(signals: List[StockSignal], style: str, market: str, 
                          start_date: str, end_date: str) -> str:
    """
    根据 AI 选股信号生成 QuantConnect Lean Python 策略代码
    
    Args:
        signals: list - AI选股结果，每项含 code/name/confidence/scores
        style: str - 风格（conservative/neutral/aggressive），影响仓位和止损
        market: str - 市场（A股/美股/港股）
        start_date: str - 回测开始日期 YYYY-MM-DD
        end_date: str - 回测结束日期 YYYY-MM-DD
        
    Returns:
        str - 完整的 Lean Python 策略代码
        
    注意：不同风格的仓位和止损设置：
    - conservative: 单股≤10%，止损8%，止盈20%
    - neutral: 单股≤15%，止损10%，止盈30%
    - aggressive: 单股≤25%，止损5%（快止损），止盈不限
    """
    # 根据风格选择策略模板
    if style == "momentum":
        strategy_template = MomentumStrategy()
    elif style == "value":
        strategy_template = ValueStrategy()
    else:
        strategy_template = BaseStrategy()
    
    # 生成策略代码
    strategy_code = strategy_template.generate(
        signals=signals,
        market=market,
        start_date=start_date,
        end_date=end_date,
        style=style
    )
    
    return strategy_code

async def submit_to_lean(strategy_code: str, job_id: str, initial_capital: float) -> Dict[str, Any]:
    """
    提交策略到 Lean 引擎执行回测
    
    Args:
        strategy_code: 策略代码
        job_id: 任务ID
        initial_capital: 初始资金
        
    Returns:
        Dict: 回测结果
    """
    try:
        # 保存策略代码文件
        strategy_dir = "./strategies"
        os.makedirs(strategy_dir, exist_ok=True)
        
        strategy_file = os.path.join(strategy_dir, f"{job_id}.py")
        with open(strategy_file, "w", encoding="utf-8") as f:
            f.write(strategy_code)
        
        # TODO: 调用 Lean API 执行回测
        # 这里需要实现与 Lean 容器的通信
        # 暂时返回模拟结果
        
        # 模拟延迟
        await asyncio.sleep(2)
        
        # 返回模拟结果
        return {
            "status": "completed",
            "metrics": {
                "annual_return": 0.152,
                "max_drawdown": -0.123,
                "sharpe": 1.23,
                "win_rate": 0.58,
                "profit_factor": 1.85,
                "calmar": 1.24,
                "benchmark_excess": 0.052
            },
            "equity_curve": [
                {"date": "2020-01-01", "value": 100000},
                {"date": "2020-12-31", "value": 115200},
                {"date": "2021-12-31", "value": 125600},
                {"date": "2022-12-31", "value": 118400},
                {"date": "2023-12-31", "value": 132800},
                {"date": "2024-12-31", "value": 145200}
            ],
            "trades": [
                {
                    "code": "sh600519",
                    "name": "贵州茅台",
                    "action": "buy",
                    "price": 1500.0,
                    "quantity": 10,
                    "pnl": 2500.0,
                    "pnl_percent": 16.7,
                    "date": "2020-03-15"
                },
                {
                    "code": "sh600519",
                    "name": "贵州茅台",
                    "action": "sell",
                    "price": 1750.0,
                    "quantity": 10,
                    "pnl": 2500.0,
                    "pnl_percent": 16.7,
                    "date": "2020-06-15"
                }
            ],
            "is_mock": True
        }
        
    except Exception as e:
        print(f"提交到 Lean 时出错: {e}")
        return {
            "status": "failed",
            "error": str(e),
            "is_mock": True
        }

async def run_backtest_task(job_id: str, request: BacktestRequest):
    """
    后台运行回测任务
    
    Args:
        job_id: 任务ID
        request: 回测请求参数
    """
    try:
        # 更新任务状态
        async with job_lock:
            backtest_jobs[job_id]["status"] = "preparing"
            backtest_jobs[job_id]["progress"] = 10
        
        # 1. 确保所有股票数据存在
        data_ready = True
        for signal in request.signals:
            ready = await ensure_data_exists(
                signal.code, 
                request.start_date, 
                request.end_date,
                request.market
            )
            if not ready:
                data_ready = False
                break
        
        if not data_ready:
            async with job_lock:
                backtest_jobs[job_id]["status"] = "failed"
                backtest_jobs[job_id]["error"] = "部分股票历史数据获取失败"
            return
        
        async with job_lock:
            backtest_jobs[job_id]["status"] = "generating_strategy"
            backtest_jobs[job_id]["progress"] = 30
        
        # 2. 生成策略代码
        strategy_code = generate_strategy_code(
            signals=request.signals,
            style=request.style,
            market=request.market,
            start_date=request.start_date,
            end_date=request.end_date
        )
        
        async with job_lock:
            backtest_jobs[job_id]["status"] = "submitting_to_lean"
            backtest_jobs[job_id]["progress"] = 50
        
        # 3. 提交到 Lean 执行回测
        result = await submit_to_lean(
            strategy_code=strategy_code,
            job_id=job_id,
            initial_capital=request.initial_capital
        )
        
        async with job_lock:
            backtest_jobs[job_id]["status"] = result["status"]
            backtest_jobs[job_id]["progress"] = 100
            backtest_jobs[job_id]["result"] = result
            backtest_jobs[job_id]["completed_at"] = datetime.now().isoformat()
            
            if result["status"] == "completed":
                backtest_jobs[job_id]["metrics"] = result.get("metrics", {})
                backtest_jobs[job_id]["equity_curve"] = result.get("equity_curve", [])
                backtest_jobs[job_id]["trades"] = result.get("trades", [])
            
    except Exception as e:
        async with job_lock:
            backtest_jobs[job_id]["status"] = "failed"
            backtest_jobs[job_id]["error"] = str(e)
            backtest_jobs[job_id]["completed_at"] = datetime.now().isoformat()

# ============== API 端点 ==============

@app.post("/backtest/run")
async def run_backtest(request: BacktestRequest, background_tasks: BackgroundTasks):
    """
    提交回测任务（异步，返回 job_id）
    """
    # 生成任务ID
    job_id = f"bt_{uuid.uuid4().hex[:12]}"
    
    # 初始化任务状态
    async with job_lock:
        backtest_jobs[job_id] = {
            "id": job_id,
            "status": "pending",
            "progress": 0,
            "request": request.dict(),
            "created_at": datetime.now().isoformat(),
            "started_at": None,
            "completed_at": None,
            "metrics": None,
            "equity_curve": None,
            "trades": None,
            "error": None
        }
    
    # 在后台运行任务
    background_tasks.add_task(run_backtest_task, job_id, request)
    
    # 立即返回任务ID
    return JSONResponse({
        "success": True,
        "job_id": job_id,
        "status": "pending",
        "message": "回测任务已提交，正在后台执行"
    })

@app.get("/backtest/{job_id}")
async def get_backtest_result(job_id: str):
    """
    查询回测状态和结果
    """
    async with job_lock:
        if job_id not in backtest_jobs:
            raise HTTPException(status_code=404, detail=f"任务 {job_id} 不存在")
        
        job = backtest_jobs[job_id]
        
        # 构建响应
        response = {
            "job_id": job_id,
            "status": job["status"],
            "progress": job.get("progress", 0),
            "created_at": job["created_at"],
            "started_at": job.get("started_at"),
            "completed_at": job.get("completed_at"),
        }
        
        # 如果已完成，包含结果
        if job["status"] in ["completed", "failed"]:
            if job["status"] == "completed":
                response["metrics"] = job.get("metrics", {})
                response["equity_curve"] = job.get("equity_curve", [])
                response["trades"] = job.get("trades", [])
            else:
                response["error"] = job.get("error", "未知错误")
        
        return JSONResponse(response)

@app.get("/backtest/list")
async def list_backtests(limit: int = Query(10, ge=1, le=100), 
                        offset: int = Query(0, ge=0)):
    """
    列出历史回测任务
    """
    async with job_lock:
        # 按创建时间排序
        jobs_list = list(backtest_jobs.values())
        jobs_list.sort(key=lambda x: x["created_at"], reverse=True)
        
        # 分页
        paginated = jobs_list[offset:offset + limit]
        
        # 简化信息
        simplified = []
        for job in paginated:
            simplified.append({
                "id": job["id"],
                "status": job["status"],
                "progress": job.get("progress", 0),
                "market": job.get("request", {}).get("market", "unknown"),
                "style": job.get("request", {}).get("style", "unknown"),
                "created_at": job["created_at"],
                "completed_at": job.get("completed_at"),
            })
        
        return JSONResponse({
            "success": True,
            "jobs": simplified,
            "total": len(jobs_list),
            "limit": limit,
            "offset": offset
        })

@app.post("/strategy/generate")
async def generate_strategy(request: StrategyGenerationRequest):
    """
    根据 AI 选股信号生成 Lean 策略代码
    """
    try:
        strategy_code = generate_strategy_code(
            signals=request.signals,
            style=request.style,
            market=request.market,
            start_date=request.start_date,
            end_date=request.end_date
        )
        
        return JSONResponse({
            "success": True,
            "strategy_code": strategy_code,
            "language": "python",
            "framework": "QuantConnect Lean"
        })
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"策略生成失败: {str(e)}")

@app.get("/health")
async def health_check():
    """
    健康检查端点
    """
    return JSONResponse({
        "status": "healthy",
        "service": "lean_bridge",
        "timestamp": datetime.now().isoformat(),
        "job_count": len(backtest_jobs)
    })

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8766)