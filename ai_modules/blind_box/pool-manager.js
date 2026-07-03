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
 * 盲盒池管理
 * 负责盲盒餐品的增删改查、库存管理、过期清理
 *
 * @module ai_modules/blind_box/pool-manager
 */

const mysql = require('mysql2/promise');
const config = require('../../config/ai_modules');
const { getErrorByCode } = require('../../config/error_codes');
const eventBus = require('../common/event-bus');
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
 * 查询符合条件的盲盒餐品
 * 根据区域、口味标签、预算范围筛选
 *
 * @param {number} districtId - 区域ID
 * @param {string[]} tasteTags - 口味标签
 * @param {number} budgetMin - 预算下限
 * @param {number} budgetMax - 预算上限
 * @returns {Promise<Array>} 符合条件的餐品列表
 */
async function getAvailableDishes(districtId, tasteTags, budgetMin, budgetMax) {
  const connection = await _getConnection();
  try {
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

    // 筛选条件：
    // 1. 状态为 active
    // 2. 区域匹配
    // 3. 盲盒价在预算范围内
    // 4. 未过期（expire_at 为 NULL 或大于当前时间）
    // 5. 有库存（stock_limit = 0 表示不限，否则 stock_used < stock_limit）
    // 6. 口味标签有交集（JSON 包含任一用户口味）
    let sql = `
      SELECT * FROM ai_blind_box_pool
      WHERE status = ?
        AND district_id = ?
        AND blindbox_price >= ?
        AND blindbox_price <= ?
        AND (expire_at IS NULL OR expire_at > ?)
        AND (stock_limit = 0 OR stock_used < stock_limit)
    `;
    const params = ['active', districtId, budgetMin, budgetMax, now];

    // 口味标签匹配：JSON_CONTAINS 检查池中餐品的 taste_tags 是否与用户口味有交集
    // 使用 OR 条件逐一匹配用户标签
    if (tasteTags && tasteTags.length > 0) {
      const tagConditions = tasteTags.map(() => 'JSON_CONTAINS(taste_tags, ?)');
      sql += ` AND (${tagConditions.join(' OR ')})`;
      tasteTags.forEach((tag) => {
        params.push(JSON.stringify(tag));
      });
    }

    sql += ' ORDER BY is_featured DESC, discount_rate DESC';

    const [rows] = await connection.query(sql, params);
    return rows;
  } finally {
    await connection.end();
  }
}

/**
 * 扣减盲盒库存
 *
 * @param {number} dishId - 餐品ID
 * @param {number} quantity - 扣减数量（默认1）
 * @returns {Promise<boolean>} 是否扣减成功
 */
async function deductStock(dishId, quantity = 1) {
  const connection = await _getConnection();
  try {
    const [result] = await connection.query(
      `UPDATE ai_blind_box_pool
       SET stock_used = stock_used + ?
       WHERE dish_id = ?
         AND (stock_limit = 0 OR stock_used + ? <= stock_limit)
         AND status = 'active'`,
      [quantity, dishId, quantity],
    );

    if (result.affectedRows === 0) {
      return false;
    }

    // 如果扣减后库存耗尽，更新状态
    await connection.query(
      `UPDATE ai_blind_box_pool
       SET status = 'depleted'
       WHERE dish_id = ?
         AND stock_limit > 0
         AND stock_used >= stock_limit
         AND status = 'active'`,
      [dishId],
    );

    return true;
  } finally {
    await connection.end();
  }
}

/**
 * 恢复盲盒库存
 *
 * @param {number} dishId - 餐品ID
 * @param {number} quantity - 恢复数量（默认1）
 * @returns {Promise<boolean>}
 */
async function restoreStock(dishId, quantity = 1) {
  const connection = await _getConnection();
  try {
    const [result] = await connection.query(
      `UPDATE ai_blind_box_pool
       SET stock_used = GREATEST(stock_used - ?, 0),
           status = IF(status = 'depleted', 'active', status)
       WHERE dish_id = ?`,
      [quantity, dishId],
    );

    return result.affectedRows > 0;
  } finally {
    await connection.end();
  }
}

/**
 * 商家添加餐品到盲盒池
 *
 * @param {Object} dishData - 餐品数据
 * @param {number} dishData.dish_id - 餐品ID
 * @param {number} dishData.merchant_id - 商家ID
 * @param {number} dishData.original_price - 原价
 * @param {number} dishData.discount_rate - 折扣率
 * @param {number} dishData.stock_limit - 库存限制
 * @param {string[]} dishData.taste_tags - 口味标签
 * @param {number} dishData.district_id - 区域ID
 * @param {boolean} [dishData.is_featured=false] - 是否推荐
 * @param {string|null} [dishData.expire_at=null] - 过期时间
 * @returns {Promise<Object>} 新增的餐品记录
 */
