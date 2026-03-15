"""
AKShare 财经新闻聚合微服务
监听端口：8767
提供接口：
  GET /news/stock?symbol=600519&count=20   # 个股相关新闻（东方财富）
  GET /news/market?count=30                 # 市场综合快讯（财新 CX）
  GET /news/flash?count=20                  # 央视新闻（fallback: 财新）
  GET /health                               # 健康检查
"""

import akshare as ak
import pandas as pd
from flask import Flask, request, jsonify
from datetime import datetime
import logging

app = Flask(__name__)
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def normalize_time(t):
    """尝试将各种时间格式统一为 ISO 字符串"""
    if t is None or (isinstance(t, float) and pd.isna(t)):
        return None
    try:
        if isinstance(t, (pd.Timestamp, datetime)):
            return t.strftime('%Y-%m-%dT%H:%M:%S')
        return str(t)
    except Exception:
        return str(t)


@app.route('/health')
def health():
    return jsonify({"success": True, "service": "news_service", "port": 8767})


@app.route('/news/stock')
def news_stock():
    symbol = request.args.get('symbol', '600519')
    count = int(request.args.get('count', 20))
    try:
        df = ak.stock_news_em(symbol=symbol)
        df = df.head(count)
        data = []
        for _, row in df.iterrows():
            data.append({
                "title": str(row.get('新闻标题', '')),
                "content": str(row.get('新闻内容', ''))[:500],
                "url": str(row.get('新闻链接', '')),
                "published_at": normalize_time(row.get('发布时间')),
                "source_name": str(row.get('文章来源', '东方财富')),
                "symbol": symbol,
            })
        return jsonify({"success": True, "count": len(data), "source": "eastmoney", "data": data})
    except Exception as e:
        logger.error(f"stock_news_em error: {e}")
        return jsonify({"success": False, "error": str(e), "data": []}), 500


@app.route('/news/market')
def news_market():
    """财新快讯（cx）"""
    count = int(request.args.get('count', 30))
    try:
        df = ak.stock_news_main_cx()
        df = df.head(count)
        data = []
        for _, row in df.iterrows():
            summary = str(row.get('summary', ''))
            data.append({
                "title": summary[:60] + ('...' if len(summary) > 60 else ''),
                "content": summary,
                "url": str(row.get('url', '')),
                "published_at": None,
                "source_name": "财新" + str(row.get('tag', '')),
            })
        return jsonify({"success": True, "count": len(data), "source": "caixin", "data": data})
    except Exception as e:
        logger.error(f"news_market error: {e}")
        return jsonify({"success": False, "error": str(e), "data": []}), 500


@app.route('/news/flash')
def news_flash():
    """央视新闻电报（today），失败降级到财新"""
    count = int(request.args.get('count', 20))
    today = datetime.now().strftime('%Y%m%d')
    try:
        df = ak.news_cctv(date=today)
        df = df.head(count)
        data = []
        for _, row in df.iterrows():
            data.append({
                "title": str(row.get('title', '')),
                "content": str(row.get('content', ''))[:500],
                "url": "",
                "published_at": str(row.get('date', today)),
                "source_name": "央视新闻",
            })
        return jsonify({"success": True, "count": len(data), "source": "cctv", "data": data})
    except Exception as e1:
        logger.warning(f"news_cctv failed: {e1}, fallback to caixin")
        try:
            df = ak.stock_news_main_cx()
            df = df.head(count)
            data = []
            for _, row in df.iterrows():
                summary = str(row.get('summary', ''))
                data.append({
                    "title": summary[:60] + ('...' if len(summary) > 60 else ''),
                    "content": summary,
                    "url": str(row.get('url', '')),
                    "published_at": None,
                    "source_name": "财新",
                })
            return jsonify({"success": True, "count": len(data), "source": "caixin", "data": data})
        except Exception as e2:
            return jsonify({"success": False, "error": f"cctv: {e1}; cx: {e2}", "data": []}), 500


@app.route('/cyq')
def chip_distribution():
    """
    筹码分布接口 - 调用 AkShare stock_cyq_em
    参数:
        code: 股票代码（如 600519）
        adjust: 复权类型（默认 hfq 后复权）
    返回:
        price: 价位列表
        percent: 该价位筹码占比(%)
        profit: 获利比例(%)
    """
    code = request.args.get('code', '600519')
    adjust = request.args.get('adjust', 'hfq')
    
    # 自动补全市场前缀（AkShare 需要 sh/sz 前缀）
    if not code.startswith(('sh', 'sz', 'SH', 'SZ')):
        # 6开头为上交所，其余为深交所
        prefix = 'sh' if code.startswith('6') else 'sz'
        symbol = f"{prefix}{code}"
    else:
        symbol = code
    
    try:
        df = ak.stock_cyq_em(symbol=symbol, adjust=adjust)
        if df is None or df.empty:
            return jsonify({"success": False, "error": "无筹码分布数据", "is_simulated": False}), 404
        
        # 标准化列名（AkShare 返回中文列名）
        data = []
        for _, row in df.iterrows():
            entry = {}
            # 兼容不同版本的列名
            for col in df.columns:
                col_lower = str(col).lower()
                if '价' in col or 'price' in col_lower:
                    entry['price'] = float(row[col]) if row[col] is not None else None
                elif '占比' in col or '筹码' in col or 'percent' in col_lower:
                    entry['percent'] = float(row[col]) if row[col] is not None else None
                elif '获利' in col or 'profit' in col_lower:
                    entry['profit'] = float(row[col]) if row[col] is not None else None
            if entry:
                data.append(entry)
        
        return jsonify({
            "success": True,
            "symbol": symbol,
            "adjust": adjust,
            "count": len(data),
            "data": data,
            "is_simulated": False
        })
    except Exception as e:
        logger.error(f"stock_cyq_em failed for {symbol}: {e}")
        return jsonify({
            "success": False,
            "error": str(e),
            "is_simulated": False
        }), 500


