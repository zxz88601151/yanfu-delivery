'use strict';

/**
 * 盲盒配送业务逻辑层
 *
 * @module ai_modules/blind_box/service
 */

const mysql = require('mysql2/promise');
const config = require('../../config/ai_modules');
const { getErrorByCode } = require('../../config/error_codes');
const eventBus = require('../common/event-bus');
const { getExpireTime } = require('../common/date-utils');
const matchingEngine = require('./matching-engine');
const priceCalculator = require('./price-calculator');
const poolManager = require('./pool-manager');
const blindBoxEvents = require('./events');

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
 * 创建盲盒订单
 *
 * 流程：
 * 1. 校验用户是否已有进行中的订单
 * 2. 调用 matching-engine 匹配餐品
 * 3. 调用 price-calculator 计算价格
 * 4. 写入数据库
 * 5. 返回盲盒结果（含倒计时）
 *
 * @param {number} userId - 用户ID
 * @param {Object} orderData - 订单数据
 * @param {number} orderData.budget_min - 预算下限
 * @param {number} orderData.budget_max - 预算上限
 * @param {string[]} orderData.taste_tags - 口味标签
 * @param {number} orderData.district_id - 区域ID
 * @returns {Promise<Object>} 创建的盲盒订单
 */
async function createOrder(userId, orderData) {
  const connection = await _getConnection();
  try {
    // 1. 检查是否有进行中的订单（pending/matched）
    const [existingOrders] = await connection.query(
      `SELECT id FROM ai_blind_box_orders
       WHERE user_id = ? AND status IN ('pending', 'matched')
       AND expire_at > ?`,
      [userId, new Date().toISOString().slice(0, 19).replace('T', ' ')],
    );

    if (existingOrders.length > 0) {
      const error = getErrorByCode(1010); // BLIND_BOX_DUPLICATE_ORDER
      throw Object.assign(new Error(error.message), { code: error.code });
    }

    // 2. 执行 AI 匹配
    const matchResult = await matchingEngine.match({
      budget_min: orderData.budget_min,
      budget_max: orderData.budget_max,
      taste_tags: orderData.taste_tags,
      district_id: orderData.district_id,
    });

    // 3. 计算价格
    const priceResult = priceCalculator.calculateBlindboxPrice(
      matchResult.originalPrice,
      matchResult.dish.discount_rate,
    );

    // 4. 计算过期时间
    const expireSeconds = config.blindBox.orderExpireSeconds;
    const expireAt = getExpireTime(expireSeconds);

    // 5. 写入数据库
    const [result] = await connection.query(
      `INSERT INTO ai_blind_box_orders
       (user_id, budget_min, budget_max, taste_tags, district_id, status,
        matched_dish_id, original_price, blindbox_price, platform_subsidy, expire_at)
       VALUES (?, ?, ?, ?, ?, 'matched', ?, ?, ?, ?, ?)`,
      [
        userId,
        orderData.budget_min,
        orderData.budget_max,
        JSON.stringify(orderData.taste_tags),
        orderData.district_id,
        matchResult.dish.id || matchResult.dish.dish_id,
        matchResult.originalPrice,
        priceResult.blindboxPrice,
        priceResult.platformSubsidy,
        expireAt.toISOString().slice(0, 19).replace('T', ' '),
      ],
    );

    // 6. 查询完整订单数据
    const [orders] = await connection.query(
      'SELECT * FROM ai_blind_box_orders WHERE id = ?',
      [result.insertId],
    );
    const order = orders[0];

    // 7. 发布事件
    eventBus.emitEvent(blindBoxEvents.BLIND_BOX_ORDER_CREATED, {
      orderId: order.id,
      userId,
      dishId: matchResult.dish.dish_id,
      blindboxPrice: priceResult.blindboxPrice,
    });

    // 8. 返回结果
    return {
      id: order.id,
      status: order.status,
      matched_dish_id: matchResult.dish.dish_id,
      original_price: matchResult.originalPrice,
      blindbox_price: priceResult.blindboxPrice,
      platform_subsidy: priceResult.platformSubsidy,
      expire_at: expireAt,
      countdown_seconds: expireSeconds,
      dish_info: {
        dish_id: matchResult.dish.dish_id,
        name: matchResult.dish.dish_name || null,
        original_price: matchResult.originalPrice,
        discount_rate: matchResult.dish.discount_rate,
      },
    };
  } finally {
    await connection.end();
  }
}

