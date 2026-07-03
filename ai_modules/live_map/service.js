'use strict';

/**
 * 活地图业务编排层
 *
 * @module ai_modules/live_map/service
 */

const reportHandler = require('./report-handler');
const verificationEngine = require('./verification-engine');
const heatmapGenerator = require('./heatmap-generator');
const riskZone = require('./risk-zone');
const incentiveManager = require('./incentive-manager');
const liveMapEvents = require('./events');
const winston = require('winston');
const path = require('path');
const { pool } = require("../../config/database");

const logger = winston.createLogger({
  level: process.env.KUAILV_LOG_LEVEL || 'info',
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({
      filename: path.join(process.env.KUAILV_LOG_DIR || './logs', 'live-map.log'),
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
 * 提交路况上报（完整业务编排）
 *
 * 流程：
 * 1. 调用 reportHandler.submitReport 处理上报
 * 2. 如果首次上报 → 发放首次上报积分（5分）+ 图片积分（2分）
 * 3. 如果是合并确认 → 发放确认积分（3分）
 * 4. 如果达到阈值（threshold_reached）→ 触发验证引擎全量扫描
 * 5. 如果有新红区创建 → 发放触发红区积分（15分）
 * 6. 发布上报事件
 *
 * @param {Object} data - 上报数据
 * @returns {Promise<Object>} 完整上报结果
 */
async function submitReport(data) {
  const { rider_id: riderId, images } = data;
  const hasImage = images && images.length > 0;

  // 1. 处理上报（频率检查、去重、权重计算、写入）
  const reportResult = await reportHandler.submitReport(data);

  // 2. 发放积分
  let totalPoints = reportResult.points_earned || 0;

  if (reportResult.merged) {
    // 合并上报（二次确认）
    const incentiveResult = await incentiveManager.addPoints(
      riderId,
      'quick_confirm',
      reportResult.report_id,
      null,
      '快速确认路况上报',
    );
    totalPoints = incentiveResult.points || 3;
    reportResult.points_earned = totalPoints;
  } else {
    // 首次上报
    const incentiveResult = await incentiveManager.addPoints(
      riderId,
      'report_submitted',
      reportResult.report_id,
      null,
      '提交路况上报',
    );
    totalPoints = incentiveResult.points || 5;

    if (hasImage) {
      await incentiveManager.addPoints(
        riderId,
        'image_provided',
        reportResult.report_id,
        null,
        '附带图片证据',
      );
      totalPoints += 2;
    }

    reportResult.points_earned = totalPoints;
  }

  // 3. 发布上报提交事件
  liveMapEvents.emitReportSubmitted({
    report_id: reportResult.report_id,
    rider_id: riderId,
    report_type: data.report_type,
    location: { lng: data.lng, lat: data.lat },
  });

  // 4. 如果达到阈值，触发即时验证
  if (reportResult.threshold_reached) {
    logger.info(`上报 ${reportResult.report_id} 达到验证阈值，启动即时验证`);
    const conditions = await verificationEngine.scanPendingReports();

    if (conditions && conditions.length > 0) {
      reportResult.status = 'verified';
      reportResult.condition_id = conditions[0].id;
      reportResult.message = '路况已确认！配送区域已更新，影响区域内骑手将收到提醒。获得高价值激励！';

      // 发放触发红区积分（给所有参与的上报者）
      for (const condition of conditions) {
        await incentiveManager.addPoints(
          riderId,
          'condition_triggered',
          reportResult.report_id,
          condition.id,
          '上报触发红区',
        );
      }

      // 额外积分加成
      totalPoints += 15;
      reportResult.points_earned = totalPoints;
    }
  }

  return reportResult;
}

/**
 * 获取路况上报列表
 *
 * @param {Object} filters - 筛选条件
 * @returns {Promise<Object>}
 */
async function listReports(filters) {
  return reportHandler.listReports(filters);
}

/**
 * 获取热力图
 *
 * @param {string} bounds - 地图范围
 * @param {number} zoom - 缩放级别
 * @param {string} districtIds - 区域ID列表
 * @returns {Promise<Object>}
 */
async function getHeatmap(bounds, zoom, districtIds) {
  const ids = districtIds
    ? districtIds.split(',').map((s) => s.trim()).filter(Boolean)
    : null;
  return heatmapGenerator.getHeatmap(ids);
}

/**
 * 获取已验证路况列表
 *
 * @param {Object} filters - 筛选条件
 * @returns {Promise<Object>}
 */
async function listConditions(filters) {
  const connection = await pool.getConnection();
  try {
    const page = Math.max(1, filters.page || 1);
    const size = Math.min(100, Math.max(1, filters.size || 20));
    const offset = (page - 1) * size;

    const where = [];
    const params = [];

    if (filters.status !== undefined && filters.status !== null) {
      where.push('status = ?');
      params.push(filters.status);
    }
    if (filters.difficulty_level !== undefined && filters.difficulty_level !== null) {
      where.push('difficulty_level = ?');
      params.push(filters.difficulty_level);
    }

    const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';

    const [countResult] = await connection.query(
      `SELECT COUNT(*) AS total FROM ai_verified_conditions ${whereClause}`,
      params,
    );
    const total = countResult[0].total;

    const [items] = await connection.query(
      `SELECT * FROM ai_verified_conditions ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, size, offset],
    );

    return { total, page, size, items };
  } finally {
    connection.release();
  }
}

/**
 * 手动过期红区
 *
 * @param {number} conditionId - 红区ID
 * @returns {Promise<Object>}
 */
async function expireCondition(conditionId) {
  const result = await riskZone.expireCondition(conditionId);

  // 刷新热力图缓存
  await heatmapGenerator.refreshAllTiles();

  return result;
}

/**
 * 获取避让建议
 *
 * @param {number} fromLng - 起点经度
 * @param {number} fromLat - 起点纬度
 * @param {number} toLng - 终点经度
 * @param {number} toLat - 终点纬度
 * @param {number} [riderId] - 骑手ID
 * @returns {Promise<Object>}
 */
async function getAvoidAdvice(fromLng, fromLat, toLng, toLat, riderId) {
  const connection = await pool.getConnection();
  try {
    // 查询沿途活跃红区
    const [conditions] = await connection.query(
      'SELECT * FROM ai_verified_conditions WHERE status IN (0, 1)',
    );

    return riskZone.getAvoidAdvice(fromLng, fromLat, toLng, toLat, conditions);
  } finally {
    connection.release();
  }
}

/**
 * 获取统计仪表盘数据
 *
 * @param {string} [date] - 日期
 * @returns {Promise<Object>}
 */
async function getStats(date) {
  const connection = await pool.getConnection();
  try {
    const targetDate = date || new Date().toISOString().slice(0, 10);

    // 今日上报总数
    const [todayReports] = await connection.query(
      'SELECT COUNT(*) AS total FROM ai_road_reports WHERE DATE(created_at) = ?',
      [targetDate],
    );

    // 红区统计
    const [conditionStats] = await connection.query(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status = 0 THEN 1 ELSE 0 END) AS active,
         SUM(CASE WHEN status = 2 THEN 1 ELSE 0 END) AS expired
       FROM ai_verified_conditions`,
    );

    // 活跃骑手数
    const [activeRiders] = await connection.query(
      'SELECT COUNT(DISTINCT rider_id) AS cnt FROM ai_road_reports WHERE DATE(created_at) = ?',
      [targetDate],
    );

    // 类型分布
    const [typeDistribution] = await connection.query(
      `SELECT report_type, COUNT(*) AS count
       FROM ai_road_reports
       WHERE DATE(created_at) = ?
       GROUP BY report_type
       ORDER BY report_type`,
      [targetDate],
    );

    const typeLabels = { 1: '修路施工', 2: '封路禁行', 3: '电梯故障', 4: '小区门禁', 5: '道路拥堵', 6: '其他' };
    const totalReports = todayReports[0].total || 0;
    const typeDist = {};
    for (const row of typeDistribution) {
      typeDist[row.report_type] = {
        label: typeLabels[row.report_type] || '未知',
        count: row.count,
        percentage: totalReports > 0 ? +((row.count / totalReports) * 100).toFixed(1) : 0,
      };
    }

    // 等级分布
    const [levelDistribution] = await connection.query(
      `SELECT difficulty_level, COUNT(*) AS count
       FROM ai_verified_conditions
       WHERE status IN (0, 1)
       GROUP BY difficulty_level
       ORDER BY difficulty_level`,
    );

    const levelColors = { 0: 'green', 1: 'yellow', 2: 'orange', 3: 'red' };
    const levelDist = {};
    for (const row of levelDistribution) {
      levelDist[row.difficulty_level] = {
        color: levelColors[row.difficulty_level] || 'green',
        count: row.count,
      };
    }

    // Top 上报骑手
    const [topReporters] = await connection.query(
      `SELECT rider_id, COUNT(*) AS reports,
         SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) AS verified
       FROM ai_road_reports
       WHERE DATE(created_at) = ?
       GROUP BY rider_id
       ORDER BY reports DESC
       LIMIT 10`,
      [targetDate],
    );

    return {
      today_summary: {
        total_reports: totalReports,
        verified_conditions: conditionStats[0]?.active || 0,
        expired_conditions: conditionStats[0]?.expired || 0,
        active_conditions: conditionStats[0]?.active || 0,
        active_riders_participated: activeRiders[0]?.cnt || 0,
      },
      type_distribution: typeDist,
      level_distribution: levelDist,
      top_reporters: topReporters,
      updated_at: new Date().toISOString(),
    };
  } finally {
    connection.release();
  }
}

/**
 * 验证扫描（cron 钩子）
 *
 * @returns {Promise<Array>}
 */
async function scanPendingReports() {
  return verificationEngine.scanPendingReports();
}

/**
 * 刷新热力图（cron 钩子）
 *
 * @returns {Promise<Object>}
 */
async function refreshHeatmap() {
  return heatmapGenerator.refreshAllTiles();
}

/**
 * 过期红区扫描（cron 钩子）
 *
 * @returns {Promise<Object>}
 */
async function expireConditions() {
  return verificationEngine.expireConditions();
}

module.exports = {
  submitReport,
  listReports,
  getHeatmap,
  listConditions,
  expireCondition,
  getAvoidAdvice,
  getStats,
  scanPendingReports,
  refreshHeatmap,
  expireConditions,
};
