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
 * 动态定价领域事件定义
 *
 * @module ai_modules/dynamic_pricing/events
 */

const eventBus = require('../common/event-bus');

/**
 * 领域事件名称
 */
const DYNAMIC_EVENTS = {
  ESTIMATE_CALCULATED: 'dynamic_pricing.estimate.calculated',
  CONFIG_CHANGED: 'dynamic_pricing.config.changed',
  ZONE_UPDATED: 'dynamic_pricing.zone.updated',
  ALERT_TRIGGERED: 'dynamic_pricing.alert.triggered',
};

/**
 * 发布定价估算完成事件
 *
 * @param {Object} payload - { userId, districtId, finalFee, factors }
 */
function emitEstimateCalculated(payload) {
  eventBus.emitEvent(DYNAMIC_EVENTS.ESTIMATE_CALCULATED, payload);
}

/**
 * 发布定价配置变更事件
 *
 * @param {Object} payload - { configKeys, updatedBy }
 */
function emitConfigChanged(payload) {
  eventBus.emitEvent(DYNAMIC_EVENTS.CONFIG_CHANGED, payload);
}

/**
 * 发布区域定价系数更新事件
 *
 * @param {Object} payload - { districtId, oldFactor, newFactor, reason }
 */
function emitZoneUpdated(payload) {
  eventBus.emitEvent(DYNAMIC_EVENTS.ZONE_UPDATED, payload);
}

/**
 * 发布价格提醒触发事件
 *
 * @param {Object} payload - { userId, districtId, currentFee, targetFee }
 */
function emitAlertTriggered(payload) {
  eventBus.emitEvent(DYNAMIC_EVENTS.ALERT_TRIGGERED, payload);
}

module.exports = {
  DYNAMIC_EVENTS,
  emitEstimateCalculated,
  emitConfigChanged,
  emitZoneUpdated,
  emitAlertTriggered,
};
