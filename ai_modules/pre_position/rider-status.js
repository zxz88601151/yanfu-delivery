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
 * 骑手预置状态管理（状态机/超时/迟到判定）
 *
 * @module ai_modules/pre_position/rider-status
 */

const mysql = require('mysql2/promise');
const config = require('../../config/ai_modules');
const { getErrorByCode } = require('../../config/error_codes');
const eventBus = require('../common/event-bus');
const dispatchEngine = require('./dispatch-engine');
const preEvents = require('./events');
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

/**
 * 检查是否迟到
 *
 * @param {Date} arrivedAt - 到达时间
 * @param {Date|string} surgeStart - 预测爆单开始时间
 * @returns {boolean}
 */
function checkIsLate(arrivedAt, surgeStart) {
  const arrive = new Date(arrivedAt);
  const start = new Date(surgeStart);
  return arrive > start;
}

/**
 * 检查是否早到（提前≥10分钟到达）
 *
 * @param {Date} arrivedAt - 到达时间
 * @param {Date|string} surgeStart - 预测爆单开始时间
 * @returns {boolean}
 */
function checkIsEarly(arrivedAt, surgeStart) {
  const arrive = new Date(arrivedAt);
  const start = new Date(surgeStart);
  const diffMs = start.getTime() - arrive.getTime();
  return diffMs >= 10 * 60 * 1000; // ≥10分钟
}

/**
 * 检查当日保底次数是否超限
 *
 * @param {number} riderId - 骑手ID
 * @param {string} [date] - 日期 YYYY-MM-DD
 * @returns {Promise<boolean>}
 */
async function checkDailyGuaranteeLimit(riderId, date) {
  const connection = await mysql.createConnection(config.db);
  try {
    const targetDate = date || new Date().toISOString().slice(0, 10);
    const [rows] = await connection.query(
      `SELECT daily_guarantee_count FROM ai_rider_pre_position_status
       WHERE rider_id = ?`,
      [riderId],
    );

    if (rows.length === 0) {
      return false;
    }

    const limit = ppConfig.dailyGuaranteeLimit || 5;
    return (rows[0].daily_guarantee_count || 0) >= limit;
  } finally {
    await connection.end();
  }
}

/**
 * 骑手接受调度
 *
 * 状态流转：
 *   待响应(0) → 已接受(1) → 前往中(pre=1)
 *
 * @param {number} dispatchId - 调度记录ID
 * @param {number} riderId - 骑手ID
 * @returns {Promise<Object>} 响应结果
 */
async function handleAccept(dispatchId, riderId) {
  const connection = await mysql.createConnection(config.db);
  try {
    // 查询调度记录
    const [dispatches] = await connection.query(
      'SELECT * FROM ai_dispatch_records WHERE id = ? AND rider_id = ?',
      [dispatchId, riderId],
    );

    if (dispatches.length === 0) {
      const err = getErrorByCode(4004);
      throw Object.assign(new Error(err.message), { code: err.code });
    }

    const dispatch = dispatches[0];

    // 检查是否已过期
    if (new Date(dispatch.expire_at) < new Date()) {
      const err = getErrorByCode(4005);
      throw Object.assign(new Error(err.message), { code: err.code });
    }

    // 检查是否已响应
    if (dispatch.status !== 0) {
      const err = getErrorByCode(4006);
      throw Object.assign(new Error(err.message), { code: err.code });
    }

    // 更新调度记录状态
    await connection.query(
      `UPDATE ai_dispatch_records
       SET status = 1, respond_action = 'accept', responded_at = NOW()
       WHERE id = ?`,
      [dispatchId],
    );

    // 创建或更新骑手预置状态
    const [existingStatus] = await connection.query(
      'SELECT * FROM ai_rider_pre_position_status WHERE rider_id = ?',
      [riderId],
    );

    if (existingStatus.length === 0) {
      await connection.query(
        `INSERT INTO ai_rider_pre_position_status
         (rider_id, dispatch_record_id, pre_status, target_district_id,
          surge_start, surge_end)
         VALUES (?, ?, 1, ?, ?, ?)`,
        [riderId, dispatchId, dispatch.target_district_id, dispatch.surge_start, dispatch.surge_end],
      );
    } else {
      await connection.query(
        `UPDATE ai_rider_pre_position_status
         SET dispatch_record_id = ?, pre_status = 1, target_district_id = ?,
             surge_start = ?, surge_end = ?, updated_at = NOW()
         WHERE rider_id = ?`,
        [dispatchId, dispatch.target_district_id, dispatch.surge_start, dispatch.surge_end, riderId],
      );
    }

    // 发布事件
    eventBus.emitEvent(preEvents.PRE_POSITION_DISPATCH_RESPONDED, {
      dispatchId,
      riderId,
      action: 'accept',
    });

    logger.info(`[PrePosition][rider-status] 骑手接受调度 dispatch=${dispatchId} rider=${riderId}`);

    return {
      dispatch_id: dispatchId,
      status: 1,
      status_label: '已接受',
      target_location: {
        lng: dispatch.target_lng || 0,
        lat: dispatch.target_lat || 0,
      },
      target_district_id: dispatch.target_district_id,
      expected_arrive_before: new Date(
        new Date().getTime() + (ppConfig.enrouteTimeoutMinutes || 20) * 60 * 1000,
      ).toISOString(),
      incentive_fee: dispatch.incentive_total,
    };
  } finally {
    await connection.end();
  }
}