/**
 * 获取盲盒订单详情
 *
 * @param {number} orderId - 订单ID
 * @returns {Promise<Object>}
 */
async function getOrder(orderId) {
  const connection = await _getConnection();
  try {
    const [orders] = await connection.query(
      'SELECT * FROM ai_blind_box_orders WHERE id = ?',
      [orderId],
    );

    if (orders.length === 0) {
      const error = getErrorByCode(1002); // BLIND_BOX_ORDER_NOT_FOUND
      throw Object.assign(new Error(error.message), { code: error.code });
    }

    const order = orders[0];

    // 检查是否过期
    const now = new Date();
    if (order.status === 'matched' && order.expire_at && new Date(order.expire_at) < now) {
      // 自动更新过期状态
      await connection.query(
        "UPDATE ai_blind_box_orders SET status = 'expired' WHERE id = ? AND status = 'matched'",
        [orderId],
      );
      order.status = 'expired';
    }

    return {
      id: order.id,
      user_id: order.user_id,
      status: order.status,
      budget_min: order.budget_min,
      budget_max: order.budget_max,
      taste_tags: order.taste_tags ? (() => { try { return JSON.parse(order.taste_tags); } catch(e) { return []; } })() : [],
      district_id: order.district_id,
      matched_dish_id: order.matched_dish_id,
      original_price: order.original_price,
      blindbox_price: order.blindbox_price,
      platform_subsidy: order.platform_subsidy,
      expire_at: order.expire_at,
      created_at: order.created_at,
    };
  } finally {
    await connection.end();
  }
}

/**
 * 确认盲盒订单
 *
 * @param {number} orderId - 订单ID
 * @returns {Promise<Object>}
 */
async function confirmOrder(orderId) {
  const connection = await _getConnection();
  try {
    // 1. 查找订单
    const [orders] = await connection.query(
      'SELECT * FROM ai_blind_box_orders WHERE id = ?',
      [orderId],
    );

    if (orders.length === 0) {
      const error = getErrorByCode(1002); // BLIND_BOX_ORDER_NOT_FOUND
      throw Object.assign(new Error(error.message), { code: error.code });
    }

    const order = orders[0];

    // 2. 校验状态
    if (order.status !== 'matched') {
      if (order.status === 'expired') {
        const error = getErrorByCode(1003); // BLIND_BOX_ORDER_EXPIRED
        throw Object.assign(new Error(error.message), { code: error.code });
      }
      const error = getErrorByCode(1004); // BLIND_BOX_ORDER_STATUS_INVALID
      throw Object.assign(new Error(error.message), { code: error.code });
    }

    // 3. 校验是否过期
    const now = new Date();
    if (order.expire_at && new Date(order.expire_at) < now) {
      await connection.query(
        "UPDATE ai_blind_box_orders SET status = 'expired' WHERE id = ?",
        [orderId],
      );
      const error = getErrorByCode(1003); // BLIND_BOX_ORDER_EXPIRED
      throw Object.assign(new Error(error.message), { code: error.code });
    }

    // 4. 扣减库存
    const stockDeducted = await poolManager.deductStock(order.matched_dish_id, 1);
    if (!stockDeducted) {
      const error = getErrorByCode(1007); // BLIND_BOX_STOCK_INSUFFICIENT
      throw Object.assign(new Error(error.message), { code: error.code });
    }

    // 5. 更新订单状态
    await connection.query(
      "UPDATE ai_blind_box_orders SET status = 'confirmed' WHERE id = ?",
      [orderId],
    );

    // 6. 发布事件
    eventBus.emitEvent(blindBoxEvents.BLIND_BOX_ORDER_CONFIRMED, {
      orderId: order.id,
      userId: order.user_id,
      dishId: order.matched_dish_id,
    });

    return {
      id: order.id,
      status: 'confirmed',
      matched_dish_id: order.matched_dish_id,
      blindbox_price: order.blindbox_price,
      platform_subsidy: order.platform_subsidy,
      message: '盲盒订单已确认',
    };
  } finally {
    await connection.end();
  }
}

