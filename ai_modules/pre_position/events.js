'use strict';

/**
 * 预置运力模块领域事件定义
 *
 * @module ai_modules/pre_position/events
 */

module.exports = {
  /** 爆单预测完成 */
  SURGE_PREDICTION_READY: 'surge.prediction.ready',
  /** 新调度指令生成 */
  PRE_POSITION_DISPATCH_CREATED: 'pre_position.dispatch.created',
  /** 骑手响应调度 */
  PRE_POSITION_DISPATCH_RESPONDED: 'pre_position.dispatch.responded',
  /** 骑手到达目标 */
  PRE_POSITION_RIDER_ARRIVED: 'pre_position.rider.arrived',
  /** 实际爆单开始 */
  PRE_POSITION_SURGE_STARTED: 'pre_position.surge.started',
  /** 爆单窗口结束 */
  PRE_POSITION_SURGE_ENDED: 'pre_position.surge.ended',
  /** 运力缺口告警 */
  PRE_POSITION_RIDER_SHORTAGE: 'pre_position.rider.shortage',
  /** 预测准确率告警 */
  PRE_POSITION_ACCURACY_ALERT: 'pre_position.accuracy.alert',
};
