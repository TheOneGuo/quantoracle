"""
A股历史K线数据 → QuantConnect Lean CSV 格式转换器

Lean 期望的日线数据格式（YYYYMMDD_HH0000.csv）：
date, open, high, low, close, volume
20200101, 123400, 125600, 122000, 124800, 1234567

数据来源：调用 QuantOracle 后端 /api/kline/:code?type=daily
注意：A股价格需要 * 10000（Lean 内部以分为单位）
"""

import os
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from typing import Optional, Dict, Any
import httpx
import asyncio
import json

# 配置
BACKEND_API_URL = os.getenv("DATA_SOURCE_BACKEND", "http://quantoracle-backend:3001/api/kline/")

async def fetch_ashare_history(code: str, start_date: str, end_date: str) -> Optional[pd.DataFrame]:
    """
    从后端API获取A股历史K线数据
    
    Args:
        code: 股票代码（如 sh600519）
        start_date: 开始日期 YYYY-MM-DD
        end_date: 结束日期 YYYY-MM-DD
        
    Returns:
        DataFrame包含OHLCV数据，失败返回None
    """
    try:
        # ============================================================
        # 【关键】构造URL时必须加入复权参数 adjust=hfq（后复权）
        #
        # 为什么需要复权？
        #   A股上市公司在分红、送股、配股等资本操作后，股价会出现
        #   跳空缺口（价格突变），导致历史K线出现虚假的大涨大跌。
        #   如果不复权，回测策略会把这些"价格缺口"误判为真实的价格
        #   波动，产生严重的错误信号和失真的回测结果。
        #
        # hfq（后复权）vs qfq（前复权）：
        #   - hfq（后复权）：以最新价格为基准，向历史推算调整价格。
        #     历史价格会被调高，接近真实成交价。适合回测引擎，因为
        #     价格序列连续，不会出现因未来除权操作导致的价格失真。
        #   - qfq（前复权）：以最早价格为基准，向未来推算调整价格。
        #     最新价格接近真实值，但历史价格会随每次除权而变动，
        #     导致同一历史时间点的价格在不同拉取时刻不一致。
        #
        # 不复权的危害：
        #   - 分红除息后股价下跌，策略误判为止损信号
        #   - 送股后股价减半，策略误判为崩盘信号
        #   - 回测绩效严重失真，夏普率、回撤等指标不可信
        #   - 机器学习特征工程中产生大量噪声数据
        #
        # 结论：回测引擎统一使用 hfq 后复权，保证历史价格序列连续。
        # ============================================================
        url = f"{BACKEND_API_URL.rstrip('/')}/{code}?type=daily&days=1000&adjust=hfq"
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(url)
            
            if response.status_code != 200:
                print(f"后端API请求失败: {response.status_code}")
                return None
            
            data = response.json()
            
            if not isinstance(data, list):
                print(f"返回数据格式错误: {type(data)}")
                return None
            
            # 转换数据格式
            records = []
            for item in data:
                # 假设item包含 date, open, close, high, low, volume 字段
                if not all(key in item for key in ['date', 'open', 'close', 'high', 'low', 'volume']):
                    print(f"数据项缺少必要字段: {item}")
                    continue
                
                records.append({
                    'date': item['date'],
                    'open': float(item['open']),
                    'high': float(item['high']),
                    'low': float(item['low']),
                    'close': float(item['close']),
                    'volume': int(item['volume'])
                })
            
            if not records:
                print(f"未获取到有效数据: {code}")
                return None
            
            df = pd.DataFrame(records)
            df['date'] = pd.to_datetime(df['date'])
            
            # 过滤日期范围
            start_dt = pd.to_datetime(start_date)
            end_dt = pd.to_datetime(end_date)
            df = df[(df['date'] >= start_dt) & (df['date'] <= end_dt)]
            
            if df.empty:
                print(f"日期范围内无数据: {start_date} 到 {end_date}")
                return None
            
            return df.sort_values('date')
            
    except Exception as e:
        print(f"获取A股历史数据时出错 {code}: {e}")
        return None

def convert_to_lean_format(df: pd.DataFrame) -> pd.DataFrame:
    """
    将标准OHLCV DataFrame转换为QuantConnect Lean格式
    
    Args:
        df: 包含open, high, low, close, volume列的DataFrame
        
    Returns:
        Lean格式的DataFrame，包含date, open, high, low, close, volume列
    """
    # 创建副本以避免修改原始数据
    lean_df = df.copy()
    
    # 确保列名正确
    required_cols = ['open', 'high', 'low', 'close', 'volume']
    for col in required_cols:
        if col not in lean_df.columns:
            raise ValueError(f"缺少必要列: {col}")
    
    # Lean要求价格以分为单位（乘以10000）
    price_cols = ['open', 'high', 'low', 'close']
    for col in price_cols:
        lean_df[col] = (lean_df[col] * 10000).round().astype(int)
    
    # 转换日期格式为YYYYMMDD
    lean_df['date'] = lean_df['date'].dt.strftime('%Y%m%d') + '_000000'
    
    # 重新排列列顺序
    lean_df = lean_df[['date', 'open', 'high', 'low', 'close', 'volume']]
    
    # 确保volume为整数
    lean_df['volume'] = lean_df['volume'].astype(int)
    
    return lean_df