/**
 * 取消盲盒订单
 *
 * @param {number} orderId - 订单ID
 * @returns {Promise<Object>}
 */
async function cancelOrder(orderId) {
  const connection = await _getConnection();
  try {
    // 1. 查找订单
    const [orders] = await connection.query(
      'SELECT * FROM ai_blind_box_orders WHERE id = ?',
      [orderId],
    );

    if (orders.length === 0) {
      const error = getErrorByCode(1002); // BLIND_BOX_ORDER_NOT_FOUND
      throw Object.assign(new Error(error.message), { code: error.code });
    }

    const order = orders[0];

    // 2. 校验状态
    if (order.status !== 'matched') {
      if (order.status === 'confirmed') {
        // 已确认订单不可取消，需要额外恢复库存？这里简单拒绝
        const error = getErrorByCode(1004); // BLIND_BOX_ORDER_STATUS_INVALID
        throw Object.assign(new Error(error.message), { code: error.code });
      }
      if (order.status === 'cancelled') {
        return { id: order.id, status: 'cancelled', message: '盲盒订单已取消' };
      }
      const error = getErrorByCode(1004);
      throw Object.assign(new Error(error.message), { code: error.code });
    }

    // 3. 更新订单状态
    await connection.query(
      "UPDATE ai_blind_box_orders SET status = 'cancelled' WHERE id = ?",
      [orderId],
    );

    // 4. 发布事件
    eventBus.emitEvent(blindBoxEvents.BLIND_BOX_ORDER_CANCELLED, {
      orderId: order.id,
      userId: order.user_id,
      dishId: order.matched_dish_id,
    });

    return {
      id: order.id,
      status: 'cancelled',
      message: '盲盒订单已取消',
    };
  } finally {
    await connection.end();
  }
}

/**
 * 商家获取盲盒池列表
 *
 * @param {Object} filters - 筛选条件
 * @returns {Promise<Object>}
 */
async function getPoolDishes(filters) {
  return poolManager.queryPool(filters);
}

/**
 * 上架/下架盲盒餐品
 *
 * @param {number} dishId - 餐品ID
 * @param {string} status - 新状态
 * @returns {Promise<Object>}
 */
async function toggleDish(dishId, status) {
  const success = await poolManager.toggleDishStatus(dishId, status);
  if (!success) {
    const error = getErrorByCode(1005); // BLIND_BOX_DISH_NOT_FOUND
    throw Object.assign(new Error(error.message), { code: error.code });
  }
  return { dish_id: dishId, status };
}

/**
 * 更新盲盒餐品库存
 *
 * @param {number} dishId - 餐品ID
 * @param {number} stockLimit - 新的库存限制
 * @returns {Promise<Object>}
 */
async function updateStock(dishId, stockLimit) {
  const success = await poolManager.updateDishStock(dishId, stockLimit);
  if (!success) {
    const error = getErrorByCode(1005); // BLIND_BOX_DISH_NOT_FOUND
    throw Object.assign(new Error(error.message), { code: error.code });
  }
  return { dish_id: dishId, stock_limit: stockLimit };
}

/**
 * 定时清理过期订单
 *
 * @returns {Promise<number>} 清理数量
 */
async function cleanExpiredOrders() {
  const connection = await _getConnection();
  try {
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const [result] = await connection.query(
      `UPDATE ai_blind_box_orders
       SET status = 'expired'
       WHERE status IN ('pending', 'matched')
         AND expire_at IS NOT NULL
         AND expire_at <= ?`,
      [now],
    );

    if (result.affectedRows > 0) {
      eventBus.emitEvent(blindBoxEvents.BLIND_BOX_ORDER_EXPIRED, {
        count: result.affectedRows,
      });
    }

    return result.affectedRows;
  } finally {
    await connection.end();
  }
}

module.exports = {
  createOrder,
  getOrder,
  confirmOrder,
  cancelOrder,
  getPoolDishes,
  toggleDish,
  updateStock,
  cleanExpiredOrders,
};
