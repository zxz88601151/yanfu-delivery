'use strict';

/**
 * 协同配送业务逻辑层（核心编排）
 *
 * 负责：
 * - 拆单/查询/到达/交接/进度/接力点管理全流程编排
 * - 定时任务注册（超时扫描）
 * - 领域事件发布
 *
 * @module ai_modules/relay_delivery/service
 */

const mysql = require('mysql2/promise');
const config = require('../../config/ai_modules');
const { getErrorByCode } = require('../../config/error_codes');
const splitEngine = require('./split-engine');
const handoffManager = require('./handoff-manager');
const feeSplitter = require('./fee-splitter');
const progressTracker = require('./progress-tracker');
const anomalyHandler = require('./anomaly-handler');
const { emitOrderCreated, emitOrderCompleted } = require('./events');

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
 * 写入接力操作审计日志
 *
 * @param {number} relayOrderId
 * @param {string} action
 * @param {string} operator
 * @param {Object} [detail]
 * @private
 */
async function _addAuditLog(relayOrderId, action, operator, detail) {
  const connection = await _getConnection();
  try {
    const [order] = await connection.query(
      'SELECT audit_log FROM ai_relay_orders WHERE id = ?',
      [relayOrderId],
    );
    if (order.length === 0) return;

    let auditLog = [];
    if (order[0].audit_log) {
      auditLog = typeof order[0].audit_log === 'string'
        ? JSON.parse(order[0].audit_log)
        : order[0].audit_log;
    }

    auditLog.push({
      action,
      timestamp: new Date().toISOString(),
      operator,
      ...(detail ? { detail } : {}),
    });

    await connection.query(
      'UPDATE ai_relay_orders SET audit_log = ? WHERE id = ?',
      [JSON.stringify(auditLog), relayOrderId],
    );
  } finally {
    await connection.end();
  }
}

/**
 * 拆单评估 + 创建接力配送方案
 *
 * @param {Object} orderData - 订单数据
 * @returns {Promise<Object>}
 */
