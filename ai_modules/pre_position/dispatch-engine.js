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
 * 调度匹配引擎 + 激励计算
 *
 * @module ai_modules/pre_position/dispatch-engine
 */

const mysql = require('mysql2/promise');
const config = require('../../config/ai_modules');
const { getErrorByCode } = require('../../config/error_codes');
const { getTimeSlot } = require('../common/date-utils');
const NodeCache = require('node-cache');
const winston = require('winston');
const path = require('path');

const logger = winston.createLogger({
  level: process.env.KUAILV_LOG_LEVEL || 'info',
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({
      filename: path.join(process.env.KUAILV_LOG_DIR || './logs', 'pre-position.log'),
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

const ppConfig = config.prePosition;
const creditCache = new NodeCache({ stdTTL: ppConfig.creditScoreCacheTtl || 300, checkperiod: 60 });
const acceptRateCache = new NodeCache({ stdTTL: ppConfig.acceptRateCacheTtl || 3600, checkperiod: 300 });

/**
 * 匹配权重
 */
const MATCH_WEIGHTS = ppConfig.matchWeights || { distance: 0.4, credit: 0.35, acceptRate: 0.25 };

/**
 * 计算匹配优先级评分
 *
 * @param {Object} rider - 骑手信息 { distance, creditScore, acceptRate }
 * @returns {number} 综合评分 0~1
 */
function calcPriorityScore(rider) {
  // 距离评分：min(1.0, 最大距离内的线性衰减)
  const maxDistKm = ppConfig.maxDispatchDistanceKm || 3;
  const distanceScore = Math.max(0, Math.min(1.0, 1 - (rider.distance || 0) / maxDistKm));

  // 信用评分：信用分/1000
  const creditScore = Math.min(1.0, (rider.creditScore || 400) / 1000);

  // 接受率评分
  const acceptRateScore = rider.acceptRate || 0.5;

  const score =
    distanceScore * MATCH_WEIGHTS.distance +
    creditScore * MATCH_WEIGHTS.credit +
    acceptRateScore * MATCH_WEIGHTS.acceptRate;

  return parseFloat(score.toFixed(4));
}

/**
 * 获取模拟骑手数据（因无 riders 表）
 *
 * @param {number} districtId - 目标区域ID
 * @param {number} count - 需要数量
 * @returns {Promise<Array<Object>>} 模拟骑手列表
 * @private
 */
async function _getSimulatedRiders(districtId, count) {
  const riders = [];
  const baseCount = Math.max(count, 15);
  for (let i = 1; i <= baseCount; i++) {
    riders.push({
      riderId: 10000 + i,
      distance: Math.random() * 5, // 0~5km
      creditScore: 300 + Math.floor(Math.random() * 700), // 300~1000
      acceptRate: 0.3 + Math.random() * 0.7, // 0.3~1.0
      status: 'idle',
      lng: 116.3 + Math.random() * 0.2,
      lat: 39.8 + Math.random() * 0.2,
    });
  }
  return riders;
}

/**
 * 匹配骑手
 *
 * 筛选条件：
 * - 空闲状态
 * - ≤3km 距离
 * - 信用分 ≥ 400
 * - 未在当前活跃调度中
 *
 * @param {Object} prediction - 预测结果
 * @param {Array<Object>} [availableRiders] - 可用骑手列表（可选，用于测试/手动调度）
 * @returns {Promise<Array<Object>>} 排序后的骑手评分列表
 */
async function matchRiders(prediction, availableRiders) {
  const minCredit = ppConfig.minCreditScore || 400;
  const maxDistKm = ppConfig.maxDispatchDistanceKm || 3;
  const redundancyFactor = ppConfig.dispatchRedundancyFactor || 1.3;
  const neededCount = Math.ceil(prediction.recommendedRiders * redundancyFactor);

  let riders;
  if (availableRiders && availableRiders.length > 0) {
    riders = availableRiders;
  } else {
    // 使用模拟骑手数据
    riders = await _getSimulatedRiders(prediction.districtId, neededCount + 10);
  }

  // 筛选符合条件的骑手
  const qualifiedRiders = riders.filter((r) => {
    if (r.status !== 'idle') return false;
    if (r.distance > maxDistKm) return false;
    if (r.creditScore < minCredit) return false;
    return true;
  });

  if (qualifiedRiders.length === 0) {
    logger.warn(`[PrePosition][dispatch] 无可用骑手 district=${prediction.districtId}`);
    return [];
  }

  // 评分排序
  const scoredRiders = qualifiedRiders.map((r) => ({
    ...r,
    priorityScore: calcPriorityScore(r),
  }));

  scoredRiders.sort((a, b) => b.priorityScore - a.priorityScore);

  // 取前 N 名
  const topRiders = scoredRiders.slice(0, neededCount);

  logger.info(
    `[PrePosition][dispatch] 骑手匹配完成 district=${prediction.districtId} ` +
    `qualified=${qualifiedRiders.length} top=${topRiders.length} needed=${neededCount}`,
  );

  return topRiders;
}

/**
 * 计算时段系数
 *
 * @param {Date|string} time - 时间
 * @returns {number} 时段系数
 */
function calcTimeFactor(time) {
  const d = time ? new Date(time) : new Date();
  const hour = d.getHours();
  const minute = d.getMinutes();
  const totalMinutes = hour * 60 + minute;

  const periods = Object.entries(ppConfig.timeFactorByPeriod || {
    '00:00-06:00': 1.5,
    '06:00-09:00': 1.0,
    '09:00-11:00': 1.0,
    '11:00-14:00': 1.2,
    '14:00-17:00': 0.8,
    '17:00-21:00': 1.2,
    '21:00-24:00': 1.3,
  });

  for (const [period, factor] of periods) {
    const [startStr, endStr] = period.split('-');
    const [sh, sm] = startStr.split(':').map(Number);
    const [eh, em] = endStr.split(':').map(Number);
    const startMins = sh * 60 + sm;
    const endMins = eh * 60 + em;

    if (startMins <= endMins) {
      // 普通时段
      if (totalMinutes >= startMins && totalMinutes < endMins) {
        return factor;
      }
    } else {
      // 跨天时段（如 22:00-06:00）
      if (totalMinutes >= startMins || totalMinutes < endMins) {
        return factor;
      }
    }
  }

  return 1.0;
}

/**
 * 计算激励费用
 *
 * @param {number} intensity - 爆单强度 1~5
 * @param {Date|string} [time] - 当前时间
 * @param {number} [distanceKm] - 距离(km)
 * @returns {{ baseFee: number, timeFactor: number, distanceSubsidy: number, earlyBonus: number, total: number }}
 */
function calcIncentive(intensity, time, distanceKm) {
  const baseFeeMap = ppConfig.baseFeeByIntensity || [0, 2, 3, 4, 5, 6];
  const baseFee = baseFeeMap[intensity] || 2;

  const timeFactor = calcTimeFactor(time);

  const dist = distanceKm || 0;
  const distanceSubsidy = Math.min(
    dist * (ppConfig.distanceSubsidyPerKm || 1.0),
    ppConfig.maxDistanceSubsidy || 5.0,
  );

  // 早到奖励在 arrive 时计算
  const earlyBonus = 0;

  const total = parseFloat(((baseFee + distanceSubsidy) * timeFactor).toFixed(2));

  return {
    baseFee: parseFloat(baseFee.toFixed(2)),
    timeFactor: parseFloat(timeFactor.toFixed(2)),
    distanceSubsidy: parseFloat(distanceSubsidy.toFixed(2)),
    earlyBonus: parseFloat(earlyBonus.toFixed(2)),
    total,
  };
}

/**
 * 创建调度记录
 *
 * @param {Object} prediction - 预测记录
 * @param {Array<Object>} matchedRiders - 匹配骑手列表
 * @param {number} [dispatchSource=0] - 调度来源: 0=系统自动 1=运营手动
 * @param {number} [dispatchType=1] - 调度类型: 1=预置调度 2=补充调度
 * @returns {Promise<Object>} DispatchResult
 */
async function createDispatchRecords(prediction, matchedRiders, dispatchSource, dispatchType) {
  const connection = await mysql.createConnection(config.db);
  try {
    const source = dispatchSource || 0;
    const type = dispatchType || 1;
    const now = new Date();
    const expireAt = new Date(now.getTime() + (ppConfig.responseTimeoutMinutes || 10) * 60 * 1000);

    const dispatchItems = [];

    for (const rider of matchedRiders) {
      const incentive = calcIncentive(prediction.intensity, now, rider.distance);

      const [insertResult] = await connection.query(
        `INSERT INTO ai_dispatch_records
         (prediction_id, rider_id, target_district_id,
          target_lng, target_lat, rider_lng, rider_lat, distance_km,
          dispatch_type, dispatch_source, status,
          expire_at, surge_start, surge_end,
          incentive_base, incentive_time_factor, incentive_distance_subsidy,
          incentive_early_bonus, incentive_total)
         VALUES (?, ?, ?,
                 ?, ?, ?, ?, ?,
                 ?, ?, 0,
                 ?, ?, ?,
                 ?, ?, ?,
                 ?, ?)`,
        [
          prediction.predictionId,
          rider.riderId,
          prediction.districtId,
          prediction.targetLng || null,
          prediction.targetLat || null,
          rider.lng || null,
          rider.lat || null,
          parseFloat(rider.distance.toFixed(2)) || null,
          type,
          source,
          expireAt,
          prediction.surgeStart,
          prediction.surgeEnd,
          incentive.baseFee,
          incentive.timeFactor,
          incentive.distanceSubsidy,
          incentive.earlyBonus,
          incentive.total,
        ],
      );

      dispatchItems.push({
        dispatchId: insertResult.insertId,
        riderId: rider.riderId,
        status: 0,
        statusLabel: '待响应',
        incentiveFee: incentive.total,
        targetDistanceKm: parseFloat((rider.distance || 0).toFixed(2)),
        priorityScore: rider.priorityScore,
      });
    }

    const riderGap = Math.max(0, prediction.recommendedRiders - dispatchItems.length);

    logger.info(
      `[PrePosition][dispatch] 调度记录创建完成 prediction=${prediction.predictionId} ` +
      `dispatched=${dispatchItems.length} gap=${riderGap}`,
    );

    return {
      predictionId: prediction.predictionId,
      totalDispatched: dispatchItems.length,
      dispatches: dispatchItems,
      riderGap,
    };
  } finally {
    await connection.end();
  }
}

module.exports = {
  calcPriorityScore,
  matchRiders,
  calcIncentive,
  calcTimeFactor,
  createDispatchRecords,
};