/**
 * 骑手拒绝调度
 *
 * @param {number} dispatchId - 调度记录ID
 * @param {number} riderId - 骑手ID
 * @param {string} [reason] - 拒绝原因
 * @returns {Promise<void>}
 */
async function handleReject(dispatchId, riderId, reason) {
  const connection = await mysql.createConnection(config.db);
  try {
    const [dispatches] = await connection.query(
      'SELECT * FROM ai_dispatch_records WHERE id = ? AND rider_id = ?',
      [dispatchId, riderId],
    );

    if (dispatches.length === 0) {
      const err = getErrorByCode(4004);
      throw Object.assign(new Error(err.message), { code: err.code });
    }

    const dispatch = dispatches[0];

    if (dispatch.status !== 0) {
      const err = getErrorByCode(4006);
      throw Object.assign(new Error(err.message), { code: err.code });
    }

    // 更新调度记录
    await connection.query(
      `UPDATE ai_dispatch_records
       SET status = 4, respond_action = 'reject', reject_reason = ?,
           responded_at = NOW()
       WHERE id = ?`,
      [reason || 'other', dispatchId],
    );

    // 发布事件
    eventBus.emitEvent(preEvents.PRE_POSITION_DISPATCH_RESPONDED, {
      dispatchId,
      riderId,
      action: 'reject',
      reason: reason || 'other',
    });

    logger.info(`[PrePosition][rider-status] 骑手拒绝调度 dispatch=${dispatchId} rider=${riderId} reason=${reason}`);

    // 触发备选调度
    await tryAlternativeDispatch(dispatch);
  } finally {
    await connection.end();
  }
}

/**
 * 骑手到达标记
 *
 * @param {number} dispatchId - 调度记录ID
 * @param {number} riderId - 骑手ID
 * @param {Object} location - { lng, lat }
 * @param {Date|string} [arrivedAt] - 到达时间
 * @returns {Promise<Object>} 到达结果
 */
