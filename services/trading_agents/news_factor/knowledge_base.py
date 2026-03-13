"""
新闻因子知识库 - 事件分析范式管理器

设计理念：
  - 所有分析范式存在 SQLite 中，支持动态增删改查
  - 不写死在代码里，运营人员可随时通过 API 维护范式
  - LLM 分析新闻时先检索最相关范式，再按框架分析（RAG 简化版）
  - 不同市场（A股/美股/港股）的影响在每条范式中单独描述

数据库 Schema：
  event_paradigms 表
    id                  INTEGER PK
    category            TEXT     大类：geo_conflict / macro_policy / disaster / financial / political / industry
    subcategory         TEXT     小类：war_outbreak / fed_rate_hike / ...
    name                TEXT     人类可读名称，如"美联储加息"
    description         TEXT     说明和使用场景
    trigger_keywords    TEXT     JSON 数组，用于快速匹配新闻关键词
    market_impact       TEXT     JSON，格式见 DEFAULT_PARADIGMS
    severity_multiplier REAL     严重程度乘数（1.0=普通, 2.0=重大）
    duration_days       INTEGER  预期影响持续天数
    historical_cases    TEXT     JSON 数组，历史案例（供 LLM 参考）
    is_active           INTEGER  软删除标志（1=启用, 0=禁用）
    created_by          TEXT
    created_at          DATETIME
    updated_at          DATETIME
"""

import sqlite3
import json
import os
import logging
from datetime import datetime
from typing import Optional, List, Dict, Any

logger = logging.getLogger(__name__)

# 知识库数据库文件路径，通过环境变量可覆盖
DB_PATH = os.getenv("KNOWLEDGE_DB_PATH",
                    os.path.join(os.path.dirname(__file__), "knowledge.db"))

