/**
 * ========================================
 * 盐阜配送 - Yanfu Delivery
 * ========================================
 * © 中哥  All Rights Reserved
 * FP_UUID_31adb5871aea40b8b0c288773f094ab2|FP_AUTHOR_中哥_SN_20260531|FP_HASH_20260531B9F3|FP_ORIGIN_2026_AUTHOR_中哥
 * ========================================
 * 严禁未经授权转载、商用，商用需联系作者授权
 * 遵循开源协议，仅限项目内部使用，商用需联系本人授权
 * ========================================
 */

'use strict';

/**
 * 上报处理核心逻辑
 *
 * @module ai_modules/live_map/report-handler
 */

const mysql = require('mysql2/promise');
const config = require('../../config/ai_modules');
const { getErrorByCode } = require('../../config/error_codes');
const winston = require('winston');
const path = require('path');

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
 * 信用等级权重映射
 */
const CREDIT_WEIGHT_MAP = {
  'newbie': 0.6,
  'bronze': 0.8,
  'silver': 0.9,
  'gold': 1.0,
  'diamond': 1.2,
};

const LM_CONFIG = config.liveMap || {};

/**
 * 获取数据库连接
 *
 * @returns {Promise<import('mysql2/promise').Connection>}
 * @private
 */
async function _getConnection() {
  return mysql.createConnection(config.db);
}

/**
 * 根据 GPS 精度计算精度权重
 *
 * @param {number} gpsAccuracy - GPS 精度（米）
 * @returns {number} 精度权重 (0.7~1.0)
 */
function _getGpsWeight(gpsAccuracy) {
  if (gpsAccuracy <= 10) return 1.0;
  if (gpsAccuracy <= 30) return 0.9;
  if (gpsAccuracy <= 50) return 0.8;
  return 0.7;
}

/**
 * 计算上报信任权重
 *
 * w = rider_credit_weight × gps_accuracy_weight × evidence_weight
 *
 * @param {string|number} creditLevel - 骑手信用等级标识
 * @param {number} gpsAccuracy - GPS 精度（米）
 * @param {boolean} hasImage - 是否有图片
 * @returns {number} 权重值（保留4位小数）
 */
function calculateWeight(creditLevel, gpsAccuracy, hasImage) {
  const creditKey = typeof creditLevel === 'number'
    ? ['newbie', 'bronze', 'silver', 'gold', 'diamond'][creditLevel] || 'bronze'
    : creditLevel;

  const creditWeight = CREDIT_WEIGHT_MAP[creditKey] || 1.0;
  const gpsWeight = _getGpsWeight(gpsAccuracy);
  const evidenceWeight = hasImage ? 1.2 : 1.0;

  return +(creditWeight * gpsWeight * evidenceWeight).toFixed(4);
}

/**
 * 查询骑手信用等级（从 credit_passport 模块的 ai_rider_credits 表）
 *
 * @param {import('mysql2/promise').Connection} connection
 * @param {number} riderId - 骑手ID
 * @returns {Promise<{ creditLevel: number, levelName: string, totalOrders: number }>}
 */
async function _getRiderCreditLevel(connection, riderId) {
  const [rows] = await connection.query(
    'SELECT level, total_score, total_orders FROM ai_rider_credits WHERE rider_id = ?',
    [riderId],
  );

  if (rows.length === 0) {
    return { creditLevel: 0, levelName: 'newbie', totalOrders: 0 };
  }

  const row = rows[0];
  const totalOrders = row.total_orders || 0;

  // 新骑手判定（总订单数 < 50）
  if (totalOrders < (LM_CONFIG.newRiderOrderThreshold || 50)) {
    return { creditLevel: 0, levelName: 'newbie', totalOrders };
  }

  return { creditLevel: row.level || 1, levelName: 'bronze', totalOrders };
}

/**
 * 检查频率限制：同分类 5 分钟内最多 1 条
 *
 * @param {import('mysql2/promise').Connection} connection
 * @param {number} riderId - 骑手ID
 * @param {number} reportType - 路况类型
 * @returns {Promise<{ allowed: boolean, nextAvailableAt: string|null }>}
 */
async function _checkFrequencyLimit(connection, riderId, reportType) {
  const rateLimitSeconds = LM_CONFIG.rateLimitSeconds || 300;

  const [rows] = await connection.query(
    `SELECT created_at FROM ai_road_reports
     WHERE rider_id = ? AND report_type = ?
     ORDER BY created_at DESC LIMIT 1`,
    [riderId, reportType],
  );

  if (rows.length === 0) {
    return { allowed: true, nextAvailableAt: null };
  }

  const lastReportAt = new Date(rows[0].created_at).getTime();
  const now = Date.now();
  const elapsed = (now - lastReportAt) / 1000;

  if (elapsed < rateLimitSeconds) {
    const nextAvailableAt = new Date(lastReportAt + rateLimitSeconds * 1000).toISOString();
    return { allowed: false, nextAvailableAt };
  }

  return { allowed: true, nextAvailableAt: null };
}

