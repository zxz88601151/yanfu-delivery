'use strict';

/**
 * 盲盒配送领域事件定义
 *
 * @module ai_modules/blind_box/events
 */

module.exports = {
  /** 盲盒订单已创建 */
  BLIND_BOX_ORDER_CREATED: 'blind_box.order.created',

  /** 盲盒订单已确认 */
  BLIND_BOX_ORDER_CONFIRMED: 'blind_box.order.confirmed',

  /** 盲盒订单已取消 */
  BLIND_BOX_ORDER_CANCELLED: 'blind_box.order.cancelled',

  /** 盲盒订单已过期 */
  BLIND_BOX_ORDER_EXPIRED: 'blind_box.order.expired',

  /** 盲盒池已更新 */
  BLIND_BOX_POOL_UPDATED: 'blind_box.pool.updated',
};
