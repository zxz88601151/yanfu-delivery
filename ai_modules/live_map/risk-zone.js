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
 * 红区管理（P1 — 基础结构已搭建，后续完善）
 *
 * @module ai_modules/live_map/risk-zone
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
 * 降级红区：difficulty_level - 1, radius × 0.5
 *
 * @param {number} conditionId - 红区ID
 * @returns {Promise<boolean>}
 */
async function downgradeCondition(conditionId) {
  const connection = await _getConnection();
  try {
    const [conditions] = await connection.query(
      'SELECT * FROM ai_verified_conditions WHERE id = ? AND status = 0',
      [conditionId],
    );

    if (conditions.length === 0) {
      return false;
    }

    const condition = conditions[0];
    const newLevel = Math.max(0, condition.difficulty_level - 1);
    const newRadius = Math.round(condition.radius * 0.5);

    await connection.query(
      `UPDATE ai_verified_conditions
       SET status = 1, difficulty_level = ?, radius = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 0`,
      [newLevel, newRadius, conditionId],
    );

    logger.info(`红区 ${conditionId} 降级：等级 ${condition.difficulty_level}→${newLevel}，半径 ${condition.radius}→${newRadius}`);

    return true;
  } finally {
    await connection.end();
  }
}

/**
 * 过期红区
 *
 * @param {number} conditionId - 红区ID
 * @returns {Promise<boolean>}
 */
async function expireCondition(conditionId) {
  const connection = await _getConnection();
  try {
    const [conditions] = await connection.query(
      'SELECT * FROM ai_verified_conditions WHERE id = ? AND status IN (0, 1)',
      [conditionId],
    );

    if (conditions.length === 0) {
      const error = getErrorByCode(3005); // LIVE_MAP_CONDITION_NOT_FOUND
      throw Object.assign(new Error(error.message), { code: error.code });
    }

    if (conditions[0].status === 2) {
      const error = getErrorByCode(3006); // LIVE_MAP_CONDITION_ALREADY_EXPIRED
      throw Object.assign(new Error(error.message), { code: error.code });
    }

    const condition = conditions[0];
    const prevStatus = condition.status;

    await connection.query(
      `UPDATE ai_verified_conditions
       SET status = 2, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status IN (0, 1)`,
      [conditionId],
    );

    // 发布过期事件
    liveMapEvents.emitRoadReportExpired({
      condition_id: conditionId,
      geo_hash: condition.geo_hash,
    });

    logger.info(`红区 ${conditionId} 已手动过期`);

    return {
      condition_id: conditionId,
      previous_status: prevStatus,
      new_status: 2,
      message: '已手动过期该红区',
    };
  } finally {
    await connection.end();
  }
}

/**
 * 续期红区：重置 expiry_at + 24h，恢复 status = 0
 *
 * @param {number} conditionId - 红区ID
 * @returns {Promise<boolean>}
 */