# ─────────────────────────────────────────────
# 预置分析范式（系统初始化时写入，之后可通过 API 修改）
# ─────────────────────────────────────────────
DEFAULT_PARADIGMS: List[Dict] = [
    # ── 地缘冲突类 ──────────────────────────────
    {
        "category": "geo_conflict", "subcategory": "war_outbreak",
        "name": "战争爆发",
        "description": "两国或多方发生直接军事冲突，影响全球风险偏好和大宗商品",
        "trigger_keywords": ["战争", "开战", "军事行动", "武装冲突", "空袭", "导弹袭击", "宣战"],
        "market_impact": {
            "A股": {
                "benefit": ["军工", "黄金ETF", "石油", "稀土"],
                "damage": ["消费", "旅游", "航空", "外贸"],
                "rationale": "战争刺激军工需求，避险情绪推高黄金；全球供应链受损影响出口和消费"
            },
            "美股": {
                "benefit": ["国防", "能源", "黄金"],
                "damage": ["旅游", "航空", "科技（供应链）"],
                "rationale": "美国军工股通常受益；全球风险偏好下降压制科技估值"
            },
            "港股": {
                "benefit": ["黄金", "资源"],
                "damage": ["消费", "内房", "科技"],
                "rationale": "港股受全球风险情绪影响大，避险资金外流"
            }
        },
        "severity_multiplier": 2.0, "duration_days": 30,
        "historical_cases": ["2022年俄乌冲突", "2023年以哈冲突"]
    },
    {
        "category": "geo_conflict", "subcategory": "sanctions",
        "name": "经济制裁",
        "description": "一国或多国对目标国实施经济/技术制裁措施",
        "trigger_keywords": ["制裁", "禁令", "出口管制", "实体清单", "技术封锁", "黑名单"],
        "market_impact": {
            "A股": {
                "benefit": ["国产替代（半导体/软件/工业）", "军工"],
                "damage": ["依赖进口原材料行业", "对美出口企业"],
                "rationale": "制裁倒逼国产替代加速；被制裁行业短期承压"
            },
            "美股": {
                "benefit": ["本土制造", "竞争对手"],
                "damage": ["对华业务占比高的科技/消费股"],
                "rationale": "制裁影响跨国企业在华收入"
            },
            "港股": {
                "benefit": [],
                "damage": ["科技", "互联网", "涉及制裁标的"],
                "rationale": "港股对制裁消息极为敏感，外资加速撤离"
            }
        },
        "severity_multiplier": 1.5, "duration_days": 60,
        "historical_cases": ["2020年华为制裁", "2022年芯片出口管制"]
    },
    {
        "category": "geo_conflict", "subcategory": "trade_war",
        "name": "贸易战/关税措施",
        "description": "两国或多国之间的贸易摩擦和报复性关税措施",
        "trigger_keywords": ["关税", "贸易战", "报复性关税", "贸易摩擦", "贸易谈判破裂", "加征关税"],
        "market_impact": {
            "A股": {
                "benefit": ["内需消费", "进口替代"],
                "damage": ["出口型制造业", "外贸依存度高行业"],
                "rationale": "关税提高出口成本；内需板块相对受益"
            },
            "美股": {
                "benefit": ["美国本土制造"],
                "damage": ["跨国企业", "零售（成本上升）"],
                "rationale": ""
            },
            "港股": {
                "benefit": [],
                "damage": ["出口", "物流", "港口"],
                "rationale": "香港作为贸易枢纽受贸易摩擦直接冲击"
            }
        },
        "severity_multiplier": 1.3, "duration_days": 90,
        "historical_cases": ["2018-2019中美贸易战", "2025年特朗普关税"]
    },
    # ── 宏观政策类 ──────────────────────────────
    {
        "category": "macro_policy", "subcategory": "fed_rate_hike",
        "name": "美联储加息",
        "description": "美联储上调联邦基金利率，收紧全球流动性",
        "trigger_keywords": ["美联储加息", "Fed加息", "联邦基金利率上调", "鹰派美联储", "缩表", "加息预期"],
        "market_impact": {
            "A股": {
                "benefit": ["银行", "保险"],
                "damage": ["成长股（高估值）", "房地产", "高负债企业"],
                "rationale": "加息收紧全球流动性，成长股估值承压；但A股相对独立，影响有限"
            },
            "美股": {
                "benefit": ["银行", "保险", "金融"],
                "damage": ["科技成长", "房地产REITs", "高负债公司"],
                "rationale": "利率上升直接压制高估值成长股，影响REITs分红吸引力"
            },
            "港股": {
                "benefit": ["银行", "保险"],
                "damage": ["地产", "公用事业", "高息股"],
                "rationale": "港元联系汇率制度下，港股随美联储政策联动明显"
            }
        },
        "severity_multiplier": 1.5, "duration_days": 14,
        "historical_cases": ["2022年美联储连续加息75BP", "2023年利率峰值5.25%"]
    },
    {
        "category": "macro_policy", "subcategory": "fed_rate_cut",
        "name": "美联储降息",
        "description": "美联储下调利率，释放流动性，改善全球风险偏好",
        "trigger_keywords": ["美联储降息", "Fed降息", "利率下调", "鸽派美联储", "宽松货币政策", "降息预期"],
        "market_impact": {
            "A股": {
                "benefit": ["成长股", "科技", "消费"],
                "damage": [],
                "rationale": "降息改善全球风险偏好，利好成长估值"
            },
            "美股": {
                "benefit": ["科技成长", "REITs", "消费", "小盘股"],
                "damage": ["银行"],
                "rationale": "降息周期利好高估值成长股"
            },
            "港股": {
                "benefit": ["地产", "科技", "消费"],
                "damage": [],
                "rationale": "降息周期港股弹性大"
            }
        },
        "severity_multiplier": 1.5, "duration_days": 30,
        "historical_cases": ["2019年预防性降息", "2024年降息周期开启"]
    },
    {
        "category": "macro_policy", "subcategory": "china_fiscal_stimulus",
        "name": "中国财政刺激",
        "description": "中国政府出台财政刺激政策，扩大内需或基建投资",
        "trigger_keywords": ["财政刺激", "扩大内需", "专项债", "基建投资", "消费补贴", "发放补贴", "刺激政策"],
        "market_impact": {
            "A股": {
                "benefit": ["基建", "新能源", "消费", "家电", "汽车"],
                "damage": [],
                "rationale": "财政刺激直接提振相关产业链，政策明确方向"
            },
            "美股": {
                "benefit": ["对华出口企业", "大宗商品"],
                "damage": [],
                "rationale": "中国刺激间接带动大宗商品和部分全球企业"
            },
            "港股": {
                "benefit": ["内地消费", "基建", "地产"],
                "damage": [],
                "rationale": "港股直接受益中国政策刺激"
            }
        },
        "severity_multiplier": 1.8, "duration_days": 60,
        "historical_cases": ["2023年扩大内需一揽子政策", "2024年万亿国债"]
    },
    {
        "category": "macro_policy", "subcategory": "china_industry_policy",
        "name": "中国产业政策扶持",
        "description": "中国政府出台产业政策，重点支持特定行业发展",
        "trigger_keywords": ["产业政策", "重点支持", "专精特新", "新质生产力", "战略新兴产业", "国家队入场"],
        "market_impact": {
            "A股": {
                "benefit": ["政策指向行业（新能源/半导体/AI/生物医药）"],
                "damage": [],
                "rationale": "政策明确支持方向，资金跟随政策流向，板块估值重塑"
            },
            "美股": {"benefit": [], "damage": [], "rationale": "影响有限"},
            "港股": {
                "benefit": ["相关中概股", "科技互联网"],
                "damage": [],
                "rationale": "港股科技股受益"
            }
        },
        "severity_multiplier": 1.3, "duration_days": 90,
        "historical_cases": ["新能源汽车补贴", "半导体大基金三期", "AI产业政策"]
    },
    {
        "category": "macro_policy", "subcategory": "china_industry_crackdown",
        "name": "中国产业监管整治",
        "description": "中国监管部门对特定行业进行整顿、反垄断调查或政策收紧",
        "trigger_keywords": ["整顿", "监管", "反垄断", "专项整治", "叫停", "禁止", "约谈", "责令整改"],
        "market_impact": {
            "A股": {
                "benefit": [],
                "damage": ["被整治行业（教育/游戏/互联网/地产等）"],
                "rationale": "监管政策冲击相关行业估值，不确定性上升"
            },
            "美股": {"benefit": [], "damage": [], "rationale": "间接影响在美上市中概股"},
            "港股": {
                "benefit": [],
                "damage": ["互联网", "教育", "地产"],
                "rationale": "港股直接承压，外资对政策风险敏感"
            }
        },
        "severity_multiplier": 1.5, "duration_days": 30,
        "historical_cases": ["2021年教育双减", "互联网反垄断调查", "游戏版号暂停"]
    },
    # ── 自然灾害类 ──────────────────────────────
    {
        "category": "disaster", "subcategory": "earthquake",
        "name": "地震",
        "description": "重大地震事件，影响区域经济和灾后重建需求",
        "trigger_keywords": ["地震", "强震", "里氏", "震级", "震后", "抗震救灾"],
        "market_impact": {
            "A股": {
                "benefit": ["建筑建材", "工程机械", "医疗物资", "救灾物资"],
                "damage": ["灾区上市公司"],
                "rationale": "灾后重建带动建材和工程机械需求；灾区企业短期承压"
            },
            "美股": {"benefit": [], "damage": [], "rationale": "除非在美国本土，否则影响有限"},
            "港股": {"benefit": [], "damage": [], "rationale": "影响有限"}
        },
        "severity_multiplier": 1.2, "duration_days": 7,
        "historical_cases": ["2008年四川汶川地震"]
    },
    {
        "category": "disaster", "subcategory": "pandemic",
        "name": "疫情/传染病大流行",
        "description": "重大传染病疫情爆发，影响全球经济活动和供应链",
        "trigger_keywords": ["疫情", "病毒", "传染病", "封城", "大流行", "WHO警告", "新冠", "确诊暴增"],
        "market_impact": {
            "A股": {
                "benefit": ["医药生物", "医疗器械", "线上服务", "消毒防护", "快递物流"],
                "damage": ["航空旅游", "线下消费", "餐饮零售", "酒店"],
                "rationale": "疫情加速线上化，线下消费受损；医药防护需求激增"
            },
            "美股": {
                "benefit": ["医疗", "科技（远程办公/电商）", "生物医药"],
                "damage": ["航空旅游", "零售", "餐饮", "酒店"],
                "rationale": ""
            },
            "港股": {
                "benefit": ["医药"],
                "damage": ["零售", "旅游", "酒店", "博彩"],
                "rationale": "香港依赖旅游和零售，疫情冲击大"
            }
        },
        "severity_multiplier": 2.5, "duration_days": 180,
        "historical_cases": ["2020年COVID-19全球大流行"]
    },
    # ── 金融市场事件类 ────────────────────────────
    {
        "category": "financial", "subcategory": "financial_crisis",
        "name": "金融危机/系统性风险",
        "description": "金融系统出现系统性风险，银行危机或流动性危机",
        "trigger_keywords": ["金融危机", "银行破产", "流动性危机", "信用崩溃", "系统性风险", "挤兑"],
        "market_impact": {
            "A股": {
                "benefit": ["黄金", "国债", "防御性消费（食品饮料）"],
                "damage": ["金融", "地产", "高杠杆企业", "全面回调"],
                "rationale": "系统性风险下，各类资产全面承压，黄金和国债避险"
            },
            "美股": {
                "benefit": ["黄金", "国债", "现金"],
                "damage": ["银行", "地产", "全市场"],
                "rationale": ""
            },
            "港股": {
                "benefit": [],
                "damage": ["全市场", "港元汇率压力"],
                "rationale": "港股高度开放，系统性风险冲击更大，外资加速撤离"
            }
        },
        "severity_multiplier": 3.0, "duration_days": 365,
        "historical_cases": ["2008年次贷危机", "2023年硅谷银行危机"]
    },
    {
        "category": "financial", "subcategory": "oil_price_surge",
        "name": "油价暴涨",
        "description": "国际油价大幅上涨，影响能源成本和通胀预期",
        "trigger_keywords": ["油价上涨", "原油飙升", "OPEC减产", "能源危机", "石油禁运", "布伦特暴涨"],
        "market_impact": {
            "A股": {
                "benefit": ["石油石化", "煤炭", "新能源（替代逻辑加速）"],
                "damage": ["航空", "化工（原料成本上升）", "物流"],
                "rationale": "能源成本上升压制高耗能行业；油气公司直接受益"
            },
            "美股": {
                "benefit": ["能源股（XOM/CVX/SLB）"],
                "damage": ["航空", "运输", "消费（通胀压力）"],
                "rationale": ""
            },
            "港股": {
                "benefit": ["中石油", "中石化", "中海油"],
                "damage": ["航空", "物流"],
                "rationale": ""
            }
        },
        "severity_multiplier": 1.3, "duration_days": 30,
        "historical_cases": ["2022年俄乌冲突后油价飙升至130美元/桶"]
    },
    {
        "category": "financial", "subcategory": "currency_crisis",
        "name": "汇率异动/货币贬值",
        "description": "主要货币大幅贬值或汇率剧烈波动",
        "trigger_keywords": ["汇率贬值", "货币危机", "人民币贬值", "美元暴涨", "外汇储备下降", "汇率破位"],
        "market_impact": {
            "A股": {
                "benefit": ["出口型企业（纺织/家电/电子/玩具）"],
                "damage": ["进口依赖型企业（航空/石油化工）"],
                "rationale": "人民币贬值提升出口竞争力，压制依赖进口成本的行业"
            },
            "美股": {
                "benefit": ["跨国企业（美元收入提升）"],
                "damage": [],
                "rationale": ""
            },
            "港股": {
                "benefit": ["出口", "资源"],
                "damage": ["内房（美元债压力）", "高外债企业"],
                "rationale": ""
            }
        },
        "severity_multiplier": 1.4, "duration_days": 30,
        "historical_cases": ["2015年811汇改", "2022年人民币破7.3"]
    },
    # ── 政治类 ────────────────────────────────
    {
        "category": "political", "subcategory": "china_us_tension",
        "name": "中美关系紧张",
        "description": "中美两国在政治、军事、经济领域的关系恶化",
        "trigger_keywords": ["中美关系", "美中摩擦", "台海紧张", "南海争端", "中美脱钩", "外交摩擦"],
        "market_impact": {
            "A股": {
                "benefit": ["军工", "国产替代", "内需消费"],
                "damage": ["出口美国企业", "依赖美国技术的公司"],
                "rationale": "中美紧张倒逼自主可控加速，国防支出增加"
            },
            "美股": {
                "benefit": ["军工", "本土制造"],
                "damage": ["在华业务为主企业（AAPL等）"],
                "rationale": ""
            },
            "港股": {
                "benefit": [],
                "damage": ["科技", "整体港股外资情绪"],
                "rationale": "中美紧张港股首当其冲，外资风险溢价上升"
            }
        },
        "severity_multiplier": 1.6, "duration_days": 60,
        "historical_cases": ["台海演习", "华为制裁", "气球事件"]
    },
    {
        "category": "political", "subcategory": "election",
        "name": "重大选举",
        "description": "主要经济体的重大选举，政权更迭带来政策不确定性",
        "trigger_keywords": ["总统选举", "大选", "选举结果", "政权更迭", "执政党更换"],
        "market_impact": {
            "A股": {"benefit": [], "damage": [], "rationale": "关注新政策方向（贸易/财政/产业）"},
            "美股": {
                "benefit": ["胜选方政策受益行业"],
                "damage": [],
                "rationale": "选举结果明朗后不确定性消除，市场通常反弹"
            },
            "港股": {"benefit": [], "damage": [], "rationale": "关注中美关系走向"}
        },
        "severity_multiplier": 1.2, "duration_days": 30,
        "historical_cases": ["2024年美国大选特朗普胜选"]
    },
    # ── 行业类 ────────────────────────────────
    {
        "category": "industry", "subcategory": "ai_breakthrough",
        "name": "AI重大突破/发布",
        "description": "人工智能领域重大技术突破或旗舰模型发布",
        "trigger_keywords": ["AI突破", "大模型发布", "GPT", "Claude", "人工智能革命", "AI超越人类", "AGI"],
        "market_impact": {
            "A股": {
                "benefit": ["AI算力（GPU服务器/光模块）", "AI应用软件", "数据中心", "国产大模型"],
                "damage": ["传统软件（被AI替代）", "部分被替代行业"],
                "rationale": "AI突破带动算力需求爆发，应用层百花齐放"
            },
            "美股": {
                "benefit": ["NVDA", "MSFT", "GOOGL", "AMZN（云）", "AI基础设施"],
                "damage": [],
                "rationale": "美股AI生态最为完整，受益最直接"
            },
            "港股": {
                "benefit": ["科技互联网（AI应用）", "算力基础设施"],
                "damage": [],
                "rationale": ""
            }
        },
        "severity_multiplier": 1.5, "duration_days": 30,
        "historical_cases": ["ChatGPT发布（2022.11）", "DeepSeek R1开源（2025.1）"]
    },
    {
        "category": "industry", "subcategory": "real_estate_crisis",
        "name": "房地产危机",
        "description": "房地产企业大规模债务违约或行业系统性风险",
        "trigger_keywords": ["房企暴雷", "烂尾楼", "房地产危机", "断供", "债务违约", "恒大", "房企违约"],
        "market_impact": {
            "A股": {
                "benefit": ["保障房", "物业管理（相对）"],
                "damage": ["房地产开发商", "银行（坏账）", "建材", "家居"],
                "rationale": "房企违约传导至上下游，银行不良资产压力上升"
            },
            "美股": {"benefit": [], "damage": ["在华地产业务相关"], "rationale": ""},
            "港股": {
                "benefit": [],
                "damage": ["内房股", "银行", "建材"],
                "rationale": "港股内房股首当其冲，流动性大幅收缩"
            }
        },
        "severity_multiplier": 2.0, "duration_days": 180,
        "historical_cases": ["恒大2021年债务危机", "碧桂园2023年违约"]
    },
    {
        "category": "industry", "subcategory": "supply_chain_disruption",
        "name": "供应链中断",
        "description": "全球供应链关键环节中断，影响多行业生产和交付",
        "trigger_keywords": ["供应链中断", "芯片短缺", "港口拥堵", "断供", "供应紧张", "缺货"],
        "market_impact": {
            "A股": {
                "benefit": ["国内替代供应商", "库存充裕企业", "国产芯片"],
                "damage": ["依赖进口零部件的制造业"],
                "rationale": "供应链危机加速国产替代；下游制造商成本上升"
            },
            "美股": {
                "benefit": ["本土制造", "自动化"],
                "damage": ["汽车", "电子消费品"],
                "rationale": ""
            },
            "港股": {"benefit": [], "damage": ["出口", "制造"], "rationale": ""}
        },
        "severity_multiplier": 1.3, "duration_days": 60,
        "historical_cases": ["2021年全球芯片荒", "苏伊士运河堵塞"]
    },
    {
        "category": "industry", "subcategory": "energy_transition",
        "name": "新能源政策/突破",
        "description": "新能源领域重大政策支持或技术突破",
        "trigger_keywords": ["碳中和", "新能源补贴", "电动车", "光伏", "风电", "储能突破", "双碳"],
        "market_impact": {
            "A股": {
                "benefit": ["新能源产业链（宁德/比亚迪/光伏组件/风电）", "电网"],
                "damage": ["传统化石能源"],
                "rationale": "政策明确碳中和路径，新能源产业链全面受益"
            },
            "美股": {
                "benefit": ["Tesla", "清洁能源ETF"],
                "damage": ["石化"],
                "rationale": ""
            },
            "港股": {
                "benefit": ["新能源汽车", "清洁能源"],
                "damage": [],
                "rationale": ""
            }
        },
        "severity_multiplier": 1.2, "duration_days": 90,
        "historical_cases": ["双碳目标发布", "美国IRA法案", "欧盟绿色协议"]
    },
]


