import React, { useState } from 'react';
import './HotStockAnalysis.css';

function HotStockAnalysis({ onBack, holdings, onAddToHoldings }) {
  // 筛选条件
  const filterConditions = [
    { label: 'PE < 30', value: 'pe' },
    { label: '近5日涨幅 > 5%', value: 'gain5d' },
    { label: '成交量较20日均量放大 > 150%', value: 'volume' },
    { label: '市值 50亿~500亿', value: 'marketCap' },
    { label: '所属行业：AI/半导体/新能源/医药/消费', value: 'industry' },
  ];

  // 模拟股票数据
  const initialStocks = [
    { code: 'sh600519', name: '贵州茅台', price: 1680.5, changePercent: 1.23, pe: 28.5, industry: '消费', reason: '白酒龙头，消费升级受益，高ROE，护城河深' },
    { code: 'sz300750', name: '宁德时代', price: 198.6, changePercent: 2.15, pe: 26.8, industry: '新能源', reason: '新能源电池领军企业，技术领先，全球市占率持续提升' },
    { code: 'sz002415', name: '海康威视', price: 32.4, changePercent: 0.85, pe: 22.1, industry: 'AI', reason: 'AI+安防龙头，智慧城市需求强劲，估值合理' },
    { code: 'sh603501', name: '韦尔股份', price: 89.7, changePercent: 3.42, pe: 29.8, industry: '半导体', reason: 'CIS芯片龙头，国产替代逻辑强，业绩拐点已现' },
    { code: 'sz000661', name: '长春高新', price: 145.2, changePercent: 1.56, pe: 27.3, industry: '医药', reason: '生长激素龙头，老龄化+消费升级，成长确定性高' },
    { code: 'sh601012', name: '隆基绿能', price: 18.5, changePercent: 2.78, pe: 24.6, industry: '新能源', reason: '光伏组件龙头，技术成本优势明显，海外市场拓展迅速' },
    { code: 'sz300124', name: '汇川技术', price: 65.3, changePercent: 1.89, pe: 25.7, industry: 'AI', reason: '工业自动化龙头，智能制造核心标的，国产替代空间大' },
    { code: 'sh688981', name: '中芯国际', price: 44.8, changePercent: 4.12, pe: 30.2, industry: '半导体', reason: '国内晶圆代工龙头，国家战略支持，先进制程突破在即' },
    { code: 'sz000568', name: '泸州老窖', price: 205.3, changePercent: 0.92, pe: 26.4, industry: '消费', reason: '高端白酒品牌，渠道改革成效显著，库存健康' },
    { code: 'sh600276', name: '恒瑞医药', price: 42.6, changePercent: 1.34, pe: 28.9, industry: '医药', reason: '创新药龙头，研发管线丰富，国际化布局加速' },
  ];

  const [stocks, setStocks] = useState(initialStocks);
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = () => {
    setRefreshing(true);
    // 模拟刷新逻辑：轻微调整价格和涨跌幅
    setTimeout(() => {
      const updated = stocks.map(stock => ({
        ...stock,
        price: (stock.price * (0.995 + Math.random() * 0.01)).toFixed(2),
        changePercent: (stock.changePercent + (Math.random() - 0.5) * 0.5).toFixed(2),
      }));
      setStocks(updated);
      setRefreshing(false);
    }, 800);
  };

  const handleAddToHoldings = (stock) => {
    if (onAddToHoldings) {
      onAddToHoldings(stock);
    } else {
      alert(`已添加 ${stock.name} 到持仓列表`);
    }
  };

  const handleViewDetails = (stock) => {
    alert(`查看 ${stock.name} (${stock.code}) 的详细分析`);
  };

  return (
    <div className="hot-stock-analysis">
      <div className="analysis-header">
        <h2>🔥 A股筛选分析（占位组件）</h2>
        <button className="btn-back" onClick={onBack}>← 返回</button>
      </div>

      {/* 筛选条件展示区 */}
      <div className="filter-section">
        <h3>筛选条件</h3>
        <div className="filter-tags">
          {filterConditions.map(cond => (
            <span key={cond.value} className="filter-tag">{cond.label}</span>
          ))}
        </div>
        <div className="filter-notes">
          <span className="note">* 筛选条件根据A股交易规则硬编码，后续将接入真实API</span>
          <button className="btn-edit" onClick={() => alert('后续开放编辑筛选条件')}>编辑条件</button>
        </div>
      </div>

      {/* 股票列表 */}
      <div className="stock-list-section">
        <div className="section-header">
          <h3>筛选结果（共{stocks.length}只）</h3>
          <button className="btn-refresh" onClick={handleRefresh} disabled={refreshing}>
            {refreshing ? '刷新中...' : '🔄 刷新'}
          </button>
        </div>
        <div className="stock-table">
          <div className="stock-table-header">
            <div className="col col-name">股票</div>
            <div className="col col-price">现价</div>
            <div className="col col-change">涨跌幅</div>
            <div className="col col-pe">PE</div>
            <div className="col col-industry">行业</div>
            <div className="col col-reason">推荐理由</div>
            <div className="col col-actions">操作</div>
          </div>
          <div className="stock-table-body">
            {stocks.map(stock => (
              <div key={stock.code} className="stock-table-row">
                <div className="col col-name">
                  <div className="stock-name">{stock.name}</div>
                  <div className="stock-code">{stock.code}</div>
                </div>
                <div className="col col-price">¥{typeof stock.price === 'number' ? stock.price.toFixed(2) : stock.price}</div>
                <div className={`col col-change ${stock.changePercent >= 0 ? 'up' : 'down'}`}>
                  {stock.changePercent >= 0 ? '+' : ''}{typeof stock.changePercent === 'number' ? stock.changePercent.toFixed(2) : stock.changePercent}%
                </div>
                <div className="col col-pe">{stock.pe}</div>
                <div className="col col-industry">
                  <span className="industry-tag">{stock.industry}</span>
                </div>
                <div className="col col-reason" title={stock.reason}>
                  {stock.reason.length > 20 ? stock.reason.substring(0, 20) + '...' : stock.reason}
                </div>
                <div className="col col-actions">
                  <button className="btn-add" onClick={() => handleAddToHoldings(stock)}>加入持仓</button>
                  <button className="btn-details" onClick={() => handleViewDetails(stock)}>查看详情</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 操作按钮 */}
      <div className="action-footer">
        <button className="btn-export">导出列表</button>
        <button className="btn-settings">高级设置</button>
        <button className="btn-ai-analyze">🤖 AI 深度分析</button>
      </div>
    </div>
  );
}

export default HotStockAnalysis;