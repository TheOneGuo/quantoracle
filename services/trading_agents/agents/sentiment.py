"""
情绪分析 Agent
分析市场情绪指标：北向资金/融资余额/龙虎榜
优先接入 AkShare 真实数据，降级时使用模拟数据
"""

import logging
import random
import os
import requests
from typing import Dict, Any, Optional
from datetime import datetime, timedelta

from ..llm_client import get_llm_client

logger = logging.getLogger(__name__)


class SentimentAgent:
    """
    市场情绪分析智能体
    
    职责：分析股票的市场情绪指标，包括：
    - 资金流向：北向资金净流入/流出
    - 杠杆资金：融资余额变化
    - 机构行为：龙虎榜机构买卖
    - 市场热度：换手率、成交额
    - 舆情情绪：新闻情绪（简单模拟）
    
    注：第一期使用模拟数据，后期接入真实数据源
    """
    
    def __init__(self):
        self.llm_client = get_llm_client()
        self.name = "Sentiment Agent"
        
        # 模拟数据缓存（实际应用中应从数据库或API获取）
        self._sentiment_cache = {}
    
    def analyze(self, code: str, name: str = None) -> Dict[str, Any]:
        """
        分析股票市场情绪，返回评分和理由
        
        Args:
            code: 股票代码（如 sh600519）
            name: 股票名称（可选，用于提示词）
            
        Returns:
            包含分析结果的字典：
            {
                "score": 0.0-1.0,           # 情绪面评分
                "reason": "分析理由文字",
                "metrics": {情绪指标},
                "sentiment": "bullish/bearish/neutral",
                "timestamp": "分析时间",
                "agent": self.name,
                "is_simulated": true        # 标记是否为模拟数据
            }
        """
        logger.info(f"SentimentAgent analyzing {code}")
        
        # 1. 获取情绪指标（模拟）
        sentiment_metrics = self._get_sentiment_metrics(code, name)
        
        # 2. 使用 LLM 分析
        llm_result = self._analyze_with_llm(code, name, sentiment_metrics)
        
        if llm_result and llm_result.get("score") is not None:
            # LLM 分析成功
            return {
                "score": float(llm_result["score"]),
                "reason": llm_result.get("reason", "情绪面分析完成"),
                "metrics": sentiment_metrics,
                "sentiment": llm_result.get("sentiment", sentiment_metrics.get("overall_sentiment", "neutral")),
                "timestamp": datetime.now().isoformat(),
                "agent": self.name,
                "is_simulated": True
            }
        else:
            # LLM 失败，使用规则引擎
            logger.warning(f"LLM analysis failed for {code}, using rule-based analysis")
            return self._rule_based_analysis(code, sentiment_metrics)
    
    def _get_sentiment_metrics(self, code: str, name: Optional[str]) -> Dict[str, Any]:
        """
        获取情绪指标：优先从 AkShare 接入真实北向资金/融资余额，降级到模拟数据。
        
        真实数据源：
        - 北向资金：东方财富接口（AkShare 封装的北向资金）
        - 融资余额：东方财富融资融券接口
        
        Args:
            code: 股票代码（如 sh600519）
            name: 股票名称
            
        Returns:
            情绪指标字典
        """
        if code in self._sentiment_cache:
            return self._sentiment_cache[code]
        
        # 提取纯数字代码
        pure_code = code.replace('sh', '').replace('sz', '')
        
        northbound_flow  = None  # 北向资金净流入（亿元）
        margin_change    = None  # 融资余额变化（亿元）
        is_real_data     = False
        
        # ── 尝试通过 AkShare 获取真实北向资金 ──────────────────────────
        try:
            import akshare as ak
            
            # 北向资金（当日沪深港通个股资金流向）
            # ak.stock_hsgt_individual_em 返回个股陆股通持股数据
            # 更稳定：用大盘北向资金接口获取当日整体情绪参考
            try:
                df_nb = ak.stock_hsgt_north_net_flow_in_em(symbol="沪深港通")
                if df_nb is not None and not df_nb.empty:
                    latest_nb = df_nb.iloc[-1]
                    # 列名可能为"资金流向" "净买入"等，取最后一列数字
                    for col in df_nb.columns:
                        val = latest_nb[col]
                        if isinstance(val, (int, float)) and abs(val) > 0.001:
                            northbound_flow = float(val)
                            break
                    is_real_data = True
            except Exception as nb_err:
                logger.debug(f"北向资金接口异常: {nb_err}")
            
            # 融资余额变化（个股）
            try:
                today_str = datetime.now().strftime("%Y%m%d")
                week_ago  = (datetime.now() - timedelta(days=7)).strftime("%Y%m%d")
                df_margin = ak.stock_margin_detail_em(
                    symbol=pure_code,
                    start_date=week_ago,
                    end_date=today_str
                )
                if df_margin is not None and len(df_margin) >= 2:
                    # 计算最近两个交易日融资余额变化
                    latest_bal = float(df_margin.iloc[-1].get("融资余额", 0) or 0)
                    prev_bal   = float(df_margin.iloc[-2].get("融资余额", 0) or 0)
                    margin_change = (latest_bal - prev_bal) / 1e8  # 转亿元
                    is_real_data  = True
            except Exception as mg_err:
                logger.debug(f"融资余额接口异常: {mg_err}")
        
        except ImportError:
            logger.warning("AkShare 未安装，情绪指标降级到模拟数据")
        except Exception as e:
            logger.warning(f"AkShare 接口调用失败，降级到模拟数据：{e}")
        
        # ── 兜底：用确定性随机填充缺失字段 ────────────────────────────
        random.seed(hash(code) % 1000)
        if northbound_flow is None:
            northbound_flow = random.uniform(-5, 10)
        if margin_change is None:
            margin_change = random.uniform(-3, 8)
        
        turnover_rate       = random.uniform(1, 15)   # 换手率（%）
        volume_amount       = random.uniform(5, 50)   # 成交额（亿元）
        institutional_net_buy = random.uniform(-5000, 10000)  # 龙虎榜机构净买（万元）
        news_sentiment      = random.uniform(30, 80)  # 舆情情绪（0-100）
        
        # ── 综合评分计算 ────────────────────────────────────────────────
        overall_score    = 0.0
        positive_factors = 0
        total_factors    = 6
        
        if northbound_flow > 0:
            overall_score += northbound_flow / 10
            positive_factors += 1
        if margin_change > 0:
            overall_score += margin_change / 8
            positive_factors += 1
        if turnover_rate > 3:
            overall_score += min(turnover_rate / 15, 1.0) * 0.5
            positive_factors += 1
        if institutional_net_buy > 0:
            overall_score += min(institutional_net_buy / 10000, 1.0) * 0.5
            positive_factors += 1
        if news_sentiment > 50:
            overall_score += (news_sentiment - 50) / 50
            positive_factors += 1
        if 10 < volume_amount < 30:
            overall_score += 0.3
            positive_factors += 1
        
        normalized_score = overall_score / total_factors if total_factors > 0 else 0.5
        
        if normalized_score > 0.6:
            overall_sentiment = "bullish"
        elif normalized_score < 0.4:
            overall_sentiment = "bearish"
        else:
            overall_sentiment = "neutral"
        
        metrics = {
            "code":               code,
            "name":               name or "未知",
            "northbound_flow":    round(northbound_flow, 2),      # 亿元
            "margin_change":      round(margin_change, 2),         # 亿元
            "turnover_rate":      round(turnover_rate, 2),         # %
            "volume_amount":      round(volume_amount, 2),         # 亿元
            "institutional_net_buy": round(institutional_net_buy, 2),  # 万元
            "news_sentiment":     round(news_sentiment, 2),        # 0-100
            "positive_factors":   positive_factors,
            "total_factors":      total_factors,
            "overall_sentiment":  overall_sentiment,
            "is_real_data":       is_real_data,                    # 标记是否为真实数据
        }
        
        self._sentiment_cache[code] = metrics
        return metrics
    
    def _analyze_with_llm(self, code: str, name: Optional[str], metrics: Dict) -> Optional[Dict]:
        """
        使用 LLM 分析情绪指标
        
        Args:
            code: 股票代码
            name: 股票名称
            metrics: 情绪指标字典
            
        Returns:
            LLM 分析结果字典，失败返回 None
        """
        # 构建提示词
        metrics_text = "\n".join([f"- {k}: {v}" for k, v in metrics.items()])
        
        prompt = f"""
请分析以下股票的市场情绪情况，并给出0-1的评分（1为最好）。

股票代码：{code}
股票名称：{name or '未知'}

情绪指标（注：当前为模拟数据）：
{metrics_text}

请按以下格式输出 JSON：
{{
  "score": 0.65,  // 0-1的评分，保留两位小数
  "reason": "详细的市场情绪分析理由，包括资金流向、杠杆资金、机构行为、市场热度等方面的分析",
  "sentiment": "bullish/bearish/neutral"  // 整体情绪判断
}}

评分参考标准：
1. 优秀（0.8-1.0）：北向大幅流入，融资余额增加，机构大幅净买入，市场热度高，舆情正面
2. 良好（0.6-0.8）：北向小幅流入，融资余额稳定或小幅增加，机构小幅净买入，市场热度适中
3. 一般（0.4-0.6）：资金流向不明显，融资余额变化不大，机构买卖平衡，市场热度一般
4. 较差（0.2-0.4）：北向流出，融资余额减少，机构净卖出，市场冷淡，舆情负面
5. 很差（0.0-0.2）：资金大幅流出，杠杆资金撤离，机构大幅卖出，市场恐慌，舆情极度负面

请注意：当前数据为模拟数据，实际分析时应结合真实市场情况。
请确保输出有效的 JSON。
"""
        
        system_prompt = """你是一个专业的市场情绪分析师。你需要基于情绪指标进行客观分析，考虑：
1. 资金流向：北向资金是净流入还是净流出，金额大小
2. 杠杆资金：融资余额是增加还是减少，反映投资者信心
3. 机构行为：龙虎榜上机构是净买入还是净卖出
4. 市场热度：换手率和成交额是否活跃
5. 舆情情绪：新闻情绪分数高低
6. 综合判断：各项指标的一致性，是否有背离现象

注意说明当前分析基于模拟数据，实际投资决策需要结合更多信息。"""
        
        result = self.llm_client.generate_json(prompt, system_prompt)
        return result
    
    def _rule_based_analysis(self, code: str, metrics: Dict) -> Dict[str, Any]:
        """
        LLM 失败时的规则引擎分析
        
        Args:
            code: 股票代码
            metrics: 情绪指标字典
            
        Returns:
            规则分析结果
        """
        score = 0.5  # 默认中等评分
        reason_parts = []
        
        # 1. 北向资金分析
        northbound = metrics.get("northbound_flow", 0)
        if northbound > 5:
            score += 0.15
            reason_parts.append(f"北向资金净流入{northbound:.2f}亿元，外资看好")
        elif northbound < -2:
            score -= 0.1
            reason_parts.append(f"北向资金净流出{abs(northbound):.2f}亿元，外资谨慎")
        else:
            reason_parts.append(f"北向资金流向{'+' if northbound > 0 else ''}{northbound:.2f}亿元，基本平衡")
        
        # 2. 融资余额分析
        margin = metrics.get("margin_change", 0)
        if margin > 3:
            score += 0.1
            reason_parts.append(f"融资余额增加{margin:.2f}亿元，杠杆资金进场")
        elif margin < -1:
            score -= 0.1
            reason_parts.append(f"融资余额减少{abs(margin):.2f}亿元，杠杆资金撤离")
        else:
            reason_parts.append(f"融资余额变化{margin:.2f}亿元，基本稳定")
        
        # 3. 机构行为分析
        institution = metrics.get("institutional_net_buy", 0)
        if institution > 5000:
            score += 0.1
            reason_parts.append(f"机构净买入{institution:.0f}万元，机构看好")
        elif institution < -2000:
            score -= 0.1
            reason_parts.append(f"机构净卖出{abs(institution):.0f}万元，机构减仓")
        
        # 4. 市场热度分析
        turnover = metrics.get("turnover_rate", 0)
        if 3 < turnover < 10:
            score += 0.05  # 适度换手有利
            reason_parts.append(f"换手率{turnover:.1f}%，市场活跃度适中")
        elif turnover > 10:
            reason_parts.append(f"换手率{turnover:.1f}%，交易过于活跃")
        
        # 5. 舆情情绪分析
        news = metrics.get("news_sentiment", 50)
        if news > 60:
            score += 0.05
            reason_parts.append(f"舆情情绪{news:.0f}分，偏正面")
        elif news < 40:
            score -= 0.05
            reason_parts.append(f"舆情情绪{news:.0f}分，偏负面")
        
        # 限制分数在0-1之间
        score = max(0.0, min(1.0, score))
        
        # 生成理由
        if not reason_parts:
            reason = "情绪指标数据不足，无法进行深入分析"
        else:
            reason = f"{metrics.get('name', code)}情绪面分析：" + "；".join(reason_parts) + "（注：当前为模拟数据）"
        
        # 确定情绪方向
        if score > 0.6:
            sentiment = "bullish"
        elif score < 0.4:
            sentiment = "bearish"
        else:
            sentiment = "neutral"
        
        return {
            "score": score,
            "reason": reason,
            "metrics": metrics,
            "sentiment": sentiment,
            "timestamp": datetime.now().isoformat(),
            "agent": self.name + " (Rule-Based)",
            "is_simulated": True
        }


# 全局单例实例
_sentiment_agent = None

def get_sentiment_agent() -> SentimentAgent:
    """
    获取全局情绪分析 Agent 实例（单例模式）
    
    Returns:
        SentimentAgent 实例
    """
    global _sentiment_agent
    if _sentiment_agent is None:
        _sentiment_agent = SentimentAgent()
    return _sentiment_agent


if __name__ == "__main__":
    # 测试代码
    agent = SentimentAgent()
    print("Testing SentimentAgent...")
    result = agent.analyze("sh600519", "贵州茅台")
    print(f"Result: {result}")