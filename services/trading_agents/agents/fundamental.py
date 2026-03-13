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
        # 构建提示词
        metrics_text = "\n".join([f"- {k}: {v}" for k, v in metrics.items()])
        
        prompt = f"""
请分析以下股票的基本面情况，并给出0-1的评分（1为最好）。

股票代码：{code}
股票名称：{metrics.get('name', name or '未知')}
所属行业：{metrics.get('industry', '未知')}

基本面指标：
{metrics_text}

请按以下格式输出 JSON：
{{
  "score": 0.85,  // 0-1的评分，保留两位小数
  "reason": "详细的分析理由，包括估值、盈利能力、成长性、财务健康等方面的分析",
  "strengths": ["优势1", "优势2", "优势3"],
  "weaknesses": ["劣势1", "劣势2", "劣势3"]
}}

评分参考标准：
1. 优秀（0.8-1.0）：估值合理或偏低，盈利能力强，成长性好，财务健康
2. 良好（0.6-0.8）：估值略高但有亮点，盈利能力中等，成长性一般，财务基本健康
3. 一般（0.4-0.6）：估值偏高，盈利能力一般，成长性有限，财务有隐忧
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
        LLM 失败时的规则引擎分析
        
        Args:
            code: 股票代码
            metrics: 指标字典
            
        Returns:
            规则分析结果
        """
        score = 0.5  # 默认中等评分
        strengths = []
        weaknesses = []
        reason_parts = []
        
        # 1. 估值分析
        pe = metrics.get("pe")
        if pe is not None:
            if pe < 15:
                score += 0.1
                strengths.append("估值偏低")
                reason_parts.append(f"市盈率{pe:.1f}倍，估值偏低")
            elif pe > 30:
                score -= 0.1
                weaknesses.append("估值偏高")
                reason_parts.append(f"市盈率{pe:.1f}倍，估值偏高")
            else:
                reason_parts.append(f"市盈率{pe:.1f}倍，估值合理")
        
        # 2. 盈利能力
        roe = metrics.get("roe")
        if roe is not None:
            if roe > 15:
                score += 0.15
                strengths.append("盈利能力强")
                reason_parts.append(f"ROE{roe:.1f}%，盈利能力强")
            elif roe < 5:
                score -= 0.1
                weaknesses.append("盈利能力弱")
                reason_parts.append(f"ROE{roe:.1f}%，盈利能力偏弱")
            else:
                reason_parts.append(f"ROE{roe:.1f}%，盈利能力一般")
        
        # 3. 成长性
        revenue_growth = metrics.get("revenue_growth")
        if revenue_growth is not None:
            if revenue_growth > 20:
                score += 0.1
                strengths.append("成长性高")
                reason_parts.append(f"营收增长{revenue_growth:.1f}%，成长性高")
            elif revenue_growth < 0:
                score -= 0.05
                weaknesses.append("营收负增长")
                reason_parts.append(f"营收增长{revenue_growth:.1f}%，负增长")
        
        # 4. 财务健康
        debt_ratio = metrics.get("debt_ratio")
        if debt_ratio is not None:
            if debt_ratio < 50:
                score += 0.05
                strengths.append("负债率低")
                reason_parts.append(f"资产负债率{debt_ratio:.1f}%，财务稳健")
            elif debt_ratio > 70:
                score -= 0.05
                weaknesses.append("负债率高")
                reason_parts.append(f"资产负债率{debt_ratio:.1f}%，负债偏高")
        
        # 5. 股息率
        dividend_yield = metrics.get("dividend_yield")
        if dividend_yield is not None and dividend_yield > 3:
            score += 0.05
            strengths.append("股息率高")
            reason_parts.append(f"股息率{dividend_yield:.1f}%，分红慷慨")
        
        # 限制分数在0-1之间
        score = max(0.0, min(1.0, score))
        
        # 生成理由
        if not reason_parts:
            reason = "基本面数据不足，无法进行深入分析"
        else:
            reason = f"{metrics.get('name', code)}基本面分析：" + "；".join(reason_parts)
        
        # 如果没有识别到优劣势，设置默认值
        if not strengths:
            strengths = ["数据有限，优势不明显"]
        if not weaknesses:
            weaknesses = ["数据有限，劣势不明显"]
        
        return {
            "score": score,
            "reason": reason,
            "metrics": metrics,
            "strengths": strengths,
            "weaknesses": weaknesses,
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