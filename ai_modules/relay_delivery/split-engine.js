'use strict';

/**
 * 拆单引擎
 *
 * 负责：
 * - 拆单条件评估（5 条件）
 * - 分段计算
 * - 接力点 5 维评分
 * - 骑手匹配 + 并行推单
 *
 * @module ai_modules/relay_delivery/split-engine
 */

const mysql = require('mysql2/promise');
const turf = require('@turf/turf');
const config = require('../../config/ai_modules');
const feeSplitter = require('./fee-splitter');

const rdConfig = config.relayDelivery;

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
 * 检查拆单 5 条件
 *
 * @param {Object} order - 订单数据
 * @returns {{ pass: boolean, reason: string|null }}
 * @private
 */
function _checkSplitConditions(order) {
  // 条件 1: 用户拒绝接力
  if (order.no_relay) {
    return { pass: false, reason: '用户不接受接力配送' };
  }

  // 条件 2: 生鲜/易腐品类
  if (order.tags && order.tags.some((t) => rdConfig.excludeTags.includes(t.toLowerCase()))) {
    return { pass: false, reason: '生鲜/易腐品类不拆分' };
  }

  // 条件 3: 距离 > 5km
  if (!order.total_distance || order.total_distance <= rdConfig.minSplitDistance) {
    return { pass: false, reason: `配送距离不足 ${rdConfig.minSplitDistance / 1000}km` };
  }

  // 条件 4: 预计时长 > 40 分钟
  const estimatedMinutes = order.estimated_time
    ? Math.floor(order.estimated_time / 60)
    : Math.floor(order.total_distance / 200); // 估算 200m/s
  if (estimatedMinutes <= rdConfig.minSplitTime) {
    return { pass: false, reason: `预估配送时长低于 ${rdConfig.minSplitTime} 分钟` };
  }

  // 条件 5: 订单金额 ≥ 20 元
  if (!order.order_amount || order.order_amount < rdConfig.minAmount) {
    return { pass: false, reason: `订单金额低于 ${rdConfig.minAmount} 元` };
  }

  return { pass: true, reason: null };
}

/**
 * 计算分段数
 *
 * N = min(3, max(2, floor(D / 3500)))
 *
 * @param {number} totalDistance - 总距离（米）
 * @returns {{ count: number, distances: number[] }}
 * @private
 */
function _calcSegmentCount(totalDistance) {
  let n = Math.min(rdConfig.maxSegments, Math.max(2, Math.floor(totalDistance / 3500)));

  // 每段在 2~4km 范围内调整
  const base = Math.floor(totalDistance / n);
  const distances = [];
  let remaining = totalDistance;

  for (let i = 0; i < n; i++) {
    if (i === n - 1) {
      distances.push(remaining);
    } else {
      const seg = Math.min(base, rdConfig.maxSegmentDistance);
      distances.push(seg);
      remaining -= seg;
    }
  }

  // 最后一段不能太长或太短
  if (distances[distances.length - 1] > rdConfig.maxSegmentDistance * 1.2) {
    // 重新均匀分配
    const evenDist = Math.floor(totalDistance / n);
    distances.length = 0;
    for (let i = 0; i < n; i++) {
      if (i === n - 1) {
        distances.push(totalDistance - distances.reduce((a, b) => a + b, 0));
      } else {
        distances.push(evenDist);
      }
    }
  }

  if (distances[distances.length - 1] < rdConfig.minSegmentDistance && distances.length > 1) {
    // 最后一段太短，合并到前一段
    const last = distances.pop();
    distances[distances.length - 1] += last;
    n = distances.length;
  }

  return { count: n, distances };
}

/**
 * 计算坐标间的大圆距离（米）
 *
 * @param {number} lng1
 * @param {number} lat1
 * @param {number} lng2
 * @param {number} lat2
 * @returns {number}
 * @private
 */
function _calcDistance(lng1, lat1, lng2, lat2) {
  const from = turf.point([lng1, lat1]);
  const to = turf.point([lng2, lat2]);
  return Math.round(turf.distance(from, to, { units: 'meters' }));
}

/**
 * 根据总方向和距离计算边界点
 *
 * @param {number} fromLng
 * @param {number} fromLat
 * @param {number} toLng
 * @param {number} toLat
 * @param {number} distanceFromStart - 距起点的距离（米）
 * @returns {{ lng: number, lat: number }}
 * @private
 */
