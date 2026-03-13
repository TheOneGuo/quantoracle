"""
多Agent协调器 + Bull vs Bear辩论
并行调用4个Agent，汇总结果，LLM做Bull/Bear辩论后输出最终评分
"""

import asyncio
import concurrent.futures
import logging
from typing import Dict, Any, List, Optional, Tuple
from datetime import datetime
import time

from .llm_client import get_llm_client
from .agents.fundamental import get_fundamental_agent
from .agents.technical import get_technical_agent
from .agents.sentiment import get_sentiment_agent
from .agents.news import get_news_agent

logger = logging.getLogger(__name__)


class TradingAgentsOrchestrator:
    """
    交易智能体协调器
    
    职责：协调多个分析智能体，汇总结果，组织多空辩论，生成最终评分
    工作流程：
    1. 并行调用基本面、技术面、情绪面、新闻面4个Agent
    2. 收集各维度评分和分析理由
    3. 使用LLM组织Bull（看多）和Bear（看空）辩论
    4. 投资组合经理（最终决策）生成综合评分和投资建议
    5. 输出带权重的多维度评分和详细理由
    """
    
    def __init__(self, max_workers: int = 4):
        self.llm_client = get_llm_client()
        self.max_workers = max_workers
        self.name = "TradingAgents Orchestrator"
        
        # 各Agent权重配置（可调整）
        self.agent_weights = {
            "fundamental": 0.30,  # 基本面权重30%
            "technical": 0.25,    # 技术面权重25%
            "sentiment": 0.20,    # 情绪面权重20%
            "news": 0.15,         # 新闻面权重15%
            "debate": 0.10        # 辩论环节权重10%
        }
        
        # Agent实例
        self.agents = {
            "fundamental": get_fundamental_agent(),
            "technical": get_technical_agent(),
            "sentiment": get_sentiment_agent(),
            "news": get_news_agent()
        }
    
    async def analyze_stock_async(self, code: str, name: str = None, 
                                 industry: str = None, use_news_factor: bool = True,
                                 model_id: Optional[str] = None) -> Dict[str, Any]:
        """
        异步分析单只股票
        
        Args:
            code: 股票代码
            name: 股票名称
            industry: 所属行业
            use_news_factor: 是否启用新闻因子分析
            
        Returns:
            完整的分析结果
        """
        logger.info(f"Orchestrator analyzing {code} asynchronously")
        start_time = time.time()
        
        # 并行调用各Agent
        tasks = []
        
        # 基本面分析（总是执行）
        tasks.append(self._run_agent_async("fundamental", code, name))
        
        # 技术面分析（总是执行）
        tasks.append(self._run_agent_async("technical", code, name))
        
        # 情绪面分析（总是执行）
        tasks.append(self._run_agent_async("sentiment", code, name))
        
        # 新闻面分析（可选）
        if use_news_factor:
            tasks.append(self._run_agent_async("news", code, name, industry))
        else:
            # 如果不使用新闻因子，添加一个空任务占位
            tasks.append(asyncio.create_task(self._empty_news_analysis(code, name)))
        
        # 等待所有任务完成
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        # 处理结果
        agent_results = {}
        for i, (agent_name, result) in enumerate(zip(["fundamental", "technical", "sentiment", "news"], results)):
            if isinstance(result, Exception):
                logger.error(f"Agent {agent_name} failed: {result}")
                # 使用fallback结果
                agent_results[agent_name] = self._get_fallback_result(agent_name, code, name, industry)
            else:
                agent_results[agent_name] = result
        
        # 组织Bull vs Bear辩论
        debate_result = await self._conduct_debate(code, name, agent_results, model_id)
        
        # 生成最终评分
        final_result = self._generate_final_score(code, name, agent_results, debate_result)
        
        # 计算耗时
        duration_ms = int((time.time() - start_time) * 1000)
        final_result["duration_ms"] = duration_ms
        final_result["timestamp"] = datetime.now().isoformat()
        
        logger.info(f"Analysis completed for {code} in {duration_ms}ms")
        return final_result
    
    def analyze_stock(self, code: str, name: str = None, 
                     industry: str = None, use_news_factor: bool = True,
                     model_id: Optional[str] = None) -> Dict[str, Any]:
        """
        同步分析单只股票（包装异步方法）
        
        Args:
            code: 股票代码
            name: 股票名称
            industry: 所属行业
            use_news_factor: 是否启用新闻因子分析
            model_id: 指定的模型ID，传递给LLM调用
            
        Returns:
            完整的分析结果
        """
        # 创建新的事件循环（如果在已有循环中运行）
        try:
            loop = asyncio.get_event_loop()
        except RuntimeError:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
        
        return loop.run_until_complete(
            self.analyze_stock_async(code, name, industry, use_news_factor, model_id)
        )
    
    async def _run_agent_async(self, agent_name: str, code: str, 
                              name: str = None, industry: str = None) -> Dict[str, Any]:
        """
        异步运行单个Agent
        
        Args:
            agent_name: Agent名称
            code: 股票代码
            name: 股票名称
            industry: 所属行业（仅news Agent需要）
            
        Returns:
            Agent分析结果
        """
        try:
            agent = self.agents[agent_name]
            
            # 在线程池中运行（避免阻塞）
            loop = asyncio.get_event_loop()
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
                if agent_name == "news":
                    result = await loop.run_in_executor(
                        executor, agent.analyze, code, name, industry
                    )
                else:
                    result = await loop.run_in_executor(
                        executor, agent.analyze, code, name
                    )
            
            return result
        except Exception as e:
            logger.error(f"Error running agent {agent_name}: {e}")
            raise
    
    async def _empty_news_analysis(self, code: str, name: str = None) -> Dict[str, Any]:
        """
        空新闻分析（当不启用新闻因子时使用）
        
        Args:
            code: 股票代码
            name: 股票名称
            
        Returns:
            空新闻分析结果
        """
        return {
            "score": 0.5,
            "reason": "新闻因子分析已关闭",
            "events": [],
            "impact": "neutral",
            "timestamp": datetime.now().isoformat(),
            "agent": "News Agent (Disabled)",
            "is_simulated": False
        }
    
    def _get_fallback_result(self, agent_name: str, code: str, 
                            name: str = None, industry: str = None) -> Dict[str, Any]:
        """
        获取Agent失败时的fallback结果
        
        Args:
            agent_name: Agent名称
            code: 股票代码
            name: 股票名称
            industry: 所属行业
            
        Returns:
            fallback分析结果
        """
        fallback_results = {
            "fundamental": {
                "score": 0.5,
                "reason": f"{code}基本面分析服务暂时不可用",
                "agent": "Fundamental Agent (Fallback)"
            },
            "technical": {
                "score": 0.5,
                "reason": f"{code}技术面分析服务暂时不可用",
                "agent": "Technical Agent (Fallback)"
            },
            "sentiment": {
                "score": 0.5,
                "reason": f"{code}情绪面分析服务暂时不可用",
                "agent": "Sentiment Agent (Fallback)"
            },
            "news": {
                "score": 0.5,
                "reason": f"{code}新闻面分析服务暂时不可用",
                "agent": "News Agent (Fallback)"
            }
        }
        
        result = fallback_results.get(agent_name, {
            "score": 0.5,
            "reason": f"{code}分析服务暂时不可用",
            "agent": f"{agent_name} Agent (Fallback)"
        })
        
        result["timestamp"] = datetime.now().isoformat()
        return result
    
    async def _conduct_debate(self, code: str, name: str, 
                             agent_results: Dict[str, Dict],
                             model_id: Optional[str] = None) -> Dict[str, Any]:
        """
        组织Bull vs Bear辩论
        
        Args:
            code: 股票代码
            name: 股票名称
            agent_results: 各Agent分析结果
            model_id: 指定的模型ID，传递给LLM调用
            
        Returns:
            辩论结果
        """
        # 收集看多和看空理由
        bull_points = []
        bear_points = []
        
        for agent_name, result in agent_results.items():
            score = result.get("score", 0.5)
            reason = result.get("reason", "")
            agent_display = result.get("agent", agent_name)
            
            if score > 0.6:  # 偏正面
                bull_points.append(f"【{agent_display}】评分{score:.2f}：{reason}")
            elif score < 0.4:  # 偏负面
                bear_points.append(f"【{agent_display}】评分{score:.2f}：{reason}")
            else:  # 中性
                # 中性观点可以同时加入双方（作为平衡因素）
                bull_points.append(f"【{agent_display}】评分{score:.2f}（中性）：{reason}")
                bear_points.append(f"【{agent_display}】评分{score:.2f}（中性）：{reason}")
        
        # 如果LLM不可用，使用简单规则
        if not self.llm_client.is_available():
            return self._simple_debate(bull_points, bear_points)
        
        # 使用LLM进行辩论
        prompt = f"""
请作为投资委员会主席，组织一场关于{name or code}的Bull（看多）vs Bear（看空）辩论。

【Bull方观点】（看多理由）：
{chr(10).join(bull_points) if bull_points else '暂无明确看多理由'}

【Bear方观点】（看空理由）：
{chr(10).join(bear_points) if bear_points else '暂无明确看空理由'}

请按以下格式输出 JSON：
{{
  "bull_summary": "Bull方核心论点总结",
  "bear_summary": "Bear方核心论点总结",
  "debate_winner": "bull/bear/tie",  // 辩论胜出方
  "winner_reason": "胜出理由说明",
  "consensus_score": 0.65,  // 共识评分（0-1）
  "investment_advice": "具体的投资建议，如'谨慎买入'、'持有观望'、'减仓回避'等",
  "key_risks": ["主要风险1", "主要风险2"],
  "key_opportunities": ["主要机会1", "主要机会2"]
}}

请基于双方论点的逻辑强度和证据充分性进行评判，而不是简单看哪方观点多。
请确保输出有效的 JSON。
"""
        
        system_prompt = """你是一个经验丰富的投资委员会主席，擅长组织多空辩论并做出平衡的决策。
你的任务是：
1. 公正地总结双方的核心论点
2. 评估双方论点的逻辑强度和证据充分性
3. 判断哪方在本次辩论中更具说服力
4. 给出平衡的共识评分和具体的投资建议
5. 识别主要的风险和机会

保持专业、客观、平衡，避免极端观点。"""
        
        llm_response = self.llm_client.generate_json(prompt, system_prompt, model_id)
        
        if llm_response:
            # 获取token消耗信息
            estimated_tokens = self.llm_client.model_cost_map.get(model_id, 0) if model_id else 0
            return {
                "debate_result": llm_response,
                "llm_used": True,
                "bull_points_count": len(bull_points),
                "bear_points_count": len(bear_points),
                "estimated_tokens": estimated_tokens,
                "model_id": model_id
            }
        else:
            # LLM生成失败，使用简单规则
            return self._simple_debate(bull_points, bear_points)
    
    def _simple_debate(self, bull_points: List[str], bear_points: List[str]) -> Dict[str, Any]:
        """
        简单规则辩论（LLM不可用时使用）
        
        Args:
            bull_points: 看多理由列表
            bear_points: 看空理由列表
            
        Returns:
            简单辩论结果
        """
        bull_count = len(bull_points)
        bear_count = len(bear_points)
        
        if bull_count > bear_count:
            winner = "bull"
            winner_reason = f"看多方面有{bull_count}个支持理由，看空方有{bear_count}个"
            consensus_score = 0.5 + min(0.3, (bull_count - bear_count) * 0.05)
        elif bear_count > bull_count:
            winner = "bear"
            winner_reason = f"看空方面有{bear_count}个支持理由，看多方面有{bull_count}个"
            consensus_score = 0.5 - min(0.3, (bear_count - bull_count) * 0.05)
        else:
            winner = "tie"
            winner_reason = f"看多方面和看空方面各有{bull_count}个理由，势均力敌"
            consensus_score = 0.5
        
        # 限制分数在0-1之间
        consensus_score = max(0.0, min(1.0, consensus_score))
        
        # 生成投资建议
        if consensus_score > 0.7:
            advice = "积极关注，可考虑买入"
        elif consensus_score > 0.6:
            advice = "谨慎乐观，可考虑分批买入"
        elif consensus_score > 0.4:
            advice = "中性，建议持有观望"
        elif consensus_score > 0.3:
            advice = "谨慎，建议减仓或观望"
        else:
            advice = "悲观，建议回避或卖出"
        
        return {
            "debate_result": {
                "bull_summary": f"有{bull_count}个看多理由",
                "bear_summary": f"有{bear_count}个看空理由",
                "debate_winner": winner,
                "winner_reason": winner_reason,
                "consensus_score": consensus_score,
                "investment_advice": advice,
                "key_risks": ["数据有限，分析基于简化规则"],
                "key_opportunities": ["需要更深入分析确认机会"]
            },
            "llm_used": False,
            "bull_points_count": bull_count,
            "bear_points_count": bear_count,
            "estimated_tokens": 0,  # 简单规则不消耗token
            "model_id": None
        }
    
    def _generate_final_score(self, code: str, name: str, 
                             agent_results: Dict[str, Dict], 
                             debate_result: Dict[str, Any]) -> Dict[str, Any]:
        """
        生成最终评分和综合结果
        
        Args:
            code: 股票代码
            name: 股票名称
            agent_results: 各Agent分析结果
            debate_result: 辩论结果
            
        Returns:
            最终分析结果
        """
        # 提取各维度评分
        scores = {}
        reasons = {}
        
        for agent_name, result in agent_results.items():
            scores[agent_name] = result.get("score", 0.5)
            reasons[agent_name] = result.get("reason", "")
        
        # 辩论共识评分
        debate_score = debate_result["debate_result"].get("consensus_score", 0.5)
        scores["debate"] = debate_score
        
        # 加权计算综合评分
        weighted_sum = 0
        total_weight = 0
        
        for agent_name, weight in self.agent_weights.items():
            if agent_name in scores:
                weighted_sum += scores[agent_name] * weight
                total_weight += weight
        
        # 如果总权重不为0，计算加权平均
        if total_weight > 0:
            final_score = weighted_sum / total_weight
        else:
            final_score = sum(scores.values()) / len(scores)
        
        # 限制在0-1之间
        final_score = max(0.0, min(1.0, final_score))
        
        # 获取token消耗信息（从debate_result）
        estimated_tokens = debate_result.get("estimated_tokens", 0)
        model_id = debate_result.get("model_id")
        
        # 生成最终结果
        return {
            "code": code,
            "name": name or code,
            "final_score": final_score,
            "scores": scores,
            "weighted_score": final_score,
            "agent_results": agent_results,
            "debate_result": debate_result,
            "investment_advice": debate_result["debate_result"].get("investment_advice", "暂无建议"),
            "key_risks": debate_result["debate_result"].get("key_risks", []),
            "key_opportunities": debate_result["debate_result"].get("key_opportunities", []),
            "llm_available": self.llm_client.is_available(),
            "orchestrator": self.name,
            "estimated_tokens": estimated_tokens,
            "model_id": model_id
        }


# 全局单例实例
_orchestrator = None

def get_orchestrator() -> TradingAgentsOrchestrator:
    """
    获取全局协调器实例（单例模式）
    
    Returns:
        TradingAgentsOrchestrator 实例
    """
    global _orchestrator
    if _orchestrator is None:
        _orchestrator = TradingAgentsOrchestrator()
    return _orchestrator


if __name__ == "__main__":
    # 测试代码
    import asyncio
    
    async def test():
        orchestrator = TradingAgentsOrchestrator()
        print("Testing Orchestrator...")
        result = await orchestrator.analyze_stock_async("sh600519", "贵州茅台", "白酒", True)
        print(f"Final result keys: {list(result.keys())}")
        print(f"Final score: {result.get('final_score')}")
        print(f"Investment advice: {result.get('investment_advice')}")
    
    asyncio.run(test())