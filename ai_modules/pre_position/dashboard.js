'use strict';

/**
 * 预置运力效果仪表盘
 *
 * @module ai_modules/pre_position/dashboard
 */

const mysql = require('mysql2/promise');
const config = require('../../config/ai_modules');
const winston = require('winston');
const path = require('path');

const logger = winston.createLogger({
  level: process.env.KUAILV_LOG_LEVEL || 'info',
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({
      filename: path.join(process.env.KUAILV_LOG_DIR || './logs', 'pre-position.log'),
      maxSize: '10m',
      maxFiles: 7,
    }),
  ],
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message }) => {
      return `[${timestamp}] [${level.toUpperCase()}] ${message}`;
    }),
  ),
});

/**
 * 获取仪表盘聚合数据
 *
 * @param {string} startDate - 开始日期 YYYY-MM-DD
 * @param {string} endDate - 结束日期 YYYY-MM-DD
 * @param {string} [districtIds] - 区域ID列表（逗号分隔）
 * @returns {Promise<Object>} DashboardData
 */
async function getDashboard(startDate, endDate, districtIds) {
  const connection = await mysql.createConnection(config.db);
  try {
    // 查询预测统计数据
    let predictionQuery = `
      SELECT
        COUNT(*) AS total_predictions,
        SUM(CASE WHEN is_hit = 1 THEN 1 ELSE 0 END) AS hit_count,
        SUM(CASE WHEN is_hit IS NOT NULL THEN accuracy ELSE 0 END) AS total_accuracy,
        SUM(CASE WHEN is_hit IS NOT NULL THEN 1 ELSE 0 END) AS accuracy_count,
        SUM(CASE WHEN intensity >= 2 THEN 1 ELSE 0 END) AS dispatched_predictions
      FROM ai_surge_predictions
      WHERE predicted_at >= ? AND predicted_at < DATE_ADD(?, INTERVAL 1 DAY)
    `;
    const params = [startDate, endDate];

    if (districtIds) {
      const ids = districtIds.split(',').map(Number).filter((n) => !isNaN(n));
      if (ids.length > 0) {
        predictionQuery += ` AND district_id IN (${ids.map(() => '?').join(',')})`;
        params.push(...ids);
      }
    }

    const [predictionStats] = await connection.query(predictionQuery, params);
    const stats = predictionStats[0];

    // 查询调度统计
    let dispatchQuery = `
      SELECT
        COUNT(*) AS total_dispatches,
        SUM(CASE WHEN dr.status IN (1,2,3,6) THEN 1 ELSE 0 END) AS accepted_dispatches,
        SUM(CASE WHEN dr.status IN (2,6) THEN 1 ELSE 0 END) AS arrived_count,
        SUM(dr.incentive_total) AS total_incentive_cost
      FROM ai_dispatch_records dr
      JOIN ai_surge_predictions sp ON dr.prediction_id = sp.id
      WHERE sp.predicted_at >= ? AND sp.predicted_at < DATE_ADD(?, INTERVAL 1 DAY)
    `;
    const dispatchParams = [startDate, endDate];

    if (districtIds) {
      const ids = districtIds.split(',').map(Number).filter((n) => !isNaN(n));
      if (ids.length > 0) {
        dispatchQuery += ` AND dr.target_district_id IN (${ids.map(() => '?').join(',')})`;
        dispatchParams.push(...ids);
      }
    }

    const [dispatchStats] = await connection.query(dispatchQuery, dispatchParams);
    const dispatchData = dispatchStats[0];

    const totalPredictions = stats.total_predictions || 0;
    const hitCount = stats.hit_count || 0;
    const hitRate = totalPredictions > 0 ? parseFloat(((hitCount / totalPredictions) * 100).toFixed(1)) : 0;
    const avgAccuracy = stats.accuracy_count > 0
      ? parseFloat(((stats.total_accuracy || 0) / stats.accuracy_count).toFixed(1))
      : 0;
    const totalDispatches = dispatchData.total_dispatches || 0;
    const acceptedDispatches = dispatchData.accepted_dispatches || 0;
    const arrivedCount = dispatchData.arrived_count || 0;
    const acceptRate = totalDispatches > 0
      ? parseFloat(((acceptedDispatches / totalDispatches) * 100).toFixed(1))
      : 0;
    const arrivalRate = acceptedDispatches > 0
      ? parseFloat(((arrivedCount / acceptedDispatches) * 100).toFixed(1))
      : 0;
    const totalIncentiveCost = parseFloat((dispatchData.total_incentive_cost || 0).toFixed(2));
    const avgIncentivePerDispatch = totalDispatches > 0
      ? parseFloat((totalIncentiveCost / totalDispatches).toFixed(2))
      : 0;

    // 日趋势
    const dailyTrend = await _getDailyTrend(connection, startDate, endDate, districtIds);

    // 强度分布
    const intensityBreakdown = await _getIntensityBreakdown(connection, startDate, endDate, districtIds);

    // 区域排行
    const districtRanking = await _getDistrictRanking(connection, startDate, endDate, districtIds);

    // 效果对比（模拟数据）
    const effectivenessComparison = {
      pre_position_zones: {
        avg_delivery_time_min: 22,
        avg_arrival_time_min: 8,
        timeout_rate: 5.2,
      },
      non_pre_position_zones: {
        avg_delivery_time_min: 30,
        avg_arrival_time_min: 15,
        timeout_rate: 8.5,
      },
      improvement: {
        delivery_time_reduction_pct: parseFloat((((30 - 22) / 30) * 100).toFixed(1)),
        arrival_time_reduction_pct: parseFloat((((15 - 8) / 15) * 100).toFixed(1)),
        timeout_rate_reduction_pct: parseFloat((((8.5 - 5.2) / 8.5) * 100).toFixed(1)),
      },
    };

    return {
      summary: {
        total_predictions: totalPredictions,
        hit_count: hitCount,
        hit_rate: hitRate,
        avg_accuracy: avgAccuracy,
        total_dispatches: totalDispatches,
        accepted_dispatches: acceptedDispatches,
        accept_rate: acceptRate,
        arrival_rate: arrivalRate,
        total_incentive_cost: totalIncentiveCost,
        avg_incentive_per_dispatch: avgIncentivePerDispatch,
      },
      daily_trend: dailyTrend,
      intensity_breakdown: intensityBreakdown,
      district_ranking: districtRanking,
      effectiveness_comparison: effectivenessComparison,
      updated_at: new Date().toISOString(),
    };
  } finally {
    await connection.end();
  }
}

