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


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8767, debug=False)
