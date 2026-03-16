const axios = require('axios');

/**
 * 东方财富金融数据 API 封装
 * 支持两个接口：
 *  - 金融数据查询 (eastmoney_financial_data)
 *  - 智能选股 (eastmoney_select_stock)
 *
 * API Key 从环境变量 EASTMONEY_APIKEY 读取
 */

const EASTMONEY_BASE_URL = 'https://mkapi2.dfcfs.com/finskillshub/api/claw';

function getApiKey() {
  const key = process.env.EASTMONEY_APIKEY;
  if (!key) {
    throw new Error('EASTMONEY_APIKEY 环境变量未设置，请配置后重启服务');
  }
  return key;
}

/**
 * 东方财富金融数据查询（行情、财务、关系数据）
 * POST /query
 * @param {string} toolQuery - 自然语言查询，如"茅台最新股价"
 */
async function queryFinancialData(toolQuery) {
  const apiKey = getApiKey();
  const response = await axios.post(
    `${EASTMONEY_BASE_URL}/query`,
    { toolQuery },
    {
      headers: { 'Content-Type': 'application/json', apikey: apiKey },
      timeout: 15000,
    }
  );
  return response.data;
}

/**
 * 东方财富智能选股
 * POST /stock-screen
 * @param {string} keyword  - 自然语言选股条件
 * @param {number} pageNo   - 页码，默认1
 * @param {number} pageSize - 每页数量，默认20
 */
async function screenStocks(keyword, pageNo = 1, pageSize = 20) {
  const apiKey = getApiKey();
  const response = await axios.post(
    `${EASTMONEY_BASE_URL}/stock-screen`,
    { keyword, pageNo, pageSize },
    {
      headers: { 'Content-Type': 'application/json', apikey: apiKey },
      timeout: 15000,
    }
  );
  return response.data;
}

/**
 * 解析金融数据查询结果为标准化格式
 */
function parseFinancialDataResult(raw) {
  if (!raw || !raw.data || !raw.data.dataTableDTOList) {
    return { success: false, data: [], raw };
  }
  const tables = raw.data.dataTableDTOList.map((item) => ({
    code: item.code,
    entityName: item.entityName,
    title: item.title,
    indicators: item.nameMap || {},
    table: item.table || {},
    indicatorOrder: item.indicatorOrder || [],
  }));
  return { success: true, data: tables, raw };
}

/**
 * 解析选股结果为标准化格式
 */
function parseScreenResult(raw) {
  if (!raw || !raw.data || !raw.data.data || !raw.data.data.result) {
    return { success: false, total: 0, stocks: [], raw };
  }
  const result = raw.data.data.result;
  return {
    success: true,
    total: result.total || 0,
    columns: result.columns || [],
    stocks: result.dataList || [],
    raw,
  };
}

module.exports = {
  queryFinancialData,
  screenStocks,
  parseFinancialDataResult,
  parseScreenResult,
};