async function handleArrive(dispatchId, riderId, location, arrivedAt) {
  const connection = await mysql.createConnection(config.db);
  try {
    const [dispatches] = await connection.query(
      'SELECT * FROM ai_dispatch_records WHERE id = ? AND rider_id = ?',
      [dispatchId, riderId],
    );

    if (dispatches.length === 0) {
      const err = getErrorByCode(4004);
      throw Object.assign(new Error(err.message), { code: err.code });
    }

    const dispatch = dispatches[0];

    // 检查是否已到达
    if (dispatch.status === 2) {
      const err = getErrorByCode(4008);
      throw Object.assign(new Error(err.message), { code: err.code });
    }

    // 仅接受或已完成状态可以标记到达
    if (dispatch.status !== 1 && dispatch.status !== 0) {
      const err = getErrorByCode(4007);
      throw Object.assign(new Error('当前状态不允许标记到达'), { code: err.code });
    }

    const arriveTime = arrivedAt ? new Date(arrivedAt) : new Date();

    // 检查迟到/早到
    const isLate = checkIsLate(arriveTime, dispatch.surge_start);
    const isEarly = checkIsEarly(arriveTime, dispatch.surge_start);

    let newStatus = 2;
    let earlyBonus = 0;
    let incentiveTotal = parseFloat(dispatch.incentive_total);

    if (isEarly) {
      earlyBonus = ppConfig.earlyArrivalBonus || 1.0;
    }

    if (isLate) {
      newStatus = 6; // 迟到标记
      const penalty = ppConfig.lateArrivalPenalty || 0.5;
      incentiveTotal = parseFloat((incentiveTotal * penalty).toFixed(2));
    }

    // 更新调度记录
    await connection.query(
      `UPDATE ai_dispatch_records
       SET status = ?, arrived_at = ?,
           rider_lng = ?, rider_lat = ?,
           early_arrival = ?, late_arrival = ?,
           incentive_early_bonus = ?,
           incentive_total = ?
       WHERE id = ?`,
      [
        newStatus,
        arriveTime,
        location.lng,
        location.lat,
        isEarly ? 1 : 0,
        isLate ? 1 : 0,
        earlyBonus,
        incentiveTotal,
        dispatchId,
      ],
    );

    // 更新骑手预置状态
    await connection.query(
      `UPDATE ai_rider_pre_position_status
       SET pre_status = 2, arrived_at = ?,
           arrived_lng = ?, arrived_lat = ?,
           current_lng = ?, current_lat = ?,
           wait_start = NOW(),
           updated_at = NOW()
       WHERE rider_id = ?`,
      [arriveTime, location.lng, location.lat, location.lng, location.lat, riderId],
    );

    // 计算爆单倒计时
    const surgeStartMs = new Date(dispatch.surge_start).getTime();
    const nowMs = arriveTime.getTime();
    const surgeCountdownSeconds = Math.max(0, Math.floor((surgeStartMs - nowMs) / 1000));

    // 发布事件
    eventBus.emitEvent(preEvents.PRE_POSITION_RIDER_ARRIVED, {
      dispatchId,
      riderId,
      districtId: dispatch.target_district_id,
      isLate,
      isEarly,
    });

    const result = {
      dispatch_id: dispatchId,
      status: newStatus,
      status_label: isLate ? '已到达（迟到）' : '已到达',
      arrived_at: arriveTime.toISOString(),
      surge_countdown_seconds: surgeCountdownSeconds,
      incentive_earned: incentiveTotal,
      incentive_breakdown: {
        base_fee: dispatch.incentive_base,
        time_factor: dispatch.incentive_time_factor,
        distance_subsidy: dispatch.incentive_distance_subsidy,
        early_bonus: earlyBonus,
        total: incentiveTotal,
      },
    };

    if (isLate) {
      result.warning = `您已迟到，激励费用将按 ${(ppConfig.lateArrivalPenalty || 0.5) * 100}% 发放`;
    } else {
      result.waiting_status = `预计爆单开始还有 ${Math.ceil(surgeCountdownSeconds / 60)} 分钟，请保持在线等待`;
    }

    logger.info(
      `[PrePosition][rider-status] 骑手到达 dispatch=${dispatchId} rider=${riderId} ` +
      `late=${isLate} early=${isEarly} incentive=${incentiveTotal}`,
    );

    return result;
  } finally {
    await connection.end();
  }
}

/**
 * 处理超时
 *
 * @param {number} dispatchId - 调度记录ID
 */
async function handleTimeout(dispatchId) {
  const connection = await mysql.createConnection(config.db);
  try {
    const [dispatches] = await connection.query(
      'SELECT * FROM ai_dispatch_records WHERE id = ?',
      [dispatchId],
    );

    if (dispatches.length === 0) {
      return;
    }

    const dispatch = dispatches[0];

    if (dispatch.status !== 0) {
      return;
    }

    // 更新为超时
    await connection.query(
      `UPDATE ai_dispatch_records
       SET status = 5, respond_action = 'timeout'
       WHERE id = ?`,
      [dispatchId],
    );

    // 发布事件
    eventBus.emitEvent(preEvents.PRE_POSITION_DISPATCH_RESPONDED, {
      dispatchId,
      riderId: dispatch.rider_id,
      action: 'timeout',
    });

    logger.info(`[PrePosition][rider-status] 调度超时 dispatch=${dispatchId} rider=${dispatch.rider_id}`);

    // 触发备选调度
    await tryAlternativeDispatch(dispatch);
  } finally {
    await connection.end();
  }
}

/**
 * 处理取消
 *
 * @param {number} dispatchId - 调度记录ID
 * @param {number} riderId - 骑手ID
 */
async function handleCancel(dispatchId, riderId) {
  const connection = await mysql.createConnection(config.db);
  try {
    const [dispatches] = await connection.query(
      'SELECT * FROM ai_dispatch_records WHERE id = ? AND rider_id = ?',
      [dispatchId, riderId],
    );

    if (dispatches.length === 0) {
      return;
    }

    const dispatch = dispatches[0];

    if (dispatch.status !== 1) {
      return;
    }

    // 检查取消窗口（5分钟）
    const respondedAt = new Date(dispatch.responded_at);
    const now = new Date();
    const diffMs = now.getTime() - respondedAt.getTime();
    const cancelWindowMs = (ppConfig.cancelWindowMinutes || 5) * 60 * 1000;

    if (diffMs > cancelWindowMs) {
      throw Object.assign(new Error('已超过取消窗口时间'), { code: 4007 });
    }

    // 更新为取消
    await connection.query(
      `UPDATE ai_dispatch_records
       SET status = 7, respond_action = 'cancel'
       WHERE id = ?`,
      [dispatchId],
    );

    // 释放骑手
    await releaseRider(riderId);

    logger.info(`[PrePosition][rider-status] 骑手取消调度 dispatch=${dispatchId} rider=${riderId}`);
  } finally {
    await connection.end();
  }
}

