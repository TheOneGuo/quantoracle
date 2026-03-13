/**
 * 提醒系统
 * 监控股票并发送通知
 */
class AlertSystem {
  constructor() {
    this.alerts = [];
    this.subscribers = [];
  }

  /**
   * 添加提醒
   */
  addAlert(alert) {
    this.alerts.push({
      id: Date.now(),
      ...alert,
      createdAt: new Date(),
      triggered: false
    });
  }

  /**
   * 检查提醒条件
   */
  checkAlerts(stockData, analysisResult) {
    const notifications = [];

    // 检查是否需要提醒
    if (analysisResult.action !== 'HOLD') {
      notifications.push({
        type: 'TRADING_SIGNAL',
        priority: analysisResult.action === 'CLEAR' ? 'HIGH' : 'MEDIUM',
        title: `${analysisResult.name}(${analysisResult.code}) - ${analysisResult.actionDesc}`,
        message: analysisResult.reason,
        data: analysisResult,
        timestamp: new Date()
      });
    }

    // 检查涨跌幅超过阈值
    if (Math.abs(stockData.changePercent) >= 5) {
      notifications.push({
        type: 'PRICE_MOVEMENT',
        priority: Math.abs(stockData.changePercent) >= 10 ? 'HIGH' : 'MEDIUM',
        title: `${stockData.name} 股价${stockData.changePercent > 0 ? '大涨' : '大跌'} ${stockData.changePercent}%`,
        message: `当前价格: ${stockData.current}, 涨跌: ${stockData.change}`,
        data: stockData,
        timestamp: new Date()
      });
    }

    return notifications;
  }

  /**
   * 发送通知 (可扩展为邮件、短信、推送等)
   */
  sendNotification(notification) {
    console.log(`[${notification.priority}] ${notification.title}`);
    console.log(notification.message);
    
    // 这里可以集成:
    // - WebSocket 推送到前端
    // - 发送邮件
    // - 发送短信
    // - 企业微信/钉钉机器人
    
    this.subscribers.forEach(callback => callback(notification));
  }

  /**
   * 订阅通知
   */
  subscribe(callback) {
    this.subscribers.push(callback);
  }
}

module.exports = AlertSystem;
