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
 * 盐阜配送 - 路径优化引擎
 * 使用最近邻丶 2-opt 求解TSP问题
 */
const { ROUTE_CONFIG } = require('../config/ai_dispatch');

class RouteOptimizer {
  constructor() {
    this.config = ROUTE_CONFIG;
  }

  /**
   * 优化配送路径
   * @param {object} start - 起点坐标 {lat, lng}
   * @param {Array} deliveries - 配送点数组 [{lat, lng, address, order_no}]
   * @param {object} options - { trafficAware, includePolyline, maxDeliveries }
   * @returns {object} RouteResult
   */
  optimizeRoute(start, deliveries, options = {}) {
    const maxDeliveries = options.maxDeliveries || this.config.MAX_DELIVERIES;
    const trafficAware = options.trafficAware !== false;
    const includePolyline = options.includePolyline !== false;

    // 限制最大配送点数
    const points = deliveries.slice(0, maxDeliveries);
    const allPoints = [start, ...points];

    // 构建距离矩阵
    const trafficStatus = options.trafficStatus || {};
    const distMatrix = this.buildDistanceMatrix(allPoints, trafficStatus, trafficAware);

    // 最近邻构造初始解
    let route = this.nearestNeighbor(allPoints, distMatrix);

    // 2-opt 迭代优化
    route = this.twoOpt(route, distMatrix);

    // 生成分段
    const segments = this.buildSegments(allPoints, route, trafficStatus);

    // 汇总
    const totalDistance = segments.reduce((sum, s) => sum + s.distance_km, 0);
    const totalDuration = segments.reduce((sum, s) => sum + s.duration_min, 0);

    return {
      ordered_indices: route,
      total_distance_km: Math.round(totalDistance * 100) / 100,
      total_duration_min: Math.round(totalDuration * 100) / 100,
      segments,
      polyline: includePolyline ? route.map(i => ({ lat: allPoints[i].lat, lng: allPoints[i].lng })) : [],
      trace_id: `RO-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`,
    };
  }

  buildDistanceMatrix(points, trafficStatus, trafficAware) {
    const n = points.length;
    const matrix = Array.from({ length: n }, () => Array(n).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dist = this.calculateDistance(points[i], points[j]);
        if (trafficAware && trafficStatus[`${i}-${j}`]) {
          dist = this.applyTrafficWeight(dist, trafficStatus[`${i}-${j}`]);
        }
        matrix[i][j] = dist;
        matrix[j][i] = dist;
      }
    }
    return matrix;
  }

  nearestNeighbor(points, distMatrix) {
    const n = points.length;
    const visited = new Set([0]);
    const route = [0];
    let current = 0;
    while (route.length < n) {
      let nearest = -1;
      let minDist = Infinity;
      for (let i = 0; i < n; i++) {
        if (!visited.has(i) && distMatrix[current][i] < minDist) {
          minDist = distMatrix[current][i];
          nearest = i;
        }
      }
      if (nearest === -1) break;
      visited.add(nearest);
      route.push(nearest);
      current = nearest;
    }
    return route;
  }

  twoOpt(route, distMatrix) {
    const maxIter = Math.min(this.config.TWO_OPT_MAX_ITER || 100, route.length * route.length);
    let improved = true;
    let iterations = 0;

    while (improved && iterations < maxIter) {
      improved = false;
      iterations++;
      for (let i = 1; i < route.length - 2; i++) {
        for (let j = i + 1; j < route.length - 1; j++) {
          const delta = -distMatrix[route[i - 1]][route[i]] - distMatrix[route[j]][route[j + 1]]
            + distMatrix[route[i - 1]][route[j]] + distMatrix[route[i]][route[j + 1]];
          if (delta < -0.001) {
            route = [...route.slice(0, i), ...route.slice(i, j + 1).reverse(), ...route.slice(j + 1)];
            improved = true;
          }
        }
      }
    }
    return route;
  }

  buildSegments(points, route, trafficStatus) {
    const segments = [];
    for (let i = 0; i < route.length - 1; i++) {
      const from = route[i];
      const to = route[i + 1];
      const dist = this.calculateDistance(points[from], points[to]);
      const traffic = trafficStatus[`${from}-${to}`] || 'normal';
      const weight = this.config.TRAFFIC_WEIGHTS[traffic] || 1.0;
      const duration = (dist * weight / (this.config.AVG_SPEED_KMH || 25)) * 60;
      segments.push({
        from_index: from,
        to_index: to,
        distance_km: Math.round(dist * 100) / 100,
        duration_min: Math.round(duration * 100) / 100,
        traffic_status: traffic,
        instruction: i === 0 ? '从起点出发' : `前往${to === route.length - 1 ? '终点' : '第' + to + '个配送点'}`,
      });
    }
    return segments;
  }

  applyTrafficWeight(distance, trafficStatus) {
    const weight = this.config.TRAFFIC_WEIGHTS[trafficStatus] || 1.0;
    return distance * weight;
  }

  calculateDistance(p1, p2) {
    const R = 6371;
    const dLat = ((p2.lat - p1.lat) * Math.PI) / 180;
    const dLng = ((p2.lng - p1.lng) * Math.PI) / 180;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos((p1.lat * Math.PI) / 180) * Math.cos((p2.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /** 兼容类图接口 */
  solveTSP(start, deliveries, traffic) {
    return this.optimizeRoute(start, deliveries, { trafficAware: !!traffic, trafficStatus: traffic });
  }
}

module.exports = RouteOptimizer;
