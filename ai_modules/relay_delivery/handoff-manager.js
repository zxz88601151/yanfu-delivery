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
 * 接力交接管理器
 *
 * 负责：
 * - 骑手到达接力点标记（含 GPS 校验）
 * - 交接确认（扫码/拍照/手动）
 * - 超时监控 + 备选调度
 * - 交接日志记录
 *
 * @module ai_modules/relay_delivery/handoff-manager
 */

const mysql = require('mysql2/promise');
const turf = require('@turf/turf');
const config = require('../../config/ai_modules');
const { getErrorByCode } = require('../../config/error_codes');
const { emitHandoffCompleted, emitSegmentFailed } = require('./events');

const rdConfig = config.relayDelivery;

// 超时监控器 Map: handoffId → { timerId, startTime, reminded }
const timeoutWatchers = new Map();

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
 * 写入交接日志
 *
 * @param {Object} data
 * @private
 */
async function _writeLog(data) {
  const connection = await _getConnection();
  try {
    await connection.query(
      `INSERT INTO ai_relay_handoff_logs (relay_order_id, handoff_id, action, rider_id, operator, detail)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        data.relayOrderId,
        data.handoffId,
        data.action,
        data.riderId || null,
        data.operator || 'system',
        data.detail ? JSON.stringify(data.detail) : null,
      ],
    );
  } finally {
    await connection.end();
  }
}

/**
 * 校验骑手是否在接力点范围内
 *
 * @param {number} handoffId - 接力段ID
 * @param {number} riderLng - 骑手经度
 * @param {number} riderLat - 骑手纬度
 * @returns {Promise<{ valid: boolean, distance: number, stationLng: number, stationLat: number }>}
 */
async function validateLocation(handoffId, riderLng, riderLat) {
  const connection = await _getConnection();
  try {
    const [handoffs] = await connection.query(
      `SELECT h.id, h.relay_order_id, h.to_lng, h.to_lat, rp.lng AS station_lng, rp.lat AS station_lat
       FROM ai_relay_handoffs h
       LEFT JOIN ai_relay_stations rp ON rp.lng = h.to_lng AND rp.lat = h.to_lat
       WHERE h.id = ?`,
      [handoffId],
    );

    if (handoffs.length === 0) {
      return { valid: false, distance: 999999, stationLng: 0, stationLat: 0 };
    }

    const targetLng = handoffs[0].station_lng || handoffs[0].to_lng;
    const targetLat = handoffs[0].station_lat || handoffs[0].to_lat;

    const from = turf.point([riderLng, riderLat]);
    const to = turf.point([targetLng, targetLat]);
    const distance = Math.round(turf.distance(from, to, { units: 'meters' }));

    const valid = distance <= rdConfig.arriveRadius;

    return { valid, distance, stationLng: targetLng, stationLat: targetLat };
  } finally {
    await connection.end();
  }
}

/**
 * 获取对接骑手信息
 *
 * @param {number} relayOrderId - 接力订单ID
 * @param {number} segmentSeq - 段序号
 * @returns {Promise<Object|null>}
 * @private
 */
async function _getCounterpartRider(relayOrderId, segmentSeq) {
  const connection = await _getConnection();
  try {
    const targetSeq = segmentSeq === 1 ? 2 : (segmentSeq === 2 ? 1 : null);
    if (!targetSeq) return null;

    const [rows] = await connection.query(
      `SELECT id, rider_id FROM ai_relay_handoffs
       WHERE relay_order_id = ? AND segment_seq = ?`,
      [relayOrderId, targetSeq],
    );

    if (rows.length === 0 || !rows[0].rider_id) {
      return null;
    }

    // 模拟骑手数据
    return {
      id: rows[0].rider_id,
      name: '骑手',
      phone: '138****xxxx',
      distance_to_station: 0,
      estimated_arrival_seconds: 300,
    };
  } finally {
    await connection.end();
  }
}

/**
 * 骑手到达接力点标记
 *
 * @param {number} handoffId - 交接段ID
 * @param {number} riderId - 骑手ID
 * @param {number} lng - 经度
 * @param {number} lat - 纬度
 * @param {string} [arrivedAt] - 到达时间
 * @returns {Promise<Object>}
 */
async function markArrive(handoffId, riderId, lng, lat, arrivedAt) {
  const connection = await _getConnection();
  try {
    // 1. 查询交接段信息
    const [handoffs] = await connection.query(
      'SELECT * FROM ai_relay_handoffs WHERE id = ?',
      [handoffId],
    );

    if (handoffs.length === 0) {
      const err = getErrorByCode(5003);
      throw Object.assign(new Error(err.message), { code: err.code });
    }

    const handoff = handoffs[0];

    // 2. 骑手校验
    if (handoff.rider_id && handoff.rider_id !== riderId) {
      const err = getErrorByCode(5006);
      throw Object.assign(new Error(err.message), { code: err.code });
    }

    // 3. GPS 位置校验
    const locationCheck = await validateLocation(handoffId, lng, lat);
    if (!locationCheck.valid) {
      // 距离超过 50m，但不阻止操作，仅记录
      await _writeLog({
        relayOrderId: handoff.relay_order_id,
        handoffId,
        action: 'arrive_location_warning',
        riderId,
        operator: 'system',
        detail: { lng, lat, distance: locationCheck.distance },
      });
    }

    const now = arrivedAt || new Date().toISOString().slice(0, 19).replace('T', ' ');

    // 4. 更新段状态
    await connection.query(
      `UPDATE ai_relay_handoffs SET status = 3, arrived_at = ? WHERE id = ?`,
      [now, handoffId],
    );

    // 5. 写入日志
    await _writeLog({
      relayOrderId: handoff.relay_order_id,
      handoffId,
      action: 'arrive',
      riderId,
      operator: `rider_${riderId}`,
      detail: { lng, lat, arrivedAt: now, locationValid: locationCheck.valid, distance: locationCheck.distance },
    });

    // 6. 获取对接骑手信息
    const counterpart = await _getCounterpartRider(handoff.relay_order_id, handoff.segment_seq);

    // 7. 启动超时监控（前段到达后开始计时）
    if (handoff.segment_seq === 1) {
      _startTimeoutMonitor(handoffId, handoff.relay_order_id);
    }

    // 8. 获取当前整个接力订单的状态
    const [segments] = await connection.query(
      'SELECT segment_seq, status FROM ai_relay_handoffs WHERE relay_order_id = ? ORDER BY segment_seq',
      [handoff.relay_order_id],
    );

    const allArrived = segments.every((s) => s.status >= 3);
    const counterpartStatus = segments.find((s) => s.segment_seq !== handoff.segment_seq);
    const isLastToArrive = allArrived;

    let nextAction = '等待对接骑手到达交接';
    if (isLastToArrive && counterpart && counterpartStatus && counterpartStatus.status >= 3) {
      nextAction = '双方已到达，请进行交接确认';
    }

    return {
      handoff_id: handoffId,
      segment_seq: handoff.segment_seq,
      status: 'arrived',
      counterpart_status: counterpartStatus && counterpartStatus.status >= 3 ? 'arrived' : 'pending',
      next_action: nextAction,
      counterpart_rider: counterpart || undefined,
    };
  } finally {
    await connection.end();
  }
}

/**
 * 交接确认
 *
 * @param {number} handoffId - 交接段ID
 * @param {number} riderId - 发起交接的骑手ID
 * @param {string} confirmMethod - 确认方式: scan_qr|photo|manual
 * @param {string} packageCondition - 包裹状况: good|damaged
 * @param {string} note - 备注
 * @param {number} [counterpartRiderId] - 对接骑手ID
 * @returns {Promise<Object>}
 */
async function confirmHandoff(handoffId, riderId, confirmMethod, packageCondition, note, counterpartRiderId) {
  const connection = await _getConnection();
  try {
    // 1. 查询交接段
    const [handoffs] = await connection.query(
      'SELECT * FROM ai_relay_handoffs WHERE id = ?',
      [handoffId],
    );

    if (handoffs.length === 0) {
      const err = getErrorByCode(5003);
      throw Object.assign(new Error(err.message), { code: err.code });
    }

    const handoff = handoffs[0];

    // 2. 状态校验：必须已到达才能交接
    if (handoff.status < 3) {
      const err = getErrorByCode(5004);
      throw Object.assign(new Error(err.message), { code: err.code });
    }
    if (handoff.status >= 4) {
      const err = getErrorByCode(5004);
      throw Object.assign(new Error(err.message), { code: err.code });
    }

    // 3. 骑手校验
    if (handoff.rider_id && handoff.rider_id !== riderId) {
      const err = getErrorByCode(5006);
      throw Object.assign(new Error(err.message), { code: err.code });
    }

    const now = new Date();
    const nowStr = now.toISOString().slice(0, 19).replace('T', ' ');

    // 4. 前段交接完成
    await connection.query(
      `UPDATE ai_relay_handoffs SET status = 4, handoff_at = ? WHERE id = ?`,
      [nowStr, handoffId],
    );

    // 5. 后段开始配送
    const nextSeq = handoff.segment_seq + 1;
    await connection.query(
      `UPDATE ai_relay_handoffs SET status = 2, picked_up_at = ? WHERE relay_order_id = ? AND segment_seq = ?`,
      [nowStr, handoff.relay_order_id, nextSeq],
    );

    // 6. 更新接力主表状态
    const [allSegments] = await connection.query(
      'SELECT COUNT(*) AS total, SUM(CASE WHEN status = 4 THEN 1 ELSE 0 END) AS completed FROM ai_relay_handoffs WHERE relay_order_id = ?',
      [handoff.relay_order_id],
    );

    const allCompleted = allSegments[0].total === allSegments[0].completed;

    await connection.query(
      `UPDATE ai_relay_orders SET status = ?, relay_completed_at = ? WHERE id = ?`,
      [allCompleted ? 3 : 2, allCompleted ? nowStr : null, handoff.relay_order_id],
    );

    // 7. 写入日志
    await _writeLog({
      relayOrderId: handoff.relay_order_id,
      handoffId,
      action: 'handoff',
      riderId,
      operator: `rider_${riderId}`,
      detail: { confirmMethod, packageCondition, note, handoffAt: nowStr },
    });

    // 8. 取消超时监控
    _stopTimeoutMonitor(handoffId);

    // 9. 发布事件
    emitHandoffCompleted({
      relayOrderId: handoff.relay_order_id,
      handoffId,
      segmentSeq: handoff.segment_seq,
      handoffAt: nowStr,
    });

    if (allCompleted) {
      const { emitOrderCompleted } = require('./events');
      emitOrderCompleted({
        relayOrderId: handoff.relay_order_id,
        orderId: handoff.order_id,
        segments: [],
        handoffTimes: [],
      });
    }

    // 10. 计算交接耗时
    const arrivedAt = handoff.arrived_at;
    const handoffDuration = arrivedAt
      ? Math.round((new Date(nowStr).getTime() - new Date(arrivedAt).getTime()) / 1000)
      : 0;

    // 11. 获取下一段信息
    const [nextHandoffs] = await connection.query(
      'SELECT * FROM ai_relay_handoffs WHERE relay_order_id = ? AND segment_seq = ?',
      [handoff.relay_order_id, nextSeq],
    );

    return {
      handoff_id: handoffId,
      segment_seq: handoff.segment_seq,
      status: 'completed',
      handoff_at: nowStr,
      handoff_duration_seconds: handoffDuration,
      next_rider: nextHandoffs.length > 0 && nextHandoffs[0].rider_id ? {
        id: nextHandoffs[0].rider_id,
        name: '骑手',
        phone: '138****xxxx',
        arrival_status: '已到达',
      } : null,
      next_segment: nextHandoffs.length > 0 ? {
        seq: nextHandoffs[0].segment_seq,
        label: nextHandoffs[0].segment_seq === 2 ? '后段' : '中段',
        from: { lng: nextHandoffs[0].from_lng, lat: nextHandoffs[0].from_lat, name: nextHandoffs[0].from_name },
        to: { lng: nextHandoffs[0].to_lng, lat: nextHandoffs[0].to_lat, name: nextHandoffs[0].to_name },
        distance: nextHandoffs[0].distance,
        estimated_time: nextHandoffs[0].estimated_time,
      } : null,
      status_update: 'relay.handoff.completed → WSPush 已推送用户进度更新',
    };
  } finally {
    await connection.end();
  }
}

/**
 * 启动超时监控
 *
 * @param {number} handoffId - 交接段ID
 * @param {number} relayOrderId - 接力订单ID
 * @private
 */
function _startTimeoutMonitor(handoffId, relayOrderId) {
  if (timeoutWatchers.has(handoffId)) {
    return; // 已经启动了监控
  }

  const handler = async () => {
    try {
      await scanHandoffTimeouts();
    } catch (err) {
      // 静默失败，下次扫描再试
    }
  };

  // 每 30 秒检查
  const timerId = setInterval(handler, 30000);

  timeoutWatchers.set(handoffId, {
    timerId,
    relayOrderId,
    startTime: Date.now(),
    reminded: false,
  });
}

/**
 * 停止超时监控
 *
 * @param {number} handoffId
 * @private
 */
function _stopTimeoutMonitor(handoffId) {
  if (timeoutWatchers.has(handoffId)) {
    clearInterval(timeoutWatchers.get(handoffId).timerId);
    timeoutWatchers.delete(handoffId);
  }
}

/**
 * 扫描所有超时的交接段（cron 调用）
 *
 * 规则：
 * - 前段到达后等待 > 5 分钟 → 推送提醒
 * - 前段到达后等待 > 10 分钟 → 触发备选方案
 *
 * @returns {Promise<{ checked: number, reminded: number, escalated: number }>}
 */
async function scanHandoffTimeouts() {
  const connection = await _getConnection();
  try {
    const remindTimeout = rdConfig.handoffRemindTimeout || 300;
    const escalateTimeout = rdConfig.handoffTimeout || 600;

    // 查询已到达、未完成的段
    const [arrivedHandoffs] = await connection.query(
      `SELECT h.id, h.relay_order_id, h.segment_seq, h.rider_id,
              h.to_lng, h.to_lat, h.arrived_at,
              TIMESTAMPDIFF(SECOND, h.arrived_at, NOW()) AS waiting_seconds
       FROM ai_relay_handoffs h
       WHERE h.status = 3
         AND h.arrived_at IS NOT NULL`,
    );

    let reminded = 0;
    let escalated = 0;

    for (const ho of arrivedHandoffs) {
      const waiting = ho.waiting_seconds;

      if (waiting >= escalateTimeout) {
        // 超时 10 分钟 → 触发备选
        const anomalyHandler = require('./anomaly-handler');
        await anomalyHandler.handleAnomaly('handoff_timeout', {
          handoffId: ho.id,
          relayOrderId: ho.relay_order_id,
          segmentSeq: ho.segment_seq,
          riderId: ho.rider_id,
          waitingSeconds: waiting,
        });

        await _writeLog({
          relayOrderId: ho.relay_order_id,
          handoffId: ho.id,
          action: 'timeout',
          riderId: ho.rider_id,
          operator: 'system',
          detail: { waitingSeconds: waiting, action: 'escalated', escalateTimeout },
        });

        // 更新状态为异常
        await connection.query(
          `UPDATE ai_relay_handoffs SET status = 5, cancel_reason = '交接超时' WHERE id = ?`,
          [ho.id],
        );

        escalated++;

        emitSegmentFailed({
          relayOrderId: ho.relay_order_id,
          segmentSeq: ho.segment_seq,
          reason: 'handoff_timeout',
          detail: { waitingSeconds: waiting },
        });
      } else if (waiting >= remindTimeout) {
        // 超时 5 分钟 → 推送提醒
        reminded++;

        await _writeLog({
          relayOrderId: ho.relay_order_id,
          handoffId: ho.id,
          action: 'timeout_remind',
          riderId: ho.rider_id,
          operator: 'system',
          detail: { waitingSeconds: waiting, action: 'remind' },
        });
      }
    }

    return { checked: arrivedHandoffs.length, reminded, escalated };
  } finally {
    await connection.end();
  }
}

/**
 * 获取交接段状态
 *
 * @param {number} handoffId
 * @returns {Promise<Object|null>}
 */
async function getHandoffStatus(handoffId) {
  const connection = await _getConnection();
  try {
    const [rows] = await connection.query(
      'SELECT * FROM ai_relay_handoffs WHERE id = ?',
      [handoffId],
    );
    return rows.length > 0 ? rows[0] : null;
  } finally {
    await connection.end();
  }
}

module.exports = {
  markArrive,
  confirmHandoff,
  validateLocation,
  getHandoffStatus,
  scanHandoffTimeouts,
};
