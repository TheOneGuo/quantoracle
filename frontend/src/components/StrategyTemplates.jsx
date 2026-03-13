import React, { useState } from 'react';

const StrategyTemplates = () => {
  const [selectedStrategy, setSelectedStrategy] = useState(null);
  const [userStrategies, setUserStrategies] = useState([
    { id: 1, name: '价值投资策略', type: 'value', active: true, returns: 15.2 },
    { id: 2, name: '趋势跟踪策略', type: 'trend', active: true, returns: 22.5 },
    { id: 3, name: '网格交易策略', type: 'grid', active: false, returns: 8.7 }
  ]);

  const templateStrategies = [
    {
      id: 'value',
      name: '价值投资策略',
      description: '基于基本面分析，寻找低估值的优质公司',
      icon: '💰',
      difficulty: '中级',
      recommendedFor: '长期投资者',
      timeHorizon: '1-3年',
      riskLevel: '中等',
      expectedReturn: '10-20%',
      keyRules: [
        'PE < 15',
        'PB < 2',
        'ROE > 15%',
        '股息率 > 3%',
        '负债率 < 60%'
      ],
      steps: [
        '筛选符合财务指标的公司',
        '分析行业前景和竞争格局',
        '评估管理团队质量',
        '计算合理估值区间',
        '在价格低于价值时买入',
        '定期跟踪财报和新闻'
      ]
    },
    {
      id: 'trend',
      name: '趋势跟踪策略',
      description: '顺势而为，跟随市场趋势进行交易',
      icon: '📈',
      difficulty: '高级',
      recommendedFor: '中短期交易者',
      timeHorizon: '1-12个月',
      riskLevel: '较高',
      expectedReturn: '15-30%',
      keyRules: [
        '价格在20日均线上方',
        'MACD金叉确认',
        '成交量放大',
        '突破关键阻力位',
        '止损设置在支撑下方'
      ],
      steps: [
        '识别主要趋势方向',
        '等待回调至关键支撑',
        '确认技术指标信号',
        '设置止损和止盈',
        '分批建仓',
        '趋势反转时离场'
      ]
    },
    {
      id: 'grid',
      name: '网格交易策略',
      description: '在价格区间内低买高卖，赚取波动收益',
      icon: '🔀',
      difficulty: '初级',
      recommendedFor: '震荡市投资者',
      timeHorizon: '1-6个月',
      riskLevel: '较低',
      expectedReturn: '5-15%',
      keyRules: [
        '确定价格震荡区间',
        '设置网格密度 (3-10%)',
        '每格分配固定资金',
        '严格执行买卖信号',
        '定期调整网格参数'
      ],
      steps: [
        '选择震荡性强的标的',
        '确定上下边界价格',
        '划分网格级别',
        '设置自动交易条件',
        '监控网格执行情况',
        '适时调整区间和密度'
      ]
    },
    {
      id: 'momentum',
      name: '动量策略',
      description: '追涨杀跌，捕捉强势股的加速行情',
      icon: '⚡',
      difficulty: '高级',
      recommendedFor: '高风险偏好者',
      timeHorizon: '1-3个月',
      riskLevel: '高',
      expectedReturn: '20-40%',
      keyRules: [
        '近期涨幅前20%',
        '成交量持续放大',
        '突破前期高点',
        'RSI > 70但不超买',
        '设置动态止盈'
      ],
      steps: [
        '筛选强势股票池',
        '确认动量启动信号',
        '快速建仓',
        '设置严格止损',
        '分批止盈',
        '及时切换标的'
      ]
    },
    {
      id: 'dividend',
      name: '股息策略',
      description: '投资高股息股票，获取稳定现金流',
      icon: '💵',
      difficulty: '初级',
      recommendedFor: '稳健型投资者',
      timeHorizon: '长期',
      riskLevel: '低',
      expectedReturn: '6-10%',
      keyRules: [
        '股息率 > 4%',
        '连续3年分红',
        '分红比例稳定',
        '现金流充足',
        '行业防御性强'
      ],
      steps: [
        '筛选高股息股票',
        '分析分红可持续性',
        '评估公司稳定性',
        '分批建仓',
        '收取股息再投资',
        '定期检视基本面'
      ]
    }
  ];

  const handleActivateStrategy = (strategyId) => {
    const strategy = templateStrategies.find(s => s.id === strategyId);
    if (strategy && !userStrategies.some(s => s.type === strategyId)) {
      const newStrategy = {
        id: userStrategies.length + 1,
        name: strategy.name,
        type: strategyId,
        active: true,
        returns: 0
      };
      setUserStrategies([...userStrategies, newStrategy]);
    }
  };

  const toggleStrategyActive = (strategyId) => {
    setUserStrategies(userStrategies.map(strategy => 
      strategy.id === strategyId 
        ? { ...strategy, active: !strategy.active }
        : strategy
    ));
  };

  return (
    <div className="strategy-templates-container">
      <div className="strategy-header">
        <h1>📋 策略模板系统</h1>
        <p>选择、定制和激活您的投资策略</p>
      </div>

      <div className="strategy-layout">
        {/* 左侧：我的策略 */}
        <div className="my-strategies">
          <h2>🚀 我的策略</h2>
          <p className="subtitle">已激活的策略模板</p>
          
          {userStrategies.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">📭</div>
              <p>暂无激活的策略</p>
              <span>从右侧模板库中选择一个策略开始</span>
            </div>
          ) : (
            <div className="strategies-list">
              {userStrategies.map(strategy => {
                const template = templateStrategies.find(t => t.id === strategy.type);
                return (
                  <div key={strategy.id} className="strategy-card">
                    <div className="strategy-card-header">
                      <div className="strategy-icon">{template?.icon || '📊'}</div>
                      <div className="strategy-info">
                        <h4>{strategy.name}</h4>
                        <span className="strategy-type">{template?.recommendedFor}</span>
                      </div>
                      <div className="strategy-actions">
                        <label className="switch">
                          <input 
                            type="checkbox" 
                            checked={strategy.active}
                            onChange={() => toggleStrategyActive(strategy.id)}
                          />
                          <span className="slider"></span>
                        </label>
                      </div>
                    </div>
                    
                    <div className="strategy-stats">
                      <div className="stat">
                        <label>累计收益</label>
                        <value className={strategy.returns >= 0 ? 'up' : 'down'}>
                          {strategy.returns >= 0 ? '+' : ''}{strategy.returns}%
                        </value>
                      </div>
                      <div className="stat">
                        <label>风险等级</label>
                        <value className="risk">{template?.riskLevel}</value>
                      </div>
                      <div className="stat">
                        <label>时间周期</label>
                        <value>{template?.timeHorizon}</value>
                      </div>
                    </div>
                    
                    <div className="strategy-description">
                      <p>{template?.description}</p>
                    </div>
                    
                    <div className="strategy-tags">
                      {template?.keyRules.slice(0, 3).map((rule, idx) => (
                        <span key={idx} className="tag">{rule}</span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          
          <div className="strategy-performance">
            <h3>📊 策略表现概览</h3>
            <div className="performance-metrics">
              <div className="metric">
                <label>活跃策略</label>
                <value>{userStrategies.filter(s => s.active).length}</value>
              </div>
              <div className="metric">
                <label>平均收益</label>
                <value>
                  {userStrategies.length > 0 
                    ? (userStrategies.reduce((sum, s) => sum + s.returns, 0) / userStrategies.length).toFixed(1) + '%'
                    : '0.0%'
                  }
                </value>
              </div>
              <div className="metric">
                <label>最佳策略</label>
                <value>
                  {userStrategies.length > 0 
                    ? userStrategies.reduce((best, s) => s.returns > best.returns ? s : best).name
                    : '暂无'
                  }
                </value>
              </div>
            </div>
          </div>
        </div>

        {/* 右侧：策略模板库 */}
        <div className="template-library">
          <h2>📚 策略模板库</h2>
          <p className="subtitle">选择适合您的投资策略模板</p>
          
          <div className="templates-grid">
            {templateStrategies.map(strategy => {
              const isActivated = userStrategies.some(s => s.type === strategy.id);
              return (
                <div key={strategy.id} className="template-card">
                  <div className="template-header">
                    <div className="template-icon">{strategy.icon}</div>
                    <div className="template-title">
                      <h4>{strategy.name}</h4>
                      <span className="template-difficulty">{strategy.difficulty}</span>
                    </div>
                    {isActivated && (
                      <span className="activated-badge">已激活</span>
                    )}
                  </div>
                  
                  <div className="template-description">
                    <p>{strategy.description}</p>
                  </div>
                  
                  <div className="template-meta">
                    <div className="meta-item">
                      <label>适合</label>
                      <value>{strategy.recommendedFor}</value>
                    </div>
                    <div className="meta-item">
                      <label>周期</label>
                      <value>{strategy.timeHorizon}</value>
                    </div>
                    <div className="meta-item">
                      <label>风险</label>
                      <value className={`risk ${strategy.riskLevel}`}>{strategy.riskLevel}</value>
                    </div>
                    <div className="meta-item">
                      <label>预期收益</label>
                      <value className="return">{strategy.expectedReturn}</value>
                    </div>
                  </div>
                  
                  <div className="template-rules">
                    <h5>关键规则</h5>
                    <ul>
                      {strategy.keyRules.slice(0, 3).map((rule, idx) => (
                        <li key={idx}>{rule}</li>
                      ))}
                    </ul>
                  </div>
                  
                  <div className="template-actions">
                    <button 
                      className={`btn-activate ${isActivated ? 'activated' : ''}`}
                      onClick={() => handleActivateStrategy(strategy.id)}
                      disabled={isActivated}
                    >
                      {isActivated ? '✅ 已激活' : '⚡ 激活策略'}
                    </button>
                    <button 
                      className="btn-details"
                      onClick={() => setSelectedStrategy(strategy.id)}
                    >
                      查看详情
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 策略详情模态框 */}
      {selectedStrategy && (() => {
        const strategy = templateStrategies.find(s => s.id === selectedStrategy);
        if (!strategy) return null;
        
        return (
          <div className="strategy-modal">
            <div className="modal-content">
              <div className="modal-header">
                <h2>{strategy.icon} {strategy.name}</h2>
                <button className="btn-close" onClick={() => setSelectedStrategy(null)}>×</button>
              </div>
              
              <div className="modal-body">
                <div className="strategy-overview">
                  <p>{strategy.description}</p>
                  <div className="overview-grid">
                    <div className="overview-item">
                      <label>难度等级</label>
                      <value>{strategy.difficulty}</value>
                    </div>
                    <div className="overview-item">
                      <label>适合人群</label>
                      <value>{strategy.recommendedFor}</value>
                    </div>
                    <div className="overview-item">
                      <label>时间周期</label>
                      <value>{strategy.timeHorizon}</value>
                    </div>
                    <div className="overview-item">
                      <label>风险等级</label>
                      <value className={`risk ${strategy.riskLevel}`}>{strategy.riskLevel}</value>
                    </div>
                    <div className="overview-item">
                      <label>预期收益</label>
                      <value className="return">{strategy.expectedReturn}</value>
                    </div>
                  </div>
                </div>
                
                <div className="strategy-details">
                  <div className="detail-section">
                    <h3>📋 关键规则</h3>
                    <ul className="rules-list">
                      {strategy.keyRules.map((rule, idx) => (
                        <li key={idx}>{rule}</li>
                      ))}
                    </ul>
                  </div>
                  
                  <div className="detail-section">
                    <h3>🚀 实施步骤</h3>
                    <ol className="steps-list">
                      {strategy.steps.map((step, idx) => (
                        <li key={idx}>{step}</li>
                      ))}
                    </ol>
                  </div>
                  
                  <div className="detail-section">
                    <h3>💡 策略要点</h3>
                    <div className="key-points">
                      <p><strong>优点：</strong> {(() => {
                        switch(strategy.id) {
                          case 'value': return '风险相对较低，适合长期投资';
                          case 'trend': return '顺应市场趋势，收益潜力大';
                          case 'grid': return '震荡市表现优异，收益稳定';
                          case 'momentum': return '捕捉快速上涨行情，收益高';
                          case 'dividend': return '现金流稳定，防御性强';
                          default: return '';
                        }
                      })()}</p>
                      <p><strong>注意事项：</strong> {(() => {
                        switch(strategy.id) {
                          case 'value': return '需要深入研究基本面，短期可能不涨';
                          case 'trend': return '趋势反转时可能产生较大回撤';
                          case 'grid': return '单边市可能被套或踏空';
                          case 'momentum': return '风险极高，需要严格止损';
                          case 'dividend': return '成长性可能不足，股价波动小';
                          default: return '';
                        }
                      })()}</p>
                    </div>
                  </div>
                </div>
              </div>
              
              <div className="modal-footer">
                <button 
                  className="btn-activate-primary"
                  onClick={() => {
                    handleActivateStrategy(strategy.id);
                    setSelectedStrategy(null);
                  }}
                  disabled={userStrategies.some(s => s.type === strategy.id)}
                >
                  {userStrategies.some(s => s.type === strategy.id) ? '✅ 策略已激活' : '⚡ 立即激活此策略'}
                </button>
                <button className="btn-cancel" onClick={() => setSelectedStrategy(null)}>
                  关闭
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};

export default StrategyTemplates;