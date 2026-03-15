/**
 * CapitalFlow.jsx - 个股资金流向图表组件
 * 展示主力/超大单/大单/中单/小单的净流入情况（ECharts 柱状图）
 * 
 * 数据来源：后端 /api/capital-flow/:code
 */

import React, { useEffect, useState, useRef } from 'react';
import * as echarts from 'echarts/core';
import { BarChart } from 'echarts/charts';
import {
  GridComponent, TooltipComponent, TitleComponent, LegendComponent
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

// 按需注册 ECharts 组件
echarts.use([BarChart, GridComponent, TooltipComponent, TitleComponent, LegendComponent, CanvasRenderer]);

/**
 * 格式化万元数值为亿元（保留2位小数）
 * @param {number} val - 金额（万元）
 * @returns {string}
 */
function toYi(val) {
  if (val == null || isNaN(val)) return '0.00';
  return (val / 1e4).toFixed(2);
}

/**
 * 资金流向组件
 * @param {string} code  - 股票代码（如 sh600519）
 * @param {string} name  - 股票名称（可选，用于标题）
 * @param {number} days  - 展示最近N天（默认5）
 */
export default function CapitalFlow({ code, name, days = 5 }) {
  const chartRef = useRef(null);        // ECharts 容器 DOM
  const chartInstance = useRef(null);   // ECharts 实例
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState(null);

  // 当 code 或 days 变化时重新拉数据
  useEffect(() => {
    if (!code) return;
    loadData();
  }, [code, days]);

  // 组件卸载时销毁 ECharts 实例
  useEffect(() => {
    return () => {
      if (chartInstance.current) {
        chartInstance.current.dispose();
        chartInstance.current = null;
      }
    };
  }, []);

  /**
   * 从后端接口拉取资金流向数据并渲染图表
   */
  async function loadData() {
    setLoading(true);
    setError('');
    try {
      const resp = await fetch(`/api/capital-flow/${code}?days=${days}`);
      const json = await resp.json();

      if (!json.success) {
        setError(json.error || '获取资金流向失败');
        return;
      }

      const { items = [], summary: sum = {} } = json.data || {};
      setSummary(sum);
      renderChart(items);
    } catch (e) {
      setError('网络请求失败：' + e.message);
    } finally {
      setLoading(false);
    }
  }

  /**
   * 使用 ECharts 渲染资金流向柱状图
   * @param {Array} items - 每日资金流向数组
   */
  function renderChart(items) {
    if (!chartRef.current) return;

    // 初始化或复用 ECharts 实例
    if (!chartInstance.current) {
      chartInstance.current = echarts.init(chartRef.current, 'dark');
    }
    const chart = chartInstance.current;

    if (!items || items.length === 0) {
      chart.clear();
      return;
    }

    // 提取各维度数据（转为亿元）
    const dates      = items.map(d => d.date);
    const mainNet    = items.map(d => parseFloat(toYi(d.main_net)));
    const superLarge = items.map(d => parseFloat(toYi(d.super_large_net)));
    const large      = items.map(d => parseFloat(toYi(d.large_net)));
    const mid        = items.map(d => parseFloat(toYi(d.mid_net)));
    const small      = items.map(d => parseFloat(toYi(d.small_net)));

    // 正流入为红色，负流出为绿色（A股配色习惯）
    const itemStyleFn = (params) => ({
      color: params.value >= 0 ? '#ef5350' : '#26a69a'
    });

    const option = {
      backgroundColor: 'transparent',
      title: {
        text: `${name || code} 资金流向（近${items.length}日）`,
        left: 'center',
        textStyle: { color: '#e0e0e0', fontSize: 14 }
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross' },
        formatter: (params) => {
          let html = `<b>${params[0].axisValue}</b><br/>`;
          params.forEach(p => {
            const color = p.value >= 0 ? '#ef5350' : '#26a69a';
            html += `<span style="color:${color}">■</span> ${p.seriesName}: ${p.value >= 0 ? '+' : ''}${p.value}亿<br/>`;
          });
          return html;
        }
      },
      legend: {
        bottom: 0,
        textStyle: { color: '#aaa' },
        data: ['主力净流入', '超大单', '大单', '中单', '小单（散户）']
      },
      grid: { left: '5%', right: '5%', top: '15%', bottom: '10%', containLabel: true },
      xAxis: {
        type: 'category',
        data: dates,
        axisLabel: { color: '#aaa', fontSize: 11 },
        axisLine: { lineStyle: { color: '#444' } }
      },
      yAxis: {
        type: 'value',
        name: '亿元',
        nameTextStyle: { color: '#aaa' },
        axisLabel: { color: '#aaa', formatter: (v) => `${v}亿` },
        splitLine: { lineStyle: { color: '#333' } }
      },
      series: [
        {
          name: '主力净流入',
          type: 'bar',
          data: mainNet,
          itemStyle: { color: (p) => p.value >= 0 ? '#ef5350' : '#26a69a' },
          barMaxWidth: 30
        },
        {
          name: '超大单',
          type: 'bar',
          data: superLarge,
          itemStyle: { color: (p) => p.value >= 0 ? '#ff7043' : '#4db6ac' },
          barMaxWidth: 30
        },
        {
          name: '大单',
          type: 'bar',
          data: large,
          itemStyle: { color: (p) => p.value >= 0 ? '#ffb300' : '#66bb6a' },
          barMaxWidth: 30
        },
        {
          name: '中单',
          type: 'bar',
          data: mid,
          itemStyle: { color: '#9e9e9e' },
          barMaxWidth: 30
        },
        {
          name: '小单（散户）',
          type: 'bar',
          data: small,
          itemStyle: { color: (p) => p.value >= 0 ? '#ab47bc' : '#5c6bc0' },
          barMaxWidth: 30
        }
      ]
    };

    chart.setOption(option, true);

    // 响应窗口大小变化
    const resizeHandler = () => chart.resize();
    window.removeEventListener('resize', resizeHandler);
    window.addEventListener('resize', resizeHandler);
  }

  // ── 渲染 ────────────────────────────────────────────────────────────
  return (
    <div style={{ width: '100%', padding: '12px 0' }}>
      {/* 顶部汇总信息 */}
      {summary && (
        <div style={{
          display: 'flex', gap: 24, marginBottom: 12,
          fontSize: 13, color: '#aaa', flexWrap: 'wrap'
        }}>
          <span>
            主力累计：
            <b style={{ color: (summary.main_net_total || 0) >= 0 ? '#ef5350' : '#26a69a' }}>
              {toYi(summary.main_net_total)}亿
            </b>
          </span>
          <span>趋势：<b style={{ color: '#e0e0e0' }}>{summary.main_trend || '--'}</b></span>
          <span>最新数据：<b style={{ color: '#e0e0e0' }}>{summary.latest_date || '--'}</b></span>
        </div>
      )}

      {/* 加载/错误状态 */}
      {loading && <div style={{ color: '#888', textAlign: 'center', padding: 20 }}>加载中...</div>}
      {error   && <div style={{ color: '#ef5350', padding: 10 }}>⚠ {error}</div>}

      {/* ECharts 图表容器 */}
      {!loading && !error && (
        <div
          ref={chartRef}
          style={{ width: '100%', height: 320, borderRadius: 8, overflow: 'hidden' }}
        />
      )}
    </div>
  );
}
