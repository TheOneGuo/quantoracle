"""
TradingAgents Python 微服务 - FastAPI 入口
端口 8765
"""

import os
import json
import logging
import time
from typing import List, Dict, Any, Optional
from datetime import datetime

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
import uvicorn

from .orchestrator import get_orchestrator
from .llm_client import get_llm_client

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# 创建 FastAPI 应用
app = FastAPI(
    title="TradingAgents AI 选股微服务",
    description="基于多智能体（基本面/技术面/情绪面/新闻面）的 AI 选股引擎",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

# 配置 CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 生产环境应限制来源
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 数据模型
class ScreeningRequest(BaseModel):
    """选股请求参数"""
    market: str = Field(default="A股", description="市场（A股/美股/港股）")
    style: str = Field(default="neutral", description="投资风格（conservative/neutral/aggressive）")
    count: int = Field(default=10, ge=1, le=50, description="候选股数量")
    use_news_factor: bool = Field(default=False, description="是否启用新闻因子")
    model: str = Field(default="stepfun/step-3.5-flash:free", description="AI模型ID（从模型选择器获取）")
    filters: Optional[Dict[str, Any]] = Field(default=None, description="额外过滤条件")
    
    class Config:
        schema_extra = {
            "example": {
                "market": "A股",
                "style": "neutral",
                "count": 10,
                "use_news_factor": True,
                "model": "stepfun/step-3.5-flash:free",
                "filters": {
                    "pe_max": 30,
                    "market_cap_min": 50,
                    "market_cap_max": 5000
                }
            }
        }

class StockAnalysisRequest(BaseModel):
    """单股分析请求参数"""
    code: str = Field(..., description="股票代码（如 sh600519）")
    name: Optional[str] = Field(default=None, description="股票名称")
    industry: Optional[str] = Field(default=None, description="所属行业")
    use_news_factor: bool = Field(default=True, description="是否启用新闻因子")

class HealthResponse(BaseModel):
    """健康检查响应"""
    status: str
    version: str
    timestamp: str
    llm_available: bool
    service_uptime: float

# 全局实例
orchestrator = get_orchestrator()
llm_client = get_llm_client()
start_time = time.time()

# 预定义股票池（示例，实际应从数据库或API获取）
STOCK_POOLS = {
    "A股": [
        {"code": "sh600519", "name": "贵州茅台", "industry": "白酒"},
        {"code": "sz000858", "name": "五粮液", "industry": "白酒"},
        {"code": "sz000333", "name": "美的集团", "industry": "家电"},
        {"code": "sh600036", "name": "招商银行", "industry": "银行"},
        {"code": "sh601318", "name": "中国平安", "industry": "保险"},
        {"code": "sz002415", "name": "海康威视", "industry": "安防"},
        {"code": "sh600276", "name": "恒瑞医药", "industry": "医药"},
        {"code": "sz300750", "name": "宁德时代", "industry": "新能源"},
        {"code": "sh600900", "name": "长江电力", "industry": "电力"},
        {"code": "sz000002", "name": "万科A", "industry": "房地产"}
    ],
    "美股": [
        {"code": "AAPL", "name": "Apple Inc.", "industry": "科技"},
        {"code": "MSFT", "name": "Microsoft", "industry": "科技"},
        {"code": "GOOGL", "name": "Alphabet", "industry": "科技"},
        {"code": "AMZN", "name": "Amazon", "industry": "电商"},
        {"code": "TSLA", "name": "Tesla", "industry": "汽车"},
        {"code": "NVDA", "name": "NVIDIA", "industry": "半导体"},
        {"code": "JPM", "name": "JPMorgan Chase", "industry": "银行"},
        {"code": "JNJ", "name": "Johnson & Johnson", "industry": "医药"},
        {"code": "WMT", "name": "Walmart", "industry": "零售"},
        {"code": "PG", "name": "Procter & Gamble", "industry": "消费品"}
    ],
    "港股": [
        {"code": "00700.HK", "name": "腾讯控股", "industry": "科技"},
        {"code": "00941.HK", "name": "中国移动", "industry": "电信"},
        {"code": "01299.HK", "name": "友邦保险", "industry": "保险"},
        {"code": "02318.HK", "name": "中国平安", "industry": "保险"},
        {"code": "03988.HK", "name": "中国银行", "industry": "银行"},
        {"code": "00883.HK", "name": "中国海洋石油", "industry": "石油"},
        {"code": "01088.HK", "name": "中国神华", "industry": "煤炭"},
        {"code": "00388.HK", "name": "香港交易所", "industry": "金融"},
        {"code": "00005.HK", "name": "汇丰控股", "industry": "银行"},
        {"code": "00669.HK", "name": "创科实业", "industry": "工具设备"}
    ]
}

@app.get("/")
async def root():
    """
    根路径，返回服务信息
    """
    return {
        "service": "TradingAgents AI Stock Screening",
        "version": "1.0.0",
        "status": "running",
        "endpoints": {
            "health": "/health",
            "analyze": "/analyze (POST)",
            "screen": "/screen (POST)",
            "docs": "/docs"
        }
    }

@app.get("/health")
async def health_check() -> HealthResponse:
    """
    健康检查端点
    """
    uptime = time.time() - start_time
    return HealthResponse(
        status="healthy",
        version="1.0.0",
        timestamp=datetime.now().isoformat(),
        llm_available=llm_client.is_available(),
        service_uptime=uptime
    )

@app.post("/analyze")
async def analyze_stock(request: StockAnalysisRequest):
    """
    分析单只股票
    
    Args:
        request: 股票分析请求
        
    Returns:
        完整的股票分析结果
    """
    logger.info(f"Analyzing stock: {request.code}")
    
    try:
        # 调用协调器进行分析
        result = orchestrator.analyze_stock(
            code=request.code,
            name=request.name,
            industry=request.industry,
            use_news_factor=request.use_news_factor
        )
        
        return {
            "success": True,
            "code": request.code,
            "name": request.name or request.code,
            "analysis": result,
            "timestamp": datetime.now().isoformat()
        }
        
    except Exception as e:
        logger.error(f"Error analyzing stock {request.code}: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"股票分析失败: {str(e)}"
        )

@app.post("/screen")
async def screen_stocks(request: ScreeningRequest, background_tasks: BackgroundTasks = None):
    """
    AI 智能选股接口
    
    Args:
        request: 选股请求参数
        background_tasks: FastAPI 后台任务（用于异步处理）
        
    Returns:
        候选股列表，含多维度评分和 AI 分析理由
    """
    logger.info(f"Screening stocks: market={request.market}, style={request.style}, count={request.count}")
    
    start_time = time.time()
    
    # 获取对应市场的股票池
    stock_pool = STOCK_POOLS.get(request.market, STOCK_POOLS["A股"])
    
    # 应用基本过滤（如果提供）
    filtered_stocks = stock_pool
    if request.filters:
        filtered_stocks = self._apply_filters(filtered_stocks, request.filters)
    
    # 限制数量
    stocks_to_analyze = filtered_stocks[:min(request.count * 2, len(filtered_stocks))]  # 分析2倍数量，最后排序
    
    # 分析每只股票
    analysis_results = []
    fallback_used = False
    
    for i, stock in enumerate(stocks_to_analyze):
        try:
            logger.info(f"Analyzing stock {i+1}/{len(stocks_to_analyze)}: {stock['code']}")
            
            result = orchestrator.analyze_stock(
                code=stock["code"],
                name=stock["name"],
                industry=stock.get("industry"),
                use_news_factor=request.use_news_factor,
                model_id=request.model
            )
            
            # 检查是否使用了fallback
            if result.get("llm_available") is False:
                fallback_used = True
            
            # 构建返回格式
            analysis_results.append({
                "code": stock["code"],
                "name": stock["name"],
                "industry": stock.get("industry", "未知"),
                "confidence": result["final_score"],  # 综合置信度
                "scores": result["scores"],  # 各维度得分
                "reason": result.get("investment_advice", "") + " " + 
                         "; ".join([f"{k}:{v:.2f}" for k, v in result["scores"].items()]),
                "risk": "low" if result["final_score"] > 0.7 else 
                       "high" if result["final_score"] < 0.4 else "medium",
                "kronos_signal": None,  # 需单独调用获取
                "analysis_details": {
                    "investment_advice": result.get("investment_advice"),
                    "key_risks": result.get("key_risks", []),
                    "key_opportunities": result.get("key_opportunities", [])
                },
                # Token消耗信息
                "estimated_tokens": result.get("estimated_tokens", 0),
                "model_id": result.get("model_id")
            })
            
        except Exception as e:
            logger.warning(f"Failed to analyze {stock['code']}: {e}")
            # 跳过失败的股票
            continue
    
    # 按置信度排序
    analysis_results.sort(key=lambda x: x["confidence"], reverse=True)
    
    # 取前N个
    final_results = analysis_results[:request.count]
    
    # 计算耗时
    duration_ms = int((time.time() - start_time) * 1000)
    
    # 确定使用的模型
    # 如果用户指定了模型，使用指定模型；否则使用默认逻辑
    model_used = request.model if request.model else "qwen2.5:9b" if llm_client.is_available() else "rule-based"
    
    response = {
        "success": True,
        "model": model_used,
        "requested_model": request.model,
        "is_fallback": fallback_used,
        "llm_available": llm_client.is_available(),
        "stocks": final_results,
        "active_events": [],  # 活跃地缘政治事件（新闻因子开启时）
        "duration_ms": duration_ms,
        "market": request.market,
        "style": request.style,
        "count_analyzed": len(analysis_results),
        "count_returned": len(final_results)
    }
    
    # 如果启用新闻因子，添加事件信息
    if request.use_news_factor:
        response["active_events"] = self._get_active_events()
    
    return response

def _apply_filters(self, stocks: List[Dict], filters: Dict[str, Any]) -> List[Dict]:
    """
    应用过滤条件（简化实现）
    
    Args:
        stocks: 股票列表
        filters: 过滤条件字典
        
    Returns:
        过滤后的股票列表
    """
    # 这里只是示例，实际应根据股票数据应用过滤
    # 第一期先返回所有股票，后期再实现真实过滤
    filtered = []
    
    for stock in stocks:
        # 模拟过滤逻辑
        include = True
        
        # 这里可以添加真实的过滤逻辑
        # 例如：if "pe_max" in filters and stock.get("pe", 100) > filters["pe_max"]: include = False
        
        if include:
            filtered.append(stock)
    
    return filtered if filtered else stocks  # 如果过滤后为空，返回原始列表

def _get_active_events(self) -> List[Dict]:
    """
    获取活跃的地缘政治事件（模拟）
    
    Returns:
        活跃事件列表
    """
    # 模拟数据，后期应从新闻API获取
    return [
        {
            "type": "宏观政策",
            "title": "美联储维持利率不变",
            "impact": "neutral",
            "date": datetime.now().strftime("%Y-%m-%d"),
            "affected_sectors": ["金融", "科技"]
        },
        {
            "type": "行业政策",
            "title": "新能源车补贴政策延续",
            "impact": "positive",
            "date": (datetime.now() - timedelta(days=3)).strftime("%Y-%m-%d"),
            "affected_sectors": ["新能源", "汽车"]
        }
    ]

@app.get("/stocks/pool/{market}")
async def get_stock_pool(market: str):
    """
    获取指定市场的股票池
    
    Args:
        market: 市场名称（A股/美股/港股）
        
    Returns:
        股票池列表
    """
    pool = STOCK_POOLS.get(market)
    if not pool:
        raise HTTPException(status_code=404, detail=f"不支持的市場: {market}")
    
    return {
        "market": market,
        "count": len(pool),
        "stocks": pool
    }

@app.get("/config")
async def get_config():
    """
    获取服务配置信息
    """
    return {
        "llm_config": {
            "primary": {
                "provider": "ollama",
                "model": "qwen2.5:9b",
                "base_url": os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
            },
            "fallback": {
                "provider": "openrouter",
                "model": "deepseek/deepseek-v3.2",
                "available": bool(os.getenv("OPENROUTER_API_KEY"))
            }
        },
        "agent_weights": get_orchestrator().agent_weights,
        "supported_markets": list(STOCK_POOLS.keys()),
        "service_port": 8765
    }

# 异常处理器
@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    """
    全局异常处理器
    """
    logger.error(f"Unhandled exception: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={
            "success": False,
            "error": "内部服务器错误",
            "detail": str(exc) if os.getenv("DEBUG") == "True" else "请查看服务器日志"
        }
    )

