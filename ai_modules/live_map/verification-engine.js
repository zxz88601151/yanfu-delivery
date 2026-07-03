'use strict';

/**
 * AI 交叉验证引擎
 *
 * @module ai_modules/live_map/verification-engine
 */

const mysql = require('mysql2/promise');
const config = require('../../config/ai_modules');
const { getErrorByCode } = require('../../config/error_codes');
const liveMapEvents = require('./events');
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

const LM_CONFIG = config.liveMap || {};
const VERIFY_THRESHOLD = LM_CONFIG.verifyThreshold || 2.5;
const MATCH_RADIUS = LM_CONFIG.matchRadius || 100;
const VERIFY_TIMEOUT_MINUTES = LM_CONFIG.verificationTimeout || 30;
const CONDITION_LIFETIME_HOURS = LM_CONFIG.conditionLifetimeHours || 24;
const DEGRADE_AFTER_HOURS = LM_CONFIG.degradeAfterHours || 12;

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
 * 查找指定位置附近同类待验证上报
 *
 * @param {import('mysql2/promise').Connection} connection
 * @param {number} lng - 中心经度
 * @param {number} lat - 中心纬度
 * @param {number} reportType - 路况类型
 * @param {number} [radius] - 匹配半径
 * @returns {Promise<Array>} 上报列表
 */
async function findNearbyReports(connection, lng, lat, reportType, radius) {
  const matchRadius = radius || MATCH_RADIUS;

  const [rows] = await connection.query(
    `SELECT *, ST_Distance_Sphere(location, ST_GeomFromText(?, 4326)) AS distance
     FROM ai_road_reports
     WHERE report_type = ?
       AND status = 0
       AND ST_Distance_Sphere(location, ST_GeomFromText(?, 4326)) <= ?
     ORDER BY created_at ASC`,
    [`POINT(${lng} ${lat})`, reportType, `POINT(${lng} ${lat})`, matchRadius],
  );

  return rows;
}

/**
 * 计算上报总权重
 *
 * @param {Array} reports - 上报列表
 * @returns {number} 累计权重
 */
function calculateTotalWeight(reports) {
  if (!Array.isArray(reports) || reports.length === 0) {
    return 0;
  }
  return +(reports.reduce((sum, r) => sum + parseFloat(r.weight || 0), 0)).toFixed(4);
}

/**
 * 判断权重是否达到验证阈值
 *
 * @param {number} totalWeight - 累计权重
 * @returns {boolean}
 */
function checkThreshold(totalWeight) {
  return totalWeight >= VERIFY_THRESHOLD;
}

/**
 * 根据 report_type 获取默认 difficulty_level 和 radius
 *
 * @param {number} reportType - 路况类型
 * @returns {{ difficultyLevel: number, radius: number }}
 */
function _getDefaultDifficultyAndRadius(reportType) {
  const configMap = {
    1: { difficultyLevel: 2, radius: 150 },
    2: { difficultyLevel: 3, radius: 300 },
    3: { difficultyLevel: 2, radius: 100 },
    4: { difficultyLevel: 1, radius: 80 },
    5: { difficultyLevel: 2, radius: 200 },
    6: { difficultyLevel: 1, radius: 100 },
  };
  return configMap[reportType] || { difficultyLevel: 1, radius: 100 };
}

/**
 * 简单的 GeoHash 编码（精度 6 级）
 *
 * @param {number} lat - 纬度
 * @param {number} lng - 经度
 * @param {number} [precision] - 精度
 * @returns {string} GeoHash
 */
function geoHashEncode(lat, lng, precision) {
  const p = precision || 6;
  const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';
  let latMin = -90, latMax = 90;
  let lonMin = -180, lonMax = 180;
  let hash = '';
  let isEven = true;
  let bit = 0;
  let ch = 0;

  while (hash.length < p) {
    if (isEven) {
      const mid = (lonMin + lonMax) / 2;
      if (lng >= mid) {
        ch = (ch << 1) | 1;
        lonMin = mid;
      } else {
        ch = (ch << 1) | 0;
        lonMax = mid;
      }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) {
        ch = (ch << 1) | 1;
        latMin = mid;
      } else {
        ch = (ch << 1) | 0;
        latMax = mid;
      }
    }

    isEven = !isEven;

    if (++bit === 5) {
      hash += BASE32[ch];
      bit = 0;
      ch = 0;
    }
  }

  return hash;
}

