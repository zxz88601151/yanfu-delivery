'use strict';

/**
 * 骑手调度业务逻辑层
 *
 * 负责：
 * - 骑手调度/接单偏好设置管理
 * - 可抢订单查询与筛选
 * - 抢单与系统派单逻辑
 * - 骑手在线/离线状态管理
 *
 * @module ai_modules/rider_dispatch/service
 */

const mysql = require('mysql2/promise');
const config = require('../../config/ai_modules');
const { getErrorByCode } = require('../../config/error_codes');
const { emitOrderGrabbed, emitRiderStatusChanged, emitSettingsUpdated } = require('./events');
const winston = require('winston');
const path = require('path');

const logger = winston.createLogger({
  level: process.env.KUAILV_LOG_LEVEL || 'info',
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({
      filename: path.join(process.env.KUAILV_LOG_DIR || './logs', 'rider-dispatch.log'),
      maxSize: '10m',
      maxFiles: 7,
    }),
  ],
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message }) => {
      return `[${timestamp}] [${level.toUpperCase()}] ${message}`;
    }),
  ),
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
 * 获取骑手调度设置
 * 如不存在则自动创建默认设置
 *
 * @param {number} riderId - 骑手ID
 * @returns {Promise<Object>} 骑手设置对象
 */
async function getSettings(riderId) {
  const conn = await _getConnection();
  try {
    let [rows] = await conn.query(
      'SELECT * FROM ai_rider_dispatch_settings WHERE rider_id = ?',
      [riderId],
    );

    if (rows.length === 0) {
      // 自动创建默认设置
      await conn.query('INSERT INTO ai_rider_dispatch_settings (rider_id) VALUES (?)', [riderId]);
      [rows] = await conn.query(
        'SELECT * FROM ai_rider_dispatch_settings WHERE rider_id = ?',
        [riderId],
      );
    }

    const s = rows[0];
    if (s.preferred_districts && typeof s.preferred_districts === 'string') {
      try {
        s.preferred_districts = JSON.parse(s.preferred_districts);
      } catch (e) {
        s.preferred_districts = [];
      }
    }

    return s;
  } finally {
    await conn.end();
  }
}

/**
 * 更新骑手调度设置
 *
 * @param {number} riderId - 骑手ID
 * @param {Object} settingsData - 设置数据
 * @returns {Promise<Object>} 更新后的设置对象
 * @throws {Error} 当没有需要更新的字段时抛出 1001 错误
 */
async function updateSettings(riderId, settingsData) {
  const conn = await _getConnection();
  try {
    const fields = [];
    const values = [];
    const allowedFields = [
      'max_delivery_distance', 'min_order_amount', 'accept_mode', 'max_concurrent_orders',
      'working_time_start', 'working_time_end', 'preferred_districts', 'max_weight',
      'vehicle_type', 'auto_grab_enabled', 'auto_grab_max_distance', 'auto_grab_min_amount',
    ];

    for (const key of allowedFields) {
      if (settingsData[key] !== undefined) {
        fields.push(`${key} = ?`);
        values.push(key === 'preferred_districts' ? JSON.stringify(settingsData[key]) : settingsData[key]);
      }
    }

    if (fields.length === 0) {
      throw Object.assign(new Error('没有需要更新的字段'), { code: 1001 });
    }

    values.push(riderId);
    await conn.query(
      `UPDATE ai_rider_dispatch_settings SET ${fields.join(', ')} WHERE rider_id = ?`,
      values,
    );

    emitSettingsUpdated(riderId);

    return getSettings(riderId);
  } finally {
    await conn.end();
  }
}

/**
 * 设置骑手在线/离线状态
 *
 * @param {number} riderId - 骑手ID
 * @param {number} status - 状态（0=离线, 1=在线）
 * @returns {Promise<Object>} 更新结果
 */
async function updateStatus(riderId, status) {
  const conn = await _getConnection();
  try {
    await conn.query(
      'UPDATE ai_rider_dispatch_settings SET status = ? WHERE rider_id = ?',
      [status, riderId],
    );

    await conn.query(
      'UPDATE riders SET status = ? WHERE id = ?',
      [status === 1 ? 'idle' : 'offline', riderId],
    );

    emitRiderStatusChanged(riderId, status);

    return { rider_id: riderId, status };
  } finally {
    await conn.end();
  }
}

/**
 * 获取骑手可抢订单列表
 * 根据骑手设置进行筛选（最低金额、偏好区域、最大距离）
 *
 * @param {number} riderId - 骑手ID
 * @returns {Promise<Array>} 可抢订单列表
 */