# 启动函数
@app.post('/industry-benchmarks/refresh')
async def refresh_industry_benchmarks(force: bool = False):
    """
    刷新行业估值基准数据接口
    
    优先从缓存读取（7天有效），缓存过期或 force=True 时从 AkShare 重新获取。
    AkShare 失败时降级使用内置静态数据（is_simulated=True）。
    
    供定时任务或管理员手动调用：
        POST /industry-benchmarks/refresh
        POST /industry-benchmarks/refresh?force=true
    """
    try:
        from .agents.fundamental import update_industry_benchmarks, INDUSTRY_BENCHMARKS
        benchmarks = update_industry_benchmarks(force=force)
        return {
            'success': True,
            'industry_count': len(benchmarks),
            'force': force,
            'is_simulated': benchmarks == {},
            'updated_at': datetime.now().isoformat(),
            'sample': dict(list(benchmarks.items())[:3]),
        }
    except Exception as e:
        logger.error(f'刷新行业基准数据失败: {e}')
        raise HTTPException(status_code=500, detail=str(e))


def start_server(host: str = "0.0.0.0", port: int = 8765):
    """
    启动 FastAPI 服务器
    
    Args:
        host: 监听地址
        port: 监听端口
    """
    logger.info(f"Starting TradingAgents service on {host}:{port}")
    logger.info(f"LLM available: {llm_client.is_available()}")
    
    uvicorn.run(
        app,
        host=host,
        port=port,
        log_level="info",
        access_log=True
    )


