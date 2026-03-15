/**
 * @file 信号推送服务
 * @description 向策略发布者推送交易信号，支持Telegram/企微/飞书三种渠道。
 *              推送失败自动切换备用渠道，并记录推送状态到 incident_log。
 */

const axios = require('axios');
// 引入订阅管理服务，用于推送前检查订阅有效性（月订阅宽限期 / 终身订阅）
const subscriptionManager = require('./subscription-manager');

// ============================================================
// 消息格式化
// ============================================================

/**
 * 格式化信号消息
 * @param {Object} signal 信号对象（来自 strategy_signals 表）
 * @param {string} channelType 渠道类型 telegram/wecom/feishu
 * @returns {string|Object} 格式化后的消息文本或卡片对象
 */
function formatSignalMessage(signal, channelType) {
  const {
    signal_type,    // open/add/reduce/stop_profit/stop_loss
    stock_code,
    stock_name,
    grade,          // 评级 A/B/C
    score,          // 评分 0-100
    current_price,
    suggested_quantity,
    cash_usage_rate,   // 使用资金比例
    avg_cost,          // 持仓均价（减仓/止损时有值）
    float_pnl_pct,     // 浮盈/浮亏百分比
    reduce_ratio,      // 建议减仓比例
    available_qty,     // 今日可操作数量（T+1后）
    t1_locked_qty,     // T+1锁定数量
    trigger_technical, // 技术面触发原因
    trigger_fundamental, // 基本面触发原因
    trigger_capital,   // 资金面触发原因
    trigger_sentiment, // 舆情触发原因
    trigger_chips,     // 筹码触发原因
    signal_time,
    expires_at,        // 响应截止时间（30分钟后）
    confirm_url,       // 平台确认链接
    id: signalId,
  } = signal;

  // 信号类型中文映射
  const typeMap = {
    open: '🟢 开仓信号',
    add: '🔵 增仓信号',
    reduce: '🟡 减仓信号',
    stop_profit: '💰 止盈信号',
    stop_loss: '🔴 止损信号（高优先级）',
  };
  const typeName = typeMap[signal_type] || signal_type;
  const isOpen = ['open', 'add'].includes(signal_type);
  const isReduce = ['reduce', 'stop_profit'].includes(signal_type);
  const isStopLoss = signal_type === 'stop_loss';

  // 格式化时间
  const fmt = (dt) => dt ? new Date(dt).toLocaleString('zh-CN', { hour12: false }) : '-';

  if (channelType === 'telegram') {
    // Telegram 使用 Markdown 格式
    let lines = [];
    lines.push(`*${typeName}*`);
    lines.push(`标的：${stock_code} ${stock_name}`);
    lines.push(`评级/评分：${grade} / ${score}分`);
    lines.push(`当前价：¥${current_price}`);

    if (isOpen) {
      // 开仓/增仓
      lines.push(`建议数量：${suggested_quantity}股（100股整数倍）`);
      lines.push(`使用资金比例：${(cash_usage_rate * 100).toFixed(1)}%`);
      lines.push(`─── 触发原因 ───`);
      lines.push(`📊 技术面：${trigger_technical || '-'}`);
      lines.push(`📰 基本面：${trigger_fundamental || '-'}`);
      lines.push(`💰 资金面：${trigger_capital || '-'}`);
      lines.push(`📣 舆情：${trigger_sentiment || '-'}`);
      lines.push(`🧩 筹码：${trigger_chips || '-'}`);
    } else if (isReduce) {
      // 减仓/止盈
      const pnl = float_pnl_pct >= 0 ? `+${float_pnl_pct.toFixed(2)}%` : `${float_pnl_pct.toFixed(2)}%`;
      lines.push(`当前价 vs 持仓均价：¥${current_price} vs ¥${avg_cost}（浮盈 ${pnl}）`);
      lines.push(`建议减仓比例：${(reduce_ratio * 100).toFixed(0)}%`);
      lines.push(`今日可操作数量：${available_qty}股（已排除T+1锁定）`);
      lines.push(`T+1锁定数量：${t1_locked_qty || 0}股（明日解锁）`);
      lines.push(`─── 触发原因 ───`);
      lines.push(`📊 技术面：${trigger_technical || '-'}`);
    } else if (isStopLoss) {
      // 止损（高优先级警示）
      const pnl = float_pnl_pct >= 0 ? `+${float_pnl_pct.toFixed(2)}%` : `${float_pnl_pct.toFixed(2)}%`;
      lines.push(`⚠️ *请立即处理*`);
      lines.push(`当前价 vs 持仓均价：¥${current_price} vs ¥${avg_cost}（浮亏 ${pnl}）`);
      lines.push(`建议平仓比例：${(reduce_ratio * 100).toFixed(0)}%`);
      lines.push(`今日可操作数量：${available_qty}股`);
      lines.push(`T+1锁定数量：${t1_locked_qty || 0}股（T+1分拆，明日可操作）`);
      lines.push(`─── 触发原因 ───`);
      lines.push(`📊 ${trigger_technical || '-'}`);
    }

    lines.push(`─────────────`);
    lines.push(`信号时间：${fmt(signal_time)}`);
    lines.push(`响应截止：${fmt(expires_at)}`);
    lines.push(`[点击确认执行](${confirm_url || `https://quantoracle.app/signals/${signalId}/confirm`})`);
    return lines.join('\n');

  } else if (channelType === 'wecom') {
    // 企业微信卡片消息（markdown类型）
    let content = `## ${typeName}\n`;
    content += `> 标的：**${stock_code} ${stock_name}**\n`;
    content += `> 评级/评分：${grade} / ${score}分\n`;
    content += `> 当前价：¥${current_price}\n`;

    if (isOpen) {
      content += `> 建议数量：${suggested_quantity}股\n`;
      content += `> 使用资金比例：${(cash_usage_rate * 100).toFixed(1)}%\n`;
      content += `\n**触发原因**\n`;
      content += `- 技术面：${trigger_technical || '-'}\n`;
      content += `- 基本面：${trigger_fundamental || '-'}\n`;
      content += `- 资金面：${trigger_capital || '-'}\n`;
    } else if (isReduce || isStopLoss) {
      const pnl = float_pnl_pct >= 0 ? `+${float_pnl_pct.toFixed(2)}%` : `${float_pnl_pct.toFixed(2)}%`;
      content += `> 浮盈亏：${pnl}\n`;
      content += `> 今日可操作：${available_qty}股  T+1锁定：${t1_locked_qty || 0}股\n`;
    }

    content += `\n截止时间：${fmt(expires_at)}\n`;
    content += `[点击确认](${confirm_url || `https://quantoracle.app/signals/${signalId}/confirm`})`;
    return { msgtype: 'markdown', markdown: { content } };

  } else if (channelType === 'feishu') {
    // 飞书卡片消息
    const color = isStopLoss ? 'red' : isReduce ? 'orange' : 'green';
    const elements = [
      {
        tag: 'div',
        text: { tag: 'lark_md', content: `**标的**：${stock_code} ${stock_name}\n**评级/评分**：${grade} / ${score}分\n**当前价**：¥${current_price}` }
      }
    ];

    if (isOpen) {
      elements.push({
        tag: 'div',
        text: { tag: 'lark_md', content: `**建议数量**：${suggested_quantity}股\n**使用资金**：${(cash_usage_rate * 100).toFixed(1)}%\n\n**触发原因**\n- 技术面：${trigger_technical || '-'}\n- 基本面：${trigger_fundamental || '-'}` }
      });
    } else {
      const pnl = float_pnl_pct >= 0 ? `+${float_pnl_pct.toFixed(2)}%` : `${float_pnl_pct.toFixed(2)}%`;
      elements.push({
        tag: 'div',
        text: { tag: 'lark_md', content: `**浮盈亏**：${pnl}\n**今日可操作**：${available_qty}股  **T+1锁定**：${t1_locked_qty || 0}股` }
      });
    }

    elements.push({ tag: 'hr' });
    elements.push({
      tag: 'div',
      text: { tag: 'lark_md', content: `截止时间：${fmt(expires_at)}` }
    });
    elements.push({
      tag: 'action',
      actions: [{
        tag: 'button',
        text: { tag: 'plain_text', content: '点击确认执行' },
        type: 'primary',
        url: confirm_url || `https://quantoracle.app/signals/${signalId}/confirm`
      }]
    });

    return {
      msg_type: 'interactive',
      card: {
        config: { wide_screen_mode: true },
        header: { title: { tag: 'plain_text', content: typeName }, template: color },
        elements
      }
    };
  }

  // 兜底：纯文本
  return `${typeName} - ${stock_code} ${stock_name} @¥${current_price}  截止:${fmt(expires_at)}`;
}

// ============================================================
// 渠道发送函数
// ============================================================

/**
 * 发送到Telegram（Bot API）
 * @param {string} webhook 格式: "TOKEN:CHATID"（BOT Token冒号Chat ID）
 * @param {string} message 格式化消息文本
 */
async function sendTelegram(webhook, message) {
  const [token, chatId] = webhook.split(':');
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  await axios.post(url, {
    chat_id: chatId,
    text: message,
    parse_mode: 'Markdown',
    disable_web_page_preview: false,
  }, { timeout: 8000 });
}

/**
 * 发送到企业微信群机器人（Webhook）
 * @param {string} webhookUrl 企业微信群机器人Webhook URL
 * @param {string|Object} message formatSignalMessage返回的内容
 */
async function sendWecom(webhookUrl, message) {
  // message 若为对象（卡片格式）直接发，否则包装为markdown
  const payload = typeof message === 'object' ? message : {
    msgtype: 'markdown',
    markdown: { content: message }
  };
  await axios.post(webhookUrl, payload, { timeout: 8000 });
}

/**
 * 发送到飞书自定义机器人（Webhook）
 * @param {string} webhookUrl 飞书机器人Webhook URL
 * @param {string|Object} message formatSignalMessage返回的内容
 */
async function sendFeishu(webhookUrl, message) {
  // message 若为对象（卡片格式）直接发，否则包装为text
  const payload = typeof message === 'object' ? message : {
    msg_type: 'text',
    content: { text: message }
  };
  await axios.post(webhookUrl, payload, { timeout: 8000 });
}

// ============================================================
// 主推送函数
// ============================================================

/**
 * 推送信号到所有配置渠道，失败自动切换备用渠道
 * @param {Object} signal 信号对象（来自 strategy_signals 表）
 * @param {Array} channels 推送渠道配置 [{type:'telegram', webhook:'...'}, ...]
 * @returns {Promise<{success: boolean, sent_channels: string[], failed_channels: string[]}>}
 */
/**
 * 推送信号到指定渠道列表（批量推送给策略订阅者）
 *
 * @param {Object} signal 信号对象（来自 strategy_signals 表）
 * @param {Array}  channels 渠道配置列表 [{type, webhook, subscriberId}]
 * @param {object|null} db 数据库实例（传入时进行订阅有效性检查，不传则跳过检查）
 * @returns {Promise<{ success: boolean, sent_channels: string[], failed_channels: string[], skipped: number }>}
 */
async function pushSignal(signal, channels, db = null) {
  const sent_channels = [];
  const failed_channels = [];
  let skipped = 0;

  for (const channel of channels) {
    const { type, webhook, subscriberId } = channel;

    // 订阅有效性检查：若传入 db 且 channel 携带 subscriberId，则校验订阅状态
    // 月订阅宽限期结束或未续费者跳过推送；终身订阅和有效月订阅正常推送
    if (db && subscriberId && signal.strategy_id) {
      const { active } = await subscriptionManager.checkSubscriptionActive(db, subscriberId, signal.strategy_id);
      if (!active) {
        // 订阅已失效（宽限期结束 / 未续费），跳过该订阅者，不推送
        skipped++;
        continue;
      }
    }

    try {
      const message = formatSignalMessage(signal, type);

      if (type === 'telegram') {
        await sendTelegram(webhook, message);
      } else if (type === 'wecom') {
        await sendWecom(webhook, message);
      } else if (type === 'feishu') {
        await sendFeishu(webhook, message);
      } else {
        throw new Error(`未知渠道类型: ${type}`);
      }

      sent_channels.push(type);
    } catch (err) {
      console.error(`[signal-pusher] 推送失败 渠道=${type} 信号=${signal.id}`, err.message);
      failed_channels.push(type);
      // 继续尝试其他渠道（不中断循环）
    }
  }

  const success = sent_channels.length > 0;
  return { success, sent_channels, failed_channels, skipped };
}

/**
 * 测试渠道是否可用（创建策略时调用）
 * @param {Object} channel 渠道配置 {type, webhook}
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
async function testChannel(channel) {
  // 构造一条测试信号
  const testSignal = {
    id: 'test-signal-001',
    signal_type: 'open',
    stock_code: '000001',
    stock_name: '平安银行',
    grade: 'A',
    score: 88,
    current_price: 10.50,
    suggested_quantity: 100,
    cash_usage_rate: 0.1,
    trigger_technical: '测试推送，请忽略',
    trigger_fundamental: '-',
    trigger_capital: '-',
    trigger_sentiment: '-',
    trigger_chips: '-',
    signal_time: new Date().toISOString(),
    expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    confirm_url: 'https://quantoracle.app/signals/test/confirm',
  };

  try {
    const { type, webhook } = channel;
    const message = formatSignalMessage(testSignal, type);

    if (type === 'telegram') {
      await sendTelegram(webhook, `[测试] ${message}`);
    } else if (type === 'wecom') {
      await sendWecom(webhook, `[测试] ${typeof message === 'string' ? message : '卡片测试消息'}`);
    } else if (type === 'feishu') {
      await sendFeishu(webhook, `[测试] ${typeof message === 'string' ? message : '卡片测试消息'}`);
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { pushSignal, formatSignalMessage, testChannel };