async function getAvailableOrders(riderId) {
  const conn = await _getConnection();
  try {
    // 获取骑手设置
    const settings = await getSettings(riderId);

    let query = `SELECT id, district_id, total_amount, delivery_fee,
       merchant_lng, merchant_lat, delivery_lng, delivery_lat,
       category,
       TIMESTAMPDIFF(MINUTE, created_at, NOW()) AS wait_minutes,
       created_at
       FROM orders
       WHERE status = 'pending' AND rider_id IS NULL`;
    const params = [];

    // 按最低金额筛选
    if (settings.min_order_amount > 0) {
      query += ' AND total_amount >= ?';
      params.push(settings.min_order_amount);
    }

    // 按偏好区域筛选
    if (settings.preferred_districts && Array.isArray(settings.preferred_districts) && settings.preferred_districts.length > 0) {
      query += ` AND district_id IN (${settings.preferred_districts.map(() => '?').join(',')})`;
      params.push(...settings.preferred_districts);
    }

    query += ' ORDER BY created_at ASC LIMIT 50';

    const [rows] = await conn.query(query, params);

    // 按最大配送距离筛选（内存计算距离）
    if (settings.max_delivery_distance > 0) {
      const [riderRows] = await conn.query('SELECT lng, lat FROM riders WHERE id = ?', [riderId]);
      if (riderRows.length > 0) {
        const riderLng = parseFloat(riderRows[0].lng);
        const riderLat = parseFloat(riderRows[0].lat);

        return rows.filter((order) => {
          if (order.merchant_lng && order.merchant_lat) {
            const dist = calcApproxDistance(
              riderLat, riderLng,
              parseFloat(order.merchant_lat), parseFloat(order.merchant_lng),
            );
            return dist <= settings.max_delivery_distance;
          }
          return true;
        });
      }
    }

    return rows;
  } finally {
    await conn.end();
  }
}

/**
 * 骑手抢单
 *
 * @param {number} riderId - 骑手ID
 * @param {number} orderId - 订单ID
 * @returns {Promise<Object>} 抢单结果
 * @throws {Error} 订单不可抢或骑手已达上限时抛出 4002 错误
 */
async function grabOrder(riderId, orderId) {
  const conn = await _getConnection();
  try {
    // 检查订单是否存在且可抢
    const [orders] = await conn.query(
      'SELECT * FROM orders WHERE id = ? AND status = ? AND rider_id IS NULL',
      [orderId, 'pending'],
    );

    if (orders.length === 0) {
      throw Object.assign(
        new Error('订单不可抢：已被其他骑手接单或已取消'),
        { code: 4002 },
      );
    }

    // 检查骑手当前活跃订单数
    const [activeOrders] = await conn.query(
      'SELECT COUNT(*) AS cnt FROM orders WHERE rider_id = ? AND status IN ("assigned", "delivering")',
      [riderId],
    );

    const settings = await getSettings(riderId);

    if (activeOrders[0].cnt >= settings.max_concurrent_orders) {
      throw Object.assign(
        new Error(`您已有 ${activeOrders[0].cnt} 个配送中订单，已达上限 ${settings.max_concurrent_orders}`),
        { code: 4002 },
      );
    }

    // 分配订单给骑手
    await conn.query(
      'UPDATE orders SET rider_id = ?, status = "assigned" WHERE id = ?',
      [riderId, orderId],
    );

    await conn.query(
      'UPDATE riders SET total_orders = total_orders + 1 WHERE id = ?',
      [riderId],
    );

    emitOrderGrabbed(riderId, orderId);

    return { order_id: orderId, rider_id: riderId, status: 'assigned' };
  } finally {
    await conn.end();
  }
}

/**
 * 计算骑手与订单的匹配分数（供派单引擎使用）
 *
 * @param {number} riderId - 骑手ID
 * @param {Object} order - 订单对象
 * @returns {Promise<number>} 匹配分数（0-100）
 */
async function calcMatchScore(riderId, order) {
  const settings = await getSettings(riderId);
  let score = 0;

  // 距离分数（0-40 分）
  if (order.merchant_lng) {
    score += 30;
  }

  // 金额分数（0-30 分）
  if (order.total_amount >= settings.min_order_amount) {
    score += 20;
  }

  // 区域匹配（0-30 分）
  if (settings.preferred_districts && Array.isArray(settings.preferred_districts)) {
    if (settings.preferred_districts.includes(order.district_id)) {
      score += 30;
    }
  } else {
    score += 15;
  }

  return score;
}

/**
 * 近似距离计算（Haversine 公式）
 *
 * @param {number} lat1 - 起点纬度
 * @param {number} lng1 - 起点经度
 * @param {number} lat2 - 终点纬度
 * @param {number} lng2 - 终点经度
 * @returns {number} 距离（米）
 */
function calcApproxDistance(lat1, lng1, lat2, lng2) {
  if (!lat1 || !lng1 || !lat2 || !lng2) return 0;

  const R = 6371000; // 地球半径（米）
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
    + Math.cos(lat1 * Math.PI / 180)
    * Math.cos(lat2 * Math.PI / 180)
    * Math.sin(dLng / 2) * Math.sin(dLng / 2);

  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

module.exports = {
  getSettings,
  updateSettings,
  updateStatus,
  getAvailableOrders,
  grabOrder,
  calcMatchScore,
};