/**
 * 检查单日上限
 *
 * @param {import('mysql2/promise').Connection} connection
 * @param {number} riderId - 骑手ID
 * @returns {Promise<{ allowed: boolean, dailyCount: number, dailyRemaining: number }>}
 */
async function _checkDailyLimit(connection, riderId) {
  const maxDaily = LM_CONFIG.maxDailyReports || 20;
  const newRiderLimit = LM_CONFIG.newRiderDailyLimit || 5;

  const today = new Date().toISOString().slice(0, 10);

  const [rows] = await connection.query(
    `SELECT COUNT(*) AS cnt FROM ai_road_reports
     WHERE rider_id = ? AND DATE(created_at) = ?`,
    [riderId, today],
  );

  const dailyCount = rows[0].cnt;

  // 检查是否是新手（通过总订单数判断）
  const { totalOrders } = await _getRiderCreditLevel(connection, riderId);
  const isNewRider = totalOrders < (LM_CONFIG.newRiderOrderThreshold || 50);
  const limit = isNewRider ? newRiderLimit : maxDaily;

  const allowed = dailyCount < limit;
  return { allowed, dailyCount, dailyRemaining: Math.max(0, limit - dailyCount), isNewRider };
}

/**
 * 空间去重检查：50 米范围内同类未过期上报
 *
 * @param {import('mysql2/promise').Connection} connection
 * @param {number} reportType - 路况类型
 * @param {number} lng - 经度
 * @param {number} lat - 纬度
 * @returns {Promise<Object|null>} 存在则返回已有记录
 */
async function _checkSpatialDuplicate(connection, reportType, lng, lat) {
  const dedupRadius = LM_CONFIG.dedupRadius || 50;

  // 使用 ST_Distance_Sphere 计算球面距离
  const [rows] = await connection.query(
    `SELECT id, verified_count, weight, status, ST_Distance_Sphere(location, ST_GeomFromText(?, 4326)) AS distance
     FROM ai_road_reports
     WHERE report_type = ?
       AND status IN (0, 1)
       AND ST_Distance_Sphere(location, ST_GeomFromText(?, 4326)) <= ?
     ORDER BY created_at DESC LIMIT 1`,
    [`POINT(${lng} ${lat})`, reportType, `POINT(${lng} ${lat})`, dedupRadius],
  );

  if (rows.length === 0) {
    return null;
  }

  return rows[0];
}

/**
 * GPS 轨迹校验（P1 stub）
 *
 * 一期实现：先返回 null（未校验），
 * P1 时会检查骑手上报前 3 分钟 GPS 轨迹是否经过上报点 50 米范围
 *
 * @param {import('mysql2/promise').Connection} connection
 * @param {number} riderId - 骑手ID
 * @param {number} lng - 经度
 * @param {number} lat - 纬度
 * @returns {Promise<null|boolean>} null=未校验  true=匹配  false=不匹配
 */
async function verifyTrajectory(connection, riderId, lng, lat) {
  // P1 实现：查询 rider_positions 表，检查上报前 3 分钟轨迹
  // 当前返回 null（未校验）
  return null;
}

/**
 * 提交路况上报
 *
 * 完整流程：
 * 1. 频率检查（同分类 5 分钟内）
 * 2. 日上限检查（20 条/新骑手 5 条）
 * 3. 空间去重（50 米内同类未过期上报）
 * 4. GPS 轨迹校验（P1 stub）
 * 5. 计算权重 w = rider_credit × gps_accuracy × evidence
 * 6. 写入 ai_road_reports
 * 7. 如果是合并到已有记录，更新 verified_count 和总权重
 *
 * @param {Object} data - 上报数据
 * @param {number} data.rider_id - 骑手ID
 * @param {number} data.report_type - 路况类型
 * @param {number} data.lng - 经度
 * @param {number} data.lat - 纬度
 * @param {number} [data.gps_accuracy] - GPS 精度
 * @param {string} [data.address] - 地址
 * @param {string} [data.description] - 描述
 * @param {string[]} [data.images] - 图片URL
 * @returns {Promise<Object>} 上报结果
 */
