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
 * 全局常量定义
 *
 * @module config/constants
 */

/** 事件名称常量 */
const EVENTS = {
  // ========== 盲盒配送 ==========
  BLIND_BOX_ORDER_MATCHED: 'blind_box.order.matched',
  BLIND_BOX_ORDER_CANCELLED: 'blind_box.order.cancelled',
  BLIND_BOX_POOL_UPDATED: 'blind_box.pool.updated',

  // ========== 动态定价 ==========
  DYNAMIC_PRICE_UPDATED: 'dynamic_price.updated',
  DYNAMIC_PRICE_ZONE_CHANGED: 'dynamic_price.zone.changed',

  // ========== 碳积分 ==========
  CARBON_EMISSION_RECORDED: 'carbon.emission.recorded',

  // ========== 信用护照 ==========
  CREDIT_RIDER_CHANGED: 'rider.credit.changed',

  // ========== 预置运力 ==========
  SURGE_PREDICTION_READY: 'surge.prediction.ready',
  PRE_POSITION_DISPATCH_CREATED: 'pre_position.dispatch.created',
  PRE_POSITION_DISPATCH_RESPONDED: 'pre_position.dispatch.responded',
  PRE_POSITION_RIDER_ARRIVED: 'pre_position.rider.arrived',
  PRE_POSITION_SURGE_STARTED: 'pre_position.surge.started',
  PRE_POSITION_SURGE_ENDED: 'pre_position.surge.ended',
  PRE_POSITION_RIDER_SHORTAGE: 'pre_position.rider.shortage',
  PRE_POSITION_ACCURACY_ALERT: 'pre_position.accuracy.alert',

  // ========== 协同配送 ==========
  RELAY_ORDER_CREATED: 'relay.order.created',
  RELAY_ORDER_COMPLETED: 'relay.order.completed',
  RELAY_HANDOFF_COMPLETED: 'relay.handoff.completed',
  RELAY_SEGMENT_FAILED: 'relay.segment.failed',
  RELAY_STATION_STATUS_CHANGED: 'relay.station.status_changed',
};

/** 爆单强度阈值 */
const INTENSITY_THRESHOLDS = {
  5: 3.0,
  4: 2.5,
  3: 2.0,
  2: 1.5,
  1: 1.2,
};

/** 预置运力状态码映射 */
const DISPATCH_STATUS = {
  PENDING: 0,
  ACCEPTED: 1,
  ARRIVED: 2,
  COMPLETED: 3,
  REJECTED: 4,
  TIMEOUT: 5,
  LATE: 6,
  CANCELLED: 7,
};

const RIDER_PRE_STATUS = {
  IDLE: 0,
  EN_ROUTE: 1,
  ARRIVED_WAITING: 2,
  ON_ORDER: 3,
};

module.exports = {
  EVENTS,
  INTENSITY_THRESHOLDS,
  DISPATCH_STATUS,
  RIDER_PRE_STATUS,
};
