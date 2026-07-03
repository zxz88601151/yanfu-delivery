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
