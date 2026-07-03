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
 * 申诉与复核管理
 *
 * @module ai_modules/credit_passport/appeal-manager
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
 * 提交申诉
 *
 * 流程：
 * 1. 校验信用变动记录是否存在
 * 2. 校验该记录是否已提交申诉（避免重复）
 * 3. 更新信用变动记录状态为申诉中(1)
 * 4. 写入申诉记录
 * 5. 返回申诉记录
 *
 * @param {number} riderId - 骑手ID
 * @param {number} creditRecordId - 信用变动记录ID
 * @param {string} reason - 申诉原因
 * @param {number} [orderId] - 关联订单ID（可选）
 * @returns {Promise<Object>} 申诉记录
 */
async function submitAppeal(riderId, creditRecordId, reason, orderId) {
  const connection = await _getConnection();
  try {
    // 1. 查询信用变动记录是否存在
    const [records] = await connection.query(
      'SELECT * FROM ai_credit_passports WHERE id = ? AND rider_id = ?',
      [creditRecordId, riderId],
    );

    if (records.length === 0) {
      const error = getErrorByCode(6002); // CREDIT_APPEAL_NOT_FOUND
      throw Object.assign(new Error(error.message), { code: error.code });
    }

    const record = records[0];

    // 2. 校验是否已申诉（status = 1 表示申诉中）
    if (record.status === 1) {
      const error = getErrorByCode(6003); // CREDIT_APPEAL_DUPLICATE
      throw Object.assign(new Error(error.message), { code: error.code });
    }

    // 3. 更新信用变动记录状态为申诉中(1)
    await connection.query(
      'UPDATE ai_credit_passports SET status = 1 WHERE id = ?',
      [creditRecordId],
    );

    // 4. 写入申诉记录
    const [appealResult] = await connection.query(
      `INSERT INTO ai_credit_appeals
       (rider_id, credit_record_id, reason, order_id, status)
       VALUES (?, ?, ?, ?, 'pending')`,
      [riderId, creditRecordId, reason, orderId || null],
    );

    // 5. 查询完整申诉记录
    const [appeals] = await connection.query(
      'SELECT * FROM ai_credit_appeals WHERE id = ?',
      [appealResult.insertId],
    );

    logger.info(`骑手 ${riderId} 提交申诉成功，申诉ID: ${appealResult.insertId}`);

    return appeals[0];
  } finally {
    await connection.end();
  }
}

/**
 * 复核申诉
 *
 * @param {number} appealId - 申诉ID
 * @param {string} action - 复核动作: 'approve' | 'reject'
 * @param {string} [reviewerNote] - 复核备注
 * @returns {Promise<Object>} 处理结果
 */
async function reviewAppeal(appealId, action, reviewerNote) {
  const connection = await _getConnection();
  try {
    // 1. 查询申诉记录
    const [appeals] = await connection.query(
      'SELECT * FROM ai_credit_appeals WHERE id = ?',
      [appealId],
    );

    if (appeals.length === 0) {
      const error = getErrorByCode(6002); // CREDIT_APPEAL_NOT_FOUND
      throw Object.assign(new Error(error.message), { code: error.code });
    }

    const appeal = appeals[0];

    if (appeal.status !== 'pending') {
      const error = getErrorByCode(6005); // CREDIT_APPEAL_STATUS_INVALID
      throw Object.assign(new Error(error.message), { code: error.code });
    }

    if (action === 'approve') {
      // 2a. 申诉通过 - 回滚信用分变更

      // 查询信用变动记录
      const [records] = await connection.query(
        'SELECT * FROM ai_credit_passports WHERE id = ?',
        [appeal.credit_record_id],
      );

      if (records.length > 0) {
        const record = records[0];
        if (!record || record.change_amount == null) {
          throw Object.assign(new Error('申诉记录数据异常，无法回滚'), { code: 6001 });
        }

        // 回滚：扣分的变加分，加分的变扣分
        const rollbackAmount = record.change_type === 2
          ? Math.abs(record.change_amount)   // 原扣分 → 加回
          : -Math.abs(record.change_amount); // 原加分 → 扣回

        const rollbackType = record.change_type === 2 ? 1 : 2;

        // 更新骑手信用总分
        await connection.query(
          `UPDATE ai_rider_credits
           SET total_score = GREATEST(0, LEAST(1000, total_score + ?)),
               updated_at = CURRENT_TIMESTAMP
           WHERE rider_id = ?`,
          [rollbackAmount, appeal.rider_id],
        );

        // 写入回滚变动记录
        await connection.query(
          `INSERT INTO ai_credit_passports
           (rider_id, change_type, change_amount, reason, order_id, status)
           VALUES (?, ?, ?, 'appeal_rollback', ?, 2)`,
          [appeal.rider_id, rollbackType, Math.abs(rollbackAmount), appeal.order_id || null],
        );

        // 更新原信用变动记录状态为申诉通过已回滚(2)
        await connection.query(
          'UPDATE ai_credit_passports SET status = 2 WHERE id = ?',
          [appeal.credit_record_id],
        );
      }

      // 更新申诉记录状态
      await connection.query(
        "UPDATE ai_credit_appeals SET status = 'approved', reviewer_note = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?",
        [reviewerNote || null, appealId],
      );

      logger.info(`申诉 ${appealId} 审核通过，已回滚信用分变更`);
    } else {
      // 2b. 申诉拒绝 - 状态设为正常(0)
      await connection.query(
        'UPDATE ai_credit_passports SET status = 0 WHERE id = ?',
        [appeal.credit_record_id],
      );

      // 更新申诉记录状态
      await connection.query(
        "UPDATE ai_credit_appeals SET status = 'rejected', reviewer_note = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?",
        [reviewerNote || null, appealId],
      );

      logger.info(`申诉 ${appealId} 审核驳回`);
    }

    // 查询更新后的申诉记录
    const [updatedAppeals] = await connection.query(
      'SELECT * FROM ai_credit_appeals WHERE id = ?',
      [appealId],
    );

    return updatedAppeals[0];
  } finally {
    await connection.end();
  }
}

module.exports = {
  submitAppeal,
  reviewAppeal,
};
