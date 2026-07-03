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
 * 活地图领域事件定义
 *
 * @module ai_modules/live_map/events
 */

const eventBus = require('../common/event-bus');

/**
 * 领域事件名称
 */
const LIVE_MAP_EVENTS = {
  /** 新上报到达（运营后台）*/
  REPORT_SUBMITTED: 'live_map.report.submitted',
  /** 红区生成（DynamicPricing, WSPush）*/
  ROAD_REPORT_VERIFIED: 'road_report.verified',
  /** 红区过期（DynamicPricing, WSPush）*/
  ROAD_REPORT_EXPIRED: 'road_report.expired',
  /** 红区降级（WSPush）*/
  CONDITION_DEGRADED: 'live_map.condition.degraded',
  /** 虚假上报标记（CreditPassport）*/
  REPORT_FLAGGED_FRAUD: 'live_map.report.flagged_fraud',
  /** 热力图更新（WSPush）*/
  HEATMAP_UPDATED: 'live_map.heatmap.updated',
};

/**
 * 发布上报提交事件
 *
 * @param {Object} payload - { report_id, rider_id, report_type, location }
 */
function emitReportSubmitted(payload) {
  eventBus.emitEvent(LIVE_MAP_EVENTS.REPORT_SUBMITTED, payload);
}

/**
 * 发布红区验证通过事件
 *
 * @param {Object} payload - { condition_id, geo_hash, center, radius, difficulty_level }
 */
function emitRoadReportVerified(payload) {
  eventBus.emitEvent(LIVE_MAP_EVENTS.ROAD_REPORT_VERIFIED, payload);
}

/**
 * 发布红区过期事件
 *
 * @param {Object} payload - { condition_id, geo_hash }
 */
function emitRoadReportExpired(payload) {
  eventBus.emitEvent(LIVE_MAP_EVENTS.ROAD_REPORT_EXPIRED, payload);
}

/**
 * 发布红区降级事件
 *
 * @param {Object} payload - { condition_id, geo_hash, old_level, new_level }
 */
function emitConditionDegraded(payload) {
  eventBus.emitEvent(LIVE_MAP_EVENTS.CONDITION_DEGRADED, payload);
}

/**
 * 发布虚假上报标记事件
 *
 * @param {Object} payload - { rider_id, fraud_count }
 */
function emitReportFlaggedFraud(payload) {
  eventBus.emitEvent(LIVE_MAP_EVENTS.REPORT_FLAGGED_FRAUD, payload);
}

/**
 * 发布热力图更新事件
 *
 * @param {Object} payload - { tile_count, updated_at }
 */
function emitHeatmapUpdated(payload) {
  eventBus.emitEvent(LIVE_MAP_EVENTS.HEATMAP_UPDATED, payload);
}

module.exports = {
  LIVE_MAP_EVENTS,
  emitReportSubmitted,
  emitRoadReportVerified,
  emitRoadReportExpired,
  emitConditionDegraded,
  emitReportFlaggedFraud,
  emitHeatmapUpdated,
};