/**
 * 释放骑手（恢复空闲状态）
 *
 * @param {number} riderId - 骑手ID
 */
async function releaseRider(riderId) {
  const connection = await mysql.createConnection(config.db);
  try {
    await connection.query(
      `UPDATE ai_rider_pre_position_status
       SET pre_status = 0, dispatch_record_id = NULL,
           wait_end = NOW(),
           total_wait_seconds = COALESCE(total_wait_seconds, 0) +
             COALESCE(TIMESTAMPDIFF(SECOND, wait_start, NOW()), 0),
           updated_at = NOW()
       WHERE rider_id = ?`,
      [riderId],
    );
  } finally {
    await connection.end();
  }
}

/**
 * 备选调度
 *
 * @param {Object} originalDispatch - 原始调度记录
 */
async function tryAlternativeDispatch(originalDispatch) {
  try {
    // 查询同区域同预测的其他待响应骑手
    const connection = await mysql.createConnection(config.db);
    try {
      const [backupDispatches] = await connection.query(
        `SELECT * FROM ai_dispatch_records
         WHERE prediction_id = ? AND target_district_id = ?
         AND status IN (4, 5)
         ORDER BY created_at DESC
         LIMIT 1`,
        [originalDispatch.prediction_id, originalDispatch.target_district_id],
      );

      if (backupDispatches.length === 0) {
        logger.warn(
          `[PrePosition][rider-status] 无备选骑手可用 prediction=${originalDispatch.prediction_id} ` +
          `district=${originalDispatch.target_district_id}`,
        );
        eventBus.emitEvent(preEvents.PRE_POSITION_RIDER_SHORTAGE, {
          districtId: originalDispatch.target_district_id,
          gap: 1,
          predictionId: originalDispatch.prediction_id,
        });
        return;
      }

      logger.info(
        `[PrePosition][rider-status] 触发备选调度 prediction=${originalDispatch.prediction_id} ` +
        `district=${originalDispatch.target_district_id}`,
      );
    } finally {
      await connection.end();
    }
  } catch (err) {
    logger.error(`[PrePosition][rider-status] 备选调度失败: ${err.message}`);
  }
}

/**
 * 扫描超时调度（cron 1分钟）
 * 1. 待响应超过10分钟 → 超时
 * 2. 前往中超过20分钟 → 迟到标记
 */
async function scanTimeouts() {
  const connection = await mysql.createConnection(config.db);
  try {
    // 1. 扫描待响应超时
    const [timeoutRecords] = await connection.query(
      `SELECT * FROM ai_dispatch_records
       WHERE status = 0 AND expire_at < NOW()`,
    );

    for (const record of timeoutRecords) {
      await handleTimeout(record.id);
    }

    // 2. 扫描前往途中超时（迟到）
    const [lateRecords] = await connection.query(
      `SELECT * FROM ai_dispatch_records
       WHERE status = 1
       AND DATE_ADD(responded_at, INTERVAL ? MINUTE) < NOW()
       AND arrived_at IS NULL`,
      [ppConfig.enrouteTimeoutMinutes || 20],
    );

    for (const record of lateRecords) {
      await connection.query(
        `UPDATE ai_dispatch_records
         SET status = 6, late_arrival = 1,
             incentive_total = incentive_total * ?
         WHERE id = ?`,
        [ppConfig.lateArrivalPenalty || 0.5, record.id],
      );

      logger.info(`[PrePosition][rider-status] 前往途中迟到标记 dispatch=${record.id} rider=${record.rider_id}`);
    }

    logger.info(
      `[PrePosition][rider-status] 超时扫描完成 timeout=${timeoutRecords.length} late=${lateRecords.length}`,
    );
  } finally {
    await connection.end();
  }
}

module.exports = {
  checkIsLate,
  checkIsEarly,
  checkDailyGuaranteeLimit,
  handleAccept,
  handleReject,
  handleArrive,
  handleTimeout,
  handleCancel,
  releaseRider,
  tryAlternativeDispatch,
  scanTimeouts,
};
