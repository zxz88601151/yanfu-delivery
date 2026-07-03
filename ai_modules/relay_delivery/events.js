'use strict';

/**
 * 协同配送领域事件定义
 *
 * @module ai_modules/relay_delivery/events
 */

const eventBus = require('../common/event-bus');

/**
 * 领域事件名称
 */
const RELAY_EVENTS = {
  ORDER_CREATED: 'relay.order.created',
  ORDER_COMPLETED: 'relay.order.completed',
  HANDOFF_COMPLETED: 'relay.handoff.completed',
  SEGMENT_FAILED: 'relay.segment.failed',
  STATION_STATUS_CHANGED: 'relay.station.status_changed',
};

/**
 * 发布接力方案创建事件
 *
 * @param {Object} payload - { relayOrderId, orderId, segments, estimatedTime }
 */
function emitOrderCreated(payload) {
  eventBus.emitEvent(RELAY_EVENTS.ORDER_CREATED, payload);
}

/**
 * 发布接力配送完成事件
 *
 * @param {Object} payload - { relayOrderId, orderId, segments, handoffTimes }
 */
function emitOrderCompleted(payload) {
  eventBus.emitEvent(RELAY_EVENTS.ORDER_COMPLETED, payload);
}

/**
 * 发布交接完成事件
 *
 * @param {Object} payload - { relayOrderId, handoffId, segmentSeq, handoffAt }
 */
function emitHandoffCompleted(payload) {
  eventBus.emitEvent(RELAY_EVENTS.HANDOFF_COMPLETED, payload);
}

/**
 * 发布分段异常事件
 *
 * @param {Object} payload - { relayOrderId, segmentSeq, reason, detail }
 */
function emitSegmentFailed(payload) {
  eventBus.emitEvent(RELAY_EVENTS.SEGMENT_FAILED, payload);
}

/**
 * 发布接力点状态变更事件
 *
 * @param {Object} payload - { stationId, status, updatedAt }
 */
function emitStationStatusChanged(payload) {
  eventBus.emitEvent(RELAY_EVENTS.STATION_STATUS_CHANGED, payload);
}

module.exports = {
  RELAY_EVENTS,
  emitOrderCreated,
  emitOrderCompleted,
  emitHandoffCompleted,
  emitSegmentFailed,
  emitStationStatusChanged,
};