async function addToPool(dishData) {
  const connection = await _getConnection();
  try {
    // 检查是否已存在
    const [existing] = await connection.query(
      'SELECT id, status FROM ai_blind_box_pool WHERE dish_id = ? AND merchant_id = ?',
      [dishData.dish_id, dishData.merchant_id],
    );

    if (existing.length > 0) {
      const error = getErrorByCode(1014); // BLIND_BOX_DISH_ALREADY_IN_POOL
      throw Object.assign(new Error(error.message), { code: error.code });
    }

    const blindboxPrice = Math.round(dishData.original_price * dishData.discount_rate * 100) / 100;

    const [result] = await connection.query(
      `INSERT INTO ai_blind_box_pool
       (dish_id, merchant_id, original_price, discount_rate, blindbox_price,
        stock_limit, stock_used, taste_tags, district_id, is_featured, expire_at, status)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 'active')`,
      [
        dishData.dish_id,
        dishData.merchant_id,
        dishData.original_price,
        dishData.discount_rate,
        blindboxPrice,
        dishData.stock_limit || 0,
        JSON.stringify(dishData.taste_tags),
        dishData.district_id,
        dishData.is_featured ? 1 : 0,
        dishData.expire_at || null,
      ],
    );

    const [inserted] = await connection.query(
      'SELECT * FROM ai_blind_box_pool WHERE id = ?',
      [result.insertId],
    );

    // 发布池更新事件
    eventBus.emitEvent(blindBoxEvents.BLIND_BOX_POOL_UPDATED, {
      action: 'add',
      dishId: dishData.dish_id,
      merchantId: dishData.merchant_id,
    });

    return inserted[0];
  } finally {
    await connection.end();
  }
}

/**
 * 下架盲盒餐品
 *
 * @param {number} dishId - 餐品ID
 * @returns {Promise<boolean>}
 */
async function removeFromPool(dishId) {
  const connection = await _getConnection();
  try {
    const [result] = await connection.query(
      `UPDATE ai_blind_box_pool SET status = 'inactive' WHERE dish_id = ? AND status = 'active'`,
      [dishId],
    );

    if (result.affectedRows > 0) {
      eventBus.emitEvent(blindBoxEvents.BLIND_BOX_POOL_UPDATED, {
        action: 'remove',
        dishId,
      });
      return true;
    }
    return false;
  } finally {
    await connection.end();
  }
}

/**
 * 清理过期餐品
 *
 * @returns {Promise<number>} 清理的记录数
 */
async function cleanExpiredDishes() {
  const connection = await _getConnection();
  try {
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const [result] = await connection.query(
      `UPDATE ai_blind_box_pool
       SET status = 'expired'
       WHERE status = 'active'
         AND expire_at IS NOT NULL
         AND expire_at <= ?`,
      [now],
    );

    if (result.affectedRows > 0) {
      eventBus.emitEvent(blindBoxEvents.BLIND_BOX_POOL_UPDATED, {
        action: 'clean_expired',
        count: result.affectedRows,
      });
    }

    return result.affectedRows;
  } finally {
    await connection.end();
  }
}

/**
 * 切换餐品上架/下架状态
 *
 * @param {number} dishId - 餐品ID
 * @param {string} newStatus - 新状态
 * @returns {Promise<boolean>}
 */
async function toggleDishStatus(dishId, newStatus) {
  const connection = await _getConnection();
  try {
    const [result] = await connection.query(
      `UPDATE ai_blind_box_pool SET status = ? WHERE dish_id = ?`,
      [newStatus, dishId],
    );
    return result.affectedRows > 0;
  } finally {
    await connection.end();
  }
}

/**
 * 更新餐品库存
 *
 * @param {number} dishId - 餐品ID
 * @param {number} stockLimit - 新的库存限制
 * @returns {Promise<boolean>}
 */
async function updateDishStock(dishId, stockLimit) {
  const connection = await _getConnection();
  try {
    const [result] = await connection.query(
      `UPDATE ai_blind_box_pool
       SET stock_limit = ?,
           status = IF(stock_limit > 0 AND stock_used >= stock_limit, 'depleted', 'active')
       WHERE dish_id = ?`,
      [stockLimit, dishId],
    );
    return result.affectedRows > 0;
  } finally {
    await connection.end();
  }
}

/**
 * 根据ID获取池餐品
 *
 * @param {number} dishId - 餐品ID
 * @returns {Promise<Object|null>}
 */
async function getDishById(dishId) {
  const connection = await _getConnection();
  try {
    const [rows] = await connection.query(
      'SELECT * FROM ai_blind_box_pool WHERE dish_id = ?',
      [dishId],
    );
    return rows.length > 0 ? rows[0] : null;
  } finally {
    await connection.end();
  }
}

/**
 * 分页查询盲盒池
 *
 * @param {Object} filters - 筛选条件
 * @param {number} [filters.merchant_id]
 * @param {number} [filters.district_id]
 * @param {string} [filters.status='active']
 * @param {number} [filters.page=1]
 * @param {number} [filters.size=20]
 * @returns {Promise<{ total: number, page: number, size: number, items: Array }>}
 */
async function queryPool(filters) {
  if (!filters || typeof filters !== 'object') {
    filters = {};
  }
  const connection = await _getConnection();
  try {
    const conditions = ['1=1'];
    const params = [];

    if (filters.merchant_id) {
      conditions.push('merchant_id = ?');
      params.push(filters.merchant_id);
    }
    if (filters.district_id) {
      conditions.push('district_id = ?');
      params.push(filters.district_id);
    }
    if (filters.status) {
      conditions.push('status = ?');
      params.push(filters.status);
    }

    const whereClause = conditions.join(' AND ');
    const page = filters.page || 1;
    const size = filters.size || 20;
    const offset = (page - 1) * size;

    const [countResult] = await connection.query(
      `SELECT COUNT(*) AS total FROM ai_blind_box_pool WHERE ${whereClause}`,
      params,
    );
    const total = countResult[0].total;

    const [rows] = await connection.query(
      `SELECT * FROM ai_blind_box_pool WHERE ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, size, offset],
    );

    return { total, page, size, items: rows };
  } finally {
    await connection.end();
  }
}

module.exports = {
  getAvailableDishes,
  deductStock,
  restoreStock,
  addToPool,
  removeFromPool,
  cleanExpiredDishes,
  toggleDishStatus,
  updateDishStock,
  getDishById,
  queryPool,
};
