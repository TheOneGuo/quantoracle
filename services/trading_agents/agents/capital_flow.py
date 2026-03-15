"""
资金流向分析 Agent
分析个股主力/超大单/大单/中单/小单资金净流入情况
数据源：优先通过后端 /api/capital-flow 接口获取东方财富真实数据，降级到 AkShare
"""

import logging
import os
import random
import requests
from typing import Dict, Any, Optional, List
from datetime import datetime

from ..llm_client import get_llm_client

logger = logging.getLogger(__name__)


class CapitalFlowAgent:
    """
    资金流向分析智能体
    
    职责：分析个股资金流向，包括：
    - 主力净流入/流出（大单+超大单）
    - 超大单（单笔 >100 万元）净流入
    - 大单（50-100 万元）净流入
    - 中单（10-50 万元）净流入
    - 小单（<10 万元）净流入（散户行为）
    - 多日资金趋势判断
    
    分析流程：
    1. 从后端接口获取真实资金流向数据
    2. 规则引擎初步判断主力意图
    3. LLM 深度解读并给出操作建议
    """
    
    def __init__(self):
        self.llm_client = get_llm_client()
        self.name = "Capital Flow Agent"
        # 后端地址（从环境变量读取，默认本地）
        self._backend_url = os.environ.get('BACKEND_URL', 'http://localhost:3001')
    
    def analyze(self, code: str, name: str = None, days: int = 5) -> Dict[str, Any]:
        """
        分析资金流向，返回评分和详细解读
        
        Args:
            code:  股票代码（如 sh600519）
            name:  股票名称（可选）
            days:  获取最近N天资金流向数据（默认5天）
            
        Returns:
            {
                "score": 0.0-1.0,          # 资金面评分（1=极强流入）
                "reason": "详细分析...",
                "items": [每日资金流向],
                "summary": {汇总统计},
                "signal": "buy/sell/neutral",
                "timestamp": "...",
                "agent": self.name
            }
        """
        logger.info(f"CapitalFlowAgent 分析 {code}，最近 {days} 天")
        
        # 1. 获取资金流向数据
        flow_data = self._fetch_capital_flow(code, days)
        
        # 2. 规则引擎判断
        rule_result = self._rule_engine(flow_data)
        
        # 3. LLM 深度分析（可选）
        llm_result = None
        if self.llm_client.is_available() and flow_data.get("items"):
            llm_result = self._analyze_with_llm(code, name, flow_data, rule_result)
        
        if llm_result and llm_result.get("score") is not None:
            return {
                "score":     float(llm_result["score"]),
                "reason":    llm_result.get("reason", rule_result["reason"]),
                "items":     flow_data.get("items", []),
                "summary":   flow_data.get("summary", {}),
                "signal":    llm_result.get("signal", rule_result["signal"]),
                "timestamp": datetime.now().isoformat(),
                "agent":     self.name,
                "is_real_data": flow_data.get("is_real_data", False)
            }
        
        # 降级到规则引擎结果
        return {
            "score":     rule_result["score"],
            "reason":    rule_result["reason"],
            "items":     flow_data.get("items", []),
            "summary":   flow_data.get("summary", {}),
            "signal":    rule_result["signal"],
            "timestamp": datetime.now().isoformat(),
            "agent":     self.name + " (Rule-Based)",
            "is_real_data": flow_data.get("is_real_data", False)
        }
    
    def _fetch_capital_flow(self, code: str, days: int) -> Dict[str, Any]:
        """
        从后端接口获取资金流向数据，失败则返回模拟数据。
        
        后端路由：GET /api/capital-flow/:code?days=N
        返回字段：items（每日明细）、summary（汇总）
        """
        # 优先调用后端接口
        try:
            url = f"{self._backend_url}/api/capital-flow/{code}"
            resp = requests.get(url, params={"days": days}, timeout=6)
            resp.raise_for_status()
            payload = resp.json()
            
            if payload.get("success") and payload.get("data", {}).get("items"):
                data = payload["data"]
                items = data.get("items", [])
                if items:
                    logger.info(f"CapitalFlowAgent: 获取到真实资金流向数据 {len(items)} 条（{code}）")
                    return {
                        "items":        items,
                        "summary":      data.get("summary", {}),
                        "is_real_data": True
                    }
        except Exception as e:
            logger.warning(f"CapitalFlowAgent: 后端接口不可达，降级模拟：{e}")
        
        # 兜底：生成模拟资金流向数据
        return self._mock_flow_data(code, days)
    
    def _mock_flow_data(self, code: str, days: int) -> Dict[str, Any]:
        """生成模拟资金流向数据（用于后端不可达时的降级）"""
        random.seed(hash(code) % 2000)
        items = []
        total_main_net = 0.0
        
        for i in range(days):
            day_offset = days - i
            date = (datetime.now() - __import__('datetime').timedelta(days=day_offset)).strftime("%Y-%m-%d")
            main_net       = random.uniform(-5e4, 8e4)   # 万元
            super_large    = random.uniform(-3e4, 5e4)
            large          = random.uniform(-2e4, 3e4)
            mid_net        = random.uniform(-1e4, 1e4)
            small_net      = -main_net * 0.3             # 散户往往反向
            total_main_net += main_net
            items.append({
                "date":            date,
                "main_net":        round(main_net, 2),
                "super_large_net": round(super_large, 2),
                "large_net":       round(large, 2),
                "mid_net":         round(mid_net, 2),
                "small_net":       round(small_net, 2),
                "main_pct":        round(main_net / 1e5 * 100, 2),
            })
        
        summary = {
            "main_net_total": round(total_main_net, 2),
            "main_trend":     "净流入" if total_main_net > 0 else "净流出",
            "latest_date":    items[-1]["date"] if items else ""
        }
        return {"items": items, "summary": summary, "is_real_data": False}
    
    def _rule_engine(self, flow_data: Dict) -> Dict[str, Any]:
        """
        规则引擎：根据资金流向数据判断主力意图
        
        规则逻辑：
        - 主力净流入 > 5亿 → 强烈看多信号（buy）
        - 主力净流入 > 1亿 → 看多信号（buy）
        - 主力净流出 > 5亿 → 强烈看空信号（sell）
        - 主力净流出 > 1亿 → 看空信号（sell）
        - 否则 → 中性（neutral）
        - 连续3天净流入 → 趋势确认，额外加分
        """
        items = flow_data.get("items", [])
        if not items:
            return {"score": 0.5, "reason": "暂无资金流向数据，保持中性", "signal": "neutral"}
        
        # 汇总主力净流入（万元）
        total_main_net  = sum(item.get("main_net", 0) for item in items)
        latest_main_net = items[-1].get("main_net", 0) if items else 0
        
        # 万元转亿元
        total_in_yi  = total_main_net / 1e4
        latest_in_yi = latest_main_net / 1e4
        
        # 连续流入天数
        consecutive_days = 0
        for item in reversed(items):
            if item.get("main_net", 0) > 0:
                consecutive_days += 1
            else:
                break
        
        # 评分计算（0-1）
        score  = 0.5   # 基础中性分
        reason_parts = []
        
        if total_in_yi > 5:
            score = 0.9
            reason_parts.append(f"近{len(items)}日主力累计净流入{total_in_yi:.2f}亿元，资金态度积极")
        elif total_in_yi > 1:
            score = 0.72
            reason_parts.append(f"近{len(items)}日主力净流入{total_in_yi:.2f}亿元，有一定资金关注")
        elif total_in_yi < -5:
            score = 0.1
            reason_parts.append(f"近{len(items)}日主力累计净流出{abs(total_in_yi):.2f}亿元，资金持续撤离")
        elif total_in_yi < -1:
            score = 0.28
            reason_parts.append(f"近{len(items)}日主力净流出{abs(total_in_yi):.2f}亿元，资金偏谨慎")
        else:
            reason_parts.append(f"近{len(items)}日主力资金流向{'+' if total_in_yi >= 0 else ''}{total_in_yi:.2f}亿元，基本平衡")
        
        # 连续流入加分
        if consecutive_days >= 3:
            score = min(score + 0.1, 1.0)
            reason_parts.append(f"连续{consecutive_days}日主力净流入，趋势信号较强")
        elif consecutive_days == 0 and total_in_yi < 0:
            days_out = sum(1 for it in items if it.get("main_net", 0) < 0)
            reason_parts.append(f"近{days_out}日主力持续净流出，谨慎对待")
        
        # 最新一日超大单行为
        latest_super = items[-1].get("super_large_net", 0) / 1e4 if items else 0
        if latest_super > 2:
            reason_parts.append(f"昨日超大单净流入{latest_super:.2f}亿元，机构活跃")
        elif latest_super < -2:
            reason_parts.append(f"昨日超大单净流出{abs(latest_super):.2f}亿元，大资金减持")
        
        # 信号判断
        if score >= 0.65:
            signal = "buy"
        elif score <= 0.35:
            signal = "sell"
        else:
            signal = "neutral"
        
        return {
            "score":  round(score, 2),
            "reason": "；".join(reason_parts) if reason_parts else "资金流向中性",
            "signal": signal
        }
    
    def _analyze_with_llm(self, code: str, name: Optional[str],
                          flow_data: Dict, rule_result: Dict) -> Optional[Dict]:
        """
        使用 LLM 深度分析资金流向，给出专业解读。
        
        Args:
            code:        股票代码
            name:        股票名称
            flow_data:   资金流向数据
            rule_result: 规则引擎结果（用于参考）
            
        Returns:
            LLM 分析结果字典，失败返回 None
        """
        items = flow_data.get("items", [])
        if not items:
            return None
        
        # 格式化资金流向明细
        flow_text = "\n".join([
            f"  {item['date']}  主力净流入:{item.get('main_net', 0)/1e4:.2f}亿  "
            f"超大单:{item.get('super_large_net', 0)/1e4:.2f}亿  "
            f"大单:{item.get('large_net', 0)/1e4:.2f}亿  "
            f"散户(小单):{item.get('small_net', 0)/1e4:.2f}亿"
            for item in items
        ])
        
        summary = flow_data.get("summary", {})
        is_real = flow_data.get("is_real_data", False)
        
        prompt = f"""
请分析以下资金流向数据，给出专业的操作建议。

股票代码：{code}
股票名称：{name or '未知'}
数据来源：{'真实数据（东方财富）' if is_real else '模拟数据（仅供参考）'}

近期资金流向明细（万元）：
{flow_text}

规则引擎初步判断：{rule_result.get('reason', '')}

请按以下格式输出 JSON：
{{
  "score": 0.75,
  "reason": "详细分析：主力意图解读、资金强度评价、操作建议（100-200字）",
  "signal": "buy/sell/neutral"
}}

评分标准：
- 0.8-1.0：主力大幅净流入，强烈看多
- 0.6-0.8：主力小幅净流入，适度看多
- 0.4-0.6：资金流向中性
- 0.2-0.4：主力净流出，适度看空
- 0.0-0.2：主力大幅流出，强烈看空

请确保输出有效的 JSON。
"""
        
        system_prompt = """你是专业的量化分析师，擅长解读A股资金流向数据。
分析时需关注：
1. 主力资金（超大单+大单）的持续性和力度
2. 散户（小单）与主力方向是否一致
3. 单日大额资金异动是否有规律
4. 结合市场整体环境给出操作建议
保持客观，注意提示投资风险。"""
        
        return self.llm_client.generate_json(prompt, system_prompt)


# 全局单例
_capital_flow_agent = None

def get_capital_flow_agent() -> CapitalFlowAgent:
    """获取全局资金流向 Agent 实例（单例模式）"""
    global _capital_flow_agent
    if _capital_flow_agent is None:
        _capital_flow_agent = CapitalFlowAgent()
    return _capital_flow_agent


if __name__ == "__main__":
    agent = CapitalFlowAgent()
    print("Testing CapitalFlowAgent...")
    result = agent.analyze("sh600519", "贵州茅台", days=5)
    import json
    print(json.dumps(result, ensure_ascii=False, indent=2))