function _calcBoundaryPoint(fromLng, fromLat, toLng, toLat, distanceFromStart) {
  const totalDist = _calcDistance(fromLng, fromLat, toLng, toLat);
  if (totalDist === 0) return { lng: toLng, lat: toLat };

  const fraction = distanceFromStart / totalDist;
  const lng = fromLng + (toLng - fromLng) * fraction;
  const lat = fromLat + (toLat - fromLat) * fraction;
  return { lng: +lng.toFixed(7), lat: +lat.toFixed(7) };
}

/**
 * 接力点距离评分
 *
 * 距离理想边界点越近越好：≤200m = 1.0, 500m = 0.0
 *
 * @param {number} distance - 距理想点的距离（米）
 * @returns {number}
 * @private
 */
function _scoreByDistance(distance) {
  return Math.max(0, 1 - distance / 500);
}

/**
 * 接力点类型评分
 *
 * @param {number} type - 0=驿站 1=商户 2=公共 3=虚拟
 * @returns {number}
 * @private
 */
function _scoreByType(type) {
  const scores = { 0: 10, 1: 8, 2: 5, 3: 2 };
  return scores[type] || 2;
}

/**
 * 接力点 5 维综合评分
 *
 * @param {Object} station - 接力点
 * @param {{ lng: number, lat: number }} idealPoint - 理想边界点
 * @param {number} distanceToIdeal - 距理想点距离（米）
 * @param {Object} [weather] - 天气数据（可选）
 * @returns {number}
 */
function scoreRelayPoint(station, idealPoint, distanceToIdeal, weather) {
  const weights = rdConfig.scoreWeights || { distance: 0.30, type: 0.25, history: 0.20, capacity: 0.15, weather: 0.10 };

  const distScore = _scoreByDistance(distanceToIdeal);
  const typeScore = _scoreByType(station.type) / 10;
  const historyScore = (station.success_rate || 100) / 100;
  const capacityScore = Math.min(1, (station.total_handoffs || 0) / 2000);

  // 天气影响：户外接力点受天气影响
  let weatherScore = 1.0;
  if (weather && weather.grade && weather.grade !== 'good') {
    const outdoorTypes = [2, 3]; // 公共设施、虚拟点
    if (outdoorTypes.includes(station.type)) {
      weatherScore = 0.5;
    }
  }

  const total = (distScore * weights.distance)
    + (typeScore * weights.type)
    + (historyScore * weights.history)
    + (capacityScore * weights.capacity)
    + (weatherScore * weights.weather);

  return +total.toFixed(4);
}

/**
 * 在指定坐标附近搜索可用接力点
 *
 * @param {number} lng - 经度
 * @param {number} lat - 纬度
 * @param {number} [radius] - 搜索半径（米）
 * @returns {Promise<Object[]>}
 */
async function findNearbyStations(lng, lat, radius) {
  const searchRadius = radius || rdConfig.stationSearchRadius;
  const connection = await _getConnection();
  try {
    const [rows] = await connection.query(
      `SELECT id, name, type, lng, lat, address,
              business_hours, amenities, status,
              success_rate, avg_handoff_time, total_handoffs
       FROM ai_relay_stations
       WHERE status = 1
         AND ST_Distance_Sphere(
           POINT(?, ?),
           POINT(lng, lat)
         ) <= ?
       ORDER BY type ASC, success_rate DESC
       LIMIT 20`,
      [lng, lat, searchRadius],
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      lng: r.lng,
      lat: r.lat,
      address: r.address,
      business_hours: r.business_hours ? (typeof r.business_hours === 'string' ? JSON.parse(r.business_hours) : r.business_hours) : null,
      amenities: r.amenities ? (typeof r.amenities === 'string' ? JSON.parse(r.amenities) : r.amenities) : [],
      status: r.status,
      success_rate: r.success_rate,
      avg_handoff_time: r.avg_handoff_time,
      total_handoffs: r.total_handoffs,
    }));
  } finally {
    await connection.end();
  }
}

/**
 * 选择最优接力点
 *
 * @param {Array} segments - 分段列表 [{ from, to, distance }]
 * @param {Object} weather - 天气数据（可选）
 * @returns {Promise<Object[]>}
 */