async function split(orderData) {
  // 1. 拆单评估
  const result = await splitEngine.evaluateSplit(orderData);

  if (!result.splittable) {
    return result;
  }

  // 2. 创建接力订单
  const connection = await _getConnection();
  try {
    const relayPoints = result.relay_points || [];
    const [insertResult] = await connection.query(
      `INSERT INTO ai_relay_orders
       (order_id, order_amount, total_distance, estimated_time, segment_count, relay_points, status, total_fee, total_relay_fee, platform_subsidy, relay_started_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, NOW())`,
      [
        orderData.order_id,
        orderData.order_amount || 0,
        orderData.total_distance,
        result.total_estimated_time,
        result.segments.length,
        JSON.stringify(relayPoints),
        orderData.total_fee,
        result.segment_fees.reduce((a, b) => a + b, 0),
        result.total_subsidy || 0,
      ],
    );

    const relayOrderId = insertResult.insertId;

    // 3. 创建各段接力记录
    for (let i = 0; i < result.segments.length; i++) {
      const seg = result.segments[i];
      await connection.query(
        `INSERT INTO ai_relay_handoffs
         (relay_order_id, segment_seq, from_type, from_lng, from_lat, from_name,
          to_type, to_lng, to_lat, to_name, distance, estimated_time,
          difficulty_factor, fee, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        [
          relayOrderId,
          seg.seq,
          seg.from.name === '商家' ? 'merchant' : 'relay_point',
          seg.from.lng, seg.from.lat, seg.from.name,
          seg.to.name === '用户' ? 'customer' : 'relay_point',
          seg.to.lng, seg.to.lat, seg.to.name,
          seg.distance,
          seg.estimated_time,
          seg.difficulty_factor,
          seg.fee,
        ],
      );
    }

    // 4. 并行匹配骑手
    const assignments = await splitEngine.matchRiders(relayOrderId, result.segments);

    // 5. 为各段分配骑手
    for (const assign of assignments) {
      await connection.query(
        `UPDATE ai_relay_handoffs SET rider_id = ?, status = 1
         WHERE relay_order_id = ? AND segment_seq = ?`,
        [assign.rider.id, relayOrderId, assign.segmentSeq],
      );
    }

    // 6. 更新主表状态为已分配
    await connection.query(
      'UPDATE ai_relay_orders SET status = 1 WHERE id = ?',
      [relayOrderId],
    );

    // 7. 审计日志
    await _addAuditLog(relayOrderId, 'split_created', 'system', {
      segments: result.segments.length,
      riders: assignments.map((a) => a.rider.id),
    });

    // 8. 发布事件
    emitOrderCreated({
      relayOrderId,
      orderId: orderData.order_id,
      segments: result.segments,
      estimatedTime: result.total_estimated_time,
    });

    return {
      splittable: true,
      relay_order_id: relayOrderId,
      ...result,
    };
  } finally {
    await connection.end();
  }
}

/**
 * 获取接力配送详情
 *
 * @param {number} orderId - 接力订单ID
 * @returns {Promise<Object|null>}
 */
async function getOrder(orderId) {
  const connection = await _getConnection();
  try {
    const [orders] = await connection.query(
      'SELECT * FROM ai_relay_orders WHERE id = ?',
      [orderId],
    );

    if (orders.length === 0) {
      const err = getErrorByCode(5005);
      throw Object.assign(new Error(err.message), { code: err.code });
    }

    const relayOrder = orders[0];
    const [handoffs] = await connection.query(
      'SELECT * FROM ai_relay_handoffs WHERE relay_order_id = ? ORDER BY segment_seq',
      [orderId],
    );

    const statusLabels = { 0: '待拆分', 1: '已分配', 2: '配送中', 3: '已完成', 4: '异常', 5: '已取消' };
    const handoffStatusLabels = { 0: 'pending', 1: 'assigned', 2: 'delivering', 3: 'arrived', 4: 'completed', 5: 'abnormal' };

    return {
      relay_order_id: relayOrder.id,
      order_id: relayOrder.order_id,
      status: relayOrder.status,
      status_label: statusLabels[relayOrder.status] || '未知',
      segment_count: relayOrder.segment_count,
      segments: handoffs.map((h) => ({
        seq: h.segment_seq,
        status: handoffStatusLabels[h.status] || 'pending',
        rider: h.rider_id ? {
          id: h.rider_id,
          name: `骑手${h.rider_id}`,
          phone: '138****xxxx',
        } : null,
        from: h.from_name,
        to: h.to_name,
        progress: h.status >= 4 ? 100 : (h.status >= 2 ? 65 : 0),
        distance: h.distance,
        estimated_time: h.estimated_time,
        picked_up_at: h.picked_up_at ? new Date(h.picked_up_at).toISOString() : null,
        arrived_at: h.arrived_at ? new Date(h.arrived_at).toISOString() : null,
        handoff_at: h.handoff_at ? new Date(h.handoff_at).toISOString() : null,
        fee: h.fee,
      })),
    };
  } finally {
    await connection.end();
  }
}

/**
 * 骑手到达接力点
 *
 * @param {number} handoffId
 * @param {Object} data - { riderId, lng, lat, arrivedAt }
 * @returns {Promise<Object>}
 */
async function arrive(handoffId, data) {
  const result = await handoffManager.markArrive(
    handoffId,
    data.rider_id,
    data.location.lng,
    data.location.lat,
    data.arrived_at,
  );

  // 获取 relay_order_id 写入审计日志
  const handoff = await handoffManager.getHandoffStatus(handoffId);
  if (handoff) {
    await _addAuditLog(handoff.relay_order_id, 'rider_arrived', `rider_${data.rider_id}`, {
      handoffId,
      location: data.location,
    });
  }

  return result;
}

/**
 * 交接确认
 *
 * @param {number} handoffId
 * @param {Object} data - { riderId, confirmMethod, packageCondition, note, counterpartRiderId }
 * @returns {Promise<Object>}
 */
async function handoff(handoffId, data) {
  const result = await handoffManager.confirmHandoff(
    handoffId,
    data.rider_id,
    data.confirm_method,
    data.package_condition || 'good',
    data.note || '',
    data.counterpart_rider_id,
  );

  return result;
}

/**
 * 获取用户端进度
 *
 * @param {number} orderId - 原始订单ID
 * @returns {Promise<Object|null>}
 */
async function getProgress(orderId) {
  return progressTracker.getProgress(orderId);
}

/**
 * 获取接力点列表
 *
 * @param {Object} filters - { type, status, page, size }
 * @returns {Promise<Object>}
 */
async function listStations(filters = {}) {
  const connection = await _getConnection();
  try {
    const conditions = ['1=1'];
    const params = [];

    if (filters.type !== undefined && filters.type !== null) {
      conditions.push('type = ?');
      params.push(filters.type);
    }
    if (filters.status !== undefined && filters.status !== null) {
      conditions.push('status = ?');
      params.push(filters.status);
    }

    const where = conditions.join(' AND ');
    const page = filters.page || 1;
    const size = filters.size || 20;
    const offset = (page - 1) * size;

    const [countResult] = await connection.query(
      `SELECT COUNT(*) AS total FROM ai_relay_stations WHERE ${where}`,
      params,
    );
    const total = countResult[0].total;

    const [rows] = await connection.query(
      `SELECT * FROM ai_relay_stations WHERE ${where} ORDER BY type ASC, success_rate DESC LIMIT ? OFFSET ?`,
      [...params, size, offset],
    );

    const items = rows.map((r) => ({
      id: r.id,
      name: r.name,
      type: ['station', 'store', 'public', 'virtual'][r.type] || 'unknown',
      lng: r.lng,
      lat: r.lat,
      address: r.address,
      amenities: r.amenities ? (typeof r.amenities === 'string' ? JSON.parse(r.amenities) : r.amenities) : [],
      business_hours: r.business_hours
        ? (typeof r.business_hours === 'string'
          ? JSON.parse(r.business_hours)
          : r.business_hours)
        : null,
      status: ['closed', 'active', 'maintenance'][r.status] || 'unknown',
      success_rate: r.success_rate,
      avg_handoff_time: r.avg_handoff_time,
    }));

    return { total, page, size, items };
  } finally {
    await connection.end();
  }
}

/**
 * 新增接力点
 *
 * @param {Object} data - { name, type, location, address, businessHours, amenities }
 * @returns {Promise<Object>}
 */
async function createStation(data) {
  const connection = await _getConnection();
  try {
    // 生成 ID
    const [count] = await connection.query('SELECT COUNT(*) AS cnt FROM ai_relay_stations');
    const nextId = `RP${String(count[0].cnt + 1).padStart(3, '0')}`;

    const hoursStr = data.business_hours ? JSON.stringify(data.business_hours) : null;
    const amenitiesStr = data.amenities ? JSON.stringify(data.amenities) : null;

    await connection.query(
      `INSERT INTO ai_relay_stations (id, name, type, lng, lat, address, business_hours, amenities, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        nextId,
        data.name,
        data.type,
        data.location.lng,
        data.location.lat,
        data.address || null,
        hoursStr,
        amenitiesStr,
      ],
    );

    return {
      id: nextId,
      name: data.name,
      status: 'active',
    };
  } finally {
    await connection.end();
  }
}

/**
 * 扫描交接超时（cron 调用）
 *
 * @returns {Promise<Object>}
 */
async function scanHandoffTimeouts() {
  return handoffManager.scanHandoffTimeouts();
}

module.exports = {
  split,
  getOrder,
  arrive,
  handoff,
  getProgress,
  listStations,
  createStation,
  scanHandoffTimeouts,
};
