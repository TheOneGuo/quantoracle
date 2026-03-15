"""
筹码分布分析 Agent
分析个股筹码分布：获利盘/套牢盘/主力成本区间/筹码集中度
数据源：优先通过后端 /api/chip-distribution 接口获取真实数据，降级到模拟数据
"""

import logging
import os
import random
import requests
from typing import Dict, Any, Optional
from datetime import datetime

from ..llm_client import get_llm_client

logger = logging.getLogger(__name__)


class ChipDistributionAgent:
    """
    筹码分布分析智能体
    
    职责：分析个股的筹码分布状态，判断持仓结构，包括：
    - 获利盘比例：当前价格以下筹码占比（越高说明越多人在赚钱）
    - 套牢盘：当前价格以上的筹码（持仓亏损的投资者）
    - 主力成本区：主力资金的持仓成本集中区间
    - 筹码集中度：90%筹码的价格区间宽度（越窄越集中）
    - 平均持仓成本：所有持仓者的加权平均成本
    
    分析流程：
    1. 获取筹码分布数据（来自后端/东方财富）
    2. 规则引擎评判筹码结构优劣
    3. LLM 解读筹码含义并预判后市
    """
    
    def __init__(self):
        self.llm_client = get_llm_client()
        self.name = "Chip Distribution Agent"
        self._backend_url = os.environ.get('BACKEND_URL', 'http://localhost:3001')
    
    def analyze(self, code: str, name: str = None, current_price: float = None) -> Dict[str, Any]:
        """
        分析筹码分布状况
        
        Args:
            code:          股票代码（如 sh600519）
            name:          股票名称
            current_price: 当前价格（用于计算获利/套牢比例）
            
        Returns:
            {
                "score": 0.0-1.0,      # 筹码结构评分
                "reason": "分析理由",
                "chip_data": {筹码数据},
                "signal": "accumulate/distribute/neutral",
                "timestamp": "...",
                "agent": self.name
            }
        """
        logger.info(f"ChipDistributionAgent 分析 {code}")
        
        # 1. 获取筹码数据
        chip_data = self._fetch_chip_data(code, current_price)
        
        # 2. 规则引擎评分
        rule_result = self._rule_engine(chip_data, current_price)
        
        # 3. LLM 分析（可选）
        llm_result = None
        if self.llm_client.is_available():
            llm_result = self._analyze_with_llm(code, name, chip_data, rule_result, current_price)
        
        if llm_result and llm_result.get("score") is not None:
            return {
                "score":     float(llm_result["score"]),
                "reason":    llm_result.get("reason", rule_result["reason"]),
                "chip_data": chip_data,
                "signal":    llm_result.get("signal", rule_result["signal"]),
                "timestamp": datetime.now().isoformat(),
                "agent":     self.name,
                "is_real_data": chip_data.get("is_real_data", False)
            }
        
        return {
            "score":     rule_result["score"],
            "reason":    rule_result["reason"],
            "chip_data": chip_data,
            "signal":    rule_result["signal"],
            "timestamp": datetime.now().isoformat(),
            "agent":     self.name + " (Rule-Based)",
            "is_real_data": chip_data.get("is_real_data", False)
        }
    
    def _fetch_chip_data(self, code: str, current_price: Optional[float]) -> Dict[str, Any]:
        """
        从后端接口获取筹码分布数据。
        
        后端路由：GET /api/chip-distribution/:code
        返回字段：profit_ratio（获利比例）、avg_cost（平均成本）、
                   concentration_90（90%集中度）、main_cost（主力成本）
        """
        try:
            url = f"{self._backend_url}/api/chip-distribution/{code}"
            resp = requests.get(url, timeout=6)
            resp.raise_for_status()
            payload = resp.json()
            
            if payload.get("success") and payload.get("data"):
                d = payload["data"]
                # 若接口有数据则直接使用
                chip_data = {
                    "profit_ratio":      d.get("profit_ratio"),      # 获利盘 %
                    "avg_cost":          d.get("avg_cost"),           # 平均成本（元）
                    "concentration_90":  d.get("concentration_90"),   # 90%筹码集中区（元）
                    "main_cost":         d.get("main_cost"),          # 主力成本（元）
                    "retail_cost":       d.get("retail_cost"),        # 散户成本（元）
                    "current_price":     current_price,
                    "is_real_data":      True,
                    "source":            d.get("source", "东方财富")
                }
                logger.info(f"ChipDistributionAgent: 获取到真实筹码数据（{code}）")
                return chip_data
        
        except Exception as e:
            logger.warning(f"ChipDistributionAgent: 后端接口不可达，降级模拟：{e}")
        
        # 兜底模拟数据
        return self._mock_chip_data(code, current_price)
    
    def _mock_chip_data(self, code: str, current_price: Optional[float]) -> Dict[str, Any]:
        """生成模拟筹码数据"""
        random.seed(hash(code) % 3000)
        base = current_price or random.uniform(10, 100)
        
        # 随机生成筹码分布参数
        profit_ratio    = random.uniform(30, 80)        # 获利盘 30%-80%
        avg_cost        = base * random.uniform(0.85, 1.1)  # 平均成本
        concentration_90 = base * random.uniform(0.15, 0.35)  # 90%筹码区间宽度
        main_cost       = base * random.uniform(0.82, 1.05)   # 主力成本
        retail_cost     = base * random.uniform(0.90, 1.15)   # 散户成本
        
        return {
            "profit_ratio":     round(profit_ratio, 2),
            "avg_cost":         round(avg_cost, 2),
            "concentration_90": round(concentration_90, 2),
            "main_cost":        round(main_cost, 2),
            "retail_cost":      round(retail_cost, 2),
            "current_price":    current_price,
            "is_real_data":     False,
            "source":           "模拟数据"
        }
    
    def _rule_engine(self, chip_data: Dict, current_price: Optional[float]) -> Dict[str, Any]:
        """
        规则引擎：根据筹码分布判断结构优劣
        
        核心规则：
        1. 获利盘 > 70%：大多数人赚钱，存在一定抛压
        2. 获利盘 < 30%：套牢盘多，解套压力可能持续
        3. 获利盘 40%-70%：筹码结构较健康
        4. 主力成本 < 当前价 * 0.9：主力深度套牢，不易轻易出货
        5. 筹码集中度高（区间窄）：主力控盘强，易于操作
        6. 平均成本 ≈ 当前价（±5%）：多空博弈均衡，方向待选择
        """
        profit_ratio     = chip_data.get("profit_ratio", 50.0)
        avg_cost         = chip_data.get("avg_cost", 0)
        concentration_90 = chip_data.get("concentration_90", 0)
        main_cost        = chip_data.get("main_cost", 0)
        price            = current_price or chip_data.get("current_price") or avg_cost or 1
        
        score        = 0.5  # 中性起点
        reason_parts = []
        
        # ── 获利盘比例分析 ────────────────────────────────────────────
        if profit_ratio >= 70:
            score -= 0.1
            reason_parts.append(f"获利盘高达{profit_ratio:.1f}%，短期可能面临获利了结压力")
        elif profit_ratio >= 45 and profit_ratio < 70:
            score += 0.1
            reason_parts.append(f"获利盘{profit_ratio:.1f}%，筹码结构健康，多空相对均衡")
        elif profit_ratio < 30:
            score -= 0.15
            reason_parts.append(f"获利盘仅{profit_ratio:.1f}%，大量套牢盘形成上方压力")
        else:
            reason_parts.append(f"获利盘{profit_ratio:.1f}%，处于中性区间")
        
        # ── 主力成本分析 ──────────────────────────────────────────────
        if main_cost > 0 and price > 0:
            main_cost_ratio = (price - main_cost) / main_cost * 100  # 相对当前价的涨幅
            if main_cost_ratio > 20:
                score += 0.15
                reason_parts.append(f"主力成本{main_cost:.2f}元，当前价已涨{main_cost_ratio:.1f}%，主力有较大盈利空间")
            elif main_cost_ratio < -10:
                score -= 0.15
                reason_parts.append(f"主力成本{main_cost:.2f}元，当前亏损{abs(main_cost_ratio):.1f}%，主力有解套动机")
            else:
                reason_parts.append(f"主力成本{main_cost:.2f}元，与当前价差{main_cost_ratio:+.1f}%，主力处于微盈或盈亏线附近")
        
        # ── 筹码集中度分析 ────────────────────────────────────────────
        if concentration_90 > 0 and avg_cost > 0:
            concentration_pct = concentration_90 / avg_cost * 100  # 集中区间占平均成本的比例
            if concentration_pct < 15:
                score += 0.12
                reason_parts.append(f"筹码高度集中（90%筹码区间仅{concentration_pct:.1f}%），主力控盘能力强")
            elif concentration_pct > 35:
                score -= 0.05
                reason_parts.append(f"筹码分散（90%筹码区间达{concentration_pct:.1f}%），换手充分但控盘偏弱")
            else:
                reason_parts.append(f"筹码集中度适中（90%区间{concentration_pct:.1f}%）")
        
        # ── 平均成本与当前价对比 ──────────────────────────────────────
        if avg_cost > 0 and price > 0:
            cost_diff_pct = (price - avg_cost) / avg_cost * 100
            if abs(cost_diff_pct) <= 5:
                reason_parts.append(f"当前价（{price:.2f}）与持仓成本（{avg_cost:.2f}）高度接近，方向选择关键时刻")
            elif cost_diff_pct > 15:
                score += 0.05
                reason_parts.append(f"当前价高于平均成本{cost_diff_pct:.1f}%，场内多数持仓已获利")
        
        # 限制分数区间
        score = max(0.0, min(1.0, score))
        
        # 信号判断
        if score >= 0.65:
            signal = "accumulate"   # 适合建仓/加仓
        elif score <= 0.35:
            signal = "distribute"   # 适合减仓/观望
        else:
            signal = "neutral"
        
        return {
            "score":  round(score, 2),
            "reason": "；".join(reason_parts) if reason_parts else "筹码分布中性",
            "signal": signal
        }
    
    def _analyze_with_llm(self, code: str, name: Optional[str],
                          chip_data: Dict, rule_result: Dict,
                          current_price: Optional[float]) -> Optional[Dict]:
        """
        用 LLM 深度解读筹码分布含义。
        
        Args:
            code:          股票代码
            name:          股票名称
            chip_data:     筹码分布数据
            rule_result:   规则引擎结果
            current_price: 当前价格
        """
        is_real = chip_data.get("is_real_data", False)
        price   = current_price or chip_data.get("current_price", "未知")
        
        prompt = f"""
请根据以下筹码分布数据，分析个股的持仓结构并给出操作建议。

股票代码：{code}
股票名称：{name or '未知'}
当前价格：{price} 元
数据来源：{'真实数据（东方财富）' if is_real else '模拟数据（仅供参考）'}

筹码分布核心指标：
- 获利盘比例：{chip_data.get('profit_ratio', 'N/A')}%  （当前价以下筹码比例）
- 平均持仓成本：{chip_data.get('avg_cost', 'N/A')} 元
- 90%筹码集中区间：{chip_data.get('concentration_90', 'N/A')} 元（区间宽度）
- 主力估算成本：{chip_data.get('main_cost', 'N/A')} 元
- 散户估算成本：{chip_data.get('retail_cost', 'N/A')} 元

规则引擎初步判断：{rule_result.get('reason', '')}

请按以下格式输出 JSON：
{{
  "score": 0.65,
  "reason": "筹码结构分析：获利/套牢状况、主力意图、短期压力位与支撑位推断、操作建议（100-200字）",
  "signal": "accumulate/distribute/neutral"
}}

signal 说明：
- accumulate：筹码结构良好，可适量建仓
- distribute：筹码结构偏差，建议逢高减仓
- neutral：筹码结构中性，观望为主

请确保输出有效 JSON。
"""
        system_prompt = """你是资深的A股筹码分析师。筹码分析的核心是理解持仓者结构：
1. 获利盘高意味着潜在抛压大，但也意味着趋势仍在
2. 筹码集中（锁定筹码多）往往是主力控盘的信号
3. 主力成本是重要支撑位，低于主力成本的价格往往有支撑
4. 结合筹码分布给出压力位和支撑位的参考
5. 投资有风险，建议仅作参考，不构成投资建议"""
        
        return self.llm_client.generate_json(prompt, system_prompt)


# 全局单例
_chip_agent = None

def get_chip_distribution_agent() -> ChipDistributionAgent:
    """获取全局筹码分布 Agent 实例（单例模式）"""
    global _chip_agent
    if _chip_agent is None:
        _chip_agent = ChipDistributionAgent()
    return _chip_agent


if __name__ == "__main__":
    agent = ChipDistributionAgent()
    print("Testing ChipDistributionAgent...")
    result = agent.analyze("sh600519", "贵州茅台", current_price=1800.0)
    import json
    print(json.dumps(result, ensure_ascii=False, indent=2))
