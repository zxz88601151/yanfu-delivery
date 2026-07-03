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
 * 异常处理器
 *
 * 处理 6 种异常场景 + 自动恢复 + 投诉溯源
 *
 * @module ai_modules/relay_delivery/anomaly-handler
 */

const mysql = require('mysql2/promise');
const config = require('../../config/ai_modules');
const { emitSegmentFailed } = require('./events');
const feeSplitter = require('./fee-splitter');

/**
 * 异常类型
 */
const ANOMALY_TYPES = {
  FRONT_CANCEL: 'front_rider_cancelled',
  REAR_CANCEL: 'rear_rider_cancelled',
  HANDOFF_TIMEOUT: 'handoff_timeout',
  STATION_UNAVAILABLE: 'station_unavailable',
  GOODS_DAMAGED: 'goods_damaged_during_handoff',
  WEATHER_CHANGE: 'weather_sudden_change',
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
 * 判断已完成的配送距离是否超过总距离 30%
 *
 * @param {number} relayOrderId - 接力订单ID
 * @param {number} handoffId - 异常段ID
 * @returns {Promise<boolean>}
 * @private
 */
async function _isMoreThan30Percent(relayOrderId, handoffId) {
  const connection = await _getConnection();
  try {
    const [orders] = await connection.query(
      'SELECT total_distance FROM ai_relay_orders WHERE id = ?',
      [relayOrderId],
    );
    if (orders.length === 0) return false;

    const totalDist = orders[0].total_distance;

    const [handoffs] = await connection.query(
      'SELECT SUM(distance) AS completed_dist FROM ai_relay_handoffs WHERE relay_order_id = ? AND id <= ? AND status >= 4',
      [relayOrderId, handoffId],
    );

    const completedDist = handoffs[0].completed_dist || 0;
    return completedDist / totalDist >= 0.3;
  } finally {
    await connection.end();
  }
}

/**
 * 查找备选骑手
 *
 * @param {number} handoffId - 接力段ID
 * @param {number} rangeMeters - 搜索范围（米）
 * @returns {Promise<Object|null>} 备选骑手信息
 * @private
 */
async function _findBackupRider(handoffId, rangeMeters) {
  // 模拟骑手查找
  const simulatedBackupRiders = [
    { id: 10100, name: '马师傅', phone: '138****9999', level: 3, score: 4.7, distance: 300 },
    { id: 10101, name: '黄师傅', phone: '138****8888', level: 2, score: 4.5, distance: 500 },
    { id: 10102, name: '朱师傅', phone: '138****7777', level: 4, score: 4.9, distance: 800 },
  ];

  return simulatedBackupRiders[0];
}

/**
 * 降级为单骑手配送
 *
 * @param {number} relayOrderId - 接力订单ID
 * @returns {Promise<Object>}
 * @private
 */
async function _downgradeToSingle(relayOrderId) {
  const connection = await _getConnection();
  try {
    // 查找已确认的前段骑手，让他继续配送全程
    const [frontHandoff] = await connection.query(
      `SELECT * FROM ai_relay_handoffs
       WHERE relay_order_id = ? AND segment_seq = 1`,
      [relayOrderId],
    );

    if (frontHandoff.length > 0 && frontHandoff[0].rider_id) {
      // 前段骑手继续配送全程
      const riderId = frontHandoff[0].rider_id;
      return {
        action: 'downgrade_single',
        rider_id: riderId,
        message: `骑手 ${riderId} 将继续配送全程`,
      };
    }

    return {
      action: 'downgrade_single',
      rider_id: null,
      message: '正在重新匹配全程骑手',
    };
  } finally {
    await connection.end();
  }
}

/**
 * 处理骑手取消（前段/后段）
 *
 * @param {Object} context - { handoffId, relayOrderId, segmentSeq, riderId, reason }
 * @returns {Promise<Object>}
 */
async function handleRiderCancel(context) {
  const { handoffId, relayOrderId, segmentSeq, riderId, reason } = context;
  const connection = await _getConnection();
  try {
    // 1. 更新该段状态为异常
    await connection.query(
      `UPDATE ai_relay_handoffs SET status = 5, cancel_reason = ? WHERE id = ?`,
      [reason || '骑手取消', handoffId],
    );

    // 2. 判断是否前段取消
    if (segmentSeq === 1) {
      // 前段取消
      const over30 = await _isMoreThan30Percent(relayOrderId, handoffId);

      if (!over30) {
        // < 30% → 整体取消，重新匹配全程骑手
        await connection.query(
          `UPDATE ai_relay_orders SET status = 5 WHERE id = ?`,
          [relayOrderId],
        );
        await connection.query(
          `UPDATE ai_relay_handoffs SET status = 5 WHERE relay_order_id = ? AND id != ?`,
          [relayOrderId, handoffId],
        );

        const downgrade = await _downgradeToSingle(relayOrderId);

        emitSegmentFailed({
          relayOrderId,
          segmentSeq,
          reason: 'rider_cancel',
          detail: { action: 'full_cancel', reason: '前段取消且配送不足30%' },
        });

        return {
          action: 'full_cancel',
          reason: '前段取消且配送不足30%，整体取消该接力方案',
          fallback: downgrade,
        };
      }

      // ≥ 30% → 保留已完成段，仅替换前段骑手
      const backup = await _findBackupRider(handoffId, 1000);

      if (backup) {
        await connection.query(
          `UPDATE ai_relay_handoffs SET rider_id = ?, status = 1 WHERE id = ?`,
          [backup.id, handoffId],
        );

        return {
          action: 'backup_rider_assigned',
          backup_rider: backup,
          message: '已分配备选骑手接替前段配送',
        };
      }

      // 无备选 → 降级
      const downgrade = await _downgradeToSingle(relayOrderId);
      return {
        action: 'downgrade_single',
        reason: '无可用备选骑手',
        fallback: downgrade,
      };
    }

    // 后段取消 → 查找备选
    const backup = await _findBackupRider(handoffId, 1000);

    if (backup) {
      await connection.query(
        `UPDATE ai_relay_handoffs SET rider_id = ?, status = 1 WHERE id = ?`,
        [backup.id, handoffId],
      );

      return {
        action: 'backup_rider_assigned',
        backup_rider: backup,
        message: '已分配备选骑手接替后段配送',
      };
    }

    // 无备选 → 前段骑手继续配送全程
    const frontRider = await connection.query(
      `SELECT rider_id FROM ai_relay_handoffs WHERE relay_order_id = ? AND segment_seq = 1`,
      [relayOrderId],
    );

    return {
      action: 'front_rider_continue',
      rider_id: frontRider[0] ? frontRider[0].rider_id : null,
      message: '后段无备选骑手，前段骑手将配送全程',
    };
  } finally {
    await connection.end();
  }
}

/**
 * 处理交接超时
 *
 * @param {Object} context - { handoffId, relayOrderId, segmentSeq, riderId, waitingSeconds }
 * @returns {Promise<Object>}
 */
async function handleTimeoutDelivery(context) {
  const { handoffId, relayOrderId, segmentSeq, riderId, waitingSeconds } = context;

  // 尝试找备选骑手
  const backup = await _findBackupRider(handoffId, 1000);

  if (backup) {
    const connection = await _getConnection();
    try {
      await connection.query(
        `UPDATE ai_relay_handoffs SET rider_id = ?, status = 1 WHERE relay_order_id = ? AND segment_seq = ? AND rider_id IS NULL`,
        [backup.id, relayOrderId, segmentSeq + 1],
      );
    } finally {
      await connection.end();
    }

    return {
      action: 'backup_rider_assigned',
      backup_rider: backup,
      message: `等待 ${Math.floor(waitingSeconds / 60)} 分钟，已启动备选骑手调度`,
    };
  }

  // 无备选 → 前段继续配送全程
  return {
    action: 'front_continue_full',
    message: '无可用备选骑手，前段骑手将配送全程',
    fee_adjustment: '前段骑手获得原配送费的80%',
  };
}

/**
 * 处理接力点不可用
 *
 * @param {number} relayOrderId - 接力订单ID
 * @returns {Promise<Object>}
 */
async function handleStationUnavailable(relayOrderId) {
  // 选择最近备用接力点
  const splitEngine = require('./split-engine');
  const connection = await _getConnection();
  try {
    const [order] = await connection.query(
      'SELECT * FROM ai_relay_orders WHERE id = ?',
      [relayOrderId],
    );
    if (order.length === 0) {
      return { action: 'downgrade_single', message: '接力点不可用，降级为单骑手配送' };
    }

    const relayOrder = order[0];
    const points = typeof relayOrder.relay_points === 'string'
      ? JSON.parse(relayOrder.relay_points)
      : relayOrder.relay_points;

    if (points && points.length > 0) {
      const firstPoint = points[0];
      const stations = await splitEngine.findNearbyStations(firstPoint.location.lng, firstPoint.location.lat, 500);
      if (stations.length > 0) {
        return {
          action: 'station_switched',
          new_station: stations[0],
          message: `接力点已切换至 ${stations[0].name}`,
        };
      }
    }

    return { action: 'downgrade_single', message: '无可替代接力点，降级为单骑手配送' };
  } finally {
    await connection.end();
  }
}

/**
 * 处理商品损坏
 *
 * @param {number} handoffId - 交接段ID
 * @param {Object} evidence - 证据信息
 * @returns {Promise<Object>}
 */
async function handleGoodsDamage(handoffId, evidence) {
  const connection = await _getConnection();
  try {
    await connection.query(
      `UPDATE ai_relay_handoffs SET status = 5, cancel_reason = '商品损坏' WHERE id = ?`,
      [handoffId],
    );

    return {
      action: 'pending_review',
      message: '商品损坏已记录，暂停费用结算，运营将介入判定责任',
      evidence,
    };
  } finally {
    await connection.end();
  }
}

/**
 * 处理天气突变
 *
 * @param {number} relayOrderId - 接力订单ID
 * @returns {Promise<Object>}
 */
async function handleWeatherChange(relayOrderId) {
  const connection = await _getConnection();
  try {
    const [order] = await connection.query(
      'SELECT relay_points FROM ai_relay_orders WHERE id = ?',
      [relayOrderId],
    );
    if (order.length === 0) return { action: 'noop' };

    const points = typeof order[0].relay_points === 'string'
      ? JSON.parse(order[0].relay_points)
      : order[0].relay_points;

    // 检查是否有户外接力点（类型为 public=2 或 virtual=3），建议转移到驿站室内
    const outdoorPoints = (points || []).filter((p) => p.type === 'public' || p.type === 'virtual');

    if (outdoorPoints.length > 0) {
      return {
        action: 'weather_alert',
        message: '天气突变，建议户外接力点转为驿站室内交接',
        affected_points: outdoorPoints.map((p) => p.name),
      };
    }

    return { action: 'noop', message: '接力点均为室内，不受天气影响' };
  } finally {
    await connection.end();
  }
}

/**
 * 异常处理入口
 *
 * @param {string} anomalyType - 异常类型
 * @param {Object} context - 上下文
 * @returns {Promise<Object>}
 */
async function handleAnomaly(anomalyType, context) {
  switch (anomalyType) {
    case ANOMALY_TYPES.FRONT_CANCEL:
    case ANOMALY_TYPES.REAR_CANCEL:
      return handleRiderCancel(context);
    case ANOMALY_TYPES.HANDOFF_TIMEOUT:
      return handleTimeoutDelivery(context);
    case ANOMALY_TYPES.STATION_UNAVAILABLE:
      return handleStationUnavailable(context.relayOrderId);
    case ANOMALY_TYPES.GOODS_DAMAGED:
      return handleGoodsDamage(context.handoffId, context.evidence);
    case ANOMALY_TYPES.WEATHER_CHANGE:
      return handleWeatherChange(context.relayOrderId);
    default:
      return { action: 'unknown', message: `未知异常类型: ${anomalyType}` };
  }
}

/**
 * 自动恢复
 *
 * @param {number} relayOrderId - 接力订单ID
 * @param {string} anomalyType - 异常类型
 * @returns {Promise<Object>}
 */
async function autoRecover(relayOrderId, anomalyType) {
  const context = { relayOrderId };
  return handleAnomaly(anomalyType, context);
}

/**
 * 获取投诉溯源数据
 *
 * @param {number} relayOrderId - 接力订单ID
 * @returns {Promise<Object>}
 */
async function getFaultTrace(relayOrderId) {
  const connection = await _getConnection();
  try {
    const [relayOrder] = await connection.query(
      'SELECT * FROM ai_relay_orders WHERE id = ?',
      [relayOrderId],
    );
    if (relayOrder.length === 0) return null;

    const [segments] = await connection.query(
      'SELECT * FROM ai_relay_handoffs WHERE relay_order_id = ? ORDER BY segment_seq',
      [relayOrderId],
    );

    const [logs] = await connection.query(
      'SELECT * FROM ai_relay_handoff_logs WHERE relay_order_id = ? ORDER BY created_at',
      [relayOrderId],
    );

    return {
      relay_order_id: relayOrderId,
      order_id: relayOrder[0].order_id,
      segments: segments.map((s) => ({
        seq: s.segment_seq,
        rider_id: s.rider_id,
        status: s.status,
        picked_up_at: s.picked_up_at,
        arrived_at: s.arrived_at,
        handoff_at: s.handoff_at,
        cancel_reason: s.cancel_reason,
      })),
      logs: logs.map((l) => ({
        action: l.action,
        rider_id: l.rider_id,
        operator: l.operator,
        detail: l.detail,
        created_at: l.created_at,
      })),
    };
  } finally {
    await connection.end();
  }
}

/**
 * 判定责任方
 *
 * @param {number} relayOrderId
 * @param {Object} complaint - 投诉信息
 * @returns {Object}
 */
function determineResponsibility(relayOrderId, complaint) {
  // 简化实现：按分段超时判定
  const result = {
    relay_order_id: relayOrderId,
    complaint_type: complaint.type || 'unknown',
    responsibility: [],
  };

  if (complaint.delay_segment === 1) {
    result.responsibility.push({ segment: 1, party: '前段骑手', reason: '前段配送超时' });
  } else if (complaint.delay_segment === 2) {
    result.responsibility.push({ segment: 2, party: '后段骑手', reason: '后段配送超时' });
  } else if (complaint.type === 'handoff_damage') {
    result.responsibility.push({ segment: 'handoff', party: '平台/驿站', reason: '交接期间商品损坏' });
  }

  return result;
}

module.exports = {
  ANOMALY_TYPES,
  handleAnomaly,
  handleRiderCancel,
  handleTimeoutDelivery,
  handleStationUnavailable,
  handleGoodsDamage,
  handleWeatherChange,
  autoRecover,
  getFaultTrace,
  determineResponsibility,
};
