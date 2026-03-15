"""
基本面分析 Agent
调用 QuantOracle 后端 /api/stock/:code 获取基本面数据，LLM 分析并输出评分 0-1
"""

import logging
from typing import Dict, Any, Optional
from datetime import datetime

from ..llm_client import get_llm_client
from ..data.stock_data import get_stock_data_client

logger = logging.getLogger(__name__)

# ============================================================
# 行业平均估值参考（A股，数据可定期更新）
# pe: 市盈率, pb: 市净率, roe: 净资产收益率(%)
# 来源：Wind/Choice 行业中位数，每年可更新一次
# ============================================================
INDUSTRY_BENCHMARKS = {
    "银行":   {"pe": 6,  "pb": 0.7, "roe": 12},
    "证券":   {"pe": 20, "pb": 1.8, "roe": 8},
    "保险":   {"pe": 12, "pb": 1.5, "roe": 10},
    "白酒":   {"pe": 30, "pb": 8,   "roe": 25},
    "医药":   {"pe": 35, "pb": 4,   "roe": 15},
    "新能源": {"pe": 25, "pb": 3,   "roe": 12},
    "房地产": {"pe": 10, "pb": 0.8, "roe": 8},
    "消费":   {"pe": 28, "pb": 5,   "roe": 18},
    "科技":   {"pe": 40, "pb": 5,   "roe": 15},
    "通用":   {"pe": 20, "pb": 2,   "roe": 12},  # 兜底默认值
}

def _get_industry_benchmark(industry: str) -> Dict[str, float]:
    """
    根据行业名称获取对应的估值基准。
    如果行业名称不在预设字典中，关键词模糊匹配，否则返回"通用"基准。
    """
    if not industry or industry == "未知":
        return INDUSTRY_BENCHMARKS["通用"]
    # 精确匹配
    if industry in INDUSTRY_BENCHMARKS:
        return INDUSTRY_BENCHMARKS[industry]
    # 关键词模糊匹配
    for key in INDUSTRY_BENCHMARKS:
        if key in industry or industry in key:
            return INDUSTRY_BENCHMARKS[key]
    return INDUSTRY_BENCHMARKS["通用"]

def _compare_with_benchmark(value: Optional[float], benchmark: float, metric: str) -> Dict[str, Any]:
    """
    将个股指标与行业基准对比，返回对比描述和相对偏差。
    
    Args:
        value: 个股实际值
        benchmark: 行业基准值
        metric: 指标名称（pe/pb/roe）
    
    Returns:
        {diff_pct: 偏差百分比, description: 描述文字, is_better: 是否优于行业}
    """
    if value is None or benchmark == 0:
        return {"diff_pct": None, "description": "数据不足", "is_better": None}
    
    diff_pct = round((value - benchmark) / benchmark * 100, 1)
    abs_diff = abs(diff_pct)
    
    # pe/pb 越低越好，roe 越高越好
    if metric in ("pe", "pb"):
        is_better = value < benchmark
        direction = "低于" if value < benchmark else "高于"
    else:  # roe
        is_better = value > benchmark
        direction = "高于" if value > benchmark else "低于"
    
    description = f"{direction}行业均值{abs_diff}%"
    return {"diff_pct": diff_pct, "description": description, "is_better": is_better}