async function renewCondition(conditionId) {
  const connection = await _getConnection();
  try {
    const [conditions] = await connection.query(
      'SELECT * FROM ai_verified_conditions WHERE id = ?',
      [conditionId],
    );

    if (conditions.length === 0) {
      return false;
    }

    const now = new Date();
    const newExpiredAt = new Date(now.getTime() + 24 * 3600 * 1000);

    await connection.query(
      `UPDATE ai_verified_conditions
       SET status = 0, expired_at = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [newExpiredAt.toISOString().slice(0, 19).replace('T', ' '), conditionId],
    );

    logger.info(`红区 ${conditionId} 已续期，新过期时间 ${newExpiredAt.toISOString()}`);

    return true;
  } finally {
    await connection.end();
  }
}

/**
 * 检查路径是否受红区影响（P1 — stub 实现）
 *
 * 使用 @turf/turf 的地理计算，TODO：后续完善 lineIntersect
 *
 * @param {Array} routePoints - 路径点数组 [{ lng, lat }]
 * @param {Array} conditions - 活跃红区列表
 * @returns {Object} { affected: boolean, zones: Array, extraDistance: number, extraTime: number }
 */
function isAffectedByRedZone(routePoints, conditions) {
  if (!routePoints || routePoints.length < 2 || !conditions || conditions.length === 0) {
    return { affected: false, zones: [], extraDistance: 0, extraTime: 0 };
  }

  const intersectingZones = [];

  for (const condition of conditions) {
    const zoneCenter = { lng: condition.lng, lat: condition.lat };
    const zoneRadius = condition.radius;

    // 简化算法：检查路径点是否在红区范围内
    for (const point of routePoints) {
      const distance = _haversineDistance(
        point.lat, point.lng,
        zoneCenter.lat, zoneCenter.lng,
      );

      if (distance <= zoneRadius) {
        intersectingZones.push({
          id: condition.id,
          type: condition.report_type,
          severity: condition.difficulty_level >= 3 ? 'severe' : (condition.difficulty_level >= 2 ? 'moderate' : 'minor'),
          center: zoneCenter,
          radius: zoneRadius,
          intersection_point: point,
        });
        break;
      }
    }
  }

  if (intersectingZones.length === 0) {
    return { affected: false, zones: [], extraDistance: 0, extraTime: 0 };
  }

  // 粗略估算绕行距离和时间
  const extraDistance = intersectingZones.reduce((sum, z) => sum + z.radius * 2, 0);
  const extraTime = Math.round(extraDistance / 5 * 60); // 假设 5m/s 速度

  return {
    affected: true,
    zones: intersectingZones,
    extraDistance,
    extraTime,
  };
}

/**
 * 获取避让建议（P1 — stub 实现）
 *
 * @param {number} fromLng - 起点经度
 * @param {number} fromLat - 起点纬度
 * @param {number} toLng - 终点经度
 * @param {number} toLat - 终点纬度
 * @param {Array} conditions - 活跃红区列表
 * @returns {Object} 避让建议
 */
function getAvoidAdvice(fromLng, fromLat, toLng, toLat, conditions) {
  const routePoints = [
    { lng: fromLng, lat: fromLat },
    { lng: (fromLng + toLng) / 2, lat: (fromLat + toLat) / 2 },
    { lng: toLng, lat: toLat },
  ];

  const affectResult = isAffectedByRedZone(routePoints, conditions);

  const originalDistance = _haversineDistance(fromLat, fromLng, toLat, toLng);
  const originalTime = Math.round(originalDistance / 5 * 60); // 假设 5m/s

  return {
    route_summary: {
      original_distance: Math.round(originalDistance),
      original_time: originalTime,
      affected: affectResult.affected,
      extra_distance: affectResult.extraDistance,
      extra_time: affectResult.extraTime,
    },
    red_zones_encountered: affectResult.zones.map((z) => ({
      id: z.id,
      type_label: _getTypeLabel(z.type),
      severity: z.severity,
      center: z.center,
      radius: z.radius,
      intersection_point: z.intersection_point,
    })),
    alternative_routes: affectResult.affected
      ? [
        {
          id: 'A',
          label: '建议绕行路线',
          extra_distance: Math.round(affectResult.extraDistance * 0.7),
          extra_time: Math.round(affectResult.extraTime * 0.7),
          is_recommended: true,
        },
      ]
      : [],
  };
}

/**
 * Haversine 距离计算
 *
 * @param {number} lat1
 * @param {number} lng1
 * @param {number} lat2
 * @param {number} lng2
 * @returns {number} 距离（米）
 * @private
 */
function _haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000; // 地球半径（米）
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
    * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * 获取路况类型标签
 *
 * @param {number} type
 * @returns {string}
 * @private
 */
function _getTypeLabel(type) {
  const labels = {
    1: '修路施工', 2: '封路禁行', 3: '电梯故障',
    4: '小区门禁', 5: '道路拥堵', 6: '其他',
  };
  return labels[type] || '未知';
}

module.exports = {
  downgradeCondition,
  expireCondition,
  renewCondition,
  isAffectedByRedZone,
  getAvoidAdvice,
};