class KnowledgeBase:
    """新闻因子知识库，管理事件分析范式的增删改查和智能检索"""

    def __init__(self, db_path: str = DB_PATH):
        self.db_path = db_path
        self._conn = None
        self.init_db()

    def _get_conn(self) -> sqlite3.Connection:
        """获取数据库连接（懒加载，线程内复用）"""
        if self._conn is None:
            self._conn = sqlite3.connect(self.db_path, check_same_thread=False)
            self._conn.row_factory = sqlite3.Row
        return self._conn

    def init_db(self):
        """
        初始化数据库：建表 + 写入预置范式（如果表为空）
        幂等操作，可重复调用不会重复插入。
        """
        conn = self._get_conn()
        conn.execute("""
            CREATE TABLE IF NOT EXISTS event_paradigms (
                id                  INTEGER PRIMARY KEY AUTOINCREMENT,
                category            TEXT NOT NULL,
                subcategory         TEXT NOT NULL,
                name                TEXT NOT NULL,
                description         TEXT,
                trigger_keywords    TEXT DEFAULT '[]',
                market_impact       TEXT DEFAULT '{}',
                severity_multiplier REAL DEFAULT 1.0,
                duration_days       INTEGER DEFAULT 7,
                historical_cases    TEXT DEFAULT '[]',
                is_active           INTEGER DEFAULT 1,
                created_by          TEXT DEFAULT 'system',
                created_at          TEXT DEFAULT (datetime('now')),
                updated_at          TEXT DEFAULT (datetime('now'))
            )
        """)
        conn.commit()

        # 只在表为空时插入预置数据，避免重复
        count = conn.execute("SELECT COUNT(*) FROM event_paradigms").fetchone()[0]
        if count == 0:
            logger.info("知识库为空，写入 %d 条预置范式", len(DEFAULT_PARADIGMS))
            for p in DEFAULT_PARADIGMS:
                self._insert(conn, p, created_by="system")
            conn.commit()
            logger.info("预置范式写入完成")

    # ─── CRUD ────────────────────────────────

    def _insert(self, conn: sqlite3.Connection, data: Dict, created_by: str = "user") -> int:
        """内部插入（不 commit，由调用方决定）"""
        cur = conn.execute("""
            INSERT INTO event_paradigms
                (category, subcategory, name, description, trigger_keywords,
                 market_impact, severity_multiplier, duration_days,
                 historical_cases, created_by)
            VALUES (?,?,?,?,?,?,?,?,?,?)
        """, (
            data["category"], data["subcategory"], data["name"],
            data.get("description", ""),
            json.dumps(data.get("trigger_keywords", []), ensure_ascii=False),
            json.dumps(data.get("market_impact", {}), ensure_ascii=False),
            data.get("severity_multiplier", 1.0),
            data.get("duration_days", 7),
            json.dumps(data.get("historical_cases", []), ensure_ascii=False),
            created_by,
        ))
        return cur.lastrowid

    def add_paradigm(self, data: Dict, created_by: str = "user") -> int:
        """
        新增分析范式
        @param data: 范式数据，必填 category/subcategory/name/trigger_keywords/market_impact
        @param created_by: 创建者标识
        @returns: 新范式的 id
        """
        conn = self._get_conn()
        row_id = self._insert(conn, data, created_by)
        conn.commit()
        logger.info("新增范式 id=%d name=%s", row_id, data["name"])
        return row_id

    def get_paradigm(self, paradigm_id: int) -> Optional[Dict]:
        """
        获取单个范式
        @param paradigm_id: 范式 id
        @returns: 范式 dict，不存在返回 None
        """
        row = self._get_conn().execute(
            "SELECT * FROM event_paradigms WHERE id=? AND is_active=1", (paradigm_id,)
        ).fetchone()
        return self._row_to_dict(row) if row else None

    def list_paradigms(self, category: Optional[str] = None, active_only: bool = True) -> List[Dict]:
        """
        列出范式（可按大类筛选）
        @param category: 大类，None 表示全部
        @param active_only: 是否只返回启用的范式
        @returns: 范式列表
        """
        sql = "SELECT * FROM event_paradigms WHERE 1=1"
        params = []
        if active_only:
            sql += " AND is_active=1"
        if category:
            sql += " AND category=?"
            params.append(category)
        sql += " ORDER BY category, subcategory"
        rows = self._get_conn().execute(sql, params).fetchall()
        return [self._row_to_dict(r) for r in rows]

    def update_paradigm(self, paradigm_id: int, data: Dict) -> bool:
        """
        更新范式（支持部分更新，只传需要改的字段）
        @param paradigm_id: 范式 id
        @param data: 要更新的字段 dict
        @returns: True=成功, False=不存在
        """
        # 字段白名单，防止注入
        allowed = {"category", "subcategory", "name", "description",
                   "trigger_keywords", "market_impact", "severity_multiplier",
                   "duration_days", "historical_cases", "is_active"}
        updates = {}
        for k, v in data.items():
            if k not in allowed:
                continue
            # JSON 字段自动序列化
            if k in {"trigger_keywords", "market_impact", "historical_cases"} and not isinstance(v, str):
                v = json.dumps(v, ensure_ascii=False)
            updates[k] = v

        if not updates:
            return False

        updates["updated_at"] = datetime.now().isoformat()
        set_clause = ", ".join(f"{k}=?" for k in updates)
        vals = list(updates.values()) + [paradigm_id]
        affected = self._get_conn().execute(
            f"UPDATE event_paradigms SET {set_clause} WHERE id=?", vals
        ).rowcount
        self._get_conn().commit()
        logger.info("更新范式 id=%d fields=%s", paradigm_id, list(updates.keys()))
        return affected > 0

    def delete_paradigm(self, paradigm_id: int) -> bool:
        """
        软删除范式（设 is_active=0，数据不丢失可恢复）
        @param paradigm_id: 范式 id
        @returns: True=成功
        """
        affected = self._get_conn().execute(
            "UPDATE event_paradigms SET is_active=0, updated_at=? WHERE id=?",
            (datetime.now().isoformat(), paradigm_id)
        ).rowcount
        self._get_conn().commit()
        logger.info("软删除范式 id=%d", paradigm_id)
        return affected > 0

    def search_paradigms(self, keywords: str) -> List[Dict]:
        """
        按关键词搜索范式（全文搜索 name/description/trigger_keywords）
        @param keywords: 搜索词
        @returns: 匹配范式列表
        """
        kw = f"%{keywords}%"
        rows = self._get_conn().execute("""
            SELECT * FROM event_paradigms
            WHERE is_active=1
              AND (name LIKE ? OR description LIKE ? OR trigger_keywords LIKE ?)
            ORDER BY name
        """, (kw, kw, kw)).fetchall()
        return [self._row_to_dict(r) for r in rows]

    def match_paradigms(self, news_title: str, news_body: str = "",
                        top_k: int = 3) -> List[Dict]:
        """
        从新闻文本中检索最相关的分析范式（RAG 简化版，关键词命中计数）

        原理：
        - 将新闻标题+正文与每条范式的 trigger_keywords 做交集计数
        - 返回命中最多的 top_k 条范式
        - 未来可升级为向量相似度检索（ChromaDB/Faiss）

        @param news_title: 新闻标题
        @param news_body: 新闻正文（可选）
        @param top_k: 返回最相关的前 N 条
        @returns: 按相关度排序的范式列表（含 match_score 字段）
        """
        text = (news_title + " " + news_body).lower()
        paradigms = self.list_paradigms(active_only=True)

        scored = []
        for p in paradigms:
            keywords = p.get("trigger_keywords", [])
            if isinstance(keywords, str):
                keywords = json.loads(keywords)
            # 计算命中的关键词数量作为相关度分数
            score = sum(1 for kw in keywords if kw.lower() in text)
            if score > 0:
                p["match_score"] = score
                scored.append(p)

        # 按命中分数降序
        scored.sort(key=lambda x: x["match_score"], reverse=True)
        return scored[:top_k]

    @staticmethod
    def _row_to_dict(row: sqlite3.Row) -> Dict:
        """将 SQLite Row 转为 dict，JSON 字段自动反序列化"""
        d = dict(row)
        for field in ("trigger_keywords", "market_impact", "historical_cases"):
            if isinstance(d.get(field), str):
                try:
                    d[field] = json.loads(d[field])
                except json.JSONDecodeError:
                    pass
        return d


# 单例（服务内复用同一个连接）
_kb_instance: Optional[KnowledgeBase] = None


def get_knowledge_base() -> KnowledgeBase:
    """获取知识库单例"""
    global _kb_instance
    if _kb_instance is None:
        _kb_instance = KnowledgeBase()
    return _kb_instance
