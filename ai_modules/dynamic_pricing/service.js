'use strict';

/**
 * 动态定价业务逻辑层（核心编排）
 *
 * 负责：
 * - 定价计算主流程编排（5 因子聚合 + 降级熔断）
 * - 配置管理（读取/更新/缓存）
 * - 定时任务（全区域重算）
 * - 领域事件发布
 *
 * @module ai_modules/dynamic_pricing/service
 */

const mysql = require('mysql2/promise');
const NodeCache = require('node-cache');
const turf = require('@turf/turf');
const config = require('../../config/ai_modules');
const { getErrorByCode } = require('../../config/error_codes');
const pricingModel = require('./pricing-model');
const supplyDemand = require('./supply-demand');
const weatherClient = require('./weather-client');
const zoneHeatmap = require('./zone-heatmap');
const eventBus = require('../common/event-bus');
const wsPush = require('../common/ws-push');
const { emitEstimateCalculated, emitConfigChanged, emitZoneUpdated } = require('./events');

// 定价配置缓存（TTL 60 秒）
const configCache = new NodeCache({
  stdTTL: config.dynamicPricing.configCacheTtl || 60,
  checkperiod: 30,
});

// 请求频率计数器
const rateLimitMap = new Map();

/**
 * 获取数据库连接
 *
 * @returns {Promise<import('mysql2/promise').Connection>}
 * @private
 */
async function _getConnection() {
  return pool.getConnection();
}

/**
 * 检查请求频率限制
 *
 * @param {number} userId - 用户ID
 * @returns {boolean} true=允许通过, false=超过限制
 * @private
 */
function _checkRateLimit(userId) {
  const key = `rate:${userId}`;
  const now = Date.now();
  const windowMs = 60000; // 1 分钟

  if (!rateLimitMap.has(key)) {
    rateLimitMap.set(key, { count: 1, start: now });
    return true;
  }

  const entry = rateLimitMap.get(key);
  if (now - entry.start > windowMs) {
    // 重置窗口
    rateLimitMap.set(key, { count: 1, start: now });
    return true;
  }

  entry.count++;
  if (entry.count > (config.dynamicPricing.rateLimitPerMinute || 60)) {
    return false;
  }

  return true;
}

/**
 * 加载定价配置
 * 从缓存读取，未命中则从 DB 加载
 *
 * @returns {Promise<Object>} PricingConfig
 */
async function loadConfig() {
  const cacheKey = 'pricing:config';

  // 1. 查缓存
  const cached = configCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const connection = await _getConnection();
  try {
    // 2. 从 DB 加载
    const [rows] = await connection.query(
      'SELECT config_key, config_value FROM ai_price_configs',
    );

    const pricingConfig = {
      baseFee: config.dynamicPricing.defaultBaseFee || 5.00,
      surgeCapUp: 5.0,
      surgeCapDown: -3.0,
      compositeFactorMax: 1.50,
      compositeFactorMin: 0.85,
      weatherProtectionCap: 8.0,
      weatherProtectionThreshold: 1.30,
      updateIntervalMinutes: 5,
      timeFactorMap: {
        '00:00-06:00': 1.30,
        '06:00-09:00': 1.0,
        '09:00-11:00': 1.0,
        '11:00-14:00': 1.15,
        '14:00-17:00': 0.90,
        '17:00-21:00': 1.10,
        '21:00-24:00': 1.15,
      },
      supplyDemandRanges: null,
      distanceRanges: null,
      densityRanges: null,
    };

    // 解析 DB 中的配置
    for (const row of rows) {
      const value = typeof row.config_value === 'string'
        ? JSON.parse(row.config_value)
        : row.config_value;

      switch (row.config_key) {
        case 'base_fee':
          pricingConfig.baseFee = parseFloat(value) || 5.00;
          break;
        case 'surge_cap_up':
          pricingConfig.surgeCapUp = parseFloat(value) || 5.0;
          break;
        case 'surge_cap_down':
          pricingConfig.surgeCapDown = parseFloat(value) || -3.0;
          break;
        case 'composite_factor_max':
          pricingConfig.compositeFactorMax = parseFloat(value) || 1.50;
          break;
        case 'composite_factor_min':
          pricingConfig.compositeFactorMin = parseFloat(value) || 0.85;
          break;
        case 'weather_protection_cap':
          pricingConfig.weatherProtectionCap = parseFloat(value) || 8.0;
          break;
        case 'weather_protection_threshold':
          pricingConfig.weatherProtectionThreshold = parseFloat(value) || 1.30;
          break;
        case 'update_interval_minutes':
          pricingConfig.updateIntervalMinutes = parseInt(value, 10) || 5;
          break;
        case 'time_factor_map':
          pricingConfig.timeFactorMap = typeof value === 'object' ? value : pricingConfig.timeFactorMap;
          break;
        case 'supply_demand_ranges':
          pricingConfig.supplyDemandRanges = value;
          break;
        case 'distance_ranges':
          pricingConfig.distanceRanges = Array.isArray(value) ? value : null;
          break;
        case 'density_ranges':
          pricingConfig.densityRanges = Array.isArray(value) ? value : null;
          break;
        default:
          break;
      }
    }

    // 3. 写缓存
    configCache.set(cacheKey, pricingConfig);

    return pricingConfig;
  } catch (err) {
    // 4. 降级：从缓存读取（可能过期但仍有值）
    const retry = configCache.get(cacheKey);
    if (retry) {
      return retry;
    }
    // 5. 返回内置默认值
    return {
      baseFee: config.dynamicPricing.defaultBaseFee || 5.00,
      surgeCapUp: 5.0,
      surgeCapDown: -3.0,
      compositeFactorMax: 1.50,
      compositeFactorMin: 0.85,
      weatherProtectionCap: 8.0,
      weatherProtectionThreshold: 1.30,
      updateIntervalMinutes: 5,
      timeFactorMap: {
        '00:00-06:00': 1.30,
        '06:00-09:00': 1.0,
        '09:00-11:00': 1.0,
        '11:00-14:00': 1.15,
        '14:00-17:00': 0.90,
        '17:00-21:00': 1.10,
        '21:00-24:00': 1.15,
      },
    };
  } finally {
    connection.release();
  }
}

