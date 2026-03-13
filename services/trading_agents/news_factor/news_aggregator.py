"""
新闻聚合器 - 多源 RSS 抓取 + 智能标签

支持30+新闻源，自动打标：
- region: APAC/EUROPE/MENA/AMERICAS/AFRICA/GLOBAL
- is_alert: 是否触发紧急告警关键词
- credibility_weight: 信源可信度权重（0.6~1.5）
- topics: 命中的关联话题列表（来自 CORRELATION_TOPICS）
"""

import asyncio
import aiohttp
import feedparser
import hashlib
from typing import List, Dict, Optional, Tuple
import re
from datetime import datetime, timezone

# === 地区检测关键词（来自 situation-monitor） ===
REGION_KEYWORDS = {
    "APAC": ["China", "Taiwan", "Japan", "Korea", "Indo-Pacific", "South China Sea", 
              "ASEAN", "Philippines", "中国", "台湾", "日本", "韩国"],
    "EUROPE": ["NATO", "EU", "European", "Ukraine", "Russia", "Germany", 
               "France", "UK", "Britain", "Poland", "欧盟", "乌克兰"],
    "MENA": ["Iran", "Israel", "Saudi", "Syria", "Iraq", "Gaza", 
             "Lebanon", "Yemen", "Houthi", "Middle East"],
    "AMERICAS": ["US", "America", "Canada", "Mexico", "Brazil", 
                 "Venezuela", "Federal Reserve", "White House"],
    "AFRICA": ["Africa", "Sahel", "Niger", "Sudan", "Ethiopia", "Somalia"],
}

# === 紧急告警关键词（来自 situation-monitor） ===
ALERT_KEYWORDS = [
    "war", "invasion", "military", "nuclear", "sanctions", "missile", "attack",
    "troops", "conflict", "strike", "bomb", "casualties", "ceasefire", "treaty",
    "nato", "coup", "martial law", "emergency", "assassination", "terrorist",
    "hostage", "evacuation",
    # 补充中文关键词（A股场景）
    "战争", "入侵", "制裁", "核武", "导弹", "冲突", "空袭", "政变", "戒严",
    "紧急", "暗杀", "恐袭", "撤离", "爆炸", "伤亡",
]

# === 20个关联话题（来自 situation-monitor，用于新闻打标） ===
CORRELATION_TOPICS = {
    "tariffs": ["tariff", "trade war", "import tax", "customs duty", "关税", "贸易战"],
    "fed-rates": ["federal reserve", "interest rate", "rate cut", "rate hike", "powell", "fomc", "美联储", "加息", "降息"],
    "inflation": ["inflation", "cpi", "consumer price", "cost of living", "通货膨胀", "CPI"],
    "crypto": ["bitcoin", "crypto", "ethereum", "比特币", "加密货币"],
    "bank-crisis": ["bank fail", "banking crisis", "fdic", "bank run", "银行危机", "挤兑"],
    "supply-chain": ["supply chain", "shipping delay", "port congestion", "供应链", "断供"],
    "china-tensions": ["china taiwan", "south china sea", "us china", "beijing washington", "台海", "南海", "中美"],
    "russia-ukraine": ["ukraine", "zelensky", "putin", "crimea", "donbas", "乌克兰", "俄乌"],
    "israel-gaza": ["gaza", "hamas", "netanyahu", "以色列", "哈马斯", "加沙"],
    "iran": ["iran nuclear", "tehran", "ayatollah", "伊朗核", "伊朗"],
    "nuclear": ["nuclear threat", "nuclear weapon", "atomic", "icbm", "核武", "核威胁"],
    "ai-regulation": ["ai regulation", "artificial intelligence law", "ai safety", "AI监管", "人工智能法"],
    "big-tech": ["antitrust tech", "google monopoly", "meta lawsuit", "科技反垄断"],
    "layoffs": ["layoff", "job cut", "workforce reduction", "裁员", "降薪"],
    "climate": ["climate change", "wildfire", "hurricane", "extreme weather", "气候变化", "极端天气"],
    "pandemic": ["pandemic", "outbreak", "virus spread", "who emergency", "疫情", "大流行"],
    "election": ["election", "polling", "campaign", "ballot", "选举", "大选"],
    "housing": ["housing market", "mortgage rate", "home price", "房地产", "楼市"],
    "dollar-collapse": ["dollar collapse", "dedollarization", "brics currency", "美元崩溃", "去美元化"],
    "food-crisis": ["food shortage", "famine", "food supply", "粮食短缺", "粮食危机"],
}

