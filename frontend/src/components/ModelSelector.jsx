import React, { useState, useEffect } from 'react';
import './ModelSelector.css';
import { getMarketColor } from '../constants/marketColors';

/**
 * AI 模型选择器组件
 * 卡片式模型选择（免费/标准/高级/旗舰）
 * 显示每次调用预计消耗 token 数和用户当前余额
 * 选中后存 localStorage，供 TradingAgents/Kronos 等复用
 * 免费模型始终可用；付费模型检查余额不足时提示充值
 * 颜色沿用 getMarketColor 风格（深色主题）
 */

const MODEL_CATALOG = [
  { 
    id: "stepfun/step-3.5-flash:free", 
    name: "StepFun Flash", 
    badge: "免费", 
    tokenCost: 0, 
    quality: 3,
    description: "快速响应，适合日常分析",
    maxTokens: 2048,
    latency: "fast"
  },
  { 
    id: "deepseek/deepseek-v3.2", 
    name: "DeepSeek V3", 
    badge: "标准", 
    tokenCost: 15000, 
    quality: 4,
    description: "平衡性能与成本，推荐使用",
    maxTokens: 8192,
    latency: "medium"
  },
  { 
    id: "anthropic/claude-sonnet-4-5", 
    name: "Claude Sonnet", 
    badge: "高级", 
    tokenCost: 60000, 
    quality: 5,
    description: "高质量分析，适合复杂推理",
    maxTokens: 16384,
    latency: "slow"
  },
  { 
    id: "openai/gpt-4.5", 
    name: "GPT-4.5", 
    badge: "旗舰", 
    tokenCost: 120000, 
    quality: 5,
    description: "顶尖性能，处理复杂任务",
    maxTokens: 32768,
    latency: "medium",
    disabled: true
  }
];

