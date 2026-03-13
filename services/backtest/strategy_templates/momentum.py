"""
动量策略模板
基于价格动量的趋势跟踪策略
"""

from .base_strategy import BaseStrategy
from typing import List, Dict, Any
from datetime import datetime

class MomentumStrategy(BaseStrategy):
    """
    动量策略模板类
    
    基于价格动量的趋势跟踪策略，特点：
    1. 使用移动平均线判断趋势
    2. 动量突破时买入
    3. 趋势反转时卖出
    4. 严格的止损止盈
    """
    
    def __init__(self):
        super().__init__()
        self.strategy_name = "QuantOracle Momentum Strategy"
        self.version = "1.0.0"
    
    def generate(self, signals: List[Dict[str, Any]], market: str, 
                start_date: str, end_date: str, style: str = "neutral") -> str:
        """
        生成QuantConnect Lean动量策略代码
        
        Args:
            signals: AI选股信号列表
            market: 市场
            start_date: 回测开始日期
            end_date: 回测结束日期
            style: 策略风格
            
        Returns:
            完整的Lean Python策略代码
        """
        # 根据风格设置参数
        params = self._get_momentum_params(style)
        
        # 构建股票代码列表
        symbols_code = self._build_symbols_code(signals, market)
        
        # 生成策略代码
        strategy_code = f'''# QuantOracle 动量策略 - 生成时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}
# 策略名称: {self.strategy_name} v{self.version}
# 市场: {market} | 风格: {style}
# 选股数量: {len(signals)} | 开始日期: {start_date} | 结束日期: {end_date}

from AlgorithmImports import *

class QuantOracleMomentumStrategy(QCAlgorithm):
    """
    QuantOracle AI驱动的动量策略
    结合AI选股信号和技术面动量指标进行趋势跟踪
    """
    
    def Initialize(self):
        # 设置回测参数
        self.SetStartDate({self._format_date(start_date)})
        self.SetEndDate({self._format_date(end_date)})
        self.SetCash({params['initial_capital']})
        
        # 设置经纪商模型
        self.SetBrokerageModel(BrokerageName.InteractiveBrokersBrokerage, AccountType.Cash)
        
        # 设置基准
        self.SetBenchmark("SPY")
        
        # 动量策略参数
        self.signal_stocks = {self._build_symbols_list(signals, market)}
        self.max_position_size = {params['max_position_size']}
        self.stop_loss_pct = {params['stop_loss_pct']}
        self.take_profit_pct = {params['take_profit_pct']}
        self.rebalance_days = {params['rebalance_days']}
        
        # 动量指标参数
        self.fast_period = {params['fast_ma']}      # 快速均线周期
        self.slow_period = {params['slow_ma']}      # 慢速均线周期
        self.rsi_period = {params['rsi_period']}    # RSI周期
        self.rsi_overbought = {params['rsi_overbought']}  # RSI超买线
        self.rsi_oversold = {params['rsi_oversold']}      # RSI超卖线
        self.volume_multiplier = {params['volume_multiplier']}  # 成交量倍数
        
        # 初始化变量
        self.next_rebalance = self.Time
        self.positions = {{}}
        self.signals = {self._build_signals_dict(signals)}
        self.indicators = {{}}  # 存储每个股票的技术指标
        
        # 添加股票并设置指标
{symbols_code}
        
        # 设置交易时间（每天开盘后45分钟，等待数据稳定）
        self.Schedule.On(self.DateRules.EveryDay(),
                        self.TimeRules.AfterMarketOpen("SPY", minutes=45),
                        self.MomentumTradeLogic)
        
        # 设置每日收盘检查
        self.Schedule.On(self.DateRules.EveryDay(),
                        self.TimeRules.BeforeMarketClose("SPY", minutes=15),
                        self.DailyCheck)
        
        # 每周重新计算动量排名
        self.Schedule.On(self.DateRules.WeekStart(),
                        self.TimeRules.AfterMarketOpen("SPY", minutes=60),
                        self.RankMomentum)
        
        self.Debug(f"动量策略初始化完成")
    
    def InitializeIndicators(self, symbol):
        """初始化技术指标"""
        # 移动平均线
        fast_ma = self.SMA(symbol, self.fast_period, Resolution.Daily)
        slow_ma = self.SMA(symbol, self.slow_period, Resolution.Daily)
        
        # RSI指标
        rsi = self.RSI(symbol, self.rsi_period, MovingAverageType.Simple, Resolution.Daily)
        
        # 成交量均线
        volume_ma = self.SMA(symbol, 20, Resolution.Daily, Field.Volume)
        
        # 存储指标
        self.indicators[str(symbol)] = {{
            'fast_ma': fast_ma,
            'slow_ma': slow_ma,
            'rsi': rsi,
            'volume_ma': volume_ma,
            'last_signal': None
        }}
    
    def RankMomentum(self):
        """根据动量指标对股票进行排名"""
        if not self.signal_stocks:
            return
        
        momentum_scores = {{}}
        
        for symbol_str in self.signal_stocks:
            symbol = SymbolCache.GetSymbol(symbol_str)
            if not symbol or str(symbol) not in self.indicators:
                continue
            
            indicators = self.indicators[str(symbol)]
            
            # 检查指标是否就绪
            if not (indicators['fast_ma'].IsReady and indicators['slow_ma'].IsReady and 
                   indicators['rsi'].IsReady and indicators['volume_ma'].IsReady):
                continue
            
            # 计算动量分数
            score = 0.0
            
            # 1. 均线排列（快线在慢线上方为正）
            if indicators['fast_ma'].Current.Value > indicators['slow_ma'].Current.Value:
                score += 0.3
            
            # 2. RSI在中性区域（40-60）
            rsi_value = indicators['rsi'].Current.Value
            if 40 <= rsi_value <= 60:
                score += 0.2
            elif rsi_value > 60:  # 超买区域，减分
                score -= 0.1
            
            # 3. 成交量放大（当前成交量是均量的倍数）
            current_volume = self.CurrentSlice[symbol].Volume if symbol in self.CurrentSlice else 0
            if current_volume > 0 and indicators['volume_ma'].Current.Value > 0:
                volume_ratio = current_volume / indicators['volume_ma'].Current.Value
                if volume_ratio > self.volume_multiplier:
                    score += 0.2
            
            # 4. AI信号强度
            ai_signal = self.signals.get(str(symbol), 0.5)
            score += ai_signal * 0.3
            
            momentum_scores[str(symbol)] = score
        
        # 根据动量分数排序
        ranked_symbols = sorted(momentum_scores.items(), key=lambda x: x[1], reverse=True)
        
        # 只保留前N个（根据风格）
        top_n = min({params['top_n']}, len(ranked_symbols))
        self.top_momentum_stocks = [symbol for symbol, _ in ranked_symbols[:top_n]]
        
        if self.top_momentum_stocks:
            self.Debug(f"动量排名前{top_n}: {{self.top_momentum_stocks}}")
    
    def MomentumTradeLogic(self):
        """动量交易逻辑"""
        # 检查是否到达调仓日
        if (self.Time - self.next_rebalance).days < self.rebalance_days:
            return
        
        # 更新调仓时间
        self.next_rebalance = self.Time + timedelta(days=self.rebalance_days)
        
        # 如果没有动量排名，先进行排名
        if not hasattr(self, 'top_momentum_stocks'):
            self.RankMomentum()
        
        if not hasattr(self, 'top_momentum_stocks') or not self.top_momentum_stocks:
            return
        
        total_portfolio_value = self.Portfolio.TotalPortfolioValue
        available_cash = self.Portfolio.Cash
        
        if total_portfolio_value <= 0:
            return
        
        # 对动量排名靠前的股票进行交易
        for symbol_str in self.top_momentum_stocks:
            symbol = SymbolCache.GetSymbol(symbol_str)
            if not symbol or str(symbol) not in self.indicators:
                continue
            
            holding = self.Portfolio[symbol]
            is_held = holding.Invested
            indicators = self.indicators[str(symbol)]
            
            # 检查指标是否就绪
            if not (indicators['fast_ma'].IsReady and indicators['slow_ma'].IsReady):
                continue
            
            # 动量信号：快线上穿慢线（金叉）
            fast_above_slow = indicators['fast_ma'].Current.Value > indicators['slow_ma'].Current.Value
            was_below = indicators['last_signal'] == 'below' if indicators['last_signal'] else False
            
            # 更新最后信号
            indicators['last_signal'] = 'above' if fast_above_slow else 'below'
            
            # 买入信号：金叉形成且未持仓
            if not is_held and fast_above_slow and was_below:
                # 检查RSI是否在合理区间
                if indicators['rsi'].IsReady:
                    rsi_value = indicators['rsi'].Current.Value
                    if rsi_value < self.rsi_overbought:  # 不在超买区
                        # 计算买入金额
                        buy_pct = self.max_position_size
                        target_value = total_portfolio_value * buy_pct
                        
                        if available_cash >= target_value * 1.01:
                            price = self.Securities[symbol].Price
                            if price > 0:
                                quantity = int(target_value / price)
                                if quantity > 0:
                                    self.MarketOrder(symbol, quantity)
                                    self.positions[str(symbol)] = {{
                                        'entry_price': price,
                                        'entry_time': self.Time,
                                        'momentum_score': self.signals.get(str(symbol), 0.5)
                                    }}
                                    self.Debug(f"动量买入 {{symbol}}: {{quantity}}股 @ {{price:.2f}}")
                                    available_cash -= price * quantity
            
            # 卖出信号：死叉形成或已持仓但快线下穿慢线
            elif is_held and str(symbol) in self.positions:
                entry_info = self.positions[str(symbol)]
                current_price = self.Securities[symbol].Price
                entry_price = entry_info['entry_price']
                
                # 计算盈亏
                if entry_price > 0:
                    pct_change = (current_price - entry_price) / entry_price
                    
                    # 止盈止损检查
                    if pct_change >= self.take_profit_pct:
                        self.Liquidate(symbol)
                        self.Debug(f"动量止盈 {{symbol}}: 盈利 {{pct_change*100:.1f}}%")
                        if str(symbol) in self.positions:
                            del self.positions[str(symbol)]
                    
                    elif pct_change <= self.stop_loss_pct:
                        self.Liquidate(symbol)
                        self.Debug(f"动量止损 {{symbol}}: 亏损 {{pct_change*100:.1f}}%")
                        if str(symbol) in self.positions:
                            del self.positions[str(symbol)]
                    
                    # 趋势反转检查：死叉
                    elif not fast_above_slow and not was_below:
                        self.Liquidate(symbol)
                        self.Debug(f"趋势反转卖出 {{symbol}}")
                        if str(symbol) in self.positions:
                            del self.positions[str(symbol)]
    
    def DailyCheck(self):
        """每日收盘检查"""
        # 清理已平仓的持仓记录
        symbols_to_remove = []
        for symbol_str in self.positions:
            symbol = SymbolCache.GetSymbol(symbol_str)
            if symbol and not self.Portfolio[symbol].Invested:
                symbols_to_remove.append(symbol_str)
        
        for symbol_str in symbols_to_remove:
            del self.positions[symbol_str]
    
    def OnOrderEvent(self, orderEvent):
        """订单事件处理"""
        if orderEvent.Status == OrderStatus.Filled:
            self.Debug(f"订单成交: {{orderEvent.Symbol}} {{orderEvent.Direction}} {{orderEvent.FillQuantity}}股")
    
    def OnEndOfAlgorithm(self):
        """回测结束总结"""
        self.Debug("动量策略回测结束")
        total_return = (self.Portfolio.TotalPortfolioValue - {params['initial_capital']}) / {params['initial_capital']} * 100
        self.Debug(f"总收益: {{total_return:.2f}}%")

# 动量策略参数：
# 1. 快速均线: {params['fast_ma']}日
# 2. 慢速均线: {params['slow_ma']}日
# 3. RSI周期: {params['rsi_period']}日
# 4. 成交量倍数: {params['volume_multiplier']}倍
# 5. 持仓前N名: {params['top_n']}只
'''
        return strategy_code
    
    def _get_momentum_params(self, style: str) -> Dict[str, Any]:
        """
        获取动量策略参数
        
        不同风格的动量参数：
        - conservative: 长线趋势，低换手
        - neutral: 中线趋势，适度换手
        - aggressive: 短线趋势，高换手
        """
        if style == "conservative":
            return {
                'initial_capital': 100000,
                'max_position_size': 0.08,   # 8%
                'stop_loss_pct': -0.10,      # -10%
                'take_profit_pct': 0.25,     # 25%
                'rebalance_days': 10,        # 10天调仓
                'fast_ma': 10,               # 快速均线10日
                'slow_ma': 30,               # 慢速均线30日
                'rsi_period': 14,            # RSI 14日
                'rsi_overbought': 75,        # RSI超买线75
                'rsi_oversold': 25,          # RSI超卖线25
                'volume_multiplier': 1.5,    # 成交量1.5倍
                'top_n': 5                   # 持仓前5名
            }
        elif style == "aggressive":
            return {
                'initial_capital': 100000,
                'max_position_size': 0.20,   # 20%
                'stop_loss_pct': -0.05,      # -5%
                'take_profit_pct': 0.15,     # 15%
                'rebalance_days': 3,         # 3天调仓
                'fast_ma': 5,                # 快速均线5日
                'slow_ma': 10,               # 慢速均线10日
                'rsi_period': 7,             # RSI 7日
                'rsi_overbought': 70,        # RSI超买线70
                'rsi_oversold': 30,          # RSI超卖线30
                'volume_multiplier': 2.0,    # 成交量2.0倍
                'top_n': 8                   # 持仓前8名
            }
        else:  # neutral
            return {
                'initial_capital': 100000,
                'max_position_size': 0.12,   # 12%
                'stop_loss_pct': -0.08,      # -8%
                'take_profit_pct': 0.20,     # 20%
                'rebalance_days': 5,         # 5天调仓
                'fast_ma': 8,                # 快速均线8日
                'slow_ma': 20,               # 慢速均线20日
                'rsi_period': 10,            # RSI 10日
                'rsi_overbought': 72,        # RSI超买线72
                'rsi_oversold': 28,          # RSI超卖线28
                'volume_multiplier': 1.8,    # 成交量1.8倍
                'top_n': 6                   # 持仓前6名
            }


if __name__ == "__main__":
    # 测试动量策略代码生成
    strategy = MomentumStrategy()
    
    test_signals = [
        {"code": "AAPL", "name": "Apple", "confidence": 0.82},
        {"code": "MSFT", "name": "Microsoft", "confidence": 0.79},
        {"code": "GOOGL", "name": "Google", "confidence": 0.75}
    ]
    
    code = strategy.generate(
        signals=test_signals,
        market="美股",
        start_date="2020-01-01",
        end_date="2021-12-31",
        style="neutral"
    )
    
    print("生成的动量策略代码片段:")
    print(code[:1500])
    print(f"\n总代码长度: {len(code)} 字符")