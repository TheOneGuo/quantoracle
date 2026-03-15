/**
 * ChipDistribution.jsx - 个股筹码分布图表组件
 * 展示获利盘/套牢盘/主力成本等筹码信息（ECharts 横向柱状图）
 * 
 * 数据来源：后端 /api/chip-distribution/:code
 */

import React, { useEffect, useState, useRef } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, LineChart } from 'echarts/charts';
import {
  GridComponent, TooltipComponent, TitleComponent,
  LegendComponent, MarkLineComponent
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

// 按需注册 ECharts 组件
echarts.use([
  BarChart, LineChart,
  GridComponent, TooltipComponent, TitleComponent,
  LegendComponent, MarkLineComponent,
  CanvasRenderer
]);

/**
 * 筹码分布组件
 * @param {string}  code         - 股票代码（如 sh600519）
 * @param {string}  name         - 股票名称（可选）
 * @param {number}  currentPrice - 当前价格（可选，用于标记获利/套牢分界线）
 */
export default function ChipDistribution({ code, name, currentPrice }) {
  const chartRef      = useRef(null);
  const chartInstance = useRef(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [chipData, setChipData] = useState(null);

  useEffect(() => {
    if (!code) return;
    loadData();
  }, [code]);

  // 卸载时销毁图表
  useEffect(() => {
    return () => {
      if (chartInstance.current) {
        chartInstance.current.dispose();
        chartInstance.current = null;
      }
    };
  }, []);

  /**
   * 从后端接口拉取筹码数据并渲染
   */
  async function loadData() {
    setLoading(true);
    setError('');
    try {
      const resp = await fetch(`/api/chip-distribution/${code}`);
      const json = await resp.json();

      if (!json.success) {
        setError(json.error || '获取筹码数据失败');
        return;
      }

      const data = json.data || {};
      setChipData(data);
      renderChart(data);
    } catch (e) {
      setError('网络请求失败：' + e.message);
    } finally {
      setLoading(false);
    }
  }

  /**
   * 渲染筹码分布横向柱状图
   * 用横向柱状图模拟筹码分布形态：
   * - Y轴为价格区间
   * - X轴为该价格区间筹码比例（%）
   * - 获利盘（当前价以下）用红色，套牢盘（以上）用绿色
   * 
   * 注：东方财富接口不返回每个价格点的筹码量，
   *     这里根据返回的统计指标模拟生成分布形态用于可视化
   * @param {Object} data - 筹码数据
   */
  function renderChart(data) {
    if (!chartRef.current) return;

    if (!chartInstance.current) {
      chartInstance.current = echarts.init(chartRef.current, 'dark');
    }
    const chart = chartInstance.current;

    const price   = currentPrice || data.current_price || data.avg_cost || 50;
    const avgCost = data.avg_cost || price;
    const mainCost = data.main_cost || price * 0.95;
    const retailCost = data.retail_cost || price * 1.02;
    const profitRatio = data.profit_ratio || 50;

    // 生成模拟筹码分布曲线（基于正态分布近似）
    // 价格区间：当前价上下 30%
    const priceMin = price * 0.70;
    const priceMax = price * 1.30;
    const steps    = 30;
    const stepSize = (priceMax - priceMin) / steps;

    const priceLabels = [];
    const chipValues  = [];
    const colors      = [];

    // 用双峰正态分布模拟筹码（主力成本区和散户成本区各一峰）
    function gauss(x, mu, sigma, weight) {
      return weight * Math.exp(-0.5 * ((x - mu) / sigma) ** 2);
    }

    for (let i = 0; i <= steps; i++) {
      const p = priceMin + i * stepSize;
      priceLabels.push(p.toFixed(2));

      // 两个峰：主力成本附近 + 散户成本附近
      const chip = gauss(p, mainCost, price * 0.04, 40)
                 + gauss(p, retailCost, price * 0.06, 30);
      chipValues.push(parseFloat(chip.toFixed(2)));

      // 当前价以下：红（获利盘），以上：绿（套牢盘）
      colors.push(p <= price ? '#ef5350' : '#26a69a');
    }

    const option = {
      backgroundColor: 'transparent',
      title: {
        text: `${name || code} 筹码分布`,
        subtext: `获利盘 ${profitRatio.toFixed(1)}%  · 平均成本 ${avgCost.toFixed(2)}元`,
        left: 'center',
        textStyle: { color: '#e0e0e0', fontSize: 14 },
        subtextStyle: { color: '#aaa', fontSize: 12 }
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params) => {
          const p = parseFloat(params[0].axisValue);
          const isProfit = p <= price;
          return `价格：${p.toFixed(2)}元<br/>
                  状态：${isProfit ? '<span style="color:#ef5350">获利盘</span>' : '<span style="color:#26a69a">套牢盘</span>'}<br/>
                  筹码密度：${params[0].value.toFixed(2)}%`;
        }
      },
      grid: { left: '8%', right: '5%', top: '20%', bottom: '8%', containLabel: true },
      xAxis: {
        type: 'value',
        name: '筹码密度(%)',
        nameTextStyle: { color: '#aaa' },
        axisLabel: { color: '#aaa' },
        splitLine: { lineStyle: { color: '#333' } }
      },
      yAxis: {
        type: 'category',
        data: priceLabels,
        name: '价格(元)',
        nameTextStyle: { color: '#aaa' },
        axisLabel: { color: '#aaa', fontSize: 10 },
        axisLine: { lineStyle: { color: '#444' } }
      },
      series: [
        {
          name: '筹码分布',
          type: 'bar',
          data: chipValues.map((v, i) => ({
            value: v,
            itemStyle: { color: colors[i] }
          })),
          barWidth: '80%',
          // 在当前价、主力成本、散户成本处画标注线
          markLine: {
            symbol: 'none',
            lineStyle: { width: 1.5 },
            label: { fontSize: 11 },
            data: [
              {
                // 当前价标注
                yAxis: price.toFixed(2),
                lineStyle: { color: '#ffd54f', type: 'solid' },
                label: { formatter: `当前价 ${price.toFixed(2)}`, color: '#ffd54f', position: 'end' }
              },
              {
                // 主力成本标注
                yAxis: mainCost.toFixed(2),
                lineStyle: { color: '#ff7043', type: 'dashed' },
                label: { formatter: `主力成本 ${mainCost.toFixed(2)}`, color: '#ff7043', position: 'end' }
              },
              {
                // 散户成本标注
                yAxis: retailCost.toFixed(2),
                lineStyle: { color: '#42a5f5', type: 'dashed' },
                label: { formatter: `散户成本 ${retailCost.toFixed(2)}`, color: '#42a5f5', position: 'end' }
              }
            ]
          }
        }
      ]
    };

    chart.setOption(option, true);

    const resizeHandler = () => chart.resize();
    window.removeEventListener('resize', resizeHandler);
    window.addEventListener('resize', resizeHandler);
  }

  // ── 渲染 ────────────────────────────────────────────────────────────
  return (
    <div style={{ width: '100%', padding: '12px 0' }}>
      {/* 顶部关键指标卡片 */}
      {chipData && (
        <div style={{
          display: 'flex', gap: 16, marginBottom: 12,
          flexWrap: 'wrap', fontSize: 13
        }}>
          <MetricCard
            label="获利盘"
            value={`${(chipData.profit_ratio || 0).toFixed(1)}%`}
            color={(chipData.profit_ratio || 0) > 50 ? '#ef5350' : '#26a69a'}
          />
          <MetricCard label="平均成本" value={`${(chipData.avg_cost || 0).toFixed(2)}元`} />
          <MetricCard label="主力成本" value={`${(chipData.main_cost || 0).toFixed(2)}元`} color="#ff7043" />
          <MetricCard label="散户成本" value={`${(chipData.retail_cost || 0).toFixed(2)}元`} color="#42a5f5" />
          {chipData.concentration_90 && (
            <MetricCard label="90%集中区" value={`±${(chipData.concentration_90 / 2).toFixed(2)}元`} />
          )}
          <span style={{ color: '#666', alignSelf: 'center', fontSize: 11 }}>
            数据：{chipData.source || '东方财富'}
            {!chipData.is_real_data && ' (模拟)'}
          </span>
        </div>
      )}

      {/* 加载/错误状态 */}
      {loading && <div style={{ color: '#888', textAlign: 'center', padding: 20 }}>加载中...</div>}
      {error   && <div style={{ color: '#ef5350', padding: 10 }}>⚠ {error}</div>}

      {/* ECharts 图表 */}
      {!loading && !error && (
        <div
          ref={chartRef}
          style={{ width: '100%', height: 380, borderRadius: 8, overflow: 'hidden' }}
        />
      )}
    </div>
  );
}

/**
 * 指标卡片子组件
 * @param {string} label - 标签
 * @param {string} value - 值
 * @param {string} color - 颜色
 */
function MetricCard({ label, value, color = '#e0e0e0' }) {
  return (
    <div style={{
      background: '#1e1e1e', borderRadius: 6, padding: '6px 12px',
      border: '1px solid #333', minWidth: 100
    }}>
      <div style={{ color: '#888', fontSize: 11, marginBottom: 2 }}>{label}</div>
      <div style={{ color, fontWeight: 600, fontSize: 14 }}>{value}</div>
    </div>
  );
}
