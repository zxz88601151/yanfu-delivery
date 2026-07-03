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
