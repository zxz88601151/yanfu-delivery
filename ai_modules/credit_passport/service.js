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
 * 信用护照业务逻辑层
 *
 * @module ai_modules/credit_passport/service
 */

const mysql = require('mysql2/promise');
const config = require('../../config/ai_modules');
const { getErrorByCode } = require('../../config/error_codes');
const eventBus = require('../common/event-bus');
const creditModel = require('./credit-model');
const levelManager = require('./level-manager');
const creditEvents = require('./events');
const winston = require('winston');
const path = require('path');

const logger = winston.createLogger({
  level: process.env.KUAILV_LOG_LEVEL || 'info',
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({
      filename: path.join(process.env.KUAILV_LOG_DIR || './logs', 'credit-passport.log'),
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
 * 获取骑手信用分（含等级权益）
 *
 * 流程：
 * 1. 查询 ai_rider_credits 表
 * 2. 如果不存在，创建默认记录（总分 600，等级 1 青铜）
 * 3. 调用 level-manager 获取等级权益
 * 4. 返回完整信用档案
 *
 * @param {number} riderId - 骑手ID
 * @returns {Promise<Object>} 信用档案
 */
async function getRiderCredit(riderId) {
  const connection = await _getConnection();
  try {
    let [credits] = await connection.query(
      'SELECT * FROM ai_rider_credits WHERE rider_id = ?',
      [riderId],
    );

    // 如果不存在，创建默认记录
    if (credits.length === 0) {
      await connection.query(
        `INSERT INTO ai_rider_credits
         (rider_id, total_score, on_time_rate, complaint_rate, praise_rate, acceptance_rate, level, total_orders)
         VALUES (?, 600, 0, 0, 0, 0, 1, 0)`,
        [riderId],
      );

      [credits] = await connection.query(
        'SELECT * FROM ai_rider_credits WHERE rider_id = ?',
        [riderId],
      );
    }

    const credit = credits[0];

    // 获取等级信息
    const levelInfo = levelManager.getLevel(credit.total_score);
    const benefits = levelManager.getLevelBenefits(levelInfo.level);

    return {
      rider_id: credit.rider_id,
      total_score: credit.total_score,
      dimensions: {
        on_time_rate: credit.on_time_rate,
        complaint_rate: credit.complaint_rate,
        praise_rate: credit.praise_rate,
        acceptance_rate: credit.acceptance_rate,
      },
      level: levelInfo,
      benefits,
      total_orders: credit.total_orders,
      created_at: credit.created_at,
      updated_at: credit.updated_at,
    };
  } finally {
    await connection.end();
  }
}

/**
 * 获取信用变动历史（分页）
 *
 * @param {number} riderId - 骑手ID
 * @param {number} [page=1] - 页码
 * @param {number} [size=20] - 每页条数
 * @returns {Promise<{ total: number, page: number, size: number, items: Array }>}
 */
async function getRiderHistory(riderId, page, size) {
  const connection = await _getConnection();
  try {
    const currentPage = Math.max(1, page || 1);
    const pageSize = Math.max(1, Math.min(100, size || 20));
    const offset = (currentPage - 1) * pageSize;

    // 查询总数
    const [countResult] = await connection.query(
      'SELECT COUNT(*) AS total FROM ai_credit_passports WHERE rider_id = ?',
      [riderId],
    );
    const total = countResult[0].total;

    // 查询分页数据
    const [items] = await connection.query(
      'SELECT * FROM ai_credit_passports WHERE rider_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
      [riderId, pageSize, offset],
    );

    return {
      total,
      page: currentPage,
      size: pageSize,
      items,
    };
  } finally {
    await connection.end();
  }
}

/**
 * 更新信用分（内部方法）
 *
 * 流程：
 * 1. 调用 credit-model 计算分差
 * 2. 查询当前信用分
 * 3. 计算新总分
 * 4. 检查等级是否变化
 * 5. 写入变动记录到 ai_credit_passports
 * 6. 更新 ai_rider_credits
 * 7. 发布 rider.credit.changed 事件
 * 8. 返回更新结果
 *
 * @param {number} riderId - 骑手ID
 * @param {string} action - 行为标识
 * @param {number} [orderId] - 关联订单ID（可选）
 * @returns {Promise<Object>} 更新结果
 */
async function updateCredit(riderId, action, orderId) {
  const connection = await _getConnection();
  try {
    // 1. 计算分差
    const changeAmount = creditModel.getScoreChange(action);
    if (changeAmount === 0) {
      logger.warn(`骑手 ${riderId} 未知行为: ${action}`);
    }

    // 2. 查询当前信用分
    let [credits] = await connection.query(
      'SELECT * FROM ai_rider_credits WHERE rider_id = ?',
      [riderId],
    );

    // 如果不存在，创建默认记录
    if (credits.length === 0) {
      await connection.query(
        `INSERT INTO ai_rider_credits
         (rider_id, total_score, on_time_rate, complaint_rate, praise_rate, acceptance_rate, level, total_orders)
         VALUES (?, 600, 0, 0, 0, 0, 1, 0)`,
        [riderId],
      );

      [credits] = await connection.query(
        'SELECT * FROM ai_rider_credits WHERE rider_id = ?',
        [riderId],
      );
    }

    const credit = credits[0];
    const prevScore = credit.total_score;
    const prevLevel = levelManager.getLevel(prevScore);

    // 3. 计算新总分
    const newScore = Math.max(0, Math.min(1000, prevScore + changeAmount));

    // 4. 检查等级是否变化
    const levelChange = levelManager.getLevelChanged(prevScore, newScore);
    const newLevelInfo = levelManager.getLevel(newScore);

    // 确定 change_type (1=加分, 2=扣分)
    const changeType = changeAmount >= 0 ? 1 : 2;

    // 5. 写入变动记录
    const [recordResult] = await connection.query(
      `INSERT INTO ai_credit_passports
       (rider_id, change_type, change_amount, reason, order_id, status)
       VALUES (?, ?, ?, ?, ?, 0)`,
      [riderId, changeType, Math.abs(changeAmount), action, orderId || null],
    );

    // 6. 更新骑手信用表
    await connection.query(
      `UPDATE ai_rider_credits
       SET total_score = ?,
           level = ?,
           total_orders = total_orders + 1,
           updated_at = CURRENT_TIMESTAMP
       WHERE rider_id = ?`,
      [newScore, newLevelInfo.level, riderId],
    );

    // 7. 发布事件
    eventBus.emitEvent(creditEvents.RIDER_CREDIT_CHANGED, {
      riderId,
      prevScore,
      newScore,
      changeAmount,
      action,
      levelChange: levelChange.changed
        ? { changed: true, direction: levelChange.direction, oldLevel: levelChange.oldLevel, newLevel: levelChange.newLevel }
        : { changed: false },
      orderId,
      recordId: recordResult.insertId,
    });

    logger.info(
      `骑手 ${riderId} 信用分变更: ${prevScore} → ${newScore} (${changeAmount >= 0 ? '+' : ''}${changeAmount})`,
    );

    // 8. 返回结果
    return {
      rider_id: riderId,
      prev_score: prevScore,
      new_score: newScore,
      change_amount: changeAmount,
      change_type: changeType,
      action,
      level: newLevelInfo,
      level_changed: levelChange.changed,
      level_change_direction: levelChange.direction,
      record_id: recordResult.insertId,
    };
  } finally {
    await connection.end();
  }
}

module.exports = {
  getRiderCredit,
  getRiderHistory,
  updateCredit,
};