# =============================================
# 知识库 CRUD API（分析范式管理）
# =============================================
from news_factor.knowledge_base import get_knowledge_base
from fastapi import Body

@app.get("/paradigms", summary="获取范式列表")
def list_paradigms(category: str = None, active_only: bool = True):
    """
    获取所有事件分析范式
    @query category: 大类筛选（geo_conflict/macro_policy/disaster/financial/political/industry）
    @query active_only: 是否只返回启用的范式（默认 true）
    """
    kb = get_knowledge_base()
    paradigms = kb.list_paradigms(category=category, active_only=active_only)
    return {"success": True, "total": len(paradigms), "paradigms": paradigms}

@app.get("/paradigms/search", summary="搜索范式")
def search_paradigms(q: str):
    """
    按关键词搜索范式（匹配 name/description/trigger_keywords）
    @query q: 搜索词
    """
    kb = get_knowledge_base()
    results = kb.search_paradigms(q)
    return {"success": True, "total": len(results), "paradigms": results}

@app.get("/paradigms/{paradigm_id}", summary="获取单个范式")
def get_paradigm(paradigm_id: int):
    """获取指定 id 的范式详情"""
    kb = get_knowledge_base()
    p = kb.get_paradigm(paradigm_id)
    if not p:
        return {"success": False, "error": f"范式 {paradigm_id} 不存在或已禁用"}
    return {"success": True, "paradigm": p}

