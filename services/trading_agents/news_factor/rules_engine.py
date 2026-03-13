"""
新闻因子规则引擎 - 初版（规则表驱动）
将来升级为 RAG + 向量数据库时，只需替换此模块
"""

import logging
from typing import Dict, List, Any, Optional, Set

logger = logging.getLogger(__name__)


class NewsRulesEngine:
    """
    新闻因子规则引擎
    
    职责：基于规则表分析新闻事件对行业和股票的影响
    事件类型 → 受影响板块映射表，支持正向受益和负向受损
    
    注：这是初版规则引擎，后期可升级为基于向量数据库的 RAG 系统
    """
    
    def __init__(self):
        # 事件类型 → 受影响板块 映射表
        self.EVENT_SECTOR_MAP = {
            "战争/冲突": {
                "benefit": ["军工", "黄金", "石油", "避险资产", "国防", "网络安全"],
                "damage": ["消费", "旅游", "航空", "出口", "运输", "奢侈品"]
            },
            "美联储加息": {
                "benefit": ["银行", "保险", "金融", "高息货币资产"],
                "damage": ["科技成长", "房地产", "高负债企业", "新兴市场", "债券"]
            },
            "美联储降息": {
                "benefit": ["科技成长", "房地产", "高负债企业", "新兴市场", "黄金"],
                "damage": ["银行", "保险", "传统金融"]
            },
            "中国财政刺激": {
                "benefit": ["基建", "新能源", "消费", "地产", "建材", "工程机械"],
                "damage": ["无明确受损板块"]
            },
            "中国货币政策宽松": {
                "benefit": ["房地产", "金融", "消费", "成长股", "小盘股"],
                "damage": ["银行净息差可能收窄"]
            },
            "碳中和/新能源政策": {
                "benefit": ["新能源", "光伏", "风电", "电动车", "储能", "环保"],
                "damage": ["传统煤炭", "火电", "高耗能产业"]
            },
            "半导体/芯片政策": {
                "benefit": ["半导体", "芯片", "集成电路", "设备材料", "设计软件"],
                "damage": ["依赖进口的下游产业"]
            },
            "医药集采": {
                "benefit": ["患者/医保", "仿制药企业（若中标）"],
                "damage": ["高价原研药", "未中标企业", "高毛利药企"]
            },
            "房地产调控": {
                "benefit": ["保障房", "租赁市场", "房地产服务"],
                "damage": ["开发商", "房地产投资", "建材（短期）"]
            },
            "疫情爆发": {
                "benefit": ["医药", "疫苗", "检测", "线上办公", "电商", "物流"],
                "damage": ["旅游", "航空", "酒店", "餐饮", "线下零售", "娱乐"]
            },
            "自然灾害": {
                "benefit": ["建材", "救援设备", "保险（部分）", "重建相关"],
                "damage": ["受灾地区企业", "农业（若影响产区）", "保险（赔付端）"]
            },
            "贸易摩擦/关税": {
                "benefit": ["进口替代", "国内产业链", "自主可控相关"],
                "damage": ["出口企业", "跨国供应链", "外贸依赖型企业"]
            },
            "数据安全/隐私监管": {
                "benefit": ["网络安全", "数据安全", "国产软件", "合规服务"],
                "damage": ["互联网平台", "数据滥用企业", "跨境数据业务"]
            },
            "人工智能政策支持": {
                "benefit": ["AI芯片", "算法公司", "算力基础设施", "应用场景"],
                "damage": ["传统劳动力密集型", "可能被替代的行业"]
            },
            "消费刺激政策": {
                "benefit": ["家电", "汽车", "食品饮料", "零售", "旅游", "娱乐"],
                "damage": ["储蓄类产品"]
            }
        }
        
        # 行业 → 相关股票关键词（用于匹配）
        self.SECTOR_KEYWORDS = {
            "军工": ["军工", "国防", "航天", "航空", "兵器", "舰船", "雷达"],
            "黄金": ["黄金", "贵金属", "金矿", "首饰"],
            "石油": ["石油", "石化", "油气", "炼化", "钻井"],
            "新能源": ["新能源", "光伏", "风电", "储能", "电池", "锂电", "氢能"],
            "半导体": ["半导体", "芯片", "集成电路", "晶圆", "封测", "光刻"],
            "医药": ["医药", "生物", "制药", "医疗", "器械", "疫苗"],
            "消费": ["消费", "白酒", "食品", "饮料", "家电", "零售", "旅游"],
            "金融": ["银行", "保险", "证券", "信托", "金融", "支付"],
            "基建": ["基建", "建筑", "建材", "水泥", "钢铁", "工程机械"],
            "房地产": ["地产", "房地产", "开发商", "物业", "租赁"],
            "科技": ["科技", "软件", "互联网", "云计算", "大数据", "人工智能"],
            "汽车": ["汽车", "整车", "零部件", "新能源车", "自动驾驶"],
            "传媒": ["传媒", "娱乐", "游戏", "影视", "广告", "出版"]
        }
    
    def analyze_impact(self, news_events: List[Dict], target_industry: Optional[str] = None) -> Dict[str, Any]:
        """
        分析新闻事件对行业的影响
        
        Args:
            news_events: 新闻事件列表，每项包含 type, content 等字段
            target_industry: 目标行业（可选），如果提供则计算对该行业的特定影响
            
        Returns:
            影响分析结果：
            {
                "overall_impact": "positive/negative/neutral",
                "affected_sectors": [
                    {"sector": "军工", "impact": "positive", "events": ["战争/冲突"]},
                    ...
                ],
                "target_industry_impact": "positive/negative/neutral"  # 仅当target_industry提供时
            }
        """
        if not news_events:
            return {
                "overall_impact": "neutral",
                "affected_sectors": [],
                "target_industry_impact": "neutral" if target_industry else None
            }
        
        # 收集所有受影响板块
        sector_impacts = {}  # sector -> {"impact": "positive"/"negative", "events": []}
        
        for event in news_events:
            event_type = event.get("type", "")
            content = event.get("content", "").lower()
            
            # 查找匹配的事件类型
            matched_event = None
            for event_pattern in self.EVENT_SECTOR_MAP:
                if event_pattern in event_type or event_pattern in content:
                    matched_event = event_pattern
                    break
            
            if not matched_event:
                # 尝试基于内容关键词匹配
                for event_pattern, sector_map in self.EVENT_SECTOR_MAP.items():
                    keywords = event_pattern.lower().split("/")
                    if any(keyword in content for keyword in keywords):
                        matched_event = event_pattern
                        break
            
            if matched_event and matched_event in self.EVENT_SECTOR_MAP:
                # 处理受益板块
                for sector in self.EVENT_SECTOR_MAP[matched_event]["benefit"]:
                    if sector:
                        if sector not in sector_impacts:
                            sector_impacts[sector] = {"impact": "positive", "events": []}
                        if matched_event not in sector_impacts[sector]["events"]:
                            sector_impacts[sector]["events"].append(matched_event)
                
                # 处理受损板块
                for sector in self.EVENT_SECTOR_MAP[matched_event]["damage"]:
                    if sector and sector not in ["无明确受损板块", ""]:
                        if sector not in sector_impacts:
                            sector_impacts[sector] = {"impact": "negative", "events": []}
                        elif sector_impacts[sector]["impact"] == "positive":
                            # 如果既有受益又有受损，标记为混合
                            sector_impacts[sector]["impact"] = "mixed"
                        if matched_event not in sector_impacts[sector]["events"]:
                            sector_impacts[sector]["events"].append(matched_event)
        
        # 转换为列表格式
        affected_sectors = []
        for sector, info in sector_impacts.items():
            affected_sectors.append({
                "sector": sector,
                "impact": info["impact"],
                "events": info["events"]
            })
        
        # 计算整体影响
        overall_impact = "neutral"
        if affected_sectors:
            positive_count = sum(1 for s in affected_sectors if s["impact"] in ["positive", "mixed"])
            negative_count = sum(1 for s in affected_sectors if s["impact"] in ["negative", "mixed"])
            
            if positive_count > negative_count:
                overall_impact = "positive"
            elif negative_count > positive_count:
                overall_impact = "negative"
        
        # 计算目标行业特定影响
        target_industry_impact = None
        if target_industry:
            target_industry_impact = self._get_industry_specific_impact(target_industry, affected_sectors)
        
        return {
            "overall_impact": overall_impact,
            "affected_sectors": affected_sectors,
            "target_industry_impact": target_industry_impact
        }
    
    def _get_industry_specific_impact(self, target_industry: str, 
                                     affected_sectors: List[Dict]) -> str:
        """
        获取对特定行业的影响
        
        Args:
            target_industry: 目标行业
            affected_sectors: 受影响板块列表
            
        Returns:
            "positive"/"negative"/"neutral"/"mixed"
        """
        if not target_industry or not affected_sectors:
            return "neutral"
        
        # 标准化行业名称（小写）
        target_lower = target_industry.lower()
        
        # 查找匹配的板块
        matching_sectors = []
        for sector_info in affected_sectors:
            sector = sector_info["sector"].lower()
            
            # 直接匹配
            if sector in target_lower or target_lower in sector:
                matching_sectors.append(sector_info)
                continue
            
            # 通过关键词匹配
            if sector in self.SECTOR_KEYWORDS:
                keywords = self.SECTOR_KEYWORDS[sector]
                if any(keyword.lower() in target_lower for keyword in keywords):
                    matching_sectors.append(sector_info)
        
        if not matching_sectors:
            return "neutral"
        
        # 统计影响方向
        impacts = [s["impact"] for s in matching_sectors]
        positive_count = impacts.count("positive")
        negative_count = impacts.count("negative")
        mixed_count = impacts.count("mixed")
        
        if mixed_count > 0 or (positive_count > 0 and negative_count > 0):
            return "mixed"
        elif positive_count > negative_count:
            return "positive"
        elif negative_count > positive_count:
            return "negative"
        else:
            return "neutral"
    
    def get_event_types(self) -> List[str]:
        """
        获取支持的事件类型列表
        
        Returns:
            事件类型列表
        """
        return list(self.EVENT_SECTOR_MAP.keys())
    
    def get_sectors_for_event(self, event_type: str) -> Dict[str, List[str]]:
        """
        获取特定事件类型影响的板块
        
        Args:
            event_type: 事件类型
            
        Returns:
            {"benefit": [受益板块], "damage": [受损板块]}
        """
        return self.EVENT_SECTOR_MAP.get(event_type, {"benefit": [], "damage": []})
    
    def add_custom_rule(self, event_type: str, benefit_sectors: List[str], 
                       damage_sectors: List[str]) -> bool:
        """
        添加自定义规则（动态扩展）
        
        Args:
            event_type: 事件类型
            benefit_sectors: 受益板块列表
            damage_sectors: 受损板块列表
            
        Returns:
            是否添加成功
        """
        if not event_type:
            return False
        
        self.EVENT_SECTOR_MAP[event_type] = {
            "benefit": benefit_sectors,
            "damage": damage_sectors
        }
        logger.info(f"Added custom rule for event type: {event_type}")
        return True


# 全局单例实例
_rules_engine = None

def get_rules_engine() -> NewsRulesEngine:
    """
    获取全局规则引擎实例（单例模式）
    
    Returns:
        NewsRulesEngine 实例
    """
    global _rules_engine
    if _rules_engine is None:
        _rules_engine = NewsRulesEngine()
    return _rules_engine


if __name__ == "__main__":
    # 测试代码
    engine = NewsRulesEngine()
    print("Testing NewsRulesEngine...")
    
    # 测试事件影响分析
    test_events = [
        {"type": "战争/冲突", "content": "地区冲突升级，国际局势紧张"},
        {"type": "新能源政策", "content": "国家发布新能源发展规划"}
    ]
    
    result = engine.analyze_impact(test_events, "光伏")
    print(f"Analysis result: {result}")
    
    # 测试获取事件类型
    event_types = engine.get_event_types()
    print(f"Supported event types: {event_types[:5]}...")