/**
 * 计算两点之间的路线距离（米）
 *
 * @param {number} lng1 - 起点经度
 * @param {number} lat1 - 起点纬度
 * @param {number} lng2 - 终点经度
 * @param {number} lat2 - 终点纬度
 * @returns {number} 距离（米）
 * @private
 */
function _calculateDistance(lng1, lat1, lng2, lat2) {
  const from = turf.point([lng1, lat1]);
  const to = turf.point([lng2, lat2]);
  const options = { units: 'meters' };
  return Math.round(turf.distance(from, to, options));
}

/**
 * 估算配送费（核心方法）
 *
 * 流程：
 * 1. 加载定价配置（缓存）
 * 2. 获取运力供需比（降级保护）
 * 3. 获取天气数据（降级保护）
 * 4. 计算配送距离
 * 5. 计算订单密度
 * 6. 执行 5 因子模型计算
 * 7. 写入定价日志（异步）
 * 8. 发布领域事件
 *
 * @param {number} userId - 用户ID
 * @param {number} merchantLng - 商家经度
 * @param {number} merchantLat - 商家纬度
 * @param {number} deliveryLng - 配送经度
 * @param {number} deliveryLat - 配送纬度
 * @param {number} districtId - 区域ID
 * @returns {Promise<Object>} EstimateResult
 * @throws {Error} 当全部因子获取失败或超出服务范围
 */