async function submitReport(data) {
  const connection = await _getConnection();
  try {
    const { rider_id: riderId, report_type: reportType, lng, lat } = data;
    const gpsAccuracy = data.gps_accuracy || 0;
    const address = data.address || null;
    const description = data.description || null;
    const images = data.images || [];
    const hasImage = images.length > 0;

    // 1. 频率检查
    const freqCheck = await _checkFrequencyLimit(connection, riderId, reportType);
    if (!freqCheck.allowed) {
      const error = getErrorByCode(3001);
      throw Object.assign(new Error(error.message), {
        code: error.code,
        data: { next_available_at: freqCheck.nextAvailableAt, reason: 'same_category_rate_limited' },
      });
    }

    // 2. 日上限检查
    const dailyCheck = await _checkDailyLimit(connection, riderId);
    if (!dailyCheck.allowed) {
      const errorCode = dailyCheck.isNewRider ? 3008 : 3007;
      const error = getErrorByCode(errorCode);
      throw Object.assign(new Error(error.message), {
        code: error.code,
        data: { daily_remaining: 0, reason: errorCode === 3008 ? 'new_rider_limit' : 'daily_limit' },
      });
    }

    // 3. 空间去重
    const existingReport = await _checkSpatialDuplicate(connection, reportType, lng, lat);

    if (existingReport && existingReport.status === 1) {
      // 已有已验证记录，快速确认
      return {
        merged: true,
        verified: true,
        report_id: existingReport.id,
        condition_id: existingReport.verified_condition_id,
        status: 'verified',
        verified_count: existingReport.verified_count,
        points_earned: 3, // quick_confirm
        message: '该路况已被验证，获得快速确认积分',
      };
    }

    // 4. 查询骑手信用等级
    const { creditLevel, levelName } = await _getRiderCreditLevel(connection, riderId);

    // 5. GPS 轨迹校验（P1 stub）
    const trajectoryMatch = await verifyTrajectory(connection, riderId, lng, lat);

    // 6. 计算权重
    const weight = calculateWeight(levelName, gpsAccuracy, hasImage);

    if (existingReport) {
      // 7a. 合并到已有待验证记录
      const newVerifiedCount = existingReport.verified_count + 1;
      const newTotalWeight = +(parseFloat(existingReport.weight) + weight).toFixed(4);

      await connection.query(
        `UPDATE ai_road_reports
         SET verified_count = ?,
             weight = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [newVerifiedCount, newTotalWeight, existingReport.id],
      );

      // 检查是否已超过阈值
      const verifyThreshold = LM_CONFIG.verifyThreshold || 2.5;
      const thresholdReached = newTotalWeight >= verifyThreshold;

      logger.info(
        `骑手 ${riderId} 确认上报 ${existingReport.id}，累计权重 ${newTotalWeight}，阈值 ${verifyThreshold}`,
      );

      return {
        merged: true,
        threshold_reached: thresholdReached,
        report_id: existingReport.id,
        status: thresholdReached ? 'verified' : 'pending',
        verified_count: newVerifiedCount,
        total_weight: newTotalWeight,
        weight,
        points_earned: 3, // confirm
        message: thresholdReached
          ? '路况已确认！配送区域已更新'
          : `该路况已有 ${existingReport.verified_count} 位骑手上报，您的确认加速了验证！`,
      };
    }

    // 7b. 首次上报，写入新记录
    const [result] = await connection.query(
      `INSERT INTO ai_road_reports
       (rider_id, report_type, lng, lat, location, address, description,
        image_urls, weight, gps_accuracy, has_image, credit_level,
        trajectory_match, status, verified_count, order_id)
       VALUES (?, ?, ?, ?, ST_GeomFromText(?, 4326), ?, ?,
               ?, ?, ?, ?, ?,
               ?, 0, 1, ?)`,
      [
        riderId, reportType, lng, lat,
        `POINT(${lng} ${lat})`,
        address, description,
        JSON.stringify(images), weight, gpsAccuracy, hasImage ? 1 : 0,
        creditLevel,
        trajectoryMatch,
        data.order_id || null,
      ],
    );

    logger.info(`骑手 ${riderId} 首次上报 ${result.insertId}，权重 ${weight}`);

    return {
      merged: false,
      threshold_reached: false,
      report_id: result.insertId,
      status: 'pending',
      verified_count: 1,
      total_weight: weight,
      weight,
      points_earned: 5, // first report
      message: '上报成功，当前验证进度 1/3，感谢您为社区做出的贡献！',
    };
  } finally {
    await connection.end();
  }
}

/**
 * 获取上报道具数据（P1）
 *
 * @param {Object} filters - 筛选条件
 * @returns {Promise<Object>} 分页结果
 */
async function listReports(filters) {
  const connection = await _getConnection();
  try {
    const page = Math.max(1, filters.page || 1);
    const size = Math.min(100, Math.max(1, filters.size || 20));
    const offset = (page - 1) * size;

    const where = [];
    const params = [];

    if (filters.status !== undefined && filters.status !== null) {
      where.push('r.status = ?');
      params.push(filters.status);
    }
    if (filters.report_type) {
      where.push('r.report_type = ?');
      params.push(filters.report_type);
    }
    if (filters.rider_id) {
      where.push('r.rider_id = ?');
      params.push(filters.rider_id);
    }
    if (filters.start_date) {
      where.push('r.created_at >= ?');
      params.push(filters.start_date);
    }
    if (filters.end_date) {
      where.push('r.created_at <= ?');
      params.push(filters.end_date);
    }

    const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';

    const [countResult] = await connection.query(
      `SELECT COUNT(*) AS total FROM ai_road_reports r ${whereClause}`,
      params,
    );
    const total = countResult[0].total;

    const [items] = await connection.query(
      `SELECT r.* FROM ai_road_reports r ${whereClause} ORDER BY r.created_at DESC LIMIT ? OFFSET ?`,
      [...params, size, offset],
    );

    return { total, page, size, items };
  } finally {
    await connection.end();
  }
}

module.exports = {
  submitReport,
  listReports,
  calculateWeight,
  verifyTrajectory,
};
