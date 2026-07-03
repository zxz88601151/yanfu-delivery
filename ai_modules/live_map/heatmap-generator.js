'use strict';

/**
 * 热力图生成器
 *
 * @module ai_modules/live_map/heatmap-generator
 */

const mysql = require('mysql2/promise');
const config = require('../../config/ai_modules');
const liveMapEvents = require('./events');
const winston = require('winston');
const path = require('path');

let NodeCache;
try {
  NodeCache = require('node-cache');
} catch (e) {
  // fallback 简易缓存
  NodeCache = null;
}

const logger = winston.createLogger({
  level: process.env.KUAILV_LOG_LEVEL || 'info',
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({
      filename: path.join(process.env.KUAILV_LOG_DIR || './logs', 'live-map.log'),
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

const LM_CONFIG = config.liveMap || {};
const CACHE_TTL = LM_CONFIG.heatmapCacheTTL || 60;

/**
 * 进程内缓存（单例）
 */
let _cache = null;

function _getCache() {
  if (!_cache) {
    _cache = new (NodeCache || require('node-cache'))({
      stdTTL: CACHE_TTL,
      checkperiod: 30,
    });
  }
  return _cache;
}

/**
 * 颜色映射表
 */
const LEVEL_COLORS = {
  0: '#4CAF50',
  1: '#FFC107',
  2: '#FF6B35',
  3: '#F44336',
};

/**
 * 路况类型标签映射
 */
const TYPE_LABELS = {
  1: '修路施工',
  2: '封路禁行',
  3: '电梯故障',
  4: '小区门禁',
  5: '道路拥堵',
  6: '其他',
};

/**
 * 严重程度映射
 */
const SEVERITY_MAP = {
  0: 'clear',
  1: 'minor',
  2: 'moderate',
  3: 'severe',
};

/**
 * GeoHash 编码（精度 6 级）
 *
 * @param {number} lat - 纬度
 * @param {number} lng - 经度
 * @param {number} [precision] - 精度
 * @returns {string} GeoHash
 */
function geoHashEncode(lat, lng, precision) {
  const p = precision || 6;
  const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';
  let latMin = -90, latMax = 90;
  let lonMin = -180, lonMax = 180;
  let hash = '';
  let isEven = true;
  let bit = 0;
  let ch = 0;

  while (hash.length < p) {
    if (isEven) {
      const mid = (lonMin + lonMax) / 2;
      if (lng >= mid) {
        ch = (ch << 1) | 1;
        lonMin = mid;
      } else {
        ch = (ch << 1) | 0;
        lonMax = mid;
      }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) {
        ch = (ch << 1) | 1;
        latMin = mid;
      } else {
        ch = (ch << 1) | 0;
        latMax = mid;
      }
    }

    isEven = !isEven;

    if (++bit === 5) {
      hash += BASE32[ch];
      bit = 0;
      ch = 0;
    }
  }

  return hash;
}

/**
 * 根据难度等级获取颜色
 *
 * @param {number} level - 难度等级 0-3
 * @returns {string} 颜色值
 */
function getColorByLevel(level) {
  return LEVEL_COLORS[level] || LEVEL_COLORS[0];
}

/**
 * 计算 GeoHash 网格的中心点
 *
 * @param {string} geoHash - GeoHash
 * @returns {{ lng: number, lat: number }}
 */
function decodeGeoHashCenter(geoHash) {
  const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';
  let latMin = -90, latMax = 90;
  let lonMin = -180, lonMax = 180;
  let isEven = true;

  for (let i = 0; i < geoHash.length; i++) {
    const char = geoHash[i];
    const idx = BASE32.indexOf(char);
    if (idx === -1) continue;

    for (let b = 4; b >= 0; b--) {
      const bit = (idx >> b) & 1;
      if (isEven) {
        const mid = (lonMin + lonMax) / 2;
        if (bit === 1) lonMin = mid;
        else lonMax = mid;
      } else {
        const mid = (latMin + latMax) / 2;
        if (bit === 1) latMin = mid;
        else latMax = mid;
      }
      isEven = !isEven;
    }
  }

  return {
    lng: +((lonMin + lonMax) / 2).toFixed(6),
    lat: +((latMin + latMax) / 2).toFixed(6),
  };
}

/**
 * 确定网格的难度等级（取最高）
 *
 * @param {Array} conditions - 网格内红区列表
 * @returns {number} 难度等级 0-3
 */
function determineTileLevel(conditions) {
  if (!conditions || conditions.length === 0) {
    return 0;
  }
  return Math.max(...conditions.map((c) => c.difficulty_level));
}

/**
 * 按 GeoHash 聚合红区
 *
 * @param {Array} conditions - 活跃红区列表
 * @param {number} precision - GeoHash 精度
 * @returns {Object} { geoHash -> { conditions: Array, level: number } }
 */
function aggregateByGeoHash(conditions, precision) {
  const grid = {};

  for (const condition of conditions) {
    const geoHash = geoHashEncode(condition.lat, condition.lng, precision);

    if (!grid[geoHash]) {
      grid[geoHash] = {
        geo_hash: geoHash,
        center: decodeGeoHashCenter(geoHash),
        conditions: [],
      };
    }

    grid[geoHash].conditions.push({
      id: condition.id,
      type: condition.report_type,
      type_label: TYPE_LABELS[condition.report_type] || '未知',
      severity: SEVERITY_MAP[condition.difficulty_level] || 'minor',
      radius: condition.radius,
      reported_count: condition.total_reports,
      created_at: condition.created_at,
      expire_at: condition.expired_at,
    });
  }

  // 计算每个网格的 level 和 color
  for (const geoHash of Object.keys(grid)) {
    const tile = grid[geoHash];
    tile.level = determineTileLevel(tile.conditions);
    tile.color = getColorByLevel(tile.level);
  }

  return grid;
}

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
 * 获取热力图数据（优先使用缓存）
 *
 * @param {string[]} [districtIds] - 区域ID列表（可选）
 * @returns {Promise<Object>} 热力图数据
 */
async function getHeatmap(districtIds) {
  const cache = _getCache();
  const cacheKey = districtIds && districtIds.length > 0
    ? `heatmap:districts:${districtIds.sort().join(',')}`
    : 'heatmap:all';

  // 检查缓存
  const cached = cache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // 缓存未命中，从数据库查询
  const connection = await _getConnection();
  try {
    let query = `SELECT * FROM ai_verified_conditions WHERE status IN (0, 1)`;
    const params = [];

    if (districtIds && districtIds.length > 0) {
      // district_ids 参数用于筛选（通过关联区域表，当前简化处理）
    }

    query += ' ORDER BY created_at DESC';

    const [conditions] = await connection.query(query, params);

    // 按 GeoHash 精度 6 级聚合
    const grid = aggregateByGeoHash(conditions, 6);

    const now = new Date();
    const tiles = Object.values(grid).sort((a, b) => a.geo_hash.localeCompare(b.geo_hash));

    const result = {
      tiles,
      cached_at: now.toISOString(),
      expires_in_seconds: CACHE_TTL,
    };

    // 写入缓存
    cache.set(cacheKey, result);

    return result;
  } finally {
    await connection.end();
  }
}

/**
 * 使指定 GeoHash 的缓存失效
 *
 * @param {string} geoHash - GeoHash
 */
function invalidateTile(geoHash) {
  const cache = _getCache();
  const keys = cache.keys();
  for (const key of keys) {
    if (key.startsWith('heatmap:')) {
      cache.del(key);
    }
  }
  logger.info(`热力图缓存已刷新（GeoHash: ${geoHash}）`);
}

/**
 * 全量刷新热力图（由 cron 触发）
 *
 * @returns {Promise<Object>} 刷新后的热力图
 */
async function refreshAllTiles() {
  const cache = _getCache();

  // 清理所有热力图缓存
  const keys = cache.keys();
  for (const key of keys) {
    if (key.startsWith('heatmap:')) {
      cache.del(key);
    }
  }

  // 重新生成
  const heatmap = await getHeatmap(null);

  // 如果有 tiles，发布热力图更新事件
  if (heatmap.tiles && heatmap.tiles.length > 0) {
    liveMapEvents.emitHeatmapUpdated({
      tile_count: heatmap.tiles.length,
      updated_at: new Date().toISOString(),
    });
  }

  logger.info(`热力图全量刷新完成，${heatmap.tiles ? heatmap.tiles.length : 0} 个瓦片`);

  return heatmap;
}

module.exports = {
  getHeatmap,
  refreshAllTiles,
  invalidateTile,
  aggregateByGeoHash,
  getColorByLevel,
  geoHashEncode,
  decodeGeoHashCenter,
  determineTileLevel,
  CACHE_TTL,
};
