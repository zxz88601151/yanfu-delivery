'use strict';

/**
 * 用户端接力进度追踪器
 *
 * 负责：
 * - 分段进度组装
 * - ETA 实时计算（含红区影响）
 * - 时间轴构建
 * - 用户通知推送
 *
 * @module ai_modules/relay_delivery/progress-tracker
 */

const mysql = require('mysql2/promise');
const config = require('../../config/ai_modules');
const eventBus = require('../common/event-bus');
const wsPush = require('../common/ws-push');

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
 * 获取当前阶段信息
 *
 * @param {Object} relayOrder - 接力订单
 * @returns {{ phase: string, phaseLabel: string }}
 */
function getPhaseInfo(relayOrder) {
  if (!relayOrder) {
    return { phase: 'unknown', phaseLabel: '未知' };
  }

  const status = relayOrder.status;
  const statusMap = {
    0: { phase: 'pending_split', label: '待拆分' },
    1: { phase: 'assigned', label: '已分配骑手' },
    2: { phase: 'delivering', label: '配送中' },
    3: { phase: 'completed', label: '已送达' },
    4: { phase: 'abnormal', label: '配送异常' },
    5: { phase: 'cancelled', label: '已取消' },
  };

  const info = statusMap[status] || statusMap[0];
  return { phase: info.phase, phaseLabel: info.label };
}

/**
 * 计算段 ETA
 *
 * @param {Object} segment - 分段数据
 * @returns {number} 剩余秒数
 * @private
 */
function _calcSegmentEta(segment) {
  if (!segment) return 0;

  if (segment.status >= 4) return 0; // 已完成
  if (segment.status >= 3) {
    // 已到达接力点，只需缓冲时间
    return config.relayDelivery.handoffBufferSeconds || 180;
  }

  const baseTime = segment.estimated_time || 0;

  // 若已出发，按进度折算
  if (segment.status >= 2 && segment.picked_up_at) {
    const elapsed = (Date.now() - new Date(segment.picked_up_at).getTime()) / 1000;
    const remaining = Math.max(0, baseTime - elapsed);
    return Math.round(remaining);
  }

  return baseTime;
}

/**
 * 计算剩余总分钟数
 *
 * @param {Array} segments - 分段列表
 * @returns {number}
 * @private
 */
function _getRemainingMinutes(segments) {
  let totalSeconds = 0;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.status >= 4) continue; // 已完成的段不计

    totalSeconds += _calcSegmentEta(seg);

    // 加交接缓冲
    if (i < segments.length - 1 && seg.status < 4) {
      totalSeconds += config.relayDelivery.handoffBufferSeconds || 180;
    }
  }

  return Math.ceil(totalSeconds / 60);
}

/**
 * 构建时间轴
 *
 * @param {Object} relayOrder - 接力订单
 * @param {Array} segments - 分段列表
 * @returns {Array}
 */
function getTimeline(relayOrder, segments) {
  const timeline = [];

  if (relayOrder.relay_started_at) {
    const startTime = new Date(relayOrder.relay_started_at);
    const timeStr = startTime.toTimeString().slice(0, 5);
    timeline.push({ time: timeStr, event: '商家已出餐', icon: '🍳' });
  }

  for (const seg of segments) {
    if (seg.picked_up_at) {
      const t = new Date(seg.picked_up_at);
      timeline.push({ time: t.toTimeString().slice(0, 5), event: `${seg.label}骑手已取餐`, icon: '🛵' });
    }

    if (seg.arrived_at && seg.segment_seq < segments.length) {
      const t = new Date(seg.arrived_at);
      timeline.push({ time: t.toTimeString().slice(0, 5), event: `${seg.label}骑手已到达接力点`, icon: '📍' });
    }

    if (seg.handoff_at) {
      const t = new Date(seg.handoff_at);
      timeline.push({ time: t.toTimeString().slice(0, 5), event: `交接完成（${seg.label}）`, icon: '🤝' });
    }
  }

  if (relayOrder.status === 3 && relayOrder.relay_completed_at) {
    const t = new Date(relayOrder.relay_completed_at);
    timeline.push({ time: t.toTimeString().slice(0, 5), event: '已送达 ✅', icon: '✅' });
  }

  // 如果时间轴为空，生成预估时间轴
  if (timeline.length === 0) {
    const now = new Date();
    const baseTime = now.getTime();

    let offset = 0;
    for (let i = 0; i < segments.length; i++) {
      offset += segments[i].estimated_time || 600;
      const eta = new Date(baseTime + offset * 1000);
      timeline.push({
        time: eta.toTimeString().slice(0, 5),
        event: i === segments.length - 1 ? '预计送达' : `预计到达接力点`,
        icon: '📍',
      });
      offset += config.relayDelivery.handoffBufferSeconds || 180;
    }
  }

  return timeline;
}