/**
 * 获取日趋势数据
 *
 * @private
 */
async function _getDailyTrend(connection, startDate, endDate, districtIds) {
  let query = `
    SELECT
      DATE(predicted_at) AS date,
      SUM(CASE WHEN is_hit = 1 THEN 1 ELSE 0 END) / COUNT(*) * 100 AS hit_rate,
      AVG(CASE WHEN accuracy IS NOT NULL THEN accuracy ELSE NULL END) AS avg_accuracy
    FROM ai_surge_predictions
    WHERE predicted_at >= ? AND predicted_at < DATE_ADD(?, INTERVAL 1 DAY)
  `;
  const params = [startDate, endDate];

  if (districtIds) {
    const ids = districtIds.split(',').map(Number).filter((n) => !isNaN(n));
    if (ids.length > 0) {
      query += ` AND district_id IN (${ids.map(() => '?').join(',')})`;
      params.push(...ids);
    }
  }

  query += ' GROUP BY DATE(predicted_at) ORDER BY date ASC';

  const [rows] = await connection.query(query, params);
  return rows.map((r) => ({
    date: r.date,
    hit_rate: parseFloat((r.hit_rate || 0).toFixed(1)),
    avg_accuracy: parseFloat((r.avg_accuracy || 0).toFixed(1)),
  }));
}

/**
 * 获取强度分布数据
 *
 * @private
 */
async function _getIntensityBreakdown(connection, startDate, endDate, districtIds) {
  let query = `
    SELECT intensity,
      COUNT(*) AS count,
      SUM(CASE WHEN is_hit = 1 THEN 1 ELSE 0 END) / COUNT(*) * 100 AS hit_rate
    FROM ai_surge_predictions
    WHERE predicted_at >= ? AND predicted_at < DATE_ADD(?, INTERVAL 1 DAY)
  `;
  const params = [startDate, endDate];

  if (districtIds) {
    const ids = districtIds.split(',').map(Number).filter((n) => !isNaN(n));
    if (ids.length > 0) {
      query += ` AND district_id IN (${ids.map(() => '?').join(',')})`;
      params.push(...ids);
    }
  }

  query += ' GROUP BY intensity ORDER BY intensity ASC';

  const [rows] = await connection.query(query, params);
  return rows.map((r) => ({
    intensity: r.intensity,
    count: r.count,
    hit_rate: parseFloat((r.hit_rate || 0).toFixed(1)),
  }));
}

/**
 * 获取区域排行数据
 *
 * @private
 */
async function _getDistrictRanking(connection, startDate, endDate, districtIds) {
  let query = `
    SELECT
      sp.district_id,
      COUNT(*) AS prediction_count,
      SUM(CASE WHEN sp.is_hit = 1 THEN 1 ELSE 0 END) / COUNT(*) * 100 AS hit_rate,
      AVG(CASE WHEN sp.accuracy IS NOT NULL THEN sp.accuracy ELSE NULL END) AS avg_accuracy,
      COUNT(dr.id) AS dispatch_count,
      AVG(dr.incentive_total) AS avg_incentive
    FROM ai_surge_predictions sp
    LEFT JOIN ai_dispatch_records dr ON dr.prediction_id = sp.id
    WHERE sp.predicted_at >= ? AND sp.predicted_at < DATE_ADD(?, INTERVAL 1 DAY)
  `;
  const params = [startDate, endDate];

  if (districtIds) {
    const ids = districtIds.split(',').map(Number).filter((n) => !isNaN(n));
    if (ids.length > 0) {
      query += ` AND sp.district_id IN (${ids.map(() => '?').join(',')})`;
      params.push(...ids);
    }
  }

  query += ' GROUP BY sp.district_id ORDER BY hit_rate DESC';

  const [rows] = await connection.query(query, params);
  return rows.map((r) => ({
    district_id: r.district_id,
    district_name: `区域${r.district_id}`,
    hit_rate: parseFloat((r.hit_rate || 0).toFixed(1)),
    avg_accuracy: parseFloat((r.avg_accuracy || 0).toFixed(1)),
    dispatch_count: r.dispatch_count || 0,
    avg_incentive: parseFloat((r.avg_incentive || 0).toFixed(2)),
  }));
}

module.exports = {
  getDashboard,
};