class FundamentalAgent:
    """
    基本面分析智能体
    
    职责：分析股票的财务基本面指标，包括：
    - 估值指标：PE, PB, PS, PEG
    - 盈利能力：ROE, ROA, 毛利率, 净利率
    - 成长性：营收增长率, 净利润增长率
    - 财务健康：资产负债率, 流动比率, 速动比率
    - 分红：股息率
    """
    
    def __init__(self):
        self.llm_client = get_llm_client()
        self.data_client = get_stock_data_client()
        self.name = "Fundamental Agent"
    
    def analyze(self, code: str, name: str = None) -> Dict[str, Any]:
        """
        分析股票基本面，返回评分和理由
        
        Args:
            code: 股票代码（如 sh600519）
            name: 股票名称（可选，用于提示词）
            
        Returns:
            包含分析结果的字典：
            {
                "score": 0.0-1.0,           # 基本面评分
                "reason": "分析理由文字",
                "metrics": {基本指标},
                "strengths": ["优势1", "优势2"],
                "weaknesses": ["劣势1", "劣势2"],
                "timestamp": "分析时间",
                "agent": self.name
            }
        """
        logger.info(f"FundamentalAgent analyzing {code}")
        
        # 1. 获取基本面数据
        fundamental_data = self.data_client.get_fundamental(code)
        if not fundamental_data:
            logger.warning(f"No fundamental data available for {code}, using fallback analysis")
            return self._fallback_analysis(code, name)
        
        # 2. 提取关键指标
        metrics = self._extract_metrics(fundamental_data, code, name)
        
        # 3. 使用 LLM 分析
        llm_result = self._analyze_with_llm(code, name, metrics)
        
        if llm_result and llm_result.get("score") is not None:
            # LLM 分析成功
            return {
                "score": float(llm_result["score"]),
                "reason": llm_result.get("reason", "LLM 分析完成"),
                "metrics": metrics,
                "strengths": llm_result.get("strengths", []),
                "weaknesses": llm_result.get("weaknesses", []),
                "timestamp": datetime.now().isoformat(),
                "agent": self.name
            }
        else:
            # LLM 失败，使用规则引擎
            logger.warning(f"LLM analysis failed for {code}, using rule-based analysis")
            return self._rule_based_analysis(code, metrics)
    
    def _extract_metrics(self, data: Dict, code: str, name: Optional[str]) -> Dict[str, Any]:
        """
        从原始数据中提取标准化指标
        
        Args:
            data: 原始基本面数据
            code: 股票代码
            name: 股票名称
            
        Returns:
            标准化指标字典
        """
        # 默认值
        metrics = {
            "code": code,
            "name": name or data.get("name", "未知"),
            "industry": data.get("industry", "未知"),
            "market_cap": data.get("market_cap"),  # 市值（亿）
            "pe": data.get("pe"),  # 市盈率
            "pb": data.get("pb"),  # 市净率
            "ps": data.get("ps"),  # 市销率
            "dividend_yield": data.get("dividend_yield"),  # 股息率
            "roe": data.get("roe"),  # 净资产收益率
            "roa": data.get("roa"),  # 总资产收益率
            "gross_margin": data.get("gross_margin"),  # 毛利率
            "net_margin": data.get("net_margin"),  # 净利率
            "revenue_growth": data.get("revenue_growth"),  # 营收增长率
            "net_profit_growth": data.get("net_profit_growth"),  # 净利润增长率
            "debt_ratio": data.get("debt_ratio"),  # 资产负债率
            "current_ratio": data.get("current_ratio"),  # 流动比率
            "quick_ratio": data.get("quick_ratio"),  # 速动比率
            "peg": data.get("peg"),  # PEG比率
        }
        
        # 清理 None 值
        metrics = {k: v for k, v in metrics.items() if v is not None}
        return metrics
    
    def _analyze_with_llm(self, code: str, name: Optional[str], metrics: Dict) -> Optional[Dict]:
        """
        使用 LLM 分析基本面数据
        
        Args:
            code: 股票代码
            name: 股票名称
            metrics: 指标字典
            
        Returns:
            LLM 分析结果字典，失败返回 None
        """
        # 获取行业基准并加入提示词
        industry = metrics.get("industry", "通用")
        benchmark = _get_industry_benchmark(industry)
        benchmark_text = f"- 行业PE均值: {benchmark['pe']}, PB均值: {benchmark['pb']}, ROE均值: {benchmark['roe']}%"
        
        # 个股与行业对比描述
        pe_cmp = _compare_with_benchmark(metrics.get("pe"), benchmark["pe"], "pe")
        pb_cmp = _compare_with_benchmark(metrics.get("pb"), benchmark["pb"], "pb")
        roe_cmp = _compare_with_benchmark(metrics.get("roe"), benchmark["roe"], "roe")
        comparison_text = "\n".join([
            f"- PE: {pe_cmp['description']}",
            f"- PB: {pb_cmp['description']}",
            f"- ROE: {roe_cmp['description']}"
        ])
        
        # 构建提示词
        metrics_text = "\n".join([f"- {k}: {v}" for k, v in metrics.items()])
        
        prompt = f"""
请分析以下股票的基本面情况，并给出0-1的评分（1为最好）。

股票代码：{code}
股票名称：{metrics.get('name', name or '未知')}
所属行业：{metrics.get('industry', '未知')}

基本面指标：
{metrics_text}

行业基准（{industry}）：
{benchmark_text}

个股与行业对比：
{comparison_text}

请按以下格式输出 JSON（评分时请参考行业对比，行业相对估值权重40%，绝对指标权重60%）：
{{
  "score": 0.85,  // 0-1的评分，保留两位小数
  "reason": "详细的分析理由，需包含与行业均值的对比（低于/高于行业均值X%），以及估值、盈利能力、成长性、财务健康等分析",
  "strengths": ["优势1", "优势2", "优势3"],
  "weaknesses": ["劣势1", "劣势2", "劣势3"]
}}

评分参考标准：
1. 优秀（0.8-1.0）：估值合理或低于行业均值，盈利能力强，成长性好，财务健康
2. 良好（0.6-0.8）：估值略高但有亮点，盈利能力中等，成长性一般，财务基本健康
3. 一般（0.4-0.6）：估值高于行业均值，盈利能力一般，成长性有限，财务有隐忧
4. 较差（0.2-0.4）：估值过高，盈利能力差，成长性差，财务风险大
5. 很差（0.0-0.2）：基本面存在重大问题

请确保输出有效的 JSON。
"""
        
        system_prompt = """你是一个专业的股票基本面分析师。你需要基于财务指标进行客观分析，考虑：
1. 估值水平：PE、PB、PEG是否合理
2. 盈利能力：ROE、毛利率、净利率是否优秀
3. 成长性：营收和净利润增长率
4. 财务健康：资产负债率、流动比率是否安全
5. 行业对比：在行业内处于什么位置

保持分析专业、客观，不要受市场情绪影响。"""
        
        result = self.llm_client.generate_json(prompt, system_prompt)
        return result
    
    def _rule_based_analysis(self, code: str, metrics: Dict) -> Dict[str, Any]:
        """
        LLM 失败时的规则引擎分析（含行业对比基准）
        
        评分权重：
        - 行业相对估值（PE/PB 对比行业均值）：占 40%
        - 绝对指标（ROE、成长性、负债率等）：占 60%
        
        Args:
            code: 股票代码
            metrics: 指标字典
            
        Returns:
            规则分析结果
        """
        industry = metrics.get("industry", "通用")
        benchmark = _get_industry_benchmark(industry)
        
        # ---- 行业相对评分（权重40%）----
        relative_score = 0.5  # 基准分
        relative_parts = []
        
        pe = metrics.get("pe")
        pe_cmp = _compare_with_benchmark(pe, benchmark["pe"], "pe")
        if pe_cmp["is_better"] is True:
            relative_score += 0.15
            relative_parts.append(f"PE{pe_cmp['description']}")
        elif pe_cmp["is_better"] is False:
            relative_score -= 0.1
            relative_parts.append(f"PE{pe_cmp['description']}")
        
        pb = metrics.get("pb")
        pb_cmp = _compare_with_benchmark(pb, benchmark["pb"], "pb")
        if pb_cmp["is_better"] is True:
            relative_score += 0.1
            relative_parts.append(f"PB{pb_cmp['description']}")
        elif pb_cmp["is_better"] is False:
            relative_score -= 0.05
            relative_parts.append(f"PB{pb_cmp['description']}")
        
        roe = metrics.get("roe")
        roe_cmp = _compare_with_benchmark(roe, benchmark["roe"], "roe")
        if roe_cmp["is_better"] is True:
            relative_score += 0.1
            relative_parts.append(f"ROE{roe_cmp['description']}")
        elif roe_cmp["is_better"] is False:
            relative_score -= 0.1
            relative_parts.append(f"ROE{roe_cmp['description']}")
        
        relative_score = max(0.0, min(1.0, relative_score))
        
        # ---- 绝对指标评分（权重60%）----
        absolute_score = 0.5
        strengths = []
        weaknesses = []
        absolute_parts = []
        
        # 估值绝对值
        if pe is not None:
            if pe < 15:
                absolute_score += 0.1
                strengths.append("估值偏低")
                absolute_parts.append(f"PE{pe:.1f}倍估值偏低")
            elif pe > 30:
                absolute_score -= 0.1
                weaknesses.append("估值偏高")
                absolute_parts.append(f"PE{pe:.1f}倍估值偏高")
            else:
                absolute_parts.append(f"PE{pe:.1f}倍估值合理")
        
        # ROE 绝对值
        if roe is not None:
            if roe > 15:
                absolute_score += 0.15
                strengths.append("盈利能力强")
                absolute_parts.append(f"ROE{roe:.1f}%盈利能力强")
            elif roe < 5:
                absolute_score -= 0.1
                weaknesses.append("盈利能力弱")
                absolute_parts.append(f"ROE{roe:.1f}%盈利能力偏弱")
        
        # 成长性
        revenue_growth = metrics.get("revenue_growth")
        if revenue_growth is not None:
            if revenue_growth > 20:
                absolute_score += 0.1
                strengths.append("成长性高")
                absolute_parts.append(f"营收增长{revenue_growth:.1f}%")
            elif revenue_growth < 0:
                absolute_score -= 0.05
                weaknesses.append("营收负增长")
                absolute_parts.append(f"营收负增长{revenue_growth:.1f}%")
        
        # 财务健康
        debt_ratio = metrics.get("debt_ratio")
        if debt_ratio is not None:
            if debt_ratio < 50:
                absolute_score += 0.05
                strengths.append("负债率低")
            elif debt_ratio > 70:
                absolute_score -= 0.05
                weaknesses.append("负债率高")
        
        # 股息率
        dividend_yield = metrics.get("dividend_yield")
        if dividend_yield is not None and dividend_yield > 3:
            absolute_score += 0.05
            strengths.append("股息率高")
        
        absolute_score = max(0.0, min(1.0, absolute_score))
        
        # ---- 综合评分：行业相对40% + 绝对指标60% ----
        final_score = round(relative_score * 0.4 + absolute_score * 0.6, 3)
        
        # 构建理由
        name = metrics.get("name", code)
        reason_parts = []
        if relative_parts:
            reason_parts.append(f"【行业对比({industry})】" + "；".join(relative_parts))
        if absolute_parts:
            reason_parts.append("【绝对指标】" + "；".join(absolute_parts))
        reason = f"{name}基本面分析：" + "；".join(reason_parts) if reason_parts else f"{name}数据不足，使用默认评分"
        
        # 补充行业基准到指标中，便于前端展示
        metrics["industry_benchmark"] = benchmark
        metrics["industry_comparison"] = {
            "pe": pe_cmp,
            "pb": pb_cmp,
            "roe": roe_cmp
        }
        
        if not strengths:
            strengths = ["数据有限，优势不明显"]
        if not weaknesses:
            weaknesses = ["数据有限，劣势不明显"]
        
        return {
            "score": final_score,
            "reason": reason,
            "metrics": metrics,
            "strengths": strengths,
            "weaknesses": weaknesses,
            "score_breakdown": {
                "relative_score": relative_score,
                "absolute_score": absolute_score,
                "relative_weight": 0.4,
                "absolute_weight": 0.6
            },
            "timestamp": datetime.now().isoformat(),
            "agent": self.name + " (Rule-Based)"
        }
    
    def _fallback_analysis(self, code: str, name: Optional[str]) -> Dict[str, Any]:
        """
        完全无法获取数据时的兜底分析
        
        Args:
            code: 股票代码
            name: 股票名称
            
        Returns:
            兜底分析结果
        """
        return {
            "score": 0.5,
            "reason": f"无法获取{code}的基本面数据，使用默认评分",
            "metrics": {"code": code, "name": name or "未知"},
            "strengths": ["数据不足，无法评估"],
            "weaknesses": ["数据不足，无法评估"],
            "timestamp": datetime.now().isoformat(),
            "agent": self.name + " (Fallback)"
        }


# 全局单例实例
_fundamental_agent = None

def get_fundamental_agent() -> FundamentalAgent:
    """
    获取全局基本面分析 Agent 实例（单例模式）
    
    Returns:
        FundamentalAgent 实例
    """
    global _fundamental_agent
    if _fundamental_agent is None:
        _fundamental_agent = FundamentalAgent()
    return _fundamental_agent


if __name__ == "__main__":
    # 测试代码
    agent = FundamentalAgent()
    print("Testing FundamentalAgent...")
    result = agent.analyze("sh600519", "贵州茅台")
    print(f"Result: {result}")