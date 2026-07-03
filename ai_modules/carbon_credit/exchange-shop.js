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
 * 碳积分兑换商城
 *
 * @module ai_modules/carbon_credit/exchange-shop
 */

const mysql = require('mysql2/promise');
const config = require('../../config/ai_modules');
const { getErrorByCode } = require('../../config/error_codes');
const accountManager = require('./account-manager');
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
 * 预定义商品目录
 *
 * @type {Array<{ id: number, name: string, credits: number, rewardType: number, rewardValue: number }>}
 */
const PRODUCTS = [
  { id: 1, name: '5元优惠券', credits: 500, rewardType: 1, rewardValue: 5.00 },
  { id: 2, name: '10元优惠券', credits: 1000, rewardType: 1, rewardValue: 10.00 },
  { id: 3, name: '免配送费券', credits: 300, rewardType: 2, rewardValue: 4.00 },
  { id: 4, name: '15元优惠券', credits: 1500, rewardType: 1, rewardValue: 15.00 },
  { id: 5, name: '20元优惠券', credits: 2000, rewardType: 1, rewardValue: 20.00 },
];

/**
 * 获取商品列表
 *
 * @returns {Array<{ id: number, name: string, credits: number, rewardType: number, rewardValue: number }>}
 */
function getProducts() {
  return PRODUCTS.map((p) => ({ ...p }));
}

/**
 * 根据商品ID查找商品
 *
 * @param {number} productId - 商品ID
 * @returns {Object|null} 商品信息
 * @private
 */
function _findProduct(productId) {
  return PRODUCTS.find((p) => p.id === productId) || null;
}

/**
 * 积分兑换
 *
 * 流程：
 * 1. 查找商品
 * 2. 调用 accountManager.deductCredits 扣除积分
 * 3. 写入 ai_carbon_exchanges 表
 * 4. 返回兑换记录
 *
 * @param {number} userId - 用户ID
 * @param {number} productId - 商品ID
 * @returns {Promise<Object>} 兑换记录
 * @throws {Error} 当商品不存在时抛出 7004 错误
 */
async function exchange(userId, productId) {
  // 1. 查找商品
  const product = _findProduct(productId);
  if (!product) {
    const err = getErrorByCode(7004);
    throw Object.assign(new Error(err.message), { code: err.code });
  }

  // 2. 扣除积分前查询余额
  const account = await accountManager.getOrCreateAccount(userId);
  const beforeCredits = account.available_credits;

  // 3. 扣除积分
  const deductResult = await accountManager.deductCredits(
    userId,
    product.credits,
    `兑换: ${product.name}`,
    productId,
  );

  // 4. 写入兑换记录
  const connection = await mysql.createConnection(config.db);
  try {
    const [result] = await connection.query(
      `INSERT INTO ai_carbon_exchanges
       (user_id, credits_used, reward_type, reward_value, status)
       VALUES (?, ?, ?, ?, 0)`,
      [userId, product.credits, product.rewardType, product.rewardValue],
    );

    const exchangeRecord = {
      id: result.insertId,
      user_id: userId,
      product_name: product.name,
      credits_used: product.credits,
      reward_type: product.rewardType,
      reward_value: product.rewardValue,
      status: 0,
      before_credits: beforeCredits,
      after_credits: deductResult.available,
      created_at: new Date(),
    };

    logger.info(`积分兑换成功: 用户 ${userId}, 商品 ${product.name}, 消耗 ${product.credits} 积分`);

    return exchangeRecord;
  } catch (err) {
    logger.error(`积分兑换失败: ${err.message}`);
    const exchangeErr = getErrorByCode(7002);
    throw Object.assign(new Error(exchangeErr.message), { code: exchangeErr.code });
  } finally {
    await connection.end();
  }
}

module.exports = {
  PRODUCTS,
  getProducts,
  exchange,
};
