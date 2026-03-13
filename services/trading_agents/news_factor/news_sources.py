"""
新闻源配置 - 参考 situation-monitor 项目整理

数据来源：https://github.com/hipcityreg/situation-monitor

按重要性分类，为中国金融市场场景优先选取相关源。
所有源均为公开 RSS feed，无需 API key。

使用方式：
  from news_sources import NEWS_SOURCES, SOURCE_CREDIBILITY, get_sources_by_category
  
  # 获取所有金融类新闻源
  finance_sources = get_sources_by_category('finance')
  
  # 获取主流可信源
  mainstream = [s for s in NEWS_SOURCES if SOURCE_CREDIBILITY.get(s['id']) == 'mainstream']
"""

from typing import List, Dict, Optional

# 新闻源列表
NEWS_SOURCES: List[Dict] = [
    # 政治类（category="politics"）
    {"id": "bbc-world", "name": "BBC World", "url": "https://feeds.bbci.co.uk/news/world/rss.xml",
     "category": "politics", "language": "en", "credibility": "mainstream", "priority": 1},
    {"id": "guardian-world", "name": "Guardian World", "url": "https://www.theguardian.com/world/rss",
     "category": "politics", "language": "en", "credibility": "mainstream", "priority": 2},
    {"id": "nyt-world", "name": "NYT World", "url": "https://rss.nytimes.com/services/xml/rss/nyt/World.xml",
     "category": "politics", "language": "en", "credibility": "mainstream", "priority": 2},
    {"id": "reuters-world", "name": "Reuters World", "url": "https://feeds.reuters.com/Reuters/worldNews",
     "category": "politics", "language": "en", "credibility": "mainstream", "priority": 1},
    {"id": "ap-news", "name": "AP News", "url": "https://rsshub.app/apnews/topics/apf-worldnews",
     "category": "politics", "language": "en", "credibility": "mainstream", "priority": 1},
    
    # 科技类（category="tech"）
    {"id": "hacker-news", "name": "Hacker News", "url": "https://hnrss.org/frontpage",
     "category": "tech", "language": "en", "credibility": "alternative", "priority": 2},
    {"id": "ars-technica", "name": "Ars Technica", "url": "https://feeds.arstechnica.com/arstechnica/technology-lab",
     "category": "tech", "language": "en", "credibility": "mainstream", "priority": 2},
    {"id": "mit-tech", "name": "MIT Tech Review", "url": "https://www.technologyreview.com/feed/",
     "category": "tech", "language": "en", "credibility": "mainstream", "priority": 1},
    {"id": "arxiv-ai", "name": "ArXiv AI", "url": "https://rss.arxiv.org/rss/cs.AI",
     "category": "tech", "language": "en", "credibility": "academic", "priority": 3},
    {"id": "openai-blog", "name": "OpenAI Blog", "url": "https://openai.com/news/rss.xml",
     "category": "tech", "language": "en", "credibility": "corporate", "priority": 2},
    {"id": "the-verge", "name": "The Verge", "url": "https://www.theverge.com/rss/index.xml",
     "category": "tech", "language": "en", "credibility": "mainstream", "priority": 3},
    
    # 金融类（category="finance"）
    {"id": "cnbc", "name": "CNBC", "url": "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114",
     "category": "finance", "language": "en", "credibility": "mainstream", "priority": 1},
    {"id": "marketwatch", "name": "MarketWatch", "url": "https://feeds.marketwatch.com/marketwatch/topstories",
     "category": "finance", "language": "en", "credibility": "mainstream", "priority": 1},
    {"id": "yahoo-finance", "name": "Yahoo Finance", "url": "https://finance.yahoo.com/news/rssindex",
     "category": "finance", "language": "en", "credibility": "mainstream", "priority": 2},
    {"id": "bbc-business", "name": "BBC Business", "url": "https://feeds.bbci.co.uk/news/business/rss.xml",
     "category": "finance", "language": "en", "credibility": "mainstream", "priority": 2},
    {"id": "ft-home", "name": "Financial Times", "url": "https://www.ft.com/rss/home",
     "category": "finance", "language": "en", "credibility": "mainstream", "priority": 1},
    
    # 政府官方类（category="gov", 特别重要）
    {"id": "federal-reserve", "name": "Federal Reserve", "url": "https://www.federalreserve.gov/feeds/press_all.xml",
     "category": "gov", "language": "en", "credibility": "official", "priority": 1},
    {"id": "sec-press", "name": "SEC Announcements", "url": "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=PX&datetype=custom&owner=include&count=40&output=atom",
     "category": "gov", "language": "en", "credibility": "official", "priority": 1},
    {"id": "white-house", "name": "White House", "url": "https://www.whitehouse.gov/news/feed/",
     "category": "gov", "language": "en", "credibility": "official", "priority": 2},
    
    # 情报/智库类（category="intel"）
    {"id": "csis", "name": "CSIS", "url": "https://www.csis.org/analysis/feed",
     "category": "intel", "language": "en", "credibility": "think-tank", "priority": 2},
    {"id": "brookings", "name": "Brookings", "url": "https://www.brookings.edu/feed/",
     "category": "intel", "language": "en", "credibility": "think-tank", "priority": 2},
    {"id": "cfr", "name": "CFR", "url": "https://www.cfr.org/rss.xml",
     "category": "intel", "language": "en", "credibility": "think-tank", "priority": 2},
    {"id": "defense-one", "name": "Defense One", "url": "https://www.defenseone.com/rss/all/",
     "category": "intel", "language": "en", "credibility": "defense", "priority": 3},
    {"id": "diplomat", "name": "The Diplomat", "url": "https://thediplomat.com/feed/",
     "category": "intel", "language": "en", "credibility": "regional", "priority": 2},
    {"id": "bellingcat", "name": "Bellingcat", "url": "https://www.bellingcat.com/feed/",
     "category": "intel", "language": "en", "credibility": "osint", "priority": 3},
    
    # 网络安全类（category="cyber"）
    {"id": "cisa-alerts", "name": "CISA Alerts", "url": "https://www.cisa.gov/uscert/ncas/alerts.xml",
     "category": "cyber", "language": "en", "credibility": "official", "priority": 2},
    {"id": "krebs-security", "name": "Krebs on Security", "url": "https://krebsonsecurity.com/feed/",
     "category": "cyber", "language": "en", "credibility": "expert", "priority": 3},
    
    # 中文财经类（category="cn-finance", 为A股场景补充）
    {"id": "caixin", "name": "财新", "url": "https://weekly.caixin.com/rss/rss.xml",
     "category": "cn-finance", "language": "zh", "credibility": "mainstream", "priority": 1},
    {"id": "yicai", "name": "第一财经", "url": "https://www.yicai.com/rss",
     "category": "cn-finance", "language": "zh", "credibility": "mainstream", "priority": 1},
    {"id": "sina-finance", "name": "新浪财经", "url": "https://rss.sina.com.cn/news/stock/rss.xml",
     "category": "cn-finance", "language": "zh", "credibility": "mainstream", "priority": 2},
    {"id": "eastmoney-news", "name": "东方财富快讯", "url": "https://np-weblist.10jqka.com.cn/comm/api/getArticleList?appid=dc92e3d4da63e5cc&menuCode=001&stockCode=&pageSize=20&rn=_ts",
     "category": "cn-finance", "language": "zh", "credibility": "mainstream", "priority": 1},
]

