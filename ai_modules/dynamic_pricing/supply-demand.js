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
 * 运力供需比计算
 * 查询活跃骑手数和待配送订单数，计算供需比
 *
 * @module ai_modules/dynamic_pricing/supply-demand
 */

const mysql = require('mysql2/promise');
const NodeCache = require('node-cache');
const config = require('../../config/ai_modules');

// 供需比缓存（TTL 120 秒）
const cache = new NodeCache({
  stdTTL: config.dynamicPricing.supplyDemandCacheTtl || 120,
  checkperiod: 60,
});

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
 * 获取指定区域的活跃骑手数量
 *
 * @param {number} districtId - 区域ID
 * @returns {Promise<number>}
 */
async function getActiveRiderCount(districtId) {
  const connection = await _getConnection();
  try {
    const [rows] = await connection.query(
      `SELECT COUNT(*) AS count FROM riders
       WHERE district_id = ? AND status IN ('idle', 'delivering')`,
      [districtId],
    );
    return rows[0].count;
  } finally {
    await connection.end();
  }
}

/**
 * 获取指定区域的待配送订单数量
 *
 * @param {number} districtId - 区域ID
 * @returns {Promise<number>}
 */
async function getPendingOrderCount(districtId) {
  const connection = await _getConnection();
  try {
    const [rows] = await connection.query(
      `SELECT COUNT(*) AS count FROM orders
       WHERE district_id = ? AND status IN ('pending', 'assigned')`,
      [districtId],
    );
    return rows[0].count;
  } finally {
    await connection.end();
  }
}

/**
 * 从缓存获取上次预测数据（降级回退用）
 *
 * @param {number} districtId - 区域ID
 * @returns {number|null}
 */
function getLastPredictionFromCache(districtId) {
  const cached = cache.get(`supply_demand:${districtId}`);
  return cached !== undefined && cached !== null ? cached : null;
}

/**
 * 获取指定区域的运力供需比
 *
 * 供需比 = 活跃骑手数 / 待配送订单数
 * 若待配送订单数为 0，返回 2.0（运力充裕）
 * 查询失败时降级：从缓存读取上次值，若无缓存返回 1.0
 *
 * @param {number} districtId - 区域ID
 * @returns {Promise<number>}
 */
async function getSupplyDemandRatio(districtId) {
  const cacheKey = `supply_demand:${districtId}`;

  // 检查缓存
  const cached = cache.get(cacheKey);
  if (cached !== undefined && cached !== null) {
    return cached;
  }

  try {
    const [activeRiders, pendingOrders] = await Promise.all([
      getActiveRiderCount(districtId),
      getPendingOrderCount(districtId),
    ]);

    let ratio;
    if (pendingOrders === 0) {
      ratio = 2.0;
    } else {
      ratio = +(activeRiders / pendingOrders).toFixed(2);
    }

    // 写入缓存
    cache.set(cacheKey, ratio);
    return ratio;
  } catch (err) {
    // 降级：从缓存读取上次值
    const fallback = getLastPredictionFromCache(districtId);
    if (fallback !== null) {
      return fallback;
    }
    // 无缓存则回退 1.0
    return 1.0;
  }
}

/**
 * 清除指定区域的供需比缓存
 *
 * @param {number} districtId - 区域ID
 */
function invalidateCache(districtId) {
  cache.del(`supply_demand:${districtId}`);
}

/**
 * 清除全部供需比缓存
 */
function invalidateAllCache() {
  cache.flushAll();
}

module.exports = {
  getSupplyDemandRatio,
  getActiveRiderCount,
  getPendingOrderCount,
  getLastPredictionFromCache,
  invalidateCache,
  invalidateAllCache,
};
