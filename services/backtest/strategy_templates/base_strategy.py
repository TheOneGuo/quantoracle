"""
基础策略模板
为QuantConnect Lean生成Python策略代码的基类
"""

from typing import List, Dict, Any
from datetime import datetime

# 导入QuantConnect数据标准化模式枚举
# DataNormalizationMode.Adjusted 表示使用复权价格，
# 与后端拉取的 hfq（后复权）数据保持一致，确保回测数据一致性。
from QuantConnect import DataNormalizationMode

class BaseStrategy:
    """
    基础策略模板类
    
    生成QuantConnect Lean Python策略代码的基类
    包含通用的仓位管理、风险管理、日志记录等功能
    """
    
    def __init__(self):
        self.strategy_name = "QuantOracle Base Strategy"
        self.version = "1.0.0"
    
    def generate(self, signals: List[Dict[str, Any]], market: str, 
                start_date: str, end_date: str, style: str = "neutral") -> str:
        """
        生成QuantConnect Lean Python策略代码
        
        Args:
            signals: AI选股信号列表，每项含 code/name/confidence/scores
            market: 市场（A股/美股/港股）
            start_date: 回测开始日期 YYYY-MM-DD
            end_date: 回测结束日期 YYYY-MM-DD
            style: 策略风格（conservative/neutral/aggressive）
            
        Returns:
            完整的Lean Python策略代码
        """
        # 根据风格设置参数
        params = self._get_style_params(style)
        
        # 构建股票代码列表
        symbols_code = self._build_symbols_code(signals, market)
        
        # 生成策略代码
        strategy_code = f'''# QuantOracle AI策略 - 生成时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}
# 策略名称: {self.strategy_name} v{self.version}
# 市场: {market} | 风格: {style}
# 选股数量: {len(signals)} | 开始日期: {start_date} | 结束日期: {end_date}

from AlgorithmImports import *

class QuantOracleBaseStrategy(QCAlgorithm):
    """
    QuantOracle AI驱动的基础量化策略
    基于AI选股信号进行投资，包含完整的风险管理框架
    """
    
    def Initialize(self):
        # 设置回测参数
        self.SetStartDate({self._format_date(start_date)})  # 回测开始日期
        self.SetEndDate({self._format_date(end_date)})      # 回测结束日期
        self.SetCash({params['initial_capital']})           # 初始资金
        
        # 设置经纪商模型（A股佣金和印花税）
        self.SetBrokerageModel(BrokerageName.InteractiveBrokersBrokerage, AccountType.Cash)
        
        # 设置基准
        self.SetBenchmark("SPY")
        
        # 策略参数
        self.signal_stocks = {self._build_symbols_list(signals, market)}  # 候选股票
        self.max_position_size = {params['max_position_size']}  # 单股最大仓位比例
        self.stop_loss_pct = {params['stop_loss_pct']}          # 止损比例
        self.take_profit_pct = {params['take_profit_pct']}      # 止盈比例
        self.rebalance_days = {params['rebalance_days']}        # 调仓周期（天）
        self.holding_period = {params['holding_period']}        # 持仓周期（天）
        
        # 初始化变量
        self.next_rebalance = self.Time
        self.positions = {{}}  # 持仓记录：symbol -> entry_price, entry_time
        self.signals = {self._build_signals_dict(signals)}  # AI信号强度
        
        # 添加股票
{symbols_code}
        
        # 设置交易时间（每天开盘后30分钟下单）
        self.Schedule.On(self.DateRules.EveryDay(),
                        self.TimeRules.AfterMarketOpen("SPY", minutes=30),
                        self.TradeLogic)
        
        # 设置每日收盘检查
        self.Schedule.On(self.DateRules.EveryDay(),
                        self.TimeRules.BeforeMarketClose("SPY", minutes=10),
                        self.DailyCheck)
        
        # 记录初始化完成
        self.Debug(f"策略初始化完成: {{self.signal_stocks}}")
    
    def TradeLogic(self):
        """交易逻辑：基于AI信号进行买卖决策"""
        # 检查是否到达调仓日
        if (self.Time - self.next_rebalance).days < self.rebalance_days:
            return
        
        # 更新调仓时间
        self.next_rebalance = self.Time + timedelta(days=self.rebalance_days)
        
        # 计算可用资金
        available_cash = self.Portfolio.Cash
        total_portfolio_value = self.Portfolio.TotalPortfolioValue
        
        if total_portfolio_value <= 0:
            return
        
        # 对每个信号股票进行决策
        for symbol in self.signal_stocks:
            # 获取当前持仓
            holding = self.Portfolio[symbol]
            is_held = holding.Invested
            
            # 获取AI信号强度（0-1）
            signal_strength = self.signals.get(str(symbol), 0.5)
            
            # 如果信号强度足够高且未持仓，考虑买入
            if not is_held and signal_strength >= {params['buy_threshold']}:
                # 计算买入金额（基于信号强度和仓位限制）
                buy_pct = min(self.max_position_size, signal_strength * self.max_position_size)
                target_value = total_portfolio_value * buy_pct
                
                # 检查可用资金
                if available_cash >= target_value * 1.01:  # 留1%缓冲
                    # 计算购买数量
                    price = self.Securities[symbol].Price
                    if price > 0:
                        quantity = int(target_value / price)
                        if quantity > 0:
                            # 执行买入
                            self.MarketOrder(symbol, quantity)
                            self.positions[str(symbol)] = {{
                                'entry_price': price,
                                'entry_time': self.Time,
                                'signal_strength': signal_strength
                            }}
                            self.Debug(f"买入 {{symbol}}: {{quantity}}股 @ {{price:.2f}}, 信号强度: {{signal_strength:.2f}}")
                            available_cash -= price * quantity
            
            # 如果已持仓，检查是否需要卖出
            elif is_held and str(symbol) in self.positions:
                entry_info = self.positions[str(symbol)]
                current_price = self.Securities[symbol].Price
                entry_price = entry_info['entry_price']
                
                # 计算盈亏比例
                if entry_price > 0:
                    pct_change = (current_price - entry_price) / entry_price
                    
                    # 止盈检查
                    if pct_change >= self.take_profit_pct:
                        self.Liquidate(symbol)
                        self.Debug(f"止盈卖出 {{symbol}}: 盈利 {{pct_change*100:.1f}}%")
                        if str(symbol) in self.positions:
                            del self.positions[str(symbol)]
                    
                    # 止损检查
                    elif pct_change <= -self.stop_loss_pct:
                        self.Liquidate(symbol)
                        self.Debug(f"止损卖出 {{symbol}}: 亏损 {{pct_change*100:.1f}}%")
                        if str(symbol) in self.positions:
                            del self.positions[str(symbol)]
                    
                    # 持仓时间检查
                    elif (self.Time - entry_info['entry_time']).days >= self.holding_period:
                        self.Liquidate(symbol)
                        self.Debug(f"持仓到期卖出 {{symbol}}: 持有{{(self.Time - entry_info['entry_time']).days}}天")
                        if str(symbol) in self.positions:
                            del self.positions[str(symbol)]
    
    def DailyCheck(self):
        """每日收盘检查：更新持仓记录，清理过期持仓"""
        # 清理已平仓的持仓记录
        symbols_to_remove = []
        for symbol_str in self.positions:
            symbol = SymbolCache.GetSymbol(symbol_str)
            if symbol and not self.Portfolio[symbol].Invested:
                symbols_to_remove.append(symbol_str)
        
        for symbol_str in symbols_to_remove:
            del self.positions[symbol_str]
        
        # 记录每日持仓情况
        if self.positions:
            self.Debug(f"当前持仓: {{len(self.positions)}}只股票")
    
    def OnOrderEvent(self, orderEvent):
        """订单事件处理"""
        order = self.Transactions.GetOrderById(orderEvent.OrderId)
        
        if orderEvent.Status == OrderStatus.Filled:
            self.Debug(f"订单成交: {{orderEvent.Symbol}} {{orderEvent.Direction}} {{orderEvent.FillQuantity}}股 @ {{orderEvent.FillPrice}}")
    
    def OnEndOfAlgorithm(self):
        """回测结束时的总结"""
        self.Debug("回测结束")
        total_return = (self.Portfolio.TotalPortfolioValue - {params['initial_capital']}) / {params['initial_capital']} * 100
        self.Debug(f"总收益: {{total_return:.2f}}%")
        self.Debug(f"最终资产: {{self.Portfolio.TotalPortfolioValue:.2f}}")

# 策略参数说明：
# 1. 单股最大仓位: {params['max_position_size']*100}%
# 2. 止损线: {params['stop_loss_pct']*100}%
# 3. 止盈线: {params['take_profit_pct']*100}%
# 4. 调仓周期: {params['rebalance_days']}天
# 5. 持仓周期: {params['holding_period']}天
# 6. 买入阈值: {params['buy_threshold']*100}%
'''
        return strategy_code
    
    def _get_style_params(self, style: str) -> Dict[str, Any]:
        """
        根据策略风格获取参数
        
        不同风格的仓位和止损设置：
        - conservative: 单股≤10%，止损8%，止盈20%
        - neutral: 单股≤15%，止损10%，止盈30%
        - aggressive: 单股≤25%，止损5%（快止损），止盈不限
        """
        if style == "conservative":
            return {
                'initial_capital': 100000,
                'max_position_size': 0.10,   # 10%
                'stop_loss_pct': -0.08,      # -8%
                'take_profit_pct': 0.20,     # 20%
                'rebalance_days': 7,         # 每周调仓
                'holding_period': 30,        # 持仓30天
                'buy_threshold': 0.70        # 买入阈值70%
            }
        elif style == "aggressive":
            return {
                'initial_capital': 100000,
                'max_position_size': 0.25,   # 25%
                'stop_loss_pct': -0.05,      # -5%
                'take_profit_pct': 0.50,     # 50%
                'rebalance_days': 3,         # 每3天调仓
                'holding_period': 14,        # 持仓14天
                'buy_threshold': 0.60        # 买入阈值60%
            }
        else:  # neutral
            return {
                'initial_capital': 100000,
                'max_position_size': 0.15,   # 15%
                'stop_loss_pct': -0.10,      # -10%
                'take_profit_pct': 0.30,     # 30%
                'rebalance_days': 5,         # 每5天调仓
                'holding_period': 21,        # 持仓21天
                'buy_threshold': 0.65        # 买入阈值65%
            }
    
    def _format_date(self, date_str: str) -> str:
        """格式化日期为Lean需要的格式"""
        try:
            dt = datetime.strptime(date_str, '%Y-%m-%d')
            return f"datetime({dt.year}, {dt.month}, {dt.day})"
        except:
            return f"datetime({datetime.now().year}, {datetime.now().month}, {datetime.now().day})"
    
    def _build_symbols_code(self, signals: List[Dict[str, Any]], market: str) -> str:
        """构建添加股票的代码段"""
        if not signals:
            return "        # 无信号股票\n        pass"
        
        code_lines = []
        for signal in signals:
            code = signal['code']
            if market == "A股":
                # A股代码格式转换
                if code.startswith('sh'):
                    symbol = f"Symbol.Create(\"{code[2:]}\", SecurityType.Equity, Market.SSE)"
                elif code.startswith('sz'):
                    symbol = f"Symbol.Create(\"{code[2:]}\", SecurityType.Equity, Market.SZSE)"
                else:
                    symbol = f"Symbol.Create(\"{code}\", SecurityType.Equity, Market.USA)"
            elif market == "美股":
                symbol = f"Symbol.Create(\"{code}\", SecurityType.Equity, Market.USA)"
            elif market == "港股":
                symbol = f"Symbol.Create(\"{code}\", SecurityType.Equity, Market.HK)"
            else:
                symbol = f"Symbol.Create(\"{code}\", SecurityType.Equity, Market.USA)"
            
            code_lines.append(f"        # 【复权设置】dataNormalizationMode=DataNormalizationMode.Adjusted\n        # 使Lean引擎在回测时自动对价格进行复权处理，与后端 hfq 数据对齐。\n        # 若不设置，Lean默认使用原始价格（Raw），遇到除权会产生价格跳空。\n        self.AddEquity({symbol}, dataNormalizationMode=DataNormalizationMode.Adjusted)")
        
        return '\n'.join(code_lines)
    
    def _build_symbols_list(self, signals: List[Dict[str, Any]], market: str) -> str:
        """构建股票符号列表字符串"""
        if not signals:
            return "[]"
        
        symbol_list = []
        for signal in signals:
            code = signal['code']
            symbol_list.append(f'"{code}"')
        
        return f"[{', '.join(symbol_list)}]"
    
    def _build_signals_dict(self, signals: List[Dict[str, Any]]) -> str:
        """构建信号强度字典字符串"""
        if not signals:
            return "{}"
        
        signal_dict = []
        for signal in signals:
            code = signal['code']
            confidence = signal.get('confidence', 0.5)
            signal_dict.append(f'"{code}": {confidence}')
        
        return f"{{{', '.join(signal_dict)}}}"


if __name__ == "__main__":
    # 测试代码生成
    strategy = BaseStrategy()
    
    # 测试信号
    test_signals = [
        {"code": "sh600519", "name": "贵州茅台", "confidence": 0.85},
        {"code": "sz000858", "name": "五粮液", "confidence": 0.78},
        {"code": "sz000333", "name": "美的集团", "confidence": 0.72}
    ]
    
    # 生成策略代码
    code = strategy.generate(
        signals=test_signals,
        market="A股",
        start_date="2020-01-01",
        end_date="2021-12-31",
        style="neutral"
    )
    
    print("生成的策略代码:")
    print(code[:2000])  # 只打印前2000字符
    print(f"\n总代码长度: {len(code)} 字符")