# 源可信度映射
SOURCE_CREDIBILITY: Dict[str, str] = {
    'bbc-world': 'mainstream', 'guardian-world': 'mainstream',
    'nyt-world': 'mainstream', 'reuters-world': 'mainstream',
    'ap-news': 'mainstream', 'cnbc': 'mainstream',
    'marketwatch': 'mainstream', 'yahoo-finance': 'mainstream',
    'bbc-business': 'mainstream', 'ft-home': 'mainstream',
    'mit-tech': 'mainstream', 'ars-technica': 'mainstream',
    'the-verge': 'mainstream', 'caixin': 'mainstream',
    'yicai': 'mainstream', 'sina-finance': 'mainstream',
    'federal-reserve': 'official', 'sec-press': 'official',
    'white-house': 'official', 'cisa-alerts': 'official',
    'csis': 'think-tank', 'brookings': 'think-tank',
    'cfr': 'think-tank', 'defense-one': 'defense',
    'diplomat': 'regional', 'bellingcat': 'osint',
    'hacker-news': 'alternative', 'arxiv-ai': 'academic',
    'openai-blog': 'corporate', 'krebs-security': 'expert',
    'eastmoney-news': 'mainstream',
}


def get_sources_by_category(category: str) -> List[Dict]:
    """
    获取指定类别的所有新闻源
    
    Args:
        category: 类别，如 'finance', 'politics', 'tech', 'gov', 'intel', 'cyber', 'cn-finance'
    
    Returns:
        该类别下的新闻源列表
    """
    return [s for s in NEWS_SOURCES if s['category'] == category]


def get_sources_by_priority(max_priority: int = 2) -> List[Dict]:
    """
    获取优先级 <= max_priority 的新闻源（优先级数字越小越重要）
    
    Args:
        max_priority: 最大优先级（默认2）
    
    Returns:
        优先级 <= max_priority 的新闻源列表
    """
    return [s for s in NEWS_SOURCES if s['priority'] <= max_priority]


def get_credibility_weight(source_id: str) -> float:
    """
    获取新闻源的可信度权重
    
    权重规则：
    - official=1.5
    - mainstream=1.0
    - think-tank=1.2
    - defense=1.1
    - academic=1.0
    - regional=0.9
    - osint=0.8
    - corporate=0.8
    - alternative=0.6
    - expert=0.9
    
    Args:
        source_id: 新闻源ID
    
    Returns:
        可信度权重
    """
    credibility = SOURCE_CREDIBILITY.get(source_id, 'mainstream')
    weight_map = {
        'official': 1.5,
        'mainstream': 1.0,
        'think-tank': 1.2,
        'defense': 1.1,
        'academic': 1.0,
        'regional': 0.9,
        'osint': 0.8,
        'corporate': 0.8,
        'alternative': 0.6,
        'expert': 0.9,
    }
    return weight_map.get(credibility, 1.0)