async function estimateFee(userId, merchantLng, merchantLat, deliveryLng, deliveryLat, districtId) {
  // 1. 频率限制检查
  if (!_checkRateLimit(userId)) {
    const error = getErrorByCode(2006);
    throw Object.assign(new Error(error.message), { code: error.code });
  }

  // 2. 加载定价配置
  const pricingConfig = await loadConfig();

  // 3. 获取各因子（每步都有降级保护）
  let sdRatio = 1.0;
  let weatherData = null;
  let distance = 1000;
  let density = 10;
  let allFactorsFailed = false;

  try {
    sdRatio = await supplyDemand.getSupplyDemandRatio(districtId);
  } catch (err) {
    sdRatio = 1.0;
  }

  try {
    weatherData = await weatherClient.getWeather(deliveryLng, deliveryLat);
  } catch (err) {
    weatherData = { grade: 'good', condition: 'clear', temperature: 25, humidity: 50, windSpeed: 2, fetchedAt: new Date().toISOString() };
  }

  try {
    distance = _calculateDistance(merchantLng, merchantLat, deliveryLng, deliveryLat);
  } catch (err) {
    distance = 1000;
  }

  try {
    density = await _getOrderDensity(districtId);
  } catch (err) {
    density = 10;
  }

  // 4. 执行 5 因子计算
  const result = pricingModel.calculate(sdRatio, weatherData, new Date(), distance, density, pricingConfig);

  // 5. 计算最终金额
  const baseFee = pricingConfig.baseFee;
  const finalFee = result.finalFee;
  const surgeAmount = result.surgeAmount;

  // 6. 应用金额上下限约束
  const cappedSurgeUp = pricingConfig.surgeCapUp || 5.0;
  const cappedSurgeDown = pricingConfig.surgeCapDown || -3.0;

  // 极端天气保护
  let effectiveSurgeUp = cappedSurgeUp;
  if (result.factors.weather >= (pricingConfig.weatherProtectionThreshold || 1.30)) {
    effectiveSurgeUp = pricingConfig.weatherProtectionCap || 8.0;
  }

  const finalSurgeAmount = Math.max(
    Math.min(surgeAmount, effectiveSurgeUp),
    cappedSurgeDown,
  );
  const finalFinalFee = Math.round((baseFee + finalSurgeAmount) * 100) / 100;

  // 7. 异步写入定价日志
  _writeLog({
    userId,
    districtId,
    baseFee,
    finalFee: finalFinalFee,
    surgeAmount: finalSurgeAmount,
    supplyDemandFactor: result.factors.supplyDemand,
    weatherFactor: result.factors.weather,
    timeFactor: result.factors.time,
    distanceFactor: result.factors.distance,
    densityFactor: result.factors.density,
    compositeFactor: result.compositeFactor,
    cappedFactor: result.cappedFactor,
    supplyDemandRatio: sdRatio,
    weatherCondition: weatherData ? weatherData.condition : 'unknown',
    deliveryDistance: distance,
    orderDensity: density,
  }).catch(() => {}); // fire-and-forget

  // 8. 发布事件
  emitEstimateCalculated({
    userId,
    districtId,
    finalFee: finalFinalFee,
    factors: result.factors,
    surgeAmount: finalSurgeAmount,
  });

  // 9. 生成 surge_reason
  const surgeReason = pricingModel.generateSurgeReason(result.factors, sdRatio, weatherData, finalSurgeAmount);

  return {
    base_fee: baseFee,
    factors: {
      supply_demand: result.factors.supplyDemand,
      weather: result.factors.weather,
      time: result.factors.time,
      distance: result.factors.distance,
      density: result.factors.density,
    },
    composite_factor: result.compositeFactor,
    capped_factor: result.cappedFactor,
    final_fee: finalFinalFee,
    surge_amount: finalSurgeAmount,
    surge_reason: surgeReason,
  };
}

/**
 * 写入定价日志（异步）
 *
 * @param {Object} data - 日志数据
 * @returns {Promise<void>}
 * @private
 */
