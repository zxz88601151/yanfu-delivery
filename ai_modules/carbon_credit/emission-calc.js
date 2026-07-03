'use strict';

/**
 * 碳排放计算引擎
 *
 * @module ai_modules/carbon_credit/emission-calc
 */

const mysql = require('mysql2/promise');
const config = require('../../config/ai_modules');
const { getErrorByCode } = require('../../config/error_codes');
const eventBus = require('../common/event-bus');
const carbonEvents = require('./events');
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
 * 车辆碳排系数表（g/km）
 * 1=电动车 2=摩托车 3=汽车
 */
const COEFFICIENTS = {
  1: { name: '电动车', co2: 0, vs_motorcycle: 80 },
  2: { name: '摩托车', co2: 80, vs_motorcycle: 0 },
  3: { name: '汽车', co2: 192, vs_motorcycle: -112 },
};

/**
 * 验证车辆类型是否有效
 *
 * @param {number} vehicleType - 车辆类型
 * @returns {boolean}
 */
function isValidVehicleType(vehicleType) {
  return vehicleType === 1 || vehicleType === 2 || vehicleType === 3;
}

/**
 * 计算单次配送碳排放
 *
 * 公式：emission = distance(m) * coeff(g/km) / 1000 → kg
 * 公式：saved = distance(m) * vs_motorcycle(g/km) / 1000 → kg
 *
 * @param {number} distance - 配送距离（米）
 * @param {number} vehicleType - 车辆类型: 1=电动车 2=摩托车 3=汽车
 * @returns {{ emission: number, saved: number }} 碳排放(kg) 和 相比摩托车减排量(kg)
 * @throws {Error} 当车辆类型无效时抛出错误
 */
function calculateEmission(distance, vehicleType) {
  if (!isValidVehicleType(vehicleType)) {
    const err = getErrorByCode(7005);
    throw Object.assign(new Error(err.message), { code: err.code });
  }

  const coeff = COEFFICIENTS[vehicleType];
  const emission = parseFloat(((distance * coeff.co2) / 1000).toFixed(2));
  const saved = parseFloat(((distance * coeff.vs_motorcycle) / 1000).toFixed(2));

  return { emission, saved };
}

/**
 * 绿色积分奖励规则
 *
 * @param {number} vehicleType - 车辆类型
 * @param {number} distance - 配送距离（米）
 * @returns {number} 奖励积分数
 */
function getCreditsEarned(vehicleType, distance) {
  // 电动车配送：每完成1单奖励10碳积分（mileage >= 1000m）
  if (vehicleType === 1 && distance >= 1000) {
    return 10;
  }
  // 摩托车配送：每完成1单奖励5碳积分
  if (vehicleType === 2) {
    return 5;
  }
  // 汽车配送：不奖励
  return 0;
}

/**
 * 记录碳排放并更新账户减排量
 *
 * 流程：
 * 1. 计算排放量
 * 2. 写入 ai_carbon_emissions 表
 * 3. 更新账户累计减排量
 * 4. 发布 carbon.emission.recorded 事件
 *
 * @param {number} orderId - 订单ID
 * @param {number} riderId - 骑手ID
 * @param {number} distance - 配送距离（米）
 * @param {number} vehicleType - 车辆类型
 * @param {Function} [callback] - 完成回调（可选）
 * @returns {Promise<{ emissionId: number, emission: number, saved: number, creditsEarned: number }>}
 */
async function recordEmission(orderId, riderId, distance, vehicleType, callback) {
  const connection = await mysql.createConnection(config.db);
  try {
    // 1. 计算排放量
    const { emission, saved } = calculateEmission(distance, vehicleType);
    const coeff = COEFFICIENTS[vehicleType];
    const creditsEarned = getCreditsEarned(vehicleType, distance);

    // 2. 写入碳排放记录表
    const [result] = await connection.query(
      `INSERT INTO ai_carbon_emissions
       (order_id, rider_id, delivery_distance, vehicle_type, coefficient, emission, saved_vs_motorcycle)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [orderId, riderId, distance, vehicleType, coeff.co2, emission, saved],
    );

    const emissionId = result.insertId;

    // 3. 更新账户累计减排量
    await connection.query(
      `UPDATE ai_carbon_credit_accounts
       SET total_reduction = total_reduction + ?
       WHERE user_id = ?`,
      [saved, riderId],
    );

    // 4. 发布事件
    eventBus.emitEvent(carbonEvents.CARBON_EMISSION_RECORDED, {
      emissionId,
      orderId,
      riderId,
      distance,
      vehicleType,
      emission,
      saved,
      creditsEarned,
    });

    logger.info(
      `碳排放记录: 骑手 ${riderId}, 订单 ${orderId}, 排放 ${emission}kg, 减排 ${saved}kg, 积分 ${creditsEarned}`,
    );

    // 可选回调
    if (typeof callback === 'function') {
      callback(null, { emissionId, emission, saved, creditsEarned });
    }

    return { emissionId, emission, saved, creditsEarned };
  } catch (err) {
    logger.error(`记录碳排放失败: ${err.message}`);
    if (typeof callback === 'function') {
      callback(err);
    }
    throw err;
  } finally {
    await connection.end();
  }
}

module.exports = {
  COEFFICIENTS,
  calculateEmission,
  getCreditsEarned,
  recordEmission,
};
