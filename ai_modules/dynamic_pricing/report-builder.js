'use strict';

/**
 * 价格影响分析报表
 *
 * 按区域/时段/天气等级交叉分析定价效果，
 * 提供柱状图数据 + CSV 导出 + 每日自动快照
 *
 * @module ai_modules/dynamic_pricing/report-builder
 */

const mysql = require('mysql2/promise');
const config = require('../../config/ai_modules');

/**
 * 获取数据库连接
 *
 * @returns {Promise<import('mysql2/promise').Connection>}
 * @private
 */
async function _getConnection() {
  return pool.getConnection();
}

/**
 * 按区域维度分析
 *
 * @param {string} startDate - 开始日期 (YYYY-MM-DD)
 * @param {string} endDate - 结束日期 (YYYY-MM-DD)
 * @returns {Promise<Object[]>}
 * @private
 */
async function _analysisByDistrict(startDate, endDate) {
  const connection = await _getConnection();
  try {
    const [rows] = await connection.query(
      `SELECT
        pl.district_id,
        COALESCE(d.name, CONCAT('区域', pl.district_id)) AS district_name,
        COUNT(*) AS order_count,
        ROUND(AVG(pl.final_fee), 2) AS avg_fee,
        ROUND(AVG(pl.surge_amount), 2) AS avg_surge,
        ROUND(SUM(CASE WHEN pl.surge_amount > 0 THEN 1 ELSE 0 END) / COUNT(*), 4) AS surge_order_ratio,
        ROUND(AVG(COALESCE(o.cancel_rate, 0)), 4) AS cancel_rate
      FROM ai_price_logs pl
      LEFT JOIN districts d ON d.id = pl.district_id
      LEFT JOIN (
        SELECT order_id, 1 AS cancel_rate FROM orders WHERE status = 'cancelled'
      ) o ON o.order_id = pl.order_id
      WHERE DATE(pl.created_at) >= ? AND DATE(pl.created_at) <= ?
      GROUP BY pl.district_id, district_name
      ORDER BY avg_surge DESC`,
      [startDate, endDate],
    );

    return rows.map((row) => ({
      district_id: row.district_id,
      district_name: row.district_name,
      order_count: row.order_count,
      avg_fee: row.avg_fee,
      avg_surge: row.avg_surge,
      surge_order_ratio: +((row.surge_order_ratio ?? 0).toFixed(2)),
      cancel_rate: +((row.cancel_rate ?? 0).toFixed(4)),
    }));
  } finally {
    connection.release();
  }
}

/**
 * 按时段维度分析
 *
 * @param {string} startDate
 * @param {string} endDate
 * @returns {Promise<Object[]>}
 * @private
 */
async function _analysisByTimeSlot(startDate, endDate) {
  const connection = await _getConnection();
  try {
    const [rows] = await connection.query(
      `SELECT
        CASE
          WHEN HOUR(created_at) >= 6 AND HOUR(created_at) < 9 THEN '早餐'
          WHEN HOUR(created_at) >= 11 AND HOUR(created_at) < 14 THEN '午餐'
          WHEN HOUR(created_at) >= 14 AND HOUR(created_at) < 17 THEN '下午茶'
          WHEN HOUR(created_at) >= 17 AND HOUR(created_at) < 21 THEN '晚餐'
          WHEN HOUR(created_at) >= 21 OR HOUR(created_at) < 6 THEN '夜宵'
          ELSE '其他'
        END AS time_slot,
        COUNT(*) AS order_count,
        ROUND(AVG(final_fee), 2) AS avg_fee,
        ROUND(AVG(surge_amount), 2) AS avg_surge,
        ROUND(SUM(CASE WHEN surge_amount > 0 THEN 1 ELSE 0 END) / COUNT(*), 4) AS surge_order_ratio
      FROM ai_price_logs
      WHERE DATE(created_at) >= ? AND DATE(created_at) <= ?
      GROUP BY time_slot
      ORDER BY FIELD(time_slot, '早餐','午餐','下午茶','晚餐','夜宵','其他')`,
      [startDate, endDate],
    );

    return rows.map((row) => ({
      time_slot: row.time_slot,
      order_count: row.order_count,
      avg_fee: row.avg_fee,
      avg_surge: row.avg_surge,
      surge_order_ratio: +((row.surge_order_ratio ?? 0).toFixed(2)),
    }));
  } finally {
    connection.release();
  }
}

/**
 * 按天气等级维度分析
 *
 * @param {string} startDate
 * @param {string} endDate
 * @returns {Promise<Object[]>}
 * @private
 */