def save_lean_data(code: str, lean_df: pd.DataFrame, output_dir: str):
    """
    将Lean格式数据保存为CSV文件
    
    Args:
        code: 股票代码（如 sh600519）
        lean_df: Lean格式的DataFrame
        output_dir: 输出目录（Lean数据目录）
    """
    try:
        # 清理代码，替换特殊字符
        clean_code = code.replace('.', '_').replace('/', '_').replace(':', '_')
        
        # 创建目录结构（如果需要）
        os.makedirs(output_dir, exist_ok=True)
        
        # 构造文件路径
        csv_path = os.path.join(output_dir, f"{clean_code}.csv")
        
        # 保存为CSV（无索引，无表头）
        lean_df.to_csv(csv_path, index=False, header=False)
        
        print(f"已保存 {code} 的Lean数据到: {csv_path}")
        print(f"数据范围: {lean_df['date'].min()} 到 {lean_df['date'].max()}")
        print(f"数据行数: {len(lean_df)}")
        
    except Exception as e:
        print(f"保存Lean数据时出错 {code}: {e}")

def generate_mock_data(code: str, start_date: str, end_date: str) -> pd.DataFrame:
    """
    生成模拟数据（当后端API不可用时）
    
    Args:
        code: 股票代码
        start_date: 开始日期 YYYY-MM-DD
        end_date: 结束日期 YYYY-MM-DD
        
    Returns:
        模拟的OHLCV DataFrame
    """
    print(f"生成模拟数据: {code} ({start_date} 到 {end_date})")
    
    # 生成日期范围
    start_dt = datetime.strptime(start_date, '%Y-%m-%d')
    end_dt = datetime.strptime(end_date, '%Y-%m-%d')
    
    dates = []
    current_dt = start_dt
    while current_dt <= end_dt:
        # 只包括工作日（周一到周五）
        if current_dt.weekday() < 5:
            dates.append(current_dt)
        current_dt += timedelta(days=1)
    
    # 生成模拟价格数据
    base_price = 100.0  # 基础价格
    price_data = []
    current_price = base_price
    
    for i, date in enumerate(dates):
        # 随机波动
        change_pct = np.random.normal(0, 0.02)  # 2%标准差
        current_price = current_price * (1 + change_pct)
        
        # 生成OHLC数据
        open_price = current_price * (1 + np.random.normal(0, 0.01))
        close_price = current_price * (1 + np.random.normal(0, 0.01))
        high_price = max(open_price, close_price) * (1 + np.random.random() * 0.02)
        low_price = min(open_price, close_price) * (1 - np.random.random() * 0.02)
        volume = np.random.randint(1000000, 10000000)
        
        price_data.append({
            'date': date,
            'open': open_price,
            'high': high_price,
            'low': low_price,
            'close': close_price,
            'volume': volume
        })
    
    return pd.DataFrame(price_data)

async def ensure_data_exists(code: str, start_date: str, end_date: str) -> bool:
    """
    确保股票历史数据存在（外部调用接口）
    
    Args:
        code: 股票代码
        start_date: 开始日期
        end_date: 结束日期
        
    Returns:
        数据是否准备成功
    """
    try:
        # 尝试从后端获取数据
        df = await fetch_ashare_history(code, start_date, end_date)
        
        if df is None or df.empty:
            print(f"无法获取 {code} 的历史数据，使用模拟数据")
            df = generate_mock_data(code, start_date, end_date)
        
        # 转换为Lean格式
        lean_df = convert_to_lean_format(df)
        
        # 保存到Lean数据目录（假设已在环境变量中配置）
        lean_data_dir = os.getenv("LEAN_DATA_DIR", "/Lean/Data/equity/china/daily")
        save_lean_data(code, lean_df, lean_data_dir)
        
        return True
        
    except Exception as e:
        print(f"准备数据时出错 {code}: {e}")
        return False

# 测试代码
if __name__ == "__main__":
    import asyncio
    
    async def test():
        # 测试获取数据
        code = "sh600519"
        start_date = "2020-01-01"
        end_date = "2020-12-31"
        
        print(f"测试获取 {code} 的历史数据...")
        df = await fetch_ashare_history(code, start_date, end_date)
        
        if df is not None:
            print(f"获取到 {len(df)} 行数据")
            print(df.head())
            
            # 测试转换
            lean_df = convert_to_lean_format(df)
            print("\n转换后的Lean格式:")
            print(lean_df.head())
            
            # 测试保存
            test_dir = "./test_output"
            save_lean_data(code, lean_df, test_dir)
        else:
            print("获取真实数据失败，生成模拟数据...")
            df = generate_mock_data(code, start_date, end_date)
            print(f"生成 {len(df)} 行模拟数据")
            print(df.head())
            
            lean_df = convert_to_lean_format(df)
            print("\n转换后的Lean格式:")
            print(lean_df.head())
    
    asyncio.run(test())