async function selectRelayPoints(segments, weather) {
  const relayPoints = [];

  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i];
    const idealPoint = _calcBoundaryPoint(
      segment.from.lng, segment.from.lat,
      segment.to.lng, segment.to.lat,
      segment.distance,
    );

    // 在理想边界点附近搜索接力点
    const stations = await findNearbyStations(idealPoint.lng, idealPoint.lat);

    if (stations.length === 0) {
      // 扩大搜索半径
      const fallbackStations = await findNearbyStations(idealPoint.lng, idealPoint.lat, 1000);
      if (fallbackStations.length === 0) {
        return null; // 无可用接力点
      }
      stations.push(...fallbackStations);
    }

    // 5 维评分排序
    for (const station of stations) {
      const dist = _calcDistance(station.lng, station.lat, idealPoint.lng, idealPoint.lat);
      station.score = scoreRelayPoint(station, idealPoint, dist, weather);
    }

    stations.sort((a, b) => b.score - a.score);
    relayPoints.push(stations[0]);
  }

  return relayPoints;
}

/**
 * 并行匹配合适的骑手
 * （模拟实现，无真实骑手表，返回模拟骑手）
 *
 * @param {number} relayOrderId - 接力订单ID
 * @param {Array} segments - 分段数据
 * @returns {Promise<Array>} 每段分配的骑手信息
 */
async function matchRiders(relayOrderId, segments) {
  const simulatedRiders = [
    { id: 10086, name: '张师傅', phone: '138****1234', level: 3, score: 4.8 },
    { id: 10087, name: '王师傅', phone: '138****2345', level: 2, score: 4.6 },
    { id: 10088, name: '刘师傅', phone: '138****3456', level: 3, score: 4.9 },
    { id: 10089, name: '陈师傅', phone: '138****4567', level: 2, score: 4.5 },
    { id: 10090, name: '赵师傅', phone: '138****5678', level: 4, score: 4.9 },
    { id: 10091, name: '孙师傅', phone: '138****6789', level: 3, score: 4.7 },
    { id: 10092, name: '李师傅', phone: '138****7890', level: 4, score: 5.0 },
    { id: 10093, name: '周师傅', phone: '138****8901', level: 3, score: 4.6 },
  ];

  const assignments = [];
  let riderIndex = 0;

  for (const segment of segments) {
    const rider = simulatedRiders[riderIndex % simulatedRiders.length];
    riderIndex++;

    assignments.push({
      segmentSeq: segment.seq,
      rider,
      status: 0,
      assignedAt: new Date().toISOString(),
    });
  }

  return assignments;
}

/**
 * 计算各段路径信息
 *
 * @param {number} totalDistance - 总距离
 * @param {Object} merchantLoc - 商家位置 { lng, lat }
 * @param {Object} customerLoc - 用户位置 { lng, lat }
 * @param {Array} relayPoints - 接力点列表
 * @returns {Array} segments
 */
function planSegments(totalDistance, merchantLoc, customerLoc, relayPoints) {
  const { count, distances } = _calcSegmentCount(totalDistance);
  const segments = [];

  let currentLng = merchantLoc.lng;
  let currentLat = merchantLoc.lat;
  let cumulativeDist = 0;

  for (let i = 0; i < count; i++) {
    const segDist = distances[i];

    let toPoint;
    let toName;
    let toType;

    if (i === count - 1) {
      // 最后一段到用户
      toPoint = { lng: customerLoc.lng, lat: customerLoc.lat };
      toName = '用户';
      toType = 'customer';
    } else {
      // 到接力点
      const rp = relayPoints[i];
      toPoint = { lng: rp.lng, lat: rp.lat };
      toName = rp.name;
      toType = rp.type === 0 ? 'station' : 'relay_point';
    }

    // 计算实际距离
    const actualDist = _calcDistance(currentLng, currentLat, toPoint.lng, toPoint.lat);

    let fromName = '商家';
    let fromType = 'merchant';
    if (i > 0) {
      fromName = relayPoints[i - 1].name;
      fromType = relayPoints[i - 1].type === 0 ? 'station' : 'relay_point';
    }

    const estimatedSeconds = Math.round(actualDist / 5); // 约 5m/s 平均速度

    segments.push({
      seq: i + 1,
      label: i === 0 ? '前段' : (i === count - 1 ? '后段' : '中段'),
      from: { lng: currentLng, lat: currentLat, name: fromName },
      fromType,
      to: { lng: toPoint.lng, lat: toPoint.lat, name: toName },
      toType,
      distance: actualDist,
      estimated_time: estimatedSeconds,
      difficulty_factor: feeSplitter.calculateDifficultyFactor(i + 1, count),
    });

    currentLng = toPoint.lng;
    currentLat = toPoint.lat;
    cumulativeDist += actualDist;
  }

  return segments;
}