# === 关键人物追踪（20人） ===
KEY_PERSONS = [
    "Trump", "Biden", "Putin", "Zelensky", "Xi Jinping", "习近平",
    "Netanyahu", "Kamala Harris", "Elon Musk", "Sam Altman",
    "Mark Zuckerberg", "Jeff Bezos", "Tim Cook", "Satya Nadella",
    "Sundar Pichai", "Jensen Huang", "Dario Amodei",
    "Warren Buffett", "Janet Yellen", "Jerome Powell", "鲍威尔",
]


class NewsAggregator:
    """
    多源新闻聚合器
    
    用法：
        aggregator = NewsAggregator()
        news = await aggregator.fetch_all(categories=['finance', 'politics'])
        alerts = [n for n in news if n['is_alert']]
    """
    
    def __init__(self, timeout: int = 10, max_per_source: int = 10):
        """
        @param timeout: 每个源的超时秒数
        @param max_per_source: 每个源最多取的新闻数量
        """
        self.timeout = timeout
        self.max_per_source = max_per_source
    
    async def fetch_source(self, source: dict, session: aiohttp.ClientSession) -> List[Dict]:
        """
        抓取单个 RSS 源
        @param source: 源配置（来自 NEWS_SOURCES）
        @returns: 标准化的新闻列表
        异常：超时/网络错误时返回空列表，不抛出
        """
        try:
            # 设置超时
            timeout = aiohttp.ClientTimeout(total=self.timeout)
            async with session.get(source['url'], timeout=timeout) as resp:
                if resp.status != 200:
                    return []
                content = await resp.read()
                # 解析 RSS
                feed = feedparser.parse(content)
                items = feed.entries[:self.max_per_source]
                normalized = []
                for item in items:
                    normalized_item = self._normalize_item(item, source)
                    if normalized_item:
                        normalized.append(normalized_item)
                return normalized
        except Exception as e:
            # 捕获所有异常，防止单个源影响整体抓取
            return []
    
    async def fetch_all(self, categories: List[str] = None, max_priority: int = 2) -> List[Dict]:
        """
        并发抓取所有（或指定类别的）新闻源
        @param categories: 限定类别，None=全部
        @param max_priority: 只抓优先级<=此值的源
        @returns: 合并后的新闻列表，按时间倒序
        """
        from .news_sources import NEWS_SOURCES, get_credibility_weight
        
        # 过滤源
        sources = [s for s in NEWS_SOURCES if s['priority'] <= max_priority]
        if categories:
            sources = [s for s in sources if s['category'] in categories]
        
        async with aiohttp.ClientSession() as session:
            tasks = [self.fetch_source(source, session) for source in sources]
            results = await asyncio.gather(*tasks, return_exceptions=True)
            
            # 合并所有结果
            all_news = []
            for i, result in enumerate(results):
                if isinstance(result, Exception):
                    continue
                all_news.extend(result)
            
            # 按发布时间倒序排序
            all_news.sort(key=lambda x: x.get('published_at', ''), reverse=True)
            return all_news
    
    def _normalize_item(self, item: dict, source: dict) -> Dict:
        """
        把 feedparser 返回的 entry 标准化为统一格式：
        {
          "id": str,                # 唯一标识（url hash）
          "title": str,
          "summary": str,
          "url": str,
          "published_at": str,      # ISO 8601
          "source_id": str,
          "source_name": str,
          "category": str,
          "credibility": str,       # mainstream/official/think-tank/...
          "credibility_weight": float,
          "region": str,            # APAC/EUROPE/MENA/AMERICAS/AFRICA/GLOBAL
          "topics": List[str],      # 命中的关联话题 id 列表
          "persons": List[str],     # 提及的关键人物
          "is_alert": bool,         # 是否触发紧急关键词
          "alert_keywords": List[str],  # 命中的告警关键词
        }
        """
        # 生成唯一ID
        url = item.get('link', '') or item.get('id', '')
        if not url:
            return None
        
        # 使用URL生成hash作为ID
        url_hash = hashlib.md5(url.encode()).hexdigest()
        
        # 标题和摘要
        title = item.get('title', '').strip()
        summary = item.get('summary', '').strip()
        if not summary and 'description' in item:
            summary = item.get('description', '').strip()
        
        # 发布时间处理
        published_at = ''
        if 'published_parsed' in item and item.published_parsed:
            try:
                dt = datetime(*item.published_parsed[:6], tzinfo=timezone.utc)
                published_at = dt.isoformat()
            except:
                pass
        if not published_at:
            published_at = datetime.now(timezone.utc).isoformat()
        
        # 拼接全文用于检测
        full_text = f"{title} {summary}".lower()
        
        # 检测区域
        region = self._detect_region(full_text)
        
        # 检测话题
        topics = self._detect_topics(full_text)
        
        # 检测人物
        persons = self._detect_persons(full_text)
        
        # 检测告警
        is_alert, alert_keywords = self._detect_alerts(full_text)
        
        # 可信度权重
        from .news_sources import get_credibility_weight
        credibility_weight = get_credibility_weight(source['id'])
        
        return {
            "id": url_hash,
            "title": title,
            "summary": summary,
            "url": url,
            "published_at": published_at,
            "source_id": source['id'],
            "source_name": source['name'],
            "category": source['category'],
            "credibility": source['credibility'],
            "credibility_weight": credibility_weight,
            "region": region,
            "topics": topics,
            "persons": persons,
            "is_alert": is_alert,
            "alert_keywords": alert_keywords,
        }
    
    def _detect_region(self, text: str) -> str:
        """检测新闻地区（多个地区命中时优先返回 APAC）"""
        detected = []
        for region, keywords in REGION_KEYWORDS.items():
            for kw in keywords:
                # 简单关键词匹配（区分大小写）
                if kw in text:
                    detected.append(region)
                    break
        
        # 去重
        detected = list(set(detected))
        
        # 优先返回APAC
        if "APAC" in detected:
            return "APAC"
        elif detected:
            return detected[0]
        else:
            return "GLOBAL"
    
    def _detect_topics(self, text: str) -> List[str]:
        """检测命中的关联话题"""
        topics = []
        for topic_id, keywords in CORRELATION_TOPICS.items():
            for kw in keywords:
                if kw.lower() in text:
                    topics.append(topic_id)
                    break
        return topics
    
    def _detect_persons(self, text: str) -> List[str]:
        """检测文中出现的关键人物"""
        persons = []
        for person in KEY_PERSONS:
            # 简单包含匹配（中文/英文）
            if person in text:
                persons.append(person)
        return persons
    
    def _detect_alerts(self, text: str) -> tuple:
        """检测紧急告警关键词，返回 (is_alert: bool, matched_keywords: List[str])"""
        matched = []
        for kw in ALERT_KEYWORDS:
            if kw.lower() in text:
                matched.append(kw)
        
        is_alert = len(matched) > 0
        return is_alert, matched


# 全局聚合器单例
_aggregator = None

def get_aggregator() -> NewsAggregator:
    global _aggregator
    if _aggregator is None:
        _aggregator = NewsAggregator()
    return _aggregator