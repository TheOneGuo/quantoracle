"""
新闻分析 Agent
分析新闻事件对股票的影响，暂用规则引擎
"""

import logging
import random
import os
import requests
from typing import Dict, Any, Optional, List
from datetime import datetime

from ..llm_client import get_llm_client
from ..news_factor.rules_engine import NewsRulesEngine

logger = logging.getLogger(__name__)


class NewsAgent:
    """
    新闻事件分析智能体
    
    职责：分析新闻事件对股票和行业的影响，包括：
    - 公司公告：业绩预告、重大合同、股权变动等
    - 行业政策：产业扶持、监管政策、行业标准
    - 宏观事件：货币政策、财政政策、地缘政治
    - 市场传闻：并购重组、业务转型等
    
    注：第一期使用规则引擎，后期升级为 RAG + 向量数据库
    """
    
    def __init__(self):
        self.llm_client = get_llm_client()
        self.rules_engine = NewsRulesEngine()
        self.name = "News Agent"
        
        # 后端新闻服务地址（通过环境变量配置，默认本地）
        self._backend_url = os.environ.get('BACKEND_URL', 'http://localhost:3001')
        
        # 模拟新闻缓存（实际应用中应从新闻API获取）
        self._news_cache = {}
    
    def analyze(self, code: str, name: str = None, industry: str = None) -> Dict[str, Any]:
        """
        分析新闻事件对股票的影响，返回评分和理由
        
        Args:
            code: 股票代码（如 sh600519）
            name: 股票名称（可选）
            industry: 所属行业（可选，用于行业新闻匹配）
            
        Returns:
            包含分析结果的字典：
            {
                "score": 0.0-1.0,           # 新闻面评分
                "reason": "分析理由文字",
                "events": [相关新闻事件],
                "impact": "positive/negative/neutral",
                "timestamp": "分析时间",
                "agent": self.name,
                "is_simulated": true        # 标记是否为模拟数据
            }
        """
        logger.info(f"NewsAgent analyzing {code}")
        
        # 1. 获取相关新闻事件（模拟）
        news_events = self._get_news_events(code, name, industry)
        
        # 如果没有新闻事件，返回中性分析
        if not news_events:
            return self._neutral_analysis(code, name)
        
        # 2. 使用规则引擎分析影响
        rule_analysis = self.rules_engine.analyze_impact(news_events, industry)
        
        # 3. 使用 LLM 分析（如果可用）
        llm_result = None
        if self.llm_client.is_available():
            llm_result = self._analyze_with_llm(code, name, news_events, industry)
        
        if llm_result and llm_result.get("score") is not None:
            # LLM 分析成功
            return {
                "score": float(llm_result["score"]),
                "reason": llm_result.get("reason", "新闻面分析完成"),
                "events": news_events,
                "impact": llm_result.get("impact", rule_analysis.get("overall_impact", "neutral")),
                "rule_analysis": rule_analysis,
                "timestamp": datetime.now().isoformat(),
                "agent": self.name,
                "is_simulated": True
            }
        else:
            # LLM 失败，使用规则引擎结果
            logger.info(f"Using rule-based news analysis for {code}")
            return self._rule_based_analysis(code, name, news_events, rule_analysis)
    
    def _get_news_events(self, code: str, name: Optional[str], industry: Optional[str]) -> List[Dict]:
        """
        从后端 /api/news/stock/:code 接口获取真实新闻事件。
        若接口不可用（网络异常、超时），降级到模拟数据作为兜底。
        
        Args:
            code: 股票代码（如 sh600519）
            name: 股票名称
            industry: 所属行业
            
        Returns:
            新闻事件列表，每项包含 type, title, content, date, source
        """
        cache_key = f"{code}_{industry}"
        if cache_key in self._news_cache:
            return self._news_cache[cache_key]
        
        # ── 优先：从后端真实新闻接口拉取 ────────────────────────────
        try:
            url = f"{self._backend_url}/api/news/stock/{code}"
            resp = requests.get(url, timeout=5, params={"count": 10})
            resp.raise_for_status()
            payload = resp.json()
            
            # 后端返回格式：{ success: true, data: [...] } 或 { items: [...] }
            raw_items = []
            if isinstance(payload, dict):
                raw_items = payload.get("data", payload.get("items", []))
            elif isinstance(payload, list):
                raw_items = payload
            
            if raw_items:
                events = []
                for item in raw_items[:10]:  # 最多取10条
                    events.append({
                        "type":    item.get("category", item.get("type", "市场资讯")),
                        "title":   item.get("title", ""),
                        "content": item.get("content", item.get("summary", item.get("title", ""))),
                        "date":    item.get("pub_date", item.get("date", item.get("publishTime", ""))),
                        "source":  item.get("source", item.get("src", "东方财富")),
                        # 影响分数由规则引擎二次计算，初始置 0
                        "impact_score": item.get("score", 0)
                    })
                
                logger.info(f"NewsAgent: 从后端获取到 {len(events)} 条真实新闻（{code}）")
                self._news_cache[cache_key] = events
                return events
        
        except Exception as e:
            # 后端不可达或返回异常，降级到模拟数据
            logger.warning(f"NewsAgent: 后端新闻接口不可用，降级到模拟数据：{e}")
        
        # ── 兜底：生成模拟数据 ────────────────────────────────────────
        random.seed(hash(cache_key) % 1000)
        events = []
        num_events = random.randint(0, 3)
        
        news_templates = [
            {
                "type": "业绩公告",
                "templates": [
                    "公司发布业绩预告，预计{period}净利润同比增长{growth}%",
                    "公司{period}报告显示，营收达{revenue}亿元，净利润{profit}亿元",
                ]
            },
            {
                "type": "重大合同",
                "templates": [
                    "公司签订重大合同，金额约{amount}亿元",
                    "公司中标{project}项目，合同价值{amount}亿元"
                ]
            },
            {
                "type": "政策影响",
                "templates": [
                    "{policy}政策出台，预计对{industry}行业产生{impact}影响",
                ]
            },
        ]
        
        for i in range(num_events):
            tpl_group = random.choice(news_templates)
            tpl = random.choice(tpl_group["templates"])
            content = tpl.format(
                period=random.choice(["一季度", "上半年", "前三季度", "全年"]),
                growth=random.randint(-30, 100),
                revenue=random.randint(10, 500),
                profit=random.randint(1, 100),
                amount=random.randint(1, 50),
                project=random.choice(["智慧城市", "新能源", "数据中心", "智能制造"]),
                policy=random.choice(["碳中和", "数字经济", "自主可控", "高质量发展"]),
                industry=industry or "相关",
                impact=random.choice(["正面", "负面", "中性"]),
            )
            days_ago = random.randint(1, 30)
            from datetime import timedelta
            news_date = (datetime.now() - timedelta(days=days_ago)).strftime("%Y-%m-%d")
            events.append({
                "type":         tpl_group["type"],
                "title":        f"{name or code}{tpl_group['type']}",
                "content":      content,
                "date":         news_date,
                "source":       "模拟数据",
                "impact_score": random.uniform(-0.3, 0.3)
            })
        
        self._news_cache[cache_key] = events
        return events
    
    def _analyze_with_llm(self, code: str, name: Optional[str], 
                          events: List[Dict], industry: Optional[str]) -> Optional[Dict]:
        """
        使用 LLM 分析新闻事件
        
        Args:
            code: 股票代码
            name: 股票名称
            events: 新闻事件列表
            industry: 所属行业
            
        Returns:
            LLM 分析结果字典，失败返回 None
        """
        if not events:
            return None
        
        # 格式化新闻事件
        events_text = "\n".join([
            f"{i+1}. [{event['date']}] {event['type']}: {event['content']}"
            for i, event in enumerate(events)
        ])
        
        prompt = f"""
请分析以下新闻事件对股票的影响，并给出0-1的评分（1为最好）。

股票代码：{code}
股票名称：{name or '未知'}
所属行业：{industry or '未知'}

近期相关新闻事件（注：当前为模拟数据）：
{events_text}

请按以下格式输出 JSON：
{{
  "score": 0.70,  // 0-1的评分，保留两位小数
  "reason": "详细的新闻分析理由，包括对每个新闻事件的解读和综合影响评估",
  "impact": "positive/negative/neutral"  // 整体影响方向
}}

评分参考标准：
1. 优秀（0.8-1.0）：重大利好频出，政策支持明确，行业前景广阔
2. 良好（0.6-0.8）：正面新闻居多，公司基本面改善，行业趋势向好
3. 一般（0.4-0.6）：新闻影响中性，好坏参半，无明显趋势
4. 较差（0.2-0.4）：负面新闻较多，公司面临挑战，行业压力增大
5. 很差（0.0-0.2）：重大利空频发，公司陷入困境，行业前景黯淡

请注意：当前数据为模拟数据，实际分析时应结合真实新闻。
请确保输出有效的 JSON。
"""
        
        system_prompt = """你是一个专业的新闻事件分析师。你需要基于新闻事件进行客观分析，考虑：
1. 事件性质：是利好、利空还是中性事件
2. 事件重要性：对公司基本面和行业格局的影响程度
3. 事件时效性：是近期事件还是历史事件
4. 事件一致性：多个事件的影响方向是否一致
5. 行业背景：结合行业发展趋势和周期位置
6. 市场预期：事件是否已被市场充分预期

注意说明当前分析基于模拟数据，实际投资决策需要结合更多信息。"""
        
        result = self.llm_client.generate_json(prompt, system_prompt)
        return result
    
    def _rule_based_analysis(self, code: str, name: Optional[str], 
                            events: List[Dict], rule_analysis: Dict) -> Dict[str, Any]:
        """
        基于规则引擎的分析
        
        Args:
            code: 股票代码
            name: 股票名称
            events: 新闻事件列表
            rule_analysis: 规则引擎分析结果
            
        Returns:
            规则分析结果
        """
        if not events:
            return self._neutral_analysis(code, name)
        
        # 计算平均影响分数
        impact_scores = [event.get("impact_score", 0) for event in events]
        avg_impact = sum(impact_scores) / len(impact_scores) if impact_scores else 0
        
        # 将影响分数(-0.3~0.3)转换为0-1评分
        score = 0.5 + avg_impact  # 基础0.5分，加上影响
        
        # 限制在0-1之间
        score = max(0.0, min(1.0, score))
        
        # 生成理由
        event_summaries = [f"{event['type']}：{event['content']}" for event in events[:3]]  # 最多3个
        reason = f"{name or code}新闻面分析：近期有{len(events)}个相关事件。" + \
                 "主要事件包括：" + "；".join(event_summaries) + \
                 f"。综合评估影响{'正面' if score > 0.6 else '负面' if score < 0.4 else '中性'}（注：当前为模拟数据）"
        
        # 确定影响方向
        if score > 0.6:
            impact = "positive"
        elif score < 0.4:
            impact = "negative"
        else:
            impact = "neutral"
        
        return {
            "score": score,
            "reason": reason,
            "events": events,
            "impact": impact,
            "rule_analysis": rule_analysis,
            "timestamp": datetime.now().isoformat(),
            "agent": self.name + " (Rule-Based)",
            "is_simulated": True
        }
    
    def _neutral_analysis(self, code: str, name: Optional[str]) -> Dict[str, Any]:
        """
        无新闻事件时的中性分析
        
        Args:
            code: 股票代码
            name: 股票名称
            
        Returns:
            中性分析结果
        """
        return {
            "score": 0.5,
            "reason": f"近期无{name or code}相关重大新闻事件，新闻面影响中性（注：当前为模拟数据）",
            "events": [],
            "impact": "neutral",
            "rule_analysis": {"overall_impact": "neutral", "affected_sectors": []},
            "timestamp": datetime.now().isoformat(),
            "agent": self.name,
            "is_simulated": True
        }


# 全局单例实例
_news_agent = None

def get_news_agent() -> NewsAgent:
    """
    获取全局新闻分析 Agent 实例（单例模式）
    
    Returns:
        NewsAgent 实例
    """
    global _news_agent
    if _news_agent is None:
        _news_agent = NewsAgent()
    return _news_agent


if __name__ == "__main__":
    # 测试代码
    from datetime import timedelta
    agent = NewsAgent()
    print("Testing NewsAgent...")
    result = agent.analyze("sh600519", "贵州茅台", "白酒")
    print(f"Result: {result}")