'use strict';

/**
 * 激励积分管理（P1 — 基础功能已实现）
 *
 * @module ai_modules/live_map/incentive-manager
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
const MAX_DAILY_POINTS = LM_CONFIG.maxDailyPoints || 60;

/**
 * 各行为积分映射
 */
const POINTS_MAP = {
  condition_triggered: 15,  // 上报触发红区（首位上报者）
  quick_confirm: 5,         // 快速确认已有上报
  daily_first_report: 3,    // 每日首次上报
  report_submitted: 1,      // 普通上报
  image_provided: 2,        // 附带图片
  efficiency_bonus: 5,      // 月度高效上报奖励
  fraud_deducted: -20,      // 确认虚假上报
  continuous_fraud: -50,    // 连续虚假上报（3次+）
};

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
 * 计算行为积分
 *
 * @param {string} actionType - 行为类型
 * @param {Object} [context] - 上下文
 * @param {boolean} [context.hasImage] - 是否有图片
 * @param {boolean} [context.isFirstReport] - 是否首次上报
 * @returns {number} 积分
 */
function calculatePoints(actionType, context) {
  const basePoints = POINTS_MAP[actionType] || 0;
  let extraPoints = 0;

  if (actionType === 'report_submitted') {
    // 首次上报 +5
    if (context && context.isFirstReport) {
      basePoints = 5;
    }
    // 附带图片额外 +2
    if (context && context.hasImage) {
      extraPoints += 2;
    }
  }

  return basePoints + extraPoints;
}

/**
 * 检查每日积分上限
 *
 * @param {import('mysql2/promise').Connection} connection
 * @param {number} riderId - 骑手ID
 * @param {number} additionalPoints - 新增积分
 * @returns {Promise<{ allowed: boolean, todayPoints: number, remaining: number }>}
 */
async function checkDailyCap(connection, riderId, additionalPoints) {
  const today = new Date().toISOString().slice(0, 10);

  const [rows] = await connection.query(
    'SELECT today_points FROM ai_rider_incentives WHERE rider_id = ?',
    [riderId],
  );

  const todayPoints = rows.length > 0 ? (rows[0].today_points || 0) : 0;
  const newTotal = todayPoints + additionalPoints;

  if (newTotal > MAX_DAILY_POINTS) {
    return {
      allowed: false,
      todayPoints,
      remaining: Math.max(0, MAX_DAILY_POINTS - todayPoints),
    };
  }

  return { allowed: true, todayPoints, remaining: MAX_DAILY_POINTS - newTotal };
}

/**
 * 添加/扣除积分
 *
 * @param {number} riderId - 骑手ID
 * @param {string} actionType - 行为类型
 * @param {number} [reportId] - 关联上报ID
 * @param {number} [conditionId] - 关联红区ID
 * @param {string} [reason] - 变动原因
 * @returns {Promise<{ points: number, todayPoints: number, totalPoints: number }>}
 */