/**
 * 创建红区记录
 *
 * @param {import('mysql2/promise').Connection} connection
 * @param {Array} reports - 触发验证的上报列表
 * @param {number} totalWeight - 累计权重
 * @returns {Promise<Object>} 创建的红区记录
 */
async function createCondition(connection, reports, totalWeight) {
  if (!reports || reports.length === 0) {
    return null;
  }

  // 使用第一条上报作为红区中心
  const firstReport = reports[0];
  const reportType = firstReport.report_type;
  const { difficultyLevel, radius } = _getDefaultDifficultyAndRadius(reportType);
  const geoHash = geoHashEncode(firstReport.lat, firstReport.lng, 6);

  // 过期时间 = 当前时间 + 24h
  const now = new Date();
  const expiredAt = new Date(now.getTime() + CONDITION_LIFETIME_HOURS * 3600 * 1000);
  const degradedAt = new Date(now.getTime() + DEGRADE_AFTER_HOURS * 3600 * 1000);

  // 插入红区
  const [result] = await connection.query(
    `INSERT INTO ai_verified_conditions
     (report_type, difficulty_level, lng, lat, center_point, radius, geo_hash,
      status, total_reports, total_weight, source, description, expired_at, degraded_at)
     VALUES (?, ?, ?, ?, ST_GeomFromText(?, 4326), ?, ?,
             0, ?, ?, 0, ?, ?, ?)`,
    [
      reportType, difficultyLevel,
      firstReport.lng, firstReport.lat,
      `POINT(${firstReport.lng} ${firstReport.lat})`,
      radius, geoHash,
      reports.length, totalWeight,
      firstReport.description || `路况类型 ${reportType}`,
      expiredAt.toISOString().slice(0, 19).replace('T', ' '),
      degradedAt.toISOString().slice(0, 19).replace('T', ' '),
    ],
  );

  const conditionId = result.insertId;

  // 更新所有关联上报的状态
  const reportIds = reports.map((r) => r.id);
  await connection.query(
    `UPDATE ai_road_reports
     SET status = 1, verified_condition_id = ?
     WHERE id IN (?)`,
    [conditionId, reportIds],
  );

  logger.info(
    `红区创建 #${conditionId}，类型 ${reportType}，难度 ${difficultyLevel}，半径 ${radius}m，${reports.length} 条上报，总权重 ${totalWeight}`,
  );

  // 查询完整红区记录
  const [conditions] = await connection.query(
    'SELECT * FROM ai_verified_conditions WHERE id = ?',
    [conditionId],
  );

  return conditions[0] || null;
}

/**
 * 处理超时未达阈值上报（降级为低置信度）
 *
 * @param {import('mysql2/promise').Connection} connection
 * @param {Object} report - 上报记录
 */
async function handleTimeoutReport(connection, report) {
  await connection.query(
    `UPDATE ai_road_reports SET status = 2 WHERE id = ? AND status = 0`,
    [report.id],
  );

  logger.info(`上报 ${report.id} 超时未验证，已标记为低置信度`);
}

/**
 * 扫描所有待验证上报，进行交叉验证
 *
 * 按位置（100m 半径）和类型分组，计算累计权重，
 * 达到阈值则生成红区，超时则降级
 *
 * @returns {Promise<Array>} 本次扫描新创建的红区列表
 */
