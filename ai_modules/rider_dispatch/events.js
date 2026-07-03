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
 * 骑手调度领域事件定义
 *
 * @module ai_modules/rider_dispatch/events
 */

const eventBus = require('../common/event-bus');

/**
 * 领域事件名称
 */
const EVENTS = {
  ORDER_GRABBED: 'rider.order.grabbed',
  ORDER_DISPATCHED: 'rider.order.dispatched',
  RIDER_STATUS_CHANGED: 'rider.status.changed',
  SETTINGS_UPDATED: 'rider.settings.updated',
};

/**
 * 发布骑手抢单事件
 *
 * @param {number} riderId - 骑手ID
 * @param {number} orderId - 订单ID
 */
function emitOrderGrabbed(riderId, orderId) {
  eventBus.emitEvent(EVENTS.ORDER_GRABBED, { riderId, orderId });
}

/**
 * 发布系统派单事件
 *
 * @param {number} riderId - 骑手ID
 * @param {number} orderId - 订单ID
 */
function emitOrderDispatched(riderId, orderId) {
  eventBus.emitEvent(EVENTS.ORDER_DISPATCHED, { riderId, orderId });
}

/**
 * 发布骑手状态变更事件
 *
 * @param {number} riderId - 骑手ID
 * @param {number} status - 状态码（0=离线, 1=在线）
 */
function emitRiderStatusChanged(riderId, status) {
  eventBus.emitEvent(EVENTS.RIDER_STATUS_CHANGED, { riderId, status });
}

/**
 * 发布骑手设置更新事件
 *
 * @param {number} riderId - 骑手ID
 */
function emitSettingsUpdated(riderId) {
  eventBus.emitEvent(EVENTS.SETTINGS_UPDATED, { riderId });
}

module.exports = {
  EVENTS,
  emitOrderGrabbed,
  emitOrderDispatched,
  emitRiderStatusChanged,
  emitSettingsUpdated,
};