@app.post("/paradigms", summary="新增范式")
def add_paradigm(data: dict = Body(...)):
    """
    新增事件分析范式
    Body 必填：category, subcategory, name, trigger_keywords, market_impact
    Body 可选：description, severity_multiplier, duration_days, historical_cases
    """
    required = ["category", "subcategory", "name", "trigger_keywords", "market_impact"]
    for field in required:
        if field not in data:
            return {"success": False, "error": f"缺少必填字段: {field}"}
    kb = get_knowledge_base()
    paradigm_id = kb.add_paradigm(data, created_by=data.get("created_by", "user"))
    return {"success": True, "id": paradigm_id, "message": "范式已创建"}

@app.put("/paradigms/{paradigm_id}", summary="全量更新范式")
@app.patch("/paradigms/{paradigm_id}", summary="部分更新范式")
def update_paradigm(paradigm_id: int, data: dict = Body(...)):
    """
    更新范式（支持部分更新，只传需要改的字段即可）
    例如只更新 market_impact：{"market_impact": {"A股": {...}}}
    """
    kb = get_knowledge_base()
    success = kb.update_paradigm(paradigm_id, data)
    if not success:
        return {"success": False, "error": f"范式 {paradigm_id} 不存在或无有效字段"}
    return {"success": True, "message": f"范式 {paradigm_id} 已更新"}

@app.delete("/paradigms/{paradigm_id}", summary="删除范式（软删除）")
def delete_paradigm(paradigm_id: int):
    """
    软删除范式（设 is_active=0，数据保留可恢复）
    若要彻底删除，请直接操作数据库
    """
    kb = get_knowledge_base()
    success = kb.delete_paradigm(paradigm_id)
    return {"success": success, "message": f"范式 {paradigm_id} 已禁用" if success else "范式不存在"}

@app.post("/paradigms/match", summary="从新闻文本匹配相关范式")
def match_paradigms(data: dict = Body(...)):
    """
    RAG 检索：从新闻标题/正文中匹配最相关的分析范式
    Body: {"title": "新闻标题", "body": "正文（可选）", "top_k": 3}
    Returns: 按相关度排序的范式列表（含 match_score）
    """
    kb = get_knowledge_base()
    results = kb.match_paradigms(
        news_title=data.get("title", ""),
        news_body=data.get("body", ""),
        top_k=data.get("top_k", 3)
    )
    return {"success": True, "matched": len(results), "paradigms": results}


if __name__ == "__main__":
    # 从环境变量读取配置
    host = os.getenv("TRADING_AGENTS_HOST", "0.0.0.0")
    port = int(os.getenv("TRADING_AGENTS_PORT", "8765"))
    
    start_server(host, port)