@app.route('/hot-stocks')
def hot_stocks():
    """
    A股热股榜 - 调用 AkShare stock_zh_a_spot_em
    按涨幅降序取前N支，过滤成交额 > 1亿
    参数:
        limit: 返回数量（默认20）
    """
    limit = int(request.args.get('limit', 20))
    try:
        df = ak.stock_zh_a_spot_em()
        if df is None or df.empty:
            raise ValueError("stock_zh_a_spot_em 返回空数据")
        
        # 列名映射（AkShare A股实时行情列名）
        col_map = {}
        for col in df.columns:
            if '代码' in col or col == 'code':
                col_map['code'] = col
            elif '名称' in col or col == 'name':
                col_map['name'] = col
            elif '最新价' in col or '现价' in col or col == 'price':
                col_map['price'] = col
            elif '涨跌幅' in col or col == 'change_pct':
                col_map['change_pct'] = col
            elif '成交量' in col or col == 'volume':
                col_map['volume'] = col
            elif '成交额' in col or col == 'turnover':
                col_map['turnover'] = col
            elif '市盈率' in col or col == 'pe':
                col_map['pe'] = col
            elif '总市值' in col or col == 'market_cap':
                col_map['market_cap'] = col
        
        # 过滤成交额 > 1亿（单位：元）
        if 'turnover' in col_map:
            df = df[df[col_map['turnover']] > 1e8]
        
        # 按涨跌幅降序排列
        if 'change_pct' in col_map:
            df = df.sort_values(by=col_map['change_pct'], ascending=False)
        
        df = df.head(limit)
        
        data = []
        for _, row in df.iterrows():
            entry = {
                "code": str(row.get(col_map.get('code', '代码'), '')),
                "name": str(row.get(col_map.get('name', '名称'), '')),
                "price": float(row[col_map['price']]) if 'price' in col_map else None,
                "change_pct": float(row[col_map['change_pct']]) if 'change_pct' in col_map else None,
                "volume": float(row[col_map['volume']]) if 'volume' in col_map else None,
                "turnover": float(row[col_map['turnover']]) if 'turnover' in col_map else None,
                "pe": float(row[col_map['pe']]) if 'pe' in col_map and row[col_map['pe']] else None,
                "market_cap": float(row[col_map['market_cap']]) if 'market_cap' in col_map else None,
            }
            data.append(entry)
        
        return jsonify({"success": True, "count": len(data), "data": data, "is_simulated": False})
    except Exception as e:
        logger.error(f"hot_stocks failed: {e}")
        return jsonify({"success": False, "error": str(e), "is_simulated": False}), 500


@app.route('/hk-spot')
def hk_spot():
    """
    港股实时行情 - 调用 AkShare stock_hk_spot_em
    返回字段：code/name/price/change_pct/volume/turnover
    """
    limit = int(request.args.get('limit', 100))
    try:
        df = ak.stock_hk_spot_em()
        if df is None or df.empty:
            raise ValueError("stock_hk_spot_em 返回空数据")
        
        col_map = {}
        for col in df.columns:
            if '代码' in col:
                col_map['code'] = col
            elif '名称' in col:
                col_map['name'] = col
            elif '最新' in col or '现价' in col:
                col_map['price'] = col
            elif '涨跌幅' in col:
                col_map['change_pct'] = col
            elif '成交量' in col:
                col_map['volume'] = col
            elif '成交额' in col:
                col_map['turnover'] = col
        
        df = df.head(limit)
        data = []
        for _, row in df.iterrows():
            entry = {
                "code": str(row.get(col_map.get('code', '代码'), '')),
                "name": str(row.get(col_map.get('name', '名称'), '')),
                "price": float(row[col_map['price']]) if 'price' in col_map else None,
                "change_pct": float(row[col_map['change_pct']]) if 'change_pct' in col_map else None,
                "volume": float(row[col_map['volume']]) if 'volume' in col_map else None,
                "turnover": float(row[col_map['turnover']]) if 'turnover' in col_map else None,
            }
            data.append(entry)
        
        return jsonify({"success": True, "count": len(data), "data": data, "is_simulated": False})
    except Exception as e:
        logger.error(f"hk_spot failed: {e}")
        return jsonify({"success": False, "error": str(e), "is_simulated": False}), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8767, debug=False)