/**
 * 组装用户端进度数据
 *
 * @param {Array} segments - 分段列表
 * @param {Array} [riders] - 骑手信息（可选）
 * @returns {Array}
 */
function composeUserProgress(segments, riders) {
  const riderMap = {};
  if (riders) {
    for (const r of riders) {
      riderMap[r.id] = r;
    }
  }

  return segments.map((seg) => {
    const rider = riderMap[seg.rider_id];
    const statusIcons = {
      0: '⏳', 1: '⏳', 2: '🟢', 3: '📍', 4: '✅', 5: '❌',
    };

    let progressPct = 0;
    if (seg.status === 4) progressPct = 100;
    else if (seg.status === 3) progressPct = 90;
    else if (seg.status === 2 && seg.picked_up_at) {
      const elapsed = (Date.now() - new Date(seg.picked_up_at).getTime()) / 1000;
      const total = seg.estimated_time || 600;
      progressPct = Math.min(85, Math.round((elapsed / total) * 100));
    } else if (seg.status >= 1) progressPct = 5;

    return {
      seq: seg.segment_seq,
      label: seg.segment_seq === 1 ? '前段' : (seg.segment_seq === segments.length ? '后段' : '中段'),
      status: ['pending', 'assigned', 'delivering', 'arrived', 'completed', 'abnormal'][seg.status] || 'pending',
      status_icon: statusIcons[seg.status] || '⏳',
      from: { name: seg.from_name || '商家' },
      to: { name: seg.to_name || (seg.segment_seq === segments.length ? '你' : '接力点') },
      rider_name: rider ? rider.name : null,
      rider_avatar: rider ? rider.avatar : null,
      rider_rating: rider ? rider.score : null,
      rider_phone: rider ? rider.phone : null,
      gps: { lng: 0, lat: 0 },
      progress_pct: progressPct,
      eta_seconds: _calcSegmentEta(seg),
    };
  });
}

/**
 * 获取用户端进度数据
 *
 * @param {number} orderId - 原始订单ID
 * @returns {Promise<Object>}
 */
async function getProgress(orderId) {
  const connection = await _getConnection();
  try {
    // 1. 查询接力主订单
    const [relayOrders] = await connection.query(
      'SELECT * FROM ai_relay_orders WHERE order_id = ?',
      [orderId],
    );

    if (relayOrders.length === 0) {
      return null;
    }

    const relayOrder = relayOrders[0];

    // 2. 查询各段
    const [segments] = await connection.query(
      'SELECT * FROM ai_relay_handoffs WHERE relay_order_id = ? ORDER BY segment_seq',
      [relayOrder.id],
    );

    // 3. 查询骑手信息（模拟）
    const riderIds = segments
      .map((s) => s.rider_id)
      .filter((id) => id !== null);

    const riders = riderIds.map((id) => ({
      id,
      name: `骑手${id}`,
      phone: '138****xxxx',
      score: 4.8,
      avatar: null,
    }));

    // 4. 获取当前阶段
    const phaseInfo = getPhaseInfo(relayOrder);
    const userProgress = composeUserProgress(segments, riders);
    const timeline = getTimeline(relayOrder, segments);
    const remainingMinutes = _getRemainingMinutes(segments);

    return {
      relay_order_id: relayOrder.id,
      order_id: relayOrder.order_id,
      is_relay: true,
      phase: phaseInfo.phase,
      phase_label: phaseInfo.phaseLabel,
      total_estimated_minutes: Math.ceil((relayOrder.estimated_time || 0) / 60),
      remaining_minutes: remainingMinutes,
      segments: userProgress,
      timeline,
    };
  } finally {
    await connection.end();
  }
}

/**
 * 刷新 ETA（骑手位置更新时调用）
 *
 * @param {number} relayOrderId - 接力订单ID
 */
async function refreshETA(relayOrderId) {
  // ETA 由前端每分钟自动轮询 progress 接口
  // 此处可触发 WebSocket 推送 ETA 更新
  const connection = await _getConnection();
  try {
    const [orders] = await connection.query(
      'SELECT order_id FROM ai_relay_orders WHERE id = ?',
      [relayOrderId],
    );
    if (orders.length > 0) {
      pushProgressUpdate(relayOrderId, orders[0].order_id);
    }
  } finally {
    await connection.end();
  }
}

/**
 * 推送进度更新到用户端
 *
 * @param {number} relayOrderId - 接力订单ID
 * @param {number} orderId - 原始订单ID
 */
async function pushProgressUpdate(relayOrderId, orderId) {
  const progress = await getProgress(orderId);
  if (progress) {
    wsPush.broadcast(`relay.progress.updated`, {
      relay_order_id: relayOrderId,
      order_id: orderId,
      phase: progress.phase,
      remaining_minutes: progress.remaining_minutes,
      segments: progress.segments,
    });
  }
}

module.exports = {
  getProgress,
  getPhaseInfo,
  getTimeline,
  composeUserProgress,
  refreshETA,
  pushProgressUpdate,
};