async function addPoints(riderId, actionType, reportId, conditionId, reason) {
  const connection = await _getConnection();
  try {
    const points = POINTS_MAP[actionType] || 0;
    if (points === 0) {
      return { points: 0, todayPoints: 0, totalPoints: 0 };
    }

    const today = new Date().toISOString().slice(0, 10);

    // 检查日上限（扣分不受限制）
    if (points > 0) {
      const capCheck = await checkDailyCap(connection, riderId, points);
      if (!capCheck.allowed) {
        logger.warn(`骑手 ${riderId} 积分已达日上限 ${MAX_DAILY_POINTS}`);
        return { points: 0, todayPoints: capCheck.todayPoints, totalPoints: 0 };
      }
    }

    // Upsert ai_rider_incentives
    await connection.query(
      `INSERT INTO ai_rider_incentives
       (rider_id, total_points, today_points, last_reset_date, total_valid_reports, total_fraud_reports)
       VALUES (?, ?, ?, ?, 0, 0)
       ON DUPLICATE KEY UPDATE
         total_points = total_points + VALUES(total_points),
         today_points = IF(last_reset_date = ?, today_points + VALUES(today_points), VALUES(today_points)),
         last_reset_date = VALUES(last_reset_date)`,
      [
        riderId,
        points,       // total_points 增量
        points > 0 ? points : 0, // today_points 增量
        today,
        today,
      ],
    );

    // 写入积分变动日志
    await connection.query(
      `INSERT INTO ai_incentive_logs
       (rider_id, points_change, action_type, report_id, condition_id, reason)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [riderId, points, actionType, reportId || null, conditionId || null, reason || actionType],
    );

    // 查询更新后的积分
    const [rows] = await connection.query(
      'SELECT total_points, today_points FROM ai_rider_incentives WHERE rider_id = ?',
      [riderId],
    );

    const result = rows.length > 0
      ? { totalPoints: rows[0].total_points, todayPoints: rows[0].today_points }
      : { totalPoints: points, todayPoints: points > 0 ? points : 0 };

    logger.info(
      `骑手 ${riderId} 积分变动: ${points >= 0 ? '+' : ''}${points} (${actionType})，当前 ${result.totalPoints}`,
    );

    return { points, todayPoints: result.todayPoints, totalPoints: result.totalPoints };
  } finally {
    await connection.end();
  }
}

/**
 * 检查骑手是否被限制上报
 *
 * @param {number} riderId - 骑手ID
 * @returns {Promise<{ banned: boolean, banExpiresAt: string|null }>}
 */
async function checkBanStatus(riderId) {
  const connection = await _getConnection();
  try {
    const [rows] = await connection.query(
      'SELECT is_banned, ban_expires_at FROM ai_rider_incentives WHERE rider_id = ?',
      [riderId],
    );

    if (rows.length === 0) {
      return { banned: false, banExpiresAt: null };
    }

    const row = rows[0];
    if (!row.is_banned) {
      return { banned: false, banExpiresAt: null };
    }

    const now = new Date();
    const banExpiresAt = row.ban_expires_at ? new Date(row.ban_expires_at) : null;

    if (banExpiresAt && banExpiresAt <= now) {
      // 限制已过期，自动解除
      await connection.query(
        'UPDATE ai_rider_incentives SET is_banned = 0, ban_expires_at = NULL WHERE rider_id = ?',
        [riderId],
      );
      return { banned: false, banExpiresAt: null };
    }

    return { banned: true, banExpiresAt: banExpiresAt ? banExpiresAt.toISOString() : null };
  } finally {
    await connection.end();
  }
}

/**
 * 虚假上报扣分 + 检查禁报
 *
 * @param {number} riderId - 骑手ID
 * @param {number} reportId - 关联上报ID
 * @returns {Promise<Object>}
 */
async function handleFraudReport(riderId, reportId) {
  const connection = await _getConnection();
  try {
    const points = POINTS_MAP.fraud_deducted; // -20
    const today = new Date().toISOString().slice(0, 10);

    // 更新积分和虚假上报计数
    await connection.query(
      `INSERT INTO ai_rider_incentives
       (rider_id, total_points, today_points, last_reset_date, total_valid_reports, total_fraud_reports, fraud_streak)
       VALUES (?, ?, ?, ?, 0, 1, 1)
       ON DUPLICATE KEY UPDATE
         total_points = total_points + ?,
         total_fraud_reports = total_fraud_reports + 1,
         fraud_streak = fraud_streak + 1`,
      [riderId, points, 0, today, points],
    );

    // 写入日志
    await connection.query(
      `INSERT INTO ai_incentive_logs
       (rider_id, points_change, action_type, report_id, reason)
       VALUES (?, ?, 'fraud_deducted', ?, '虚假上报扣分')`,
      [riderId, points, reportId],
    );

    // 检查连续虚假次数
    const [rows] = await connection.query(
      'SELECT fraud_streak FROM ai_rider_incentives WHERE rider_id = ?',
      [riderId],
    );

    const fraudStreak = rows.length > 0 ? rows[0].fraud_streak : 1;
    let banned = false;

    // 连续 3 次虚假上报 → 禁报 7 天
    if (fraudStreak >= 3) {
      const banExpiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000);

      await connection.query(
        `UPDATE ai_rider_incentives
         SET total_points = total_points + ?, is_banned = 1, ban_expires_at = ?, fraud_streak = 0
         WHERE rider_id = ?`,
        [POINTS_MAP.continuous_fraud, banExpiresAt.toISOString().slice(0, 19).replace('T', ' '), riderId],
      );

      // 写入连续造假扣分日志
      await connection.query(
        `INSERT INTO ai_incentive_logs
         (rider_id, points_change, action_type, reason)
         VALUES (?, ?, 'ban', '连续3次虚假上报，禁报7天')`,
        [riderId, POINTS_MAP.continuous_fraud],
      );

      banned = true;
      logger.warn(`骑手 ${riderId} 连续 ${fraudStreak} 次虚假上报，已禁报 7 天`);
    }

    return { points, fraudStreak, banned };
  } finally {
    await connection.end();
  }
}

/**
 * 获取积分排行榜（P1 — stub）
 *
 * @param {string} period - 周期: 'weekly' | 'monthly'
 * @param {number} limit - 返回条数
 * @returns {Promise<Array>}
 */
async function getLeaderboard(period, limit) {
  const connection = await _getConnection();
  try {
    const maxLimit = Math.min(limit || 20, 100);

    const [rows] = await connection.query(
      `SELECT rider_id, total_points, total_valid_reports
       FROM ai_rider_incentives
       ORDER BY total_points DESC
       LIMIT ?`,
      [maxLimit],
    );

    return rows;
  } finally {
    await connection.end();
  }
}

module.exports = {
  calculatePoints,
  checkDailyCap,
  addPoints,
  checkBanStatus,
  handleFraudReport,
  getLeaderboard,
  POINTS_MAP,
  MAX_DAILY_POINTS,
};