/**
 * 评估是否可拆分并创建接力方案（主入口）
 *
 * @param {Object} orderData - 订单数据
 * @returns {Promise<Object>} 评估结果
 */
async function evaluateSplit(orderData) {
  // 1. 检查 5 条件
  const checkResult = _checkSplitConditions(orderData);
  if (!checkResult.pass) {
    return {
      splittable: false,
      reason: checkResult.reason,
      fallback: '单骑手配送',
    };
  }

  // 2. 计算分段数
  const { count, distances } = _calcSegmentCount(orderData.total_distance);

  // 3. 计算理想边界点并搜索接力点
  const segments = [];
  let currentLng = orderData.merchant_location.lng;
  let currentLat = orderData.merchant_location.lat;

  for (let i = 0; i < count; i++) {
    // 理想边界点（分段点）
    const idealPoint = i < count - 1
      ? _calcBoundaryPoint(
          orderData.merchant_location.lng, orderData.merchant_location.lat,
          orderData.customer_location.lng, orderData.customer_location.lat,
          distances.slice(0, i + 1).reduce((a, b) => a + b, 0),
        )
      : { lng: orderData.customer_location.lng, lat: orderData.customer_location.lat };

    segments.push({
      seq: i + 1,
      from: i === 0
        ? { lng: currentLng, lat: currentLat, name: '商家' }
        : null,
      to: { lng: idealPoint.lng, lat: idealPoint.lat },
      distance: distances[i],
    });
    currentLng = idealPoint.lng;
    currentLat = idealPoint.lat;
  }

  // 4. 选择接力点
  const relayPoints = await selectRelayPoints(segments);

  if (!relayPoints || relayPoints.length === 0) {
    return {
      splittable: false,
      reason: '沿途无可用接力点',
      fallback: '单骑手配送',
    };
  }

  // 5. 完善分段信息
  const fullSegments = planSegments(
    orderData.total_distance,
    orderData.merchant_location,
    orderData.customer_location,
    relayPoints,
  );

  // 6. 计算段配送费
  const segmentFees = feeSplitter.splitFee(
    orderData.total_fee,
    fullSegments,
  );

  const totalRelayFee = segmentFees.reduce((a, b) => a + b, 0);
  const platformSubsidy = feeSplitter.calculatePlatformSubsidy(orderData.total_fee, segmentFees);

  // 7. 计算总 ETA
  const totalEtaSeconds = fullSegments.reduce((a, s) => a + s.estimated_time, 0)
    + (fullSegments.length - 1) * rdConfig.handoffBufferSeconds;

  return {
    splittable: true,
    segments: fullSegments.map((s, idx) => ({
      seq: s.seq,
      label: s.label,
      from: s.from,
      to: s.to,
      distance: s.distance,
      estimated_time: s.estimated_time,
      difficulty_factor: s.difficulty_factor,
      fee: segmentFees[idx],
    })),
    relay_points: relayPoints.map((rp) => ({
      id: rp.id,
      name: rp.name,
      type: rp.type === 0 ? 'station' : (rp.type === 1 ? 'store' : (rp.type === 2 ? 'public' : 'virtual')),
      location: { lng: rp.lng, lat: rp.lat },
      address: rp.address,
    })),
    total_estimated_time: totalEtaSeconds,
    total_fee: orderData.total_fee,
    total_subsidy: +platformSubsidy.toFixed(2),
    segment_fees: segmentFees,
    eta_breakdown: {
      front_segment: fullSegments[0] ? fullSegments[0].estimated_time : 0,
      handoff_buffer: (fullSegments.length - 1) * rdConfig.handoffBufferSeconds,
      back_segment: fullSegments[fullSegments.length - 1] ? fullSegments[fullSegments.length - 1].estimated_time : 0,
      total_seconds: totalEtaSeconds,
      total_minutes: Math.ceil(totalEtaSeconds / 60),
    },
  };
}

module.exports = {
  evaluateSplit,
  planSegments,
  selectRelayPoints,
  scoreRelayPoint,
  findNearbyStations,
  matchRiders,
};
