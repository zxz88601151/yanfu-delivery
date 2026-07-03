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
 * 碳积分业务逻辑层
 *
 * @module ai_modules/carbon_credit/service
 */

const eventBus = require('../common/event-bus');
const carbonEvents = require('./events');
const emissionCalc = require('./emission-calc');
const accountManager = require('./account-manager');
const exchangeShop = require('./exchange-shop');
const greenIncentive = require('./green-incentive');
const riderGreenRank = require('./rider-green-rank');
const reportGenerator = require('./report-generator');
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
 * 获取碳积分账户
 *
 * @param {number} userId - 用户ID
 * @returns {Promise<Object>} 账户信息
 */
async function getAccount(userId) {
  try {
    return await accountManager.getOrCreateAccount(userId);
  } catch (err) {
    logger.error(`获取碳积分账户失败 userId=${userId}: ${err.message}`);
    throw err;
  }
}

/**
 * 获取积分明细（分页）
 *
 * @param {number} userId - 用户ID
 * @param {number} [page=1] - 页码
 * @param {number} [size=20] - 每页条数
 * @returns {Promise<Object>} 分页数据
 */
async function getHistory(userId, page, size) {
  try {
    return await accountManager.getHistory(userId, page, size);
  } catch (err) {
    logger.error(`获取碳积分明细失败 userId=${userId}: ${err.message}`);
    throw err;
  }
}

/**
 * 记录配送碳排放
 *
 * 流程：
 * 1. 调用 emission-calc 的 recordEmission 计算并写入
 * 2. 根据车型计算积分奖励（电动车10分/摩托车5分/汽车0分）
 * 3. 调用 green-incentive 计算额外激励
 * 4. 调用 accountManager.addCredits 加积分
 * 5. 发布 carbon.emission.recorded 事件
 * 6. 返回完整结果
 *
 * @param {number} orderId - 订单ID
 * @param {number} riderId - 骑手ID
 * @param {number} distance - 配送距离（米）
 * @param {number} vehicleType - 车辆类型
 * @returns {Promise<Object>} 完整结果
 */
async function recordDelivery(orderId, riderId, distance, vehicleType) {
  try {
    // 1. 记录碳排放
    const emissionResult = await emissionCalc.recordEmission(orderId, riderId, distance, vehicleType);

    // 2. 计算基础积分奖励
    const baseCredits = emissionCalc.getCreditsEarned(vehicleType, distance);

    // 3. 计算绿色激励
    const incentive = await greenIncentive.getGreenBonus(vehicleType, new Date(), riderId);

    // 4. 总积分奖励
    const totalCredits = baseCredits + incentive.bonus;

    // 5. 如果有积分奖励，增加积分
    let creditResult = null;
    if (totalCredits > 0) {
      const reasons = [];
      if (baseCredits > 0) reasons.push(`绿色配送奖励${baseCredits}积分`);
      if (incentive.bonus > 0) reasons.push(incentive.reason);
      creditResult = await accountManager.addCredits(riderId, totalCredits, reasons.join('+'), orderId);
    }

    // 6. 发布事件
    eventBus.emitEvent(carbonEvents.CARBON_EMISSION_RECORDED, {
      orderId, riderId, distance, vehicleType,
      emission: emissionResult.emission, saved: emissionResult.saved,
      baseCredits, incentiveBonus: incentive.bonus, totalCredits,
    });

    logger.info(`配送碳记录完成: 骑手 ${riderId}, 订单 ${orderId}, 排放 ${emissionResult.emission}kg, 积分 ${totalCredits}`);

    return {
      emission: { id: emissionResult.emissionId, emission: emissionResult.emission, saved: emissionResult.saved },
      credits: { earned: totalCredits, base: baseCredits, bonus: incentive.bonus, bonusReason: incentive.reason, balanceAfter: creditResult ? creditResult.available : null },
    };
  } catch (err) {
    logger.error(`记录配送碳排放失败 orderId=${orderId}: ${err.message}`);
    throw err;
  }
}

/**
 * 积分兑换
 *
 * @param {number} userId - 用户ID
 * @param {number} productId - 商品ID
 * @returns {Promise<Object>} 兑换记录
 */
async function exchangeCredits(userId, productId) {
  try {
    return await exchangeShop.exchange(userId, productId);
  } catch (err) {
    logger.error(`碳积分兑换失败 userId=${userId}: ${err.message}`);
    throw err;
  }
}

/**
 * 获取商品列表
 *
 * @returns {Array} 商品列表
 */
async function getProducts() {
  try {
    return exchangeShop.getProducts();
  } catch (err) {
    logger.error('获取碳积分商品列表失败', err);
    return [];
  }
}

/**
 * 获取骑手绿色排行
 *
 * @param {number} [page=1] - 页码
 * @param {number} [size=20] - 每页条数
 * @returns {Promise<Object>} 排行数据
 */
async function getRiderRanking(page, size) {
  try {
    return await riderGreenRank.getRanking(page, size);
  } catch (err) {
    logger.error('获取骑手绿色排行失败', err);
    throw err;
  }
}

/**
 * 获取碳足迹ESG报告
 *
 * @param {number} userId - 用户ID
 * @param {string} startDate - 开始日期
 * @param {string} endDate - 结束日期
 * @returns {Promise<Object>} ESG报告
 */
async function getEsgReport(userId, startDate, endDate) {
  try {
    return await reportGenerator.generateReport(userId, startDate, endDate);
  } catch (err) {
    logger.error(`获取ESG报告失败 userId=${userId}: ${err.message}`);
    throw err;
  }
}

module.exports = {
  getAccount,
  getHistory,
  recordDelivery,
  exchangeCredits,
  getProducts,
  getRiderRanking,
  getEsgReport,
};
