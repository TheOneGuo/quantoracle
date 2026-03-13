"""
技术面分析 Agent
调用 /api/kline/:code 获取K线，计算 MACD/RSI/均线，LLM 综合评分
"""

import logging
from typing import Dict, Any, Optional
from datetime import datetime

from ..llm_client import get_llm_client
from ..data.stock_data import get_stock_data_client

logger = logging.getLogger(__name__)


class TechnicalAgent:
    """
    技术面分析智能体
    
    职责：分析股票的技术指标和价格走势，包括：
    - 趋势指标：移动平均线（MA5, MA10, MA20, MA60）
    - 动量指标：MACD, RSI, KDJ
    - 成交量：量价关系，成交量比率
    - 价格形态：支撑阻力，价格位置
    - 技术信号：金叉死叉，背离信号
    """
    
    def __init__(self):
        self.llm_client = get_llm_client()
        self.data_client = get_stock_data_client()
        self.name = "Technical Agent"
    
    def analyze(self, code: str, name: str = None) -> Dict[str, Any]:
        """
        分析股票技术面，返回评分和理由
        
        Args:
            code: 股票代码（如 sh600519）
            name: 股票名称（可选，用于提示词）
            
        Returns:
            包含分析结果的字典：
            {
                "score": 0.0-1.0,           # 技术面评分
                "reason": "分析理由文字",
                "indicators": {技术指标},
                "signals": ["信号1", "信号2"],
                "trend": "bullish/bearish/neutral",
                "timestamp": "分析时间",
                "agent": self.name
            }
        """
        logger.info(f"TechnicalAgent analyzing {code}")
        
        # 1. 获取K线数据
        kline_data = self.data_client.get_kline(code, limit=240)  # 约1年数据
        if not kline_data or len(kline_data) < 50:
            logger.warning(f"Insufficient kline data for {code}, using fallback analysis")
            return self._fallback_analysis(code, name)
        
        # 2. 计算技术指标
        indicators = self.data_client.calculate_technical_indicators(kline_data)
        if not indicators:
            logger.warning(f"Failed to calculate indicators for {code}, using fallback")
            return self._fallback_analysis(code, name)
        
        # 3. 使用 LLM 分析
        llm_result = self._analyze_with_llm(code, name, indicators)
        
        if llm_result and llm_result.get("score") is not None:
            # LLM 分析成功
            return {
                "score": float(llm_result["score"]),
                "reason": llm_result.get("reason", "技术面分析完成"),
                "indicators": indicators,
                "signals": llm_result.get("signals", []),
                "trend": llm_result.get("trend", indicators.get("trend", "neutral")),
                "timestamp": datetime.now().isoformat(),
                "agent": self.name
            }
        else:
            # LLM 失败，使用规则引擎
            logger.warning(f"LLM analysis failed for {code}, using rule-based analysis")
            return self._rule_based_analysis(code, indicators)
    
    def _analyze_with_llm(self, code: str, name: Optional[str], indicators: Dict) -> Optional[Dict]:
        """
        使用 LLM 分析技术指标
        
        Args:
            code: 股票代码
            name: 股票名称
            indicators: 技术指标字典
            
        Returns:
            LLM 分析结果字典，失败返回 None
        """
        # 构建技术指标摘要
        indicators_text = self._format_indicators(indicators)
        
        prompt = f"""
请分析以下股票的技术面情况，并给出0-1的评分（1为最好）。

股票代码：{code}
股票名称：{name or '未知'}

当前价格：{indicators.get('current_price', '未知')}
近期高点：{indicators.get('recent_high', '未知')}
近期低点：{indicators.get('recent_low', '未知')}
价格位置：{indicators.get('price_position', 0.5):.1%}（0%为近期低点，100%为近期高点）

技术指标：
{indicators_text}

请按以下格式输出 JSON：
{{
  "score": 0.75,  // 0-1的评分，保留两位小数
  "reason": "详细的技术分析理由，包括趋势、动量、成交量、形态等方面的分析",
  "signals": ["信号1", "信号2", "信号3"],  // 如"MACD金叉"、"RSI超卖"等
  "trend": "bullish/bearish/neutral"  // 整体趋势判断
}}

评分参考标准：
1. 优秀（0.8-1.0）：上升趋势明确，技术指标多头排列，量价配合良好，突破关键位置
2. 良好（0.6-0.8）：趋势向上或有筑底迹象，部分指标走好，量能有所放大
3. 一般（0.4-0.6）：震荡走势，方向不明，指标中性，量能平淡
4. 较差（0.2-0.4）：下降趋势，技术指标空头排列，量价背离，跌破支撑
5. 很差（0.0-0.2）：技术形态严重恶化，指标全面走弱，风险极高

请确保输出有效的 JSON。
"""
        
        system_prompt = """你是一个专业的股票技术分析师。你需要基于技术指标进行客观分析，考虑：
1. 趋势分析：价格处于上升、下降还是震荡趋势
2. 移动平均线：短期均线与长期均线的关系，是否多头/空头排列
3. 动量指标：RSI是否超买超卖，MACD是否金叉死叉
4. 成交量：量价是否配合，有无放量突破或缩量调整
5. 价格位置：处于近期高点还是低点，是否面临关键支撑阻力
6. 技术信号：有无明显的买入或卖出信号

保持分析专业、客观，不要预测未来，只分析当前技术状态。"""
        
        result = self.llm_client.generate_json(prompt, system_prompt)
        return result
    
    def _format_indicators(self, indicators: Dict) -> str:
        """
        格式化技术指标为可读文本
        
        Args:
            indicators: 技术指标字典
            
        Returns:
            格式化的指标文本
        """
        lines = []
        
        # 移动平均线
        ma_lines = []
        for period in [5, 10, 20, 60]:
            key = f"ma{period}"
            if key in indicators and indicators[key] is not None:
                ma_lines.append(f"MA{period}: {indicators[key]:.2f}")
        if ma_lines:
            lines.append("移动平均线：" + "，".join(ma_lines))
        
        # RSI
        if "rsi" in indicators:
            rsi = indicators["rsi"]
            rsi_status = "超买" if rsi > 70 else "超卖" if rsi < 30 else "正常"
            lines.append(f"RSI: {rsi:.1f} ({rsi_status})")
        
        # MACD
        if "macd" in indicators:
            macd = indicators["macd"]
            if isinstance(macd, dict):
                macd_str = f"MACD: {macd.get('macd', 0):.3f}, 信号线: {macd.get('signal', 0):.3f}, 柱状图: {macd.get('histogram', 0):.3f}"
                macd_signal = "金叉" if macd.get('histogram', 0) > 0 else "死叉" if macd.get('histogram', 0) < 0 else "中性"
                lines.append(f"{macd_str} ({macd_signal})")
        
        # 成交量
        if "volume_ratio" in indicators:
            vol_ratio = indicators["volume_ratio"]
            vol_status = "放量" if vol_ratio > 1.5 else "缩量" if vol_ratio < 0.5 else "平量"
            lines.append(f"成交量比率: {vol_ratio:.2f}x ({vol_status})")
        
        # 价格位置
        if "price_position" in indicators:
            pos = indicators["price_position"]
            pos_status = "高位" if pos > 0.7 else "低位" if pos < 0.3 else "中位"
            lines.append(f"价格位置: {pos:.1%} ({pos_status})")
        
        # 趋势
        if "trend" in indicators:
            trend = indicators["trend"]
            trend_cn = {"bullish": "看涨", "bearish": "看跌", "neutral": "中性"}.get(trend, trend)
            lines.append(f"趋势判断: {trend_cn}")
        
        return "\n".join(lines)
    
    def _rule_based_analysis(self, code: str, indicators: Dict) -> Dict[str, Any]:
        """
        LLM 失败时的规则引擎分析
        
        Args:
            code: 股票代码
            indicators: 技术指标字典
            
        Returns:
            规则分析结果
        """
        score = 0.5  # 默认中等评分
        signals = []
        reason_parts = []
        
        # 1. 趋势分析
        trend = indicators.get("trend", "neutral")
        if trend == "bullish":
            score += 0.15
            signals.append("上升趋势")
            reason_parts.append("处于上升趋势")
        elif trend == "bearish":
            score -= 0.15
            signals.append("下降趋势")
            reason_parts.append("处于下降趋势")
        else:
            reason_parts.append("震荡趋势")
        
        # 2. 均线排列
        ma5 = indicators.get("ma5")
        ma20 = indicators.get("ma20")
        if ma5 is not None and ma20 is not None:
            current_price = indicators.get("current_price", 0)
            if current_price > ma5 > ma20:  # 多头排列
                score += 0.1
                signals.append("均线多头排列")
                reason_parts.append(f"价格{current_price:.2f} > MA5{ma5:.2f} > MA20{ma20:.2f}，多头排列")
            elif current_price < ma5 < ma20:  # 空头排列
                score -= 0.1
                signals.append("均线空头排列")
                reason_parts.append(f"价格{current_price:.2f} < MA5{ma5:.2f} < MA20{ma20:.2f}，空头排列")
        
        # 3. RSI分析
        rsi = indicators.get("rsi")
        if rsi is not None:
            if rsi < 30:
                score += 0.1  # 超卖是潜在买入机会
                signals.append("RSI超卖")
                reason_parts.append(f"RSI{rsi:.1f}，超卖区域")
            elif rsi > 70:
                score -= 0.1  # 超买是风险信号
                signals.append("RSI超买")
                reason_parts.append(f"RSI{rsi:.1f}，超买区域")
            elif 40 < rsi < 60:
                score += 0.05  # 中性偏强
                reason_parts.append(f"RSI{rsi:.1f}，中性区域")
        
        # 4. MACD分析
        macd_data = indicators.get("macd")
        if isinstance(macd_data, dict):
            histogram = macd_data.get("histogram", 0)
            if histogram > 0:
                score += 0.05
                signals.append("MACD金叉")
                reason_parts.append("MACD柱状图为正，金叉状态")
            elif histogram < 0:
                score -= 0.05
                signals.append("MACD死叉")
                reason_parts.append("MACD柱状图为负，死叉状态")
        
        # 5. 成交量分析
        volume_ratio = indicators.get("volume_ratio")
        if volume_ratio is not None:
            if volume_ratio > 1.5:
                # 放量需要结合价格方向判断
                if trend == "bullish":
                    score += 0.05
                    signals.append("放量上涨")
                    reason_parts.append(f"成交量放大{volume_ratio:.1f}倍，量价配合良好")
                elif trend == "bearish":
                    score -= 0.05
                    signals.append("放量下跌")
                    reason_parts.append(f"成交量放大{volume_ratio:.1f}倍，抛压较重")
        
        # 6. 价格位置
        price_position = indicators.get("price_position")
        if price_position is not None:
            if price_position < 0.3:
                score += 0.05  # 低位有安全边际
                signals.append("价格低位")
                reason_parts.append(f"价格处于近期{price_position:.1%}分位，相对低位")
            elif price_position > 0.7:
                score -= 0.05  # 高位有风险
                signals.append("价格高位")
                reason_parts.append(f"价格处于近期{price_position:.1%}分位，相对高位")
        
        # 限制分数在0-1之间
        score = max(0.0, min(1.0, score))
        
        # 生成理由
        if not reason_parts:
            reason = "技术指标数据不足，无法进行深入分析"
        else:
            reason = f"{name or code}技术面分析：" + "；".join(reason_parts)
        
        # 如果没有识别到信号，设置默认值
        if not signals:
            signals = ["技术信号不明显"]
        
        return {
            "score": score,
            "reason": reason,
            "indicators": indicators,
            "signals": signals,
            "trend": trend,
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
            "reason": f"无法获取{code}的技术指标数据，使用默认评分",
            "indicators": {},
            "signals": ["数据不足，无法评估"],
            "trend": "neutral",
            "timestamp": datetime.now().isoformat(),
            "agent": self.name + " (Fallback)"
        }


# 全局单例实例
_technical_agent = None

def get_technical_agent() -> TechnicalAgent:
    """
    获取全局技术面分析 Agent 实例（单例模式）
    
    Returns:
        TechnicalAgent 实例
    """
    global _technical_agent
    if _technical_agent is None:
        _technical_agent = TechnicalAgent()
    return _technical_agent


if __name__ == "__main__":
    # 测试代码
    agent = TechnicalAgent()
    print("Testing TechnicalAgent...")
    result = agent.analyze("sh600519", "贵州茅台")
    print(f"Result: {result}")