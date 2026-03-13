/**
 * AI 选股模拟数据生成器
 * 当 TradingAgents 服务不可达时返回模拟数据
 */

/**
 * 生成模拟股票数据
 * @param {string} market - 市场（A股/美股/港股）
 * @param {string} style - 风格（conservative/neutral/aggressive）
 * @param {number} count - 股票数量
 * @returns {Array} 模拟股票数据
 */
function generateFallbackStocks(market, style, count) {
    const marketStocks = getMarketStocks(market);
    const filteredStocks = applyStyleFilter(marketStocks, style);
    
    // 随机选择并排序
    const selected = filteredStocks
        .sort(() => Math.random() - 0.5)
        .slice(0, count)
        .map((stock, index) => {
            // 根据风格和索引生成不同的评分
            const baseScore = getBaseScoreByStyle(style);
            const rankBonus = (count - index) / count * 0.2; // 排名越高分数越高
            
            const scores = {
                fundamental: baseScore + Math.random() * 0.2,
                technical: baseScore + Math.random() * 0.2,
                sentiment: baseScore + Math.random() * 0.2,
                news: baseScore + Math.random() * 0.2,
                debate: baseScore + Math.random() * 0.2
            };
            
            const finalScore = calculateWeightedScore(scores, style);
            
            return {
                code: stock.code,
                name: stock.name,
                industry: stock.industry,
                confidence: finalScore,
                scores: scores,
                reason: generateReason(stock, scores, style),
                risk: finalScore > 0.7 ? 'low' : finalScore < 0.4 ? 'high' : 'medium',
                kronos_signal: null,
                analysis_details: {
                    investment_advice: getAdviceByScore(finalScore),
                    key_risks: ['数据服务暂时不可用，此为模拟数据'],
                    key_opportunities: ['建议在服务恢复后重新分析']
                }
            };
        })
        .sort((a, b) => b.confidence - a.confidence); // 按置信度降序
    
    return selected;
}

/**
 * 获取市场股票池
 */
function getMarketStocks(market) {
    const pools = {
        'A股': [
            { code: 'sh600519', name: '贵州茅台', industry: '白酒' },
            { code: 'sz000858', name: '五粮液', industry: '白酒' },
            { code: 'sz000333', name: '美的集团', industry: '家电' },
            { code: 'sh600036', name: '招商银行', industry: '银行' },
            { code: 'sh601318', name: '中国平安', industry: '保险' },
            { code: 'sz002415', name: '海康威视', industry: '安防' },
            { code: 'sh600276', name: '恒瑞医药', industry: '医药' },
            { code: 'sz300750', name: '宁德时代', industry: '新能源' },
            { code: 'sh600900', name: '长江电力', industry: '电力' },
            { code: 'sz000002', name: '万科A', industry: '房地产' },
            { code: 'sh688256', name: '寒武纪', industry: 'AI芯片' },
            { code: 'sz002230', name: '科大讯飞', industry: 'AI应用' },
            { code: 'sz002371', name: '北方华创', industry: '半导体设备' },
            { code: 'sh688981', name: '中芯国际', industry: '半导体' },
            { code: 'sz002594', name: '比亚迪', industry: '新能源车' }
        ],
        '美股': [
            { code: 'AAPL', name: 'Apple Inc.', industry: '科技' },
            { code: 'MSFT', name: 'Microsoft', industry: '科技' },
            { code: 'GOOGL', name: 'Alphabet', industry: '科技' },
            { code: 'AMZN', name: 'Amazon', industry: '电商' },
            { code: 'TSLA', name: 'Tesla', industry: '汽车' },
            { code: 'NVDA', name: 'NVIDIA', industry: '半导体' },
            { code: 'JPM', name: 'JPMorgan Chase', industry: '银行' },
            { code: 'JNJ', name: 'Johnson & Johnson', industry: '医药' },
            { code: 'WMT', name: 'Walmart', industry: '零售' },
            { code: 'PG', name: 'Procter & Gamble', industry: '消费品' },
            { code: 'V', name: 'Visa', industry: '金融' },
            { code: 'MA', name: 'Mastercard', industry: '金融' },
            { code: 'HD', name: 'Home Depot', industry: '零售' },
            { code: 'DIS', name: 'Disney', industry: '娱乐' },
            { code: 'NFLX', name: 'Netflix', industry: '娱乐' }
        ],
        '港股': [
            { code: '00700.HK', name: '腾讯控股', industry: '科技' },
            { code: '00941.HK', name: '中国移动', industry: '电信' },
            { code: '01299.HK', name: '友邦保险', industry: '保险' },
            { code: '02318.HK', name: '中国平安', industry: '保险' },
            { code: '03988.HK', name: '中国银行', industry: '银行' },
            { code: '00883.HK', name: '中国海洋石油', industry: '石油' },
            { code: '01088.HK', name: '中国神华', industry: '煤炭' },
            { code: '00388.HK', name: '香港交易所', industry: '金融' },
            { code: '00005.HK', name: '汇丰控股', industry: '银行' },
            { code: '00669.HK', name: '创科实业', industry: '工具设备' },
            { code: '02269.HK', name: '药明生物', industry: '医药' },
            { code: '00981.HK', name: '中芯国际', industry: '半导体' },
            { code: '02020.HK', name: '安踏体育', industry: '消费' },
            { code: '06030.HK', name: '中信证券', industry: '证券' },
            { code: '09633.HK', name: '农夫山泉', industry: '消费' }
        ]
    };
    
    return pools[market] || pools['A股'];
}

/**
 * 应用风格过滤
 */
function applyStyleFilter(stocks, style) {
    // 模拟不同风格的偏好
    const stylePreferences = {
        'conservative': ['银行', '保险', '电力', '消费品', '医药'],
        'neutral': ['科技', '新能源', '半导体', '家电', '零售'],
        'aggressive': ['AI芯片', 'AI应用', '半导体设备', '新能源车', '娱乐']
    };
    
    const preferredIndustries = stylePreferences[style] || stylePreferences['neutral'];
    
    return stocks.filter(stock => {
        const industry = stock.industry || '';
        // 保守型偏好稳定行业，激进型偏好成长行业
        if (style === 'conservative') {
            return preferredIndustries.some(pref => industry.includes(pref));
        } else if (style === 'aggressive') {
            return preferredIndustries.some(pref => industry.includes(pref));
        }
        // 中性风格不过滤
        return true;
    });
}

/**
 * 根据风格获取基础评分
 */
function getBaseScoreByStyle(style) {
    const baseScores = {
        'conservative': 0.6,  // 保守型股票基础分较高
        'neutral': 0.5,
        'aggressive': 0.4    // 激进型股票基础分较低（风险较高）
    };
    return baseScores[style] || 0.5;
}

/**
 * 计算加权评分
 */
function calculateWeightedScore(scores, style) {
    const weights = {
        'conservative': { fundamental: 0.4, technical: 0.2, sentiment: 0.2, news: 0.1, debate: 0.1 },
        'neutral': { fundamental: 0.3, technical: 0.25, sentiment: 0.2, news: 0.15, debate: 0.1 },
        'aggressive': { fundamental: 0.25, technical: 0.3, sentiment: 0.2, news: 0.15, debate: 0.1 }
    };
    
    const weightSet = weights[style] || weights['neutral'];
    let weightedSum = 0;
    let totalWeight = 0;
    
    for (const [dimension, weight] of Object.entries(weightSet)) {
        if (scores[dimension] !== undefined) {
            weightedSum += scores[dimension] * weight;
            totalWeight += weight;
        }
    }
    
    return totalWeight > 0 ? weightedSum / totalWeight : 0.5;
}

/**
 * 生成分析理由
 */
function generateReason(stock, scores, style) {
    const dimensionText = Object.entries(scores)
        .map(([dim, score]) => `${dim}:${score.toFixed(2)}`)
        .join(' ');
    
    const styleText = {
        'conservative': '稳健',
        'neutral': '平衡',
        'aggressive': '成长'
    }[style] || '平衡';
    
    const advice = getAdviceByScore(calculateWeightedScore(scores, style));
    
    return `${stock.name}（${stock.industry}）${styleText}型配置，${advice}。多维度评分：${dimensionText}（模拟数据）`;
}

/**
 * 根据评分获取投资建议
 */
function getAdviceByScore(score) {
    if (score > 0.8) return '强烈推荐买入';
    if (score > 0.7) return '推荐买入';
    if (score > 0.6) return '谨慎买入';
    if (score > 0.5) return '持有观望';
    if (score > 0.4) return '谨慎观望';
    if (score > 0.3) return '考虑减仓';
    return '建议回避';
}

module.exports = {
    generateFallbackStocks
};