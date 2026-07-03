'use strict';

/**
 * 定价区域热力图数据聚合 + 缓存管理
 *
 * 负责各区域定价系数的聚合计算、缓存读写、批量刷新
 *
 * @module ai_modules/dynamic_pricing/zone-heatmap
 */

const NodeCache = require('node-cache');
const config = require('../../config/ai_modules');
const supplyDemand = require('./supply-demand');
const weatherClient = require('./weather-client');
const pricingModel = require('./pricing-model');

const cache = new NodeCache({
  stdTTL: config.dynamicPricing.zoneCacheTtl || 300,
  checkperiod: 60,
});

// 缓存 key 前缀
const CACHE_KEY_PREFIX = 'pricing:zone:';

/**
 * 获取缓存的键名
 *
 * @param {number} districtId - 区域ID
 * @returns {string}
 * @private
 */
function _cacheKey(districtId) {
  return `${CACHE_KEY_PREFIX}${districtId}`;
}

/**
 * 获取区域中心坐标
 * 从 DB 查询 districts 表中的中心点坐标
 *
 * @param {number} districtId - 区域ID
 * @returns {Promise<{ lng: number, lat: number }|null>}
 * @private
 */
async function _getDistrictCenter(districtId) {
  const mysql = require('mysql2/promise');
  const connection = await mysql.createConnection(config.db);
  try {
    const [rows] = await connection.query(
      'SELECT center_lng, center_lat, name FROM districts WHERE id = ?',
      [districtId],
    );
    if (rows.length === 0) {
      return null;
    }
    return {
      lng: rows[0].center_lng || 116.397,
      lat: rows[0].center_lat || 39.908,
      name: rows[0].name || `区域${districtId}`,
    };
  } finally {
    await connection.end();
  }
}

/**
 * 获取区域订单密度
 * 过去 15 分钟内该区域的订单数 / 区域面积
 *
 * @param {number} districtId - 区域ID
 * @returns {Promise<number>}
 * @private
 */
async function _getOrderDensity(districtId) {
  const mysql = require('mysql2/promise');
  const connection = await mysql.createConnection(config.db);
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
    const density = orderCount[0].count / area;

    return +density.toFixed(2);
  } finally {
    await connection.end();
  }
}

/**
 * 对单个区域聚合定价因子
 *
 * @param {number} districtId - 区域ID
 * @returns {Promise<Object|null>} ZoneData
 */
async function aggregateFactors(districtId) {
  try {
    const center = await _getDistrictCenter(districtId);
    if (!center) {
      return null;
    }

    // 并发获取各因子
    const [ratio, weather, density] = await Promise.all([
      supplyDemand.getSupplyDemandRatio(districtId),
      weatherClient.getWeather(center.lng, center.lat),
      _getOrderDensity(districtId),
    ]);

    // 加载配置（使用默认值简化）
    const pricingConfig = {
      timeFactorMap: {
        '00:00-06:00': 1.30,
        '06:00-09:00': 1.0,
        '09:00-11:00': 1.0,
        '11:00-14:00': 1.15,
        '14:00-17:00': 0.90,
        '17:00-21:00': 1.10,
        '21:00-24:00': 1.15,
      },
      compositeFactorMax: 1.50,
      compositeFactorMin: 0.85,
      weatherProtectionThreshold: 1.30,
      weatherProtectionCap: 8.0,
      baseFee: config.dynamicPricing.defaultBaseFee || 5.00,
    };

    // 使用平均距离 2000m 计算
    const avgDistance = 2000;

    const result = pricingModel.calculate(ratio, weather, new Date(), avgDistance, density, pricingConfig);

    return {
      districtId,
      districtName: center.name,
      compositeFactor: result.compositeFactor,
      cappedFactor: result.cappedFactor,
      supplyDemandRatio: ratio,
      factorDetail: {
        supplyDemand: result.factors.supplyDemand,
        weather: result.factors.weather,
        time: result.factors.time,
        distance: result.factors.distance,
        density: result.factors.density,
      },
      updatedAt: new Date().toISOString(),
    };
  } catch (err) {
    // 降级：从缓存读取
    const cached = cache.get(_cacheKey(districtId));
    return cached || null;
  }
}

/**
 * 批量获取区域定价数据
 *
 * @param {number[]} districtIds - 区域ID数组（可选）
 * @returns {Promise<Object[]>}
 */
async function getZones(districtIds) {
  if (!districtIds || districtIds.length === 0) {
    return getAllZones();
  }

  const results = [];
  const uncachedIds = [];

  // 先查缓存
  for (const id of districtIds) {
    const cached = cache.get(_cacheKey(id));
    if (cached) {
      results.push(cached);
    } else {
      uncachedIds.push(id);
    }
  }

  // 未命中的实时计算
  if (uncachedIds.length > 0) {
    const freshResults = await Promise.all(
      uncachedIds.map((id) => aggregateFactors(id)),
    );
    for (const zoneData of freshResults) {
      if (zoneData) {
        cache.set(_cacheKey(zoneData.districtId), zoneData);
        results.push(zoneData);
      }
    }
  }

  return results;
}

/**
 * 获取所有区域定价数据
 *
 * @returns {Promise<Object[]>}
 */
async function getAllZones() {
  const mysql = require('mysql2/promise');
  const connection = await mysql.createConnection(config.db);
  try {
    const [districts] = await connection.query(
      'SELECT id FROM districts ORDER BY id',
    );
    const ids = districts.map((d) => d.id);
    return getZones(ids);
  } finally {
    await connection.end();
  }
}

/**
 * 使指定区域的缓存失效
 *
 * @param {number[]} districtIds - 区域ID数组
 */
function invalidateCache(districtIds) {
  for (const id of districtIds) {
    cache.del(_cacheKey(id));
  }
}

/**
 * 刷新所有区域定价缓存（cron 调用）
 * 遍历所有区域重算并更新缓存
 *
 * @returns {Promise<Object[]>} 更新后的区域数据列表
 */
async function refreshAllZones() {
  const mysql = require('mysql2/promise');
  const connection = await mysql.createConnection(config.db);
  try {
    const [districts] = await connection.query(
      'SELECT id, name FROM districts ORDER BY id',
    );

    const results = [];
    for (const district of districts) {
      try {
        const zoneData = await aggregateFactors(district.id);
        if (zoneData) {
          cache.set(_cacheKey(district.id), zoneData);
          results.push(zoneData);
        }
      } catch (err) {
        // 单个区域失败不影响其他区域
        continue;
      }
    }

    return results;
  } finally {
    await connection.end();
  }
}

/**
 * 批量获取区域定价数据（供 service 调用，含旧值对比）
 *
 * @param {number[]} districtIds - 区域ID数组
 * @returns {Promise<{ zones: Object[], changed: Object[] }>}
 */
async function getZonesWithChanges(districtIds) {
  const oldZones = {};
  const ids = districtIds || [];

  // 记录旧值
  for (const id of ids) {
    const cached = cache.get(_cacheKey(id));
    if (cached) {
      oldZones[id] = cached.compositeFactor;
    }
  }

  const zones = await getZones(ids);

  // 找出显著变化的区域
  const threshold = config.dynamicPricing.zoneChangeThreshold || 0.10;
  const changed = zones.filter((z) => {
    const oldFactor = oldZones[z.districtId];
    if (oldFactor === undefined) {
      return false;
    }
    return Math.abs(z.cappedFactor - oldFactor) >= threshold;
  });

  return { zones, changed };
}

module.exports = {
  getZones,
  getAllZones,
  aggregateFactors,
  invalidateCache,
  refreshAllZones,
  getZonesWithChanges,
};
