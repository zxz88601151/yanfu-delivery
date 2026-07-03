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

/**
 * 盐阜配送 - AI路径优化API路由
 * 提供最优路线规划、路况监测、配送点排序等功能
 */
const express = require('express');
const router = express.Router();
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const mapService = require('../services/map');
const { pool } = require('../config/database');
const config = require('../config/ai_dispatch');

// ==================== 路线规划 ====================

/**
 * 最优路线规划（多配送点排序）
 * POST /api/ai/route/optimize
 * Body: { deliveries: [{lng, lat, address, weight?}], origin?: {lng, lat} }
 */
router.post('/route/optimize', authMiddleware, async (req, res) => {
  try {
    const { deliveries, origin } = req.body;
    if (!deliveries || !Array.isArray(deliveries) || deliveries.length === 0) {
      return res.status(400).json({ success: false, message: '请提供配送点列表' });
    }
    if (deliveries.length > config.ROUTE_CONFIG.MAX_DELIVERIES) {
      return res.status(400).json({
        success: false,
        message: `单次最大配送点数为 ${config.ROUTE_CONFIG.MAX_DELIVERIES}`,
      });
    }
    const optimized = await optimizeRoute(deliveries, origin);
    const cacheKey = `route_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
    await pool.query(
      'INSERT INTO route_optimization_cache (cache_key, route_data, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 1 HOUR))',
      [cacheKey, JSON.stringify(optimized)]
    );
    res.json({ success: true, data: { ...optimized, cache_key: cacheKey } });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

/**
 * 获取已缓存的路线方案
 * GET /api/ai/route/cached/:cacheKey
 */
router.get('/route/cached/:cacheKey', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT route_data FROM route_optimization_cache WHERE cache_key = ? AND expires_at > NOW()',
      [req.params.cacheKey]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: '缓存不存在或已过期' });
    }
    res.json({ success: true, data: JSON.parse(rows[0].route_data) });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ==================== 单条路线规划 ====================

/**
 * 两点间最优路线（骑行）
 * GET /api/ai/route/riding?fromLng=&fromLat=&toLng=&toLat=
 */
router.get('/route/riding', authMiddleware, async (req, res) => {
  try {
    const { fromLng, fromLat, toLng, toLat } = req.query;
    if (!fromLng || !fromLat || !toLng || !toLat) {
      return res.status(400).json({ success: false, message: '请提供起终点坐标' });
    }
    const route = await mapService.calcRidingRoute(
      parseFloat(fromLng), parseFloat(fromLat),
      parseFloat(toLng), parseFloat(toLat)
    );
    res.json({ success: true, data: route });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

/**
 * 两点间路线规划（驾车）
 * GET /api/ai/route/driving?fromLng=&fromLat=&toLng=&toLat=
 */
router.get('/route/driving', authMiddleware, async (req, res) => {
  try {
    const { fromLng, fromLat, toLng, toLat } = req.query;
    if (!fromLng || !fromLat || !toLng || !toLat) {
      return res.status(400).json({ success: false, message: '请提供起终点坐标' });
    }
    const route = await mapService.calcDrivingRoute(
      parseFloat(fromLng), parseFloat(fromLat),
      parseFloat(toLng), parseFloat(toLat)
    );
    res.json({ success: true, data: route });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

/**
 * 计算两点间距离
 * GET /api/ai/route/distance?fromLng=&fromLat=&toLng=&toLat=
 */
router.get('/route/distance', authMiddleware, async (req, res) => {
  try {
    const { fromLng, fromLat, toLng, toLat } = req.query;
    if (!fromLng || !fromLat || !toLng || !toLat) {
      return res.status(400).json({ success: false, message: '请提供起终点坐标' });
    }
    const result = await mapService.calcDistance(
      parseFloat(fromLng), parseFloat(fromLat),
      parseFloat(toLng), parseFloat(toLat)
    );
    res.json({ success: true, data: result });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ==================== 路况监测与重规划 ====================

/**
 * 记录路线重规划事件
 * POST /api/ai/route/replan
 * Body: { rider_id, original_route, new_route, reason, traffic_change }
 */
router.post('/route/replan', authMiddleware, async (req, res) => {
  try {
    const { rider_id, original_route, new_route, reason, traffic_change } = req.body;
    if (!rider_id || !reason) {
      return res.status(400).json({ success: false, message: '缺少必要参数' });
    }
    await pool.query(
      `INSERT INTO route_replan_events
       (rider_id, original_route, new_route, reason, traffic_change)
       VALUES (?, ?, ?, ?, ?)`,
      [
        rider_id,
        original_route ? JSON.stringify(original_route) : null,
        new_route ? JSON.stringify(new_route) : null,
        reason,
        traffic_change !== undefined ? traffic_change : null,
      ]
    );
    res.json({ success: true, message: '重规划事件已记录' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

/**
 * 获取骑手重规划历史
 * GET /api/ai/route/replan-history?rider_id=&page=&page_size=
 */
router.get('/route/replan-history', authMiddleware, async (req, res) => {
  try {
    const { rider_id, page = 1, page_size = 20 } = req.query;
    const offset = (Number(page) - 1) * Number(page_size);

    let query, countQuery, params;
    if (rider_id) {
      query = 'SELECT * FROM route_replan_events WHERE rider_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?';
      countQuery = 'SELECT COUNT(*) as total FROM route_replan_events WHERE rider_id = ?';
      params = [rider_id, Number(page_size), offset];
    } else {
      query = 'SELECT * FROM route_replan_events ORDER BY created_at DESC LIMIT ? OFFSET ?';
      countQuery = 'SELECT COUNT(*) as total FROM route_replan_events';
      params = [Number(page_size), offset];
    }

    const [rows] = await pool.query(query, params);
    const [countResult] = await pool.query(countQuery, rider_id ? [rider_id] : []);

    res.json({
      success: true,
      data: rows,
      pagination: {
        page: Number(page),
        page_size: Number(page_size),
        total: countResult[0].total,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ==================== 路线统计（Admin） ====================

/**
 * 路线优化统计
 * GET /api/ai/route/stats
 */
router.get('/route/stats', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const [replanCount] = await pool.query(
      'SELECT COUNT(*) as total, COALESCE(SUM(traffic_change IS NOT NULL), 0) as traffic_triggered FROM route_replan_events'
    );
    const [cacheCount] = await pool.query(
      'SELECT COUNT(*) as total FROM route_optimization_cache WHERE expires_at > NOW()'
    );
    const [topReasons] = await pool.query(
      'SELECT reason, COUNT(*) as count FROM route_replan_events GROUP BY reason ORDER BY count DESC LIMIT 10'
    );

    res.json({
      success: true,
      data: {
        total_replans: replanCount[0].total,
        traffic_triggered_replans: replanCount[0].traffic_triggered,
        active_cached_routes: cacheCount[0].total,
        top_replan_reasons: topReasons,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ==================== 内部辅助方法 ====================

/**
 * 使用最近邻+2-opt优化配送路线
 * @param {Array} deliveries - 配送点数组 [{lng, lat, address, weight?}]
 * @param {Object} origin - 起点坐标 {lng, lat}
 */
async function optimizeRoute(deliveries, origin) {
  const n = deliveries.length;
  const dist = Array.from({ length: n + 1 }, () => Array(n + 1).fill(0));

  // 起点到各配送点距离
  if (origin) {
    for (let j = 0; j < n; j++) {
      dist[0][j + 1] = haversine(origin.lat, origin.lng, deliveries[j].lat, deliveries[j].lng);
      dist[j + 1][0] = dist[0][j + 1];
    }
  }

  // 各配送点间距离
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = haversine(deliveries[i].lat, deliveries[i].lng, deliveries[j].lat, deliveries[j].lng);
      dist[i + 1][j + 1] = d;
      dist[j + 1][i + 1] = d;
    }
  }

  // Step 1: 最近邻算法
  const visited = new Set();
  const startIdx = origin ? 0 : 1;
  const order = [startIdx];
  visited.add(startIdx);

  while (visited.size < n + (origin ? 1 : 0)) {
    let bestNext = -1;
    let bestDist = Infinity;
    const current = order[order.length - 1];

    for (let i = origin ? 1 : 1; i <= n; i++) {
      if (!visited.has(i) && dist[current][i] < bestDist) {
        bestDist = dist[current][i];
        bestNext = i;
      }
    }
    if (bestNext !== -1) {
      order.push(bestNext);
      visited.add(bestNext);
    }
  }

  // Step 2: 2-opt 优化
  let improved = true;
  let maxIter = config.ROUTE_CONFIG.TWO_OPT_MAX_ITER || 100;
  while (improved && maxIter > 0) {
    improved = false;
    maxIter--;

    for (let i = 1; i < order.length - 2; i++) {
      for (let j = i + 1; j < order.length - 1; j++) {
        const delta =
          -dist[order[i - 1]][order[i]] - dist[order[j]][order[j + 1]]
          + dist[order[i - 1]][order[j]] + dist[order[i]][order[j + 1]];

        if (delta < -0.001) {
          const reversed = order.slice(i, j + 1).reverse();
          order.splice(i, j - i + 1, ...reversed);
          improved = true;
        }
      }
    }
  }

  // 计算总距离
  let totalDist = 0;
  for (let k = 0; k < order.length - 1; k++) {
    totalDist += dist[order[k]][order[k + 1]];
  }

  // 构建有序配送点列表
  const stops = order
    .filter(idx => idx !== 0)
    .map(idx => ({
      address: deliveries[idx - 1].address || `配送点${idx}`,
      lng: deliveries[idx - 1].lng,
      lat: deliveries[idx - 1].lat,
    }));

  // 估算总时间
  const avgSpeed = config.ROUTE_CONFIG.AVG_SPEED_KMH || 25;
  const travelHours = totalDist / avgSpeed;
  const totalMin = Math.ceil((travelHours + (stops.length * 5) / 60) * 60);

  return {
    total_distance_km: parseFloat(totalDist.toFixed(2)),
    estimated_time_minutes: totalMin,
    stops: stops.map((s, i) => ({
      sequence: i + 1,
      address: s.address,
      lng: s.lng,
      lat: s.lat,
    })),
    ordered_addresses: stops.map(s => s.address),
  };
}

/**
 * Haversine公式计算距离（公里）
 */
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
    * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

module.exports = router;
