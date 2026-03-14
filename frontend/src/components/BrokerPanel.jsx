/**
 * @file BrokerPanel.jsx
 * @description 实盘对接面板（M5 P1/P2）
 * 展示纸交易账户、持仓、委托，支持手动下单和实盘信号推送接收。
 */

import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useBrokerWS } from '../hooks/useBrokerWS';
import './BrokerPanel.css';

const API_BASE = 'http://localhost:3001/api';

/**
 * 实盘对接主面板
 * @returns {JSX.Element}
 */
function BrokerPanel() {
  const [account, setAccount] = useState(null);
  const [positions, setPositions] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('positions'); // positions | orders | trade | signals

  // 下单表单
  const [tradeForm, setTradeForm] = useState({
    code: '',
    action: 'buy',
    quantity: 100,
    price: 0,
  });
  const [tradeMsg, setTradeMsg] = useState(null);
  const [tradeLoading, setTradeLoading] = useState(false);

  // WebSocket 实盘信号
  const { signals, connected, clearSignals } = useBrokerWS();

  /**
   * 加载账户 + 持仓 + 委托
   */
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [accRes, posRes, ordRes] = await Promise.all([
        axios.get(`${API_BASE}/broker/account`),
        axios.get(`${API_BASE}/broker/positions`),
        axios.get(`${API_BASE}/broker/orders?limit=20`),
      ]);
      if (accRes.data.success) setAccount(accRes.data.data);
      if (posRes.data.success) setPositions(posRes.data.data);
      if (ordRes.data.success) setOrders(ordRes.data.data);
    } catch (err) {
      console.error('[BrokerPanel] 加载数据失败:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const timer = setInterval(loadData, 15000); // 15s 自动刷新
    return () => clearInterval(timer);
  }, [loadData]);

  /**
   * 提交下单
   * @param {React.FormEvent} e
   */
  const handleTrade = async (e) => {
    e.preventDefault();
    setTradeMsg(null);
    setTradeLoading(true);
    try {
      const res = await axios.post(`${API_BASE}/broker/trade`, {
        ...tradeForm,
        quantity: parseInt(tradeForm.quantity, 10),
        price: parseFloat(tradeForm.price) || 0,
      });
      if (res.data.success) {
        setTradeMsg({ type: 'success', text: `委托成功：${res.data.data.orderId.slice(0, 8)}...` });
        loadData();
      } else {
        setTradeMsg({ type: 'error', text: res.data.message || '委托失败' });
      }
    } catch (err) {
      setTradeMsg({ type: 'error', text: err.response?.data?.error || '请求失败' });
    } finally {
      setTradeLoading(false);
    }
  };

  /**
   * 格式化金额显示
   * @param {number} val
   * @returns {string}
   */
  const fmt = (val) =>
    typeof val === 'number' ? val.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-';

  const profitColor = (val) => (val >= 0 ? '#48bb78' : '#f56565');

  return (
    <div className="broker-panel">
      {/* 顶部账户概览 */}
      <div className="broker-header">
        <div className="broker-title">
          <h2>💼 实盘对接</h2>
          <span className={`ws-badge ${connected ? 'online' : 'offline'}`}>
            {connected ? '🟢 信号已连接' : '🔴 信号离线'}
          </span>
          {signals.length > 0 && (
            <span className="signal-badge">{signals.length} 条新信号</span>
          )}
        </div>
        <button className="btn-refresh" onClick={loadData} disabled={loading}>
          {loading ? '刷新中...' : '🔄 刷新'}
        </button>
      </div>

      {/* 账户摘要卡片 */}
      {account && (
        <div className="account-cards">
          <div className="acc-card">
            <label>总资产</label>
            <span>¥{fmt(account.totalAssets)}</span>
          </div>
          <div className="acc-card">
            <label>可用资金</label>
            <span>¥{fmt(account.available)}</span>
          </div>
          <div className="acc-card">
            <label>持仓市值</label>
            <span>¥{fmt(account.marketValue)}</span>
          </div>
          <div className="acc-card">
            <label>总盈亏</label>
            <span style={{ color: profitColor(account.profitLoss) }}>
              {account.profitLoss >= 0 ? '+' : ''}¥{fmt(account.profitLoss)}
            </span>
          </div>
        </div>
      )}

      {/* Tab 切换 */}
      <div className="broker-tabs">
        {[
          { key: 'positions', label: '📦 持仓' },
          { key: 'orders', label: '📋 委托' },
          { key: 'trade', label: '⚡ 下单' },
          { key: 'signals', label: `🔔 信号${signals.length > 0 ? ` (${signals.length})` : ''}` },
        ].map(tab => (
          <button
            key={tab.key}
            className={`tab-btn ${activeTab === tab.key ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab 内容 */}
      <div className="broker-content">
        {/* 持仓 */}
        {activeTab === 'positions' && (
          <div className="positions-section">
            {positions.length === 0 ? (
              <div className="empty-tip">暂无持仓（纸交易模式）</div>
            ) : (
              <div className="table-wrap">
                <table className="broker-table">
                  <thead>
                    <tr>
                      <th>代码</th>
                      <th>数量</th>
                      <th>成本价</th>
                      <th>最新价</th>
                      <th>浮盈</th>
                      <th>盈亏%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {positions.map(pos => (
                      <tr key={pos.code}>
                        <td><span className="stock-code">{pos.code}</span></td>
                        <td>{pos.quantity}</td>
                        <td>¥{fmt(pos.costPrice)}</td>
                        <td>¥{fmt(pos.currentPrice)}</td>
                        <td style={{ color: profitColor(pos.profit) }}>
                          {pos.profit >= 0 ? '+' : ''}¥{fmt(pos.profit)}
                        </td>
                        <td style={{ color: profitColor(pos.profitPct) }}>
                          {pos.profitPct >= 0 ? '+' : ''}{pos.profitPct?.toFixed(2)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* 委托 */}
        {activeTab === 'orders' && (
          <div className="orders-section">
            {orders.length === 0 ? (
              <div className="empty-tip">暂无委托记录</div>
            ) : (
              <div className="table-wrap">
                <table className="broker-table">
                  <thead>
                    <tr>
                      <th>编号</th>
                      <th>代码</th>
                      <th>方向</th>
                      <th>数量</th>
                      <th>价格</th>
                      <th>状态</th>
                      <th>时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map(ord => (
                      <tr key={ord.orderId}>
                        <td><span className="order-id">{ord.orderId.slice(0, 8)}...</span></td>
                        <td>{ord.code}</td>
                        <td>
                          <span className={`action-tag ${ord.action}`}>
                            {ord.action === 'buy' ? '买入' : '卖出'}
                          </span>
                        </td>
                        <td>{ord.quantity}</td>
                        <td>¥{fmt(ord.price)}</td>
                        <td>
                          <span className={`status-tag ${ord.status}`}>
                            {{ filled: '已成交', pending: '待成交', cancelled: '已撤销', failed: '失败' }[ord.status] || ord.status}
                          </span>
                        </td>
                        <td className="time-cell">{new Date(ord.createdAt).toLocaleTimeString('zh-CN')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* 下单 */}
        {activeTab === 'trade' && (
          <div className="trade-section">
            <div className="trade-card">
              <h3>模拟下单（纸交易）</h3>
              <form className="trade-form-broker" onSubmit={handleTrade}>
                <div className="form-row">
                  <label>股票代码</label>
                  <input
                    type="text"
                    placeholder="如 sh600519"
                    value={tradeForm.code}
                    onChange={e => setTradeForm(f => ({ ...f, code: e.target.value }))}
                    required
                  />
                </div>
                <div className="form-row">
                  <label>方向</label>
                  <div className="action-btns">
                    <button
                      type="button"
                      className={`action-btn buy ${tradeForm.action === 'buy' ? 'active' : ''}`}
                      onClick={() => setTradeForm(f => ({ ...f, action: 'buy' }))}
                    >买入</button>
                    <button
                      type="button"
                      className={`action-btn sell ${tradeForm.action === 'sell' ? 'active' : ''}`}
                      onClick={() => setTradeForm(f => ({ ...f, action: 'sell' }))}
                    >卖出</button>
                  </div>
                </div>
                <div className="form-row">
                  <label>数量（股）</label>
                  <input
                    type="number"
                    min={100}
                    step={100}
                    value={tradeForm.quantity}
                    onChange={e => setTradeForm(f => ({ ...f, quantity: e.target.value }))}
                    required
                  />
                </div>
                <div className="form-row">
                  <label>价格（元，0=市价）</label>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={tradeForm.price}
                    onChange={e => setTradeForm(f => ({ ...f, price: e.target.value }))}
                  />
                </div>
                <button type="submit" className={`submit-btn ${tradeForm.action}`} disabled={tradeLoading}>
                  {tradeLoading ? '提交中...' : `确认${tradeForm.action === 'buy' ? '买入' : '卖出'}`}
                </button>
              </form>
              {tradeMsg && (
                <div className={`trade-msg ${tradeMsg.type}`}>{tradeMsg.text}</div>
              )}
            </div>
          </div>
        )}

        {/* 实盘信号 */}
        {activeTab === 'signals' && (
          <div className="signals-section">
            <div className="signals-header">
              <span className={`ws-status ${connected ? 'online' : 'offline'}`}>
                {connected ? '🟢 WebSocket 已连接' : '🔴 WebSocket 断开（自动重连中）'}
              </span>
              {signals.length > 0 && (
                <button className="btn-clear" onClick={clearSignals}>清空</button>
              )}
            </div>
            {signals.length === 0 ? (
              <div className="empty-tip">
                暂无信号推送
                <br />
                <small>策略触发时，信号将实时出现在此处</small>
              </div>
            ) : (
              <div className="signal-list">
                {signals.map(sig => (
                  <div key={sig.id} className={`signal-item ${sig.action || 'info'}`}>
                    <div className="signal-top">
                      <span className="signal-stock">{sig.stock || sig.code || '未知标的'}</span>
                      <span className="signal-time">{new Date(sig.receivedAt).toLocaleTimeString('zh-CN')}</span>
                    </div>
                    <div className="signal-body">
                      {sig.message || sig.reason || JSON.stringify(sig)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default BrokerPanel;