const ModelSelector = ({ onModelChange, currentMarket = "A股", onRequireTopup }) => {
  const [selectedModelId, setSelectedModelId] = useState(null);
  const [userBalance, setUserBalance] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  // 初始化：从 localStorage 读取选中的模型
  useEffect(() => {
    const savedModel = localStorage.getItem('selected_ai_model');
    if (savedModel) {
      setSelectedModelId(savedModel);
    } else {
      // 默认选择免费模型
      const freeModel = MODEL_CATALOG.find(m => m.badge === "免费");
      if (freeModel) {
        setSelectedModelId(freeModel.id);
        localStorage.setItem('selected_ai_model', freeModel.id);
      }
    }
    fetchUserBalance();
  }, []);

  // 获取用户余额
  const fetchUserBalance = async () => {
    try {
      setIsLoading(true);
      const response = await fetch('/api/usage/balance');
      if (response.ok) {
        const data = await response.json();
        setUserBalance(data.remaining || 0);
      }
    } catch (error) {
      console.error('获取用户余额失败:', error);
      // 模拟数据
      setUserBalance(50000);
    } finally {
      setIsLoading(false);
    }
  };

  // 处理模型选择
  const handleSelectModel = (modelId) => {
    const model = MODEL_CATALOG.find(m => m.id === modelId);
    if (!model) return;

    // 检查余额（付费模型需要足够余额）
    if (model.tokenCost > 0 && userBalance < model.tokenCost * 10) {
      // 余额不足，提示充值
      if (onRequireTopup) {
        onRequireTopup({
          required: model.tokenCost * 10,
          current: userBalance,
          modelName: model.name
        });
      }
      return;
    }

    setSelectedModelId(modelId);
    localStorage.setItem('selected_ai_model', modelId);
    
    if (onModelChange) {
      onModelChange(modelId);
    }
  };

  // 获取当前选中的模型
  const getSelectedModel = () => {
    return MODEL_CATALOG.find(m => m.id === selectedModelId) || MODEL_CATALOG[0];
  };

  // 格式化数字
  const formatNumber = (num) => {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + 'M';
    }
    if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
  };

  // 获取质量星级
  const renderQualityStars = (quality) => {
    const stars = [];
    for (let i = 1; i <= 5; i++) {
      stars.push(
        <span 
          key={i}
          className={`quality-star ${i <= quality ? 'active' : 'inactive'}`}
          style={{ color: i <= quality ? getMarketColor(currentMarket, "bullish") : '#718096' }}
        >
          ★
        </span>
      );
    }
    return stars;
  };

  // 获取延迟标签样式
  const getLatencyStyle = (latency) => {
    const colors = {
      fast: getMarketColor(currentMarket, "bullish"),
      medium: getMarketColor(currentMarket, "neutral"),
      slow: getMarketColor(currentMarket, "bearish")
    };
    return { backgroundColor: colors[latency] || colors.medium };
  };

  // 余额是否足够使用该模型
  const isBalanceSufficient = (model) => {
    if (model.tokenCost === 0) return true;
    return userBalance >= model.tokenCost * 10;
  };

  // 刷新余额
  const handleRefreshBalance = () => {
    fetchUserBalance();
  };

  // 前往充值页面
  const handleTopupClick = () => {
    // 实际应用中应跳转到充值页面
    alert('充值功能即将上线，敬请期待！');
  };

  return (
    <div className="model-selector-container">
      <div className="model-selector-header">
        <h3 style={{ color: getMarketColor(currentMarket, "bullish") }}>
          AI 模型选择器
        </h3>
        <div className="balance-display">
          <span className="balance-label">当前余额：</span>
          <span className="balance-amount" style={{ color: getMarketColor(currentMarket, "bullish") }}>
            {isLoading ? '...' : formatNumber(userBalance)} tokens
          </span>
          <button 
            className="refresh-btn"
            onClick={handleRefreshBalance}
            style={{ color: getMarketColor(currentMarket, "neutral") }}
          >
            🔄
          </button>
          <button 
            className="topup-btn"
            onClick={handleTopupClick}
            style={{ 
              backgroundColor: getMarketColor(currentMarket, "bullish"),
              color: 'white'
            }}
          >
            充值
          </button>
        </div>
      </div>

      <div className="model-grid">
        {MODEL_CATALOG.map((model) => {
          const isSelected = selectedModelId === model.id;
          const hasSufficientBalance = isBalanceSufficient(model);
          const isDisabled = model.disabled || (!hasSufficientBalance && model.tokenCost > 0);

          return (
            <div 
              key={model.id}
              className={`model-card ${isSelected ? 'selected' : ''} ${isDisabled ? 'disabled' : ''}`}
              onClick={() => !isDisabled && handleSelectModel(model.id)}
              style={{
                borderColor: isSelected ? getMarketColor(currentMarket, "bullish") : '#2D3748',
                backgroundColor: isSelected ? `${getMarketColor(currentMarket, "bullish")}15` : '#1A202C'
              }}
            >
              {model.disabled && (
                <div className="coming-soon-badge">即将推出</div>
              )}
              
              <div className="model-card-header">
                <h4 className="model-name">{model.name}</h4>
                <span 
                  className="model-badge"
                  style={{ 
                    backgroundColor: model.badge === "免费" 
                      ? getMarketColor(currentMarket, "bullish") 
                      : model.badge === "旗舰"
                      ? '#9F7AEA'
                      : getMarketColor(currentMarket, "neutral")
                  }}
                >
                  {model.badge}
                </span>
              </div>

              <div className="model-stats">
                <div className="model-stat">
                  <span className="stat-label">质量：</span>
                  <span className="stat-value">{renderQualityStars(model.quality)}</span>
                </div>
                <div className="model-stat">
                  <span className="stat-label">预计消耗：</span>
                  <span className="stat-value">
                    {model.tokenCost === 0 ? '免费' : `${formatNumber(model.tokenCost)} tokens/次`}
                  </span>
                </div>
                <div className="model-stat">
                  <span className="stat-label">响应速度：</span>
                  <span 
                    className="latency-badge"
                    style={getLatencyStyle(model.latency)}
                  >
                    {model.latency === 'fast' ? '快速' : model.latency === 'slow' ? '较慢' : '中等'}
                  </span>
                </div>
                <div className="model-stat">
                  <span className="stat-label">最大长度：</span>
                  <span className="stat-value">{formatNumber(model.maxTokens)} tokens</span>
                </div>
              </div>

              <p className="model-description">{model.description}</p>

              {model.tokenCost > 0 && !hasSufficientBalance && (
                <div className="insufficient-balance">
                  <span style={{ color: getMarketColor(currentMarket, "bearish") }}>
                    ⚠️ 余额不足，需要至少 {formatNumber(model.tokenCost * 10)} tokens
                  </span>
                </div>
              )}

              <div className="model-card-footer">
                {isSelected ? (
                  <div className="selected-indicator">
                    <span style={{ color: getMarketColor(currentMarket, "bullish") }}>✓ 已选中</span>
                  </div>
                ) : (
                  <button 
                    className="select-btn"
                    disabled={isDisabled}
                    style={{
                      backgroundColor: isDisabled ? '#4A5568' : getMarketColor(currentMarket, "bullish"),
                      color: 'white'
                    }}
                  >
                    {model.disabled ? '即将推出' : '选择模型'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="model-info-footer">
        <div className="info-item">
          <span className="info-label">当前选中：</span>
          <span className="info-value" style={{ color: getMarketColor(currentMarket, "bullish") }}>
            {getSelectedModel().name} ({getSelectedModel().badge})
          </span>
        </div>
        <div className="info-item">
          <span className="info-label">预计单次消耗：</span>
          <span className="info-value">
            {getSelectedModel().tokenCost === 0 ? '免费' : `${formatNumber(getSelectedModel().tokenCost)} tokens`}
          </span>
        </div>
        <div className="info-item">
          <span className="info-label">每月预估：</span>
          <span className="info-value">
            {getSelectedModel().tokenCost === 0 ? '免费无限使用' : 
              `约 ${formatNumber(getSelectedModel().tokenCost * 30)} tokens`}
          </span>
        </div>
      </div>

      <div className="usage-tips">
        <p style={{ color: getMarketColor(currentMarket, "neutral") }}>
          💡 提示：选择模型后，TradingAgents 智能选股、Kronos 择时等 AI 功能将使用此模型。
          免费模型始终可用；付费模型消耗您的 token 余额，余额不足时将无法使用。
        </p>
      </div>
    </div>
  );
};

export default ModelSelector;