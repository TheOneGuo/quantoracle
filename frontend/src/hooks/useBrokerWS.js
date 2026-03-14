/**
 * @file useBrokerWS.js
 * @description 实盘信号 WebSocket Hook（M5 P2）
 * 自动连接后端 WebSocket，接收策略信号并通知前端。
 */

import { useEffect, useRef, useState, useCallback } from 'react';

const WS_URL = 'ws://localhost:3001/ws';

/**
 * 实盘信号 WebSocket Hook
 * @returns {{
 *   signals: Array,
 *   connected: boolean,
 *   clearSignals: Function
 * }}
 */
export function useBrokerWS() {
  const [signals, setSignals] = useState([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef(null);
  const retryRef = useRef(null);

  const connect = useCallback(() => {
    try {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        console.log('[BrokerWS] 连接成功');
        if (retryRef.current) {
          clearTimeout(retryRef.current);
          retryRef.current = null;
        }
      };

      ws.onmessage = (evt) => {
        try {
          const data = JSON.parse(evt.data);
          if (data.type === 'signal' || data.type === 'trade_signal') {
            setSignals(prev => [
              { ...data, id: Date.now(), receivedAt: new Date().toISOString() },
              ...prev.slice(0, 49), // 最多保留 50 条
            ]);
          }
        } catch (e) {
          console.warn('[BrokerWS] 消息解析失败:', e);
        }
      };

      ws.onclose = () => {
        setConnected(false);
        console.log('[BrokerWS] 连接断开，5s 后重连...');
        retryRef.current = setTimeout(connect, 5000);
      };

      ws.onerror = (err) => {
        console.warn('[BrokerWS] 连接错误:', err.message);
      };
    } catch (e) {
      console.warn('[BrokerWS] 无法建立连接:', e);
    }
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (retryRef.current) clearTimeout(retryRef.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, [connect]);

  /** 清空信号列表 */
  const clearSignals = useCallback(() => setSignals([]), []);

  return { signals, connected, clearSignals };
}