async function _writeLog(data) {
  const connection = await _getConnection();
  try {
    await connection.query(
      `INSERT INTO ai_price_logs
       (user_id, district_id, base_fee, final_fee, surge_amount,
        supply_demand_factor, weather_factor, time_factor, distance_factor, density_factor,
        composite_factor, capped_factor, supply_demand_ratio, weather_condition,
        delivery_distance, order_density)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.userId,
        data.districtId,
        data.baseFee,
        data.finalFee,
        data.surgeAmount,
        data.supplyDemandFactor,
        data.weatherFactor,
        data.timeFactor,
        data.distanceFactor,
        data.densityFactor,
        data.compositeFactor,
        data.cappedFactor,
        data.supplyDemandRatio,
        data.weatherCondition,
        data.deliveryDistance,
        data.orderDensity,
      ],
    );
  } finally {
    connection.release();
  }
}

/**
 * 获取订单密度
 *
 * @param {number} districtId - 区域ID
 * @returns {Promise<number>}
 * @private
 */
async function _getOrderDensity(districtId) {
  const connection = await _getConnection();
  try {
    const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000)
      .toISOString().slice(0, 19).replace('T', ' ');

    const [orderCount] = await connection.query(
      `SELECT COUNT(*) AS count FROM orders
       WHERE district_id = ? AND created_at >= ?`,
      [districtId, fifteenMinAgo],
    );

    const [areaInfo] = await connection.query(
      'SELECT area_sqkm FROM districts WHERE id = ?',
      [districtId],
    );

    const area = (areaInfo.length > 0 && areaInfo[0].area_sqkm) || 1.0;
    return +(orderCount[0].count / area).toFixed(2);
  } finally {
    connection.release();
  }
}

/**
 * 获取区域定价系数列表
 *
 * @param {number[]} [districtIds] - 区域ID数组（可选）
 * @returns {Promise<Object[]>}
 */
async function getZoneFactors(districtIds) {
  if (districtIds && districtIds.length > 0) {
    return zoneHeatmap.getZones(districtIds);
  }
  return zoneHeatmap.getAllZones();
}

/**
 * 获取定价配置
 *
 * @returns {Promise<Object>} 展平的配置对象
 */
async function getConfig() {
  const pricingConfig = await loadConfig();

  return {
    surge_cap_up: pricingConfig.surgeCapUp,
    surge_cap_down: pricingConfig.surgeCapDown,
    composite_factor_max: pricingConfig.compositeFactorMax,
    composite_factor_min: pricingConfig.compositeFactorMin,
    weather_protection_cap: pricingConfig.weatherProtectionCap,
    weather_protection_threshold: pricingConfig.weatherProtectionThreshold,
    update_interval_minutes: pricingConfig.updateIntervalMinutes,
    time_factor_map: pricingConfig.timeFactorMap,
  };
}

/**
 * 更新定价配置
 *
 * @param {Array<{ config_key: string, config_value: * }>} configs - 配置列表
 * @returns {Promise<string[]>} 更新的配置键列表
 */
async function updateConfig(configs) {
  const connection = await _getConnection();
  try {
    const updatedKeys = [];

    for (const item of configs) {
      const valueStr = typeof item.config_value === 'object'
        ? JSON.stringify(item.config_value)
        : item.config_value;

      const [result] = await connection.query(
        `INSERT INTO ai_price_configs (config_key, config_value)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)`,
        [item.config_key, valueStr],
      );

      if (result.affectedRows > 0 || result.changedRows > 0) {
        updatedKeys.push(item.config_key);
      }
    }

    // 清除配置缓存
    configCache.del('pricing:config');

    // 发布配置变更事件
    emitConfigChanged({
      configKeys: updatedKeys,
      updatedAt: new Date().toISOString(),
    });

    return updatedKeys;
  } finally {
    connection.release();
  }
}

/**
 * 获取定价日志（分页）
 *
 * @param {number} page - 页码
 * @param {number} size - 每页条数
 * @param {Object} [filters] - 筛选条件
 * @returns {Promise<Object>} 分页结果
 */
async function getLogs(page = 1, size = 20, filters = {}) {
  const connection = await _getConnection();
  try {
    const conditions = ['1=1'];
    const params = [];

    if (filters.district_id) {
      conditions.push('district_id = ?');
      params.push(filters.district_id);
    }
    if (filters.start_date) {
      conditions.push('created_at >= ?');
      params.push(filters.start_date);
    }
    if (filters.end_date) {
      conditions.push('created_at <= ?');
      params.push(filters.end_date);
    }
    if (filters.user_id) {
      conditions.push('user_id = ?');
      params.push(filters.user_id);
    }

    const whereClause = conditions.join(' AND ');
    const offset = (page - 1) * size;

    const [countResult] = await connection.query(
      `SELECT COUNT(*) AS total FROM ai_price_logs WHERE ${whereClause}`,
      params,
    );
    const total = countResult[0].total;

    const [rows] = await connection.query(
      `SELECT * FROM ai_price_logs WHERE ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, size, offset],
    );

    const items = rows.map((row) => ({
      id: row.id,
      user_id: row.user_id,
      order_id: row.order_id,
      district_id: row.district_id,
      base_fee: row.base_fee,
      final_fee: row.final_fee,
      surge_amount: row.surge_amount,
      factors: {
        supply_demand: row.supply_demand_factor,
        weather: row.weather_factor,
        time: row.time_factor,
        distance: row.distance_factor,
        density: row.density_factor,
      },
      composite_factor: row.composite_factor,
      capped_factor: row.capped_factor,
      created_at: row.created_at,
    }));

    return { total, page, size, items };
  } finally {
    connection.release();
  }
}

/**
 * 刷新所有区域定价系数（cron 调用）
 *
 * 遍历所有区域重算各因子 → 比较新旧值 → 显著变化时推送 WS
 *
 * @returns {Promise<{ updated: number, changed: number }>}
 */
async function recalcAllZoneFactors() {
  const { zones, changed } = await zoneHeatmap.getZonesWithChanges();

  // 对显著变化的区域推送 WebSocket 消息
  for (const zone of changed) {
    const wsEvent = 'dynamic_pricing.zone_updated';
    wsPush.broadcast(wsEvent, {
      district_id: zone.districtId,
      district_name: zone.districtName,
      composite_factor: zone.compositeFactor,
      capped_factor: zone.cappedFactor,
      supply_demand_ratio: zone.supplyDemandRatio,
      factor_detail: zone.factorDetail,
      changed_at: zone.updatedAt,
    });

    emitZoneUpdated({
      districtId: zone.districtId,
      districtName: zone.districtName,
      newFactor: zone.cappedFactor,
      reason: 'scheduled_recalc',
    });
  }

  return {
    updated: zones.length,
    changed: changed.length,
  };
}

module.exports = {
  estimateFee,
  getZoneFactors,
  getConfig,
  updateConfig,
  getLogs,
  recalcAllZoneFactors,
  loadConfig,
};