async function scanPendingReports() {
  const connection = await _getConnection();
  try {
    // 1. 查询所有待验证上报
    const [pendingReports] = await connection.query(
      `SELECT * FROM ai_road_reports WHERE status = 0 ORDER BY created_at ASC`,
    );

    if (pendingReports.length === 0) {
      return [];
    }

    logger.info(`验证扫描：发现 ${pendingReports.length} 条待验证上报`);

    const createdConditions = [];
    const processedIds = new Set();
    const now = Date.now();

    for (const report of pendingReports) {
      if (processedIds.has(report.id)) {
        continue;
      }

      // 2. 查找该位置附近同类上报
      const nearbyReports = await findNearbyReports(
        connection, report.lng, report.lat, report.report_type, MATCH_RADIUS,
      );

      if (nearbyReports.length === 0) {
        continue;
      }

      // 3. 计算累计权重
      const totalWeight = calculateTotalWeight(nearbyReports);
      const reportLng = report.lng;
      const reportLat = report.lat;

      // 4. 判断是否达到阈值
      if (checkThreshold(totalWeight)) {
        // 创建红区
        const condition = await createCondition(connection, nearbyReports, totalWeight);

        if (condition) {
          // 发布验证通过事件
          liveMapEvents.emitRoadReportVerified({
            condition_id: condition.id,
            geo_hash: condition.geo_hash,
            center: { lng: condition.lng, lat: condition.lat },
            radius: condition.radius,
            difficulty_level: condition.difficulty_level,
          });

          createdConditions.push(condition);
        }
      } else {
        // 检查是否超时
        const elapsedMinutes = (now - new Date(report.created_at).getTime()) / 60000;
        if (elapsedMinutes >= VERIFY_TIMEOUT_MINUTES) {
          await handleTimeoutReport(connection, report);

          // 查找同组其他未到期的上报
          for (const nr of nearbyReports) {
            processedIds.add(nr.id);
          }
        }
      }

      // 标记已处理
      for (const nr of nearbyReports) {
        processedIds.add(nr.id);
      }
    }

    return createdConditions;
  } finally {
    await connection.end();
  }
}

/**
 * 上报后立即触发验证检查
 *
 * @param {Object} reportResult - submitReport 的返回结果
 * @returns {Promise<Object|null>} 创建的红区或 null
 */
async function checkCondition(reportResult) {
  // 如果上报结果已经表明达到阈值，由 service.js 层触发完整扫描
  // 或者直接针对该位置做一次验证
  if (!reportResult) {
    return null;
  }

  if (reportResult.threshold_reached) {
    // 触发全量扫描
    const conditions = await scanPendingReports();
    return conditions.length > 0 ? conditions[0] : null;
  }

  return null;
}

/**
 * 处理过期红区
 *
 * 扫描所有活跃红区，检查是否有需要降级或过期的
 *
 * @returns {Promise<{ degraded: number, expired: number }>}
 */
async function expireConditions() {
  const connection = await _getConnection();
  try {
    const now = new Date();

    // 1. 降级：超过 degradeAfterHours 的活跃红区
    const [toDegrade] = await connection.query(
      `SELECT * FROM ai_verified_conditions
       WHERE status = 0 AND degraded_at IS NOT NULL AND degraded_at <= ?
       ORDER BY id ASC`,
      [now.toISOString().slice(0, 19).replace('T', ' ')],
    );

    for (const condition of toDegrade) {
      const newLevel = Math.max(0, condition.difficulty_level - 1);
      const newRadius = Math.round(condition.radius * 0.5);

      await connection.query(
        `UPDATE ai_verified_conditions
         SET status = 1, difficulty_level = ?, radius = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 0`,
        [newLevel, newRadius, condition.id],
      );

      liveMapEvents.emitConditionDegraded({
        condition_id: condition.id,
        geo_hash: condition.geo_hash,
        old_level: condition.difficulty_level,
        new_level: newLevel,
      });

      logger.info(`红区 ${condition.id} 已降级：${condition.difficulty_level}→${newLevel}, 半径 ${condition.radius}→${newRadius}`);
    }

    // 2. 过期：超过 expired_at 的活跃或降级中红区
    const [toExpire] = await connection.query(
      `SELECT * FROM ai_verified_conditions
       WHERE status IN (0, 1) AND expired_at <= ?
       ORDER BY id ASC`,
      [now.toISOString().slice(0, 19).replace('T', ' ')],
    );

    for (const condition of toExpire) {
      await connection.query(
        `UPDATE ai_verified_conditions
         SET status = 2, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status IN (0, 1)`,
        [condition.id],
      );

      liveMapEvents.emitRoadReportExpired({
        condition_id: condition.id,
        geo_hash: condition.geo_hash,
      });

      logger.info(`红区 ${condition.id} 已过期`);
    }

    return { degraded: toDegrade.length, expired: toExpire.length };
  } finally {
    await connection.end();
  }
}

module.exports = {
  scanPendingReports,
  checkCondition,
  findNearbyReports,
  calculateTotalWeight,
  checkThreshold,
  createCondition,
  expireConditions,
  geoHashEncode,
  VERIFY_THRESHOLD,
  MATCH_RADIUS,
};