async function _analysisByWeather(startDate, endDate) {
  const connection = await _getConnection();
  try {
    const [rows] = await connection.query(
      `SELECT
        COALESCE(weather_condition, 'unknown') AS weather_condition,
        COUNT(*) AS order_count,
        ROUND(AVG(final_fee), 2) AS avg_fee,
        ROUND(AVG(surge_amount), 2) AS avg_surge,
        ROUND(AVG(weather_factor), 4) AS avg_weather_factor,
        ROUND(SUM(CASE WHEN surge_amount > 0 THEN 1 ELSE 0 END) / COUNT(*), 4) AS surge_order_ratio
      FROM ai_price_logs
      WHERE DATE(created_at) >= ? AND DATE(created_at) <= ?
      GROUP BY weather_condition
      ORDER BY avg_surge DESC`,
      [startDate, endDate],
    );

    return rows.map((row) => ({
      weather_condition: row.weather_condition,
      order_count: row.order_count,
      avg_fee: row.avg_fee,
      avg_surge: row.avg_surge,
      avg_weather_factor: row.avg_weather_factor,
      surge_order_ratio: +((row.surge_order_ratio ?? 0).toFixed(2)),
    }));
  } finally {
    connection.release();
  }
}

/**
 * 获取聚合概要数据
 *
 * @param {string} startDate
 * @param {string} endDate
 * @returns {Promise<Object>}
 * @private
 */
async function _getSummary(startDate, endDate) {
  const connection = await _getConnection();
  try {
    const [rows] = await connection.query(
      `SELECT
        COUNT(*) AS total_orders,
        ROUND(AVG(final_fee), 2) AS avg_fee,
        ROUND(AVG(surge_amount), 2) AS avg_surge,
        ROUND(SUM(CASE WHEN surge_amount > 0 THEN 1 ELSE 0 END) / COUNT(*), 4) AS surge_order_ratio
      FROM ai_price_logs
      WHERE DATE(created_at) >= ? AND DATE(created_at) <= ?`,
      [startDate, endDate],
    );

    return {
      total_orders: (rows[0]?.total_orders ?? 0),
      avg_fee: (rows[0]?.avg_fee ?? 0),
      avg_surge: (rows[0]?.avg_surge ?? 0),
      surge_order_ratio: +((rows[0]?.surge_order_ratio ?? 0).toFixed(2)),
    };
  } finally {
    connection.release();
  }
}

/**
 * 获取价格影响分析报表
 *
 * @param {string} dimension - 分析维度: 'district' | 'time_slot' | 'weather'
 * @param {string} startDate - 开始日期 (YYYY-MM-DD)
 * @param {string} endDate - 结束日期 (YYYY-MM-DD)
 * @returns {Promise<Object>}
 */
async function getReport(dimension, startDate, endDate) {
  const summary = await _getSummary(startDate, endDate);

  let details;
  switch (dimension) {
    case 'time_slot':
      details = await _analysisByTimeSlot(startDate, endDate);
      break;
    case 'weather':
      details = await _analysisByWeather(startDate, endDate);
      break;
    case 'district':
    default:
      details = await _analysisByDistrict(startDate, endDate);
      break;
  }

  return {
    dimension,
    period: { start: startDate, end: endDate },
    summary,
    details,
  };
}

/**
 * 将报表导出为 CSV 格式
 *
 * @param {Object} report - 报表数据
 * @returns {Promise<string>} CSV 内容
 */
async function exportCSV(report) {
  const lines = [];

  // CSV 头部
  lines.push(`维度: ${report.dimension}, 周期: ${report.period.start} ~ ${report.period.end}`);
  lines.push('');

  // 概要
  lines.push('指标, 值');
  lines.push(`总订单数, ${report.summary.total_orders}`);
  lines.push(`平均配送费, ${report.summary.avg_fee}`);
  lines.push(`平均浮动金额, ${report.summary.avg_surge}`);
  lines.push(`浮动订单占比, ${report.summary.surge_order_ratio}`);
  lines.push('');

  // 明细表头
  if (report.details.length > 0) {
    const headers = Object.keys(report.details[0]);
    lines.push(headers.join(', '));

    for (const row of report.details) {
      const values = headers.map((h) => row[h] !== null && row[h] !== undefined ? row[h] : '');
      lines.push(values.join(', '));
    }
  }

  return lines.join('\n');
}

/**
 * 生成每日自动快照
 * cron 每日凌晨 3:00 调用
 *
 * @returns {Promise<Object>}
 */
async function generateDailySnapshot() {
  const yesterday = new Date(Date.now() - 86400000);
  const dateStr = yesterday.toISOString().slice(0, 10);

  const report = await getReport('district', dateStr, dateStr);

  // 可将快照保存到报表表或文件中
  // 此处仅返回数据，由调用方决定存储方式

  return {
    date: dateStr,
    report,
    generatedAt: new Date().toISOString(),
  };
}

const reportBuilder = {
  getReport,
  exportCSV,
  generateDailySnapshot,
};

module.exports = { reportBuilder };
