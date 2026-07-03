'use strict';

/**
 * 碳积分账户管理
 *
 * @module ai_modules/carbon_credit/account-manager
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
      filename: path.join(process.env.KUAILV_LOG_DIR || './logs', 'carbon-credit.log'),
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
 * 获取或创建碳积分账户
 *
 * @param {number} userId - 用户ID
 * @returns {Promise<Object>} 账户信息
 * @throws {Error} 数据库错误
 */
async function getOrCreateAccount(userId) {
  const connection = await mysql.createConnection(config.db);
  try {
    let [accounts] = await connection.query(
      'SELECT * FROM ai_carbon_credit_accounts WHERE user_id = ?',
      [userId],
    );

    // 不存在则创建默认账户
    if (accounts.length === 0) {
      await connection.query(
        `INSERT INTO ai_carbon_credit_accounts
         (user_id, total_credits, total_reduction, used_credits)
         VALUES (?, 0, 0, 0)`,
        [userId],
      );

      [accounts] = await connection.query(
        'SELECT * FROM ai_carbon_credit_accounts WHERE user_id = ?',
        [userId],
      );
    }

    const account = accounts[0];
    return {
      id: account.id,
      user_id: account.user_id,
      total_credits: account.total_credits,
      total_reduction: account.total_reduction,
      used_credits: account.used_credits,
      available_credits: account.total_credits - account.used_credits,
      created_at: account.created_at,
      updated_at: account.updated_at,
    };
  } finally {
    await connection.end();
  }
}

/**
 * 写入积分变更明细（内部方法）
 *
 * @param {import('mysql2/promise').Connection} connection - 数据库连接
 * @param {number} userId - 用户ID
 * @param {number} changeType - 变动类型: 1=收入 2=支出
 * @param {number} amount - 变动积分数
 * @param {number} balanceAfter - 变动后可用余额
 * @param {string} reason - 原因
 * @param {number} [orderId] - 关联订单ID
 * @returns {Promise<number>} 记录ID
 * @private
 */
async function _writeLog(connection, userId, changeType, amount, balanceAfter, reason, orderId) {
  const [result] = await connection.query(
    `INSERT INTO ai_carbon_credit_accounts_log
     (user_id, change_type, amount, balance_after, reason, order_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [userId, changeType, amount, balanceAfter, reason, orderId || null],
  );
  return result.insertId;
}

/**
 * 增加碳积分
 *
 * @param {number} userId - 用户ID
 * @param {number} amount - 增加数量
 * @param {string} reason - 增加原因
 * @param {number} [orderId] - 关联订单ID（可选）
 * @returns {Promise<{ available: number, total: number, logId: number }>}
 */
async function addCredits(userId, amount, reason, orderId) {
  const connection = await mysql.createConnection(config.db);
  try {
    // 更新 total_credits
    await connection.query(
      'UPDATE ai_carbon_credit_accounts SET total_credits = total_credits + ? WHERE user_id = ?',
      [amount, userId],
    );

    // 查询新余额
    const [accounts] = await connection.query(
      'SELECT * FROM ai_carbon_credit_accounts WHERE user_id = ?',
      [userId],
    );

    if (accounts.length === 0) {
      const err = getErrorByCode(7003);
      throw Object.assign(new Error(err.message), { code: err.code });
    }

    const account = accounts[0];
    const available = account.total_credits - account.used_credits;

    // 写入积分明细
    const logId = await _writeLog(connection, userId, 1, amount, available, reason, orderId);

    logger.info(`碳积分增加: 用户 ${userId}, +${amount} 积分, 原因: ${reason}`);

    return { available, total: account.total_credits, logId };
  } finally {
    await connection.end();
  }
}

/**
 * 扣除碳积分（兑换时）
 *
 * @param {number} userId - 用户ID
 * @param {number} amount - 扣除数量
 * @param {string} reason - 扣除原因
 * @param {number} [refId] - 关联兑换记录ID（可选）
 * @returns {Promise<{ available: number, total: number, logId: number }>}
 * @throws {Error} 当积分不足时抛出 7001 错误
 */
async function deductCredits(userId, amount, reason, refId) {
  const connection = await mysql.createConnection(config.db);
  try {
    // 查询当前账户
    const [accounts] = await connection.query(
      'SELECT * FROM ai_carbon_credit_accounts WHERE user_id = ?',
      [userId],
    );

    if (accounts.length === 0) {
      const err = getErrorByCode(7003);
      throw Object.assign(new Error(err.message), { code: err.code });
    }

    const account = accounts[0];
    const available = account.total_credits - account.used_credits;

    // 检查可用积分是否充足
    if (available < amount) {
      const err = getErrorByCode(7001);
      throw Object.assign(new Error(err.message), { code: err.code });
    }

    // 更新 used_credits
    await connection.query(
      'UPDATE ai_carbon_credit_accounts SET used_credits = used_credits + ? WHERE user_id = ?',
      [amount, userId],
    );

    // 查询新余额
    const [updatedAccounts] = await connection.query(
      'SELECT * FROM ai_carbon_credit_accounts WHERE user_id = ?',
      [userId],
    );

    const updatedAccount = updatedAccounts[0];
    const newAvailable = updatedAccount.total_credits - updatedAccount.used_credits;

    // 写入积分明细
    const logId = await _writeLog(connection, userId, 2, amount, newAvailable, reason, refId);

    logger.info(`碳积分扣除: 用户 ${userId}, -${amount} 积分, 原因: ${reason}`);

    return { available: newAvailable, total: updatedAccount.total_credits, logId };
  } finally {
    await connection.end();
  }
}

/**
 * 获取积分明细（分页）
 *
 * @param {number} userId - 用户ID
 * @param {number} [page=1] - 页码
 * @param {number} [size=20] - 每页条数
 * @returns {Promise<{ total: number, page: number, size: number, items: Array }>}
 */
async function getHistory(userId, page, size) {
  const connection = await mysql.createConnection(config.db);
  try {
    const currentPage = Math.max(1, page || 1);
    const pageSize = Math.max(1, Math.min(100, size || 20));
    const offset = (currentPage - 1) * pageSize;

    // 查询总数
    const [countResult] = await connection.query(
      'SELECT COUNT(*) AS total FROM ai_carbon_credit_accounts_log WHERE user_id = ?',
      [userId],
    );
    const total = countResult[0].total;

    // 查询分页数据
    const [items] = await connection.query(
      'SELECT * FROM ai_carbon_credit_accounts_log WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
      [userId, pageSize, offset],
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

module.exports = {
  getOrCreateAccount,
  addCredits,
  deductCredits,
  getHistory,
};
