"""
股票数据获取模块
调用现有 QuantOracle 后端 API 获取股票基本面和K线数据
"""

import os
import json
import logging
from typing import Optional, Dict, Any, List, Tuple
from datetime import datetime, timedelta

import requests
from requests.exceptions import RequestException, Timeout

logger = logging.getLogger(__name__)


class StockDataClient:
    """
    股票数据客户端，封装对 QuantOracle 后端 API 的调用
    
    依赖的现有接口：
    1. GET /api/stock/:code   - 股票基本面数据
    2. GET /api/kline/:code   - K线数据（OHLCV）
    """
    
    def __init__(self, base_url: str = None):
        """
        初始化客户端
        
        Args:
            base_url: QuantOracle 后端地址，默认从环境变量读取，否则为 http://localhost:3001
        """
        self.base_url = base_url or os.getenv("QUANTORACLE_BACKEND_URL", "http://localhost:3001")
        self.timeout = 10  # 请求超时秒数
        self.max_retries = 2
    
    def _make_request(self, endpoint: str, method: str = "GET", **kwargs) -> Optional[Dict]:
        """
        发起 HTTP 请求，带重试机制
        
        Args:
            endpoint: API 端点路径（不含 base_url）
            method: HTTP 方法
            **kwargs: 传递给 requests 的参数
            
        Returns:
            解析后的 JSON 响应字典，失败返回 None
        """
        url = f"{self.base_url}{endpoint}"
        
        for attempt in range(self.max_retries):
            try:
                logger.debug(f"Requesting {url} (attempt {attempt+1})")
                response = requests.request(method, url, timeout=self.timeout, **kwargs)
                response.raise_for_status()
                return response.json()
            except Timeout:
                logger.warning(f"Request timeout for {url} (attempt {attempt+1})")
                if attempt == self.max_retries - 1:
                    return None
            except RequestException as e:
                logger.warning(f"Request failed for {url}: {e} (attempt {attempt+1})")
                if attempt == self.max_retries - 1:
                    return None
            except Exception as e:
                logger.error(f"Unexpected error for {url}: {e}")
                if attempt == self.max_retries - 1:
                    return None
            
            # 等待后重试
            if attempt < self.max_retries - 1:
                import time
                time.sleep(1)
        
        return None
    
    def get_fundamental(self, code: str) -> Optional[Dict[str, Any]]:
        """
        获取股票基本面数据
        
        Args:
            code: 股票代码（如 sh600519, sz000001）
            
        Returns:
            基本面数据字典，失败返回 None
        """
        endpoint = f"/api/stock/{code}"
        data = self._make_request(endpoint)
        
        if data and data.get("success"):
            return data.get("data", {})
        
        logger.warning(f"Failed to get fundamental data for {code}")
        return None
    
    def get_kline(self, code: str, period: str = "daily", limit: int = 240) -> Optional[List[List]]:
        """
        获取股票K线数据（OHLCV）
        
        Args:
            code: 股票代码
            period: 周期，支持 daily/weekly/monthly，默认为 daily
            limit: 获取的K线数量，默认240根（约1年）
            
        Returns:
            K线数据列表，每项为 [timestamp, open, high, low, close, volume]
            失败返回 None
        """
        endpoint = f"/api/kline/{code}"
        params = {"period": period, "limit": limit}
        data = self._make_request(endpoint, params=params)
        
        if data and data.get("success"):
            # 假设返回格式为 {"data": [[timestamp, o, h, l, c, v], ...]}
            return data.get("data", [])
        
        logger.warning(f"Failed to get kline data for {code}")
        return None
    
    def get_multiple_fundamentals(self, codes: List[str]) -> Dict[str, Optional[Dict]]:
        """
        批量获取多只股票的基本面数据
        
        Args:
            codes: 股票代码列表
            
        Returns:
            字典：{股票代码: 基本面数据 或 None}
        """
        results = {}
        for code in codes:
            results[code] = self.get_fundamental(code)
        return results
    
    def batch_get_kline(self, codes: List[str], **kwargs) -> Dict[str, Optional[List]]:
        """
        批量获取多只股票的K线数据
        
        Args:
            codes: 股票代码列表
            **kwargs: 传递给 get_kline 的参数
            
        Returns:
            字典：{股票代码: K线数据 或 None}
        """
        results = {}
        for code in codes:
            results[code] = self.get_kline(code, **kwargs)
        return results
    
    def calculate_technical_indicators(self, kline_data: List[List]) -> Dict[str, Any]:
        """
        基于K线数据计算常用技术指标（MACD, RSI, 移动平均线等）
        
        Args:
            kline_data: K线数据列表，每项为 [timestamp, open, high, low, close, volume]
            
        Returns:
            技术指标字典
        """
        if not kline_data or len(kline_data) < 50:
            logger.warning("Insufficient kline data for technical indicators")
            return {}
        
        try:
            import numpy as np
            import pandas as pd
            
            # 转换为 pandas DataFrame
            df = pd.DataFrame(kline_data, columns=["timestamp", "open", "high", "low", "close", "volume"])
            df["close"] = pd.to_numeric(df["close"], errors="coerce")
            df["volume"] = pd.to_numeric(df["volume"], errors="coerce")
            df = df.dropna(subset=["close"])
            
            if len(df) < 50:
                return {}
            
            close_prices = df["close"].values
            
            # 计算移动平均线
            ma5 = np.mean(close_prices[-5:]) if len(close_prices) >= 5 else None
            ma10 = np.mean(close_prices[-10:]) if len(close_prices) >= 10 else None
            ma20 = np.mean(close_prices[-20:]) if len(close_prices) >= 20 else None
            ma60 = np.mean(close_prices[-60:]) if len(close_prices) >= 60 else None
            
            # 计算 RSI（相对强弱指数）
            def calculate_rsi(prices, period=14):
                if len(prices) <= period:
                    return 50  # 默认值
                
                deltas = np.diff(prices)
                gains = np.where(deltas > 0, deltas, 0)
                losses = np.where(deltas < 0, -deltas, 0)
                
                avg_gain = np.mean(gains[-period:])
                avg_loss = np.mean(losses[-period:])
                
                if avg_loss == 0:
                    return 100
                
                rs = avg_gain / avg_loss
                rsi = 100 - (100 / (1 + rs))
                return rsi
            
            rsi = calculate_rsi(close_prices)
            
            # 计算 MACD（指数平滑移动平均线差）
            def calculate_macd(prices, fast=12, slow=26, signal=9):
                if len(prices) < slow:
                    return {"macd": 0, "signal": 0, "histogram": 0}
                
                # 简单实现：使用指数移动平均
                exp1 = pd.Series(prices).ewm(span=fast, adjust=False).mean().iloc[-1]
                exp2 = pd.Series(prices).ewm(span=slow, adjust=False).mean().iloc[-1]
                macd = exp1 - exp2
                signal_line = pd.Series(prices).ewm(span=signal, adjust=False).mean().iloc[-1]
                histogram = macd - signal_line
                return {"macd": macd, "signal": signal_line, "histogram": histogram}
            
            macd = calculate_macd(close_prices)
            
            # 计算成交量均值
            volume_avg = np.mean(df["volume"].values[-20:]) if len(df) >= 20 else None
            volume_current = df["volume"].values[-1] if len(df) > 0 else None
            volume_ratio = volume_current / volume_avg if volume_avg and volume_avg > 0 else 1.0
            
            # 计算价格位置相对于近期高低点
            recent_high = np.max(close_prices[-20:]) if len(close_prices) >= 20 else close_prices[-1]
            recent_low = np.min(close_prices[-20:]) if len(close_prices) >= 20 else close_prices[-1]
            price_position = (close_prices[-1] - recent_low) / (recent_high - recent_low) if recent_high != recent_low else 0.5
            
            return {
                "ma5": float(ma5) if ma5 is not None else None,
                "ma10": float(ma10) if ma10 is not None else None,
                "ma20": float(ma20) if ma20 is not None else None,
                "ma60": float(ma60) if ma60 is not None else None,
                "rsi": float(rsi),
                "macd": macd,
                "volume_ratio": float(volume_ratio),
                "price_position": float(price_position),
                "current_price": float(close_prices[-1]),
                "recent_high": float(recent_high),
                "recent_low": float(recent_low),
                "trend": "bullish" if close_prices[-1] > ma20 else "bearish" if close_prices[-1] < ma20 else "neutral"
            }
        except Exception as e:
            logger.error(f"Error calculating technical indicators: {e}")
            return {}


# 全局单例实例
_stock_data_client = None

def get_stock_data_client() -> StockDataClient:
    """
    获取全局股票数据客户端实例（单例模式）
    
    Returns:
        StockDataClient 实例
    """
    global _stock_data_client
    if _stock_data_client is None:
        _stock_data_client = StockDataClient()
    return _stock_data_client


if __name__ == "__main__":
    # 测试代码
    client = StockDataClient()
    print("Testing stock data client...")
    
    # 测试基本面数据
    fundamental = client.get_fundamental("sh600519")
    print(f"Fundamental data for sh600519: {fundamental}")
    
    # 测试K线数据
    kline = client.get_kline("sh600519", limit=10)
    print(f"Kline data for sh600519 (first 10): {kline[:2] if kline else 'None'}")
    
    # 测试技术指标计算
    if kline:
        indicators = client.calculate_technical_indicators(kline)
        print(f"Technical indicators: {indicators}")