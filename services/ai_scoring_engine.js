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
 * 盐阜配送 - AI五维评分引擎
 * 核心类 ScoringEngine，负责候选骑手筛选、五维评分计算、排序
 */
const { pool } = require('../config/database');
const {
  SCORE_WEIGHTS,
  EXPANSION_CONFIG,
  REDIS_KEYS,
} = require('../config/ai_dispatch');
const {
  calculateDistance,
  calculateDistanceScore,
  calculateLoadScore,
  calculateTimeEnvScore,
  calculateQualityScore,
  calculateFairnessScore,
  calculateTotalScore,
  generateTraceId,
  getWeatherCondition,
  getTrafficCondition,
  getRiderCurrentOrders,
  getRiderPerformanceData,
  isPeakHour,
} = require('../utils/ai_dispatch_utils');

class ScoringEngine {
  /**
   * 对候选骑手逐一计算五维评分
   * @param {object} order - 订单数据 { id, order_no, merchant_id, distance_km, total_amount, delivery_fee, ... }
   * @param {Array} riders - 候选骑手列表
   * @param {object} [context] - 上下文 { hour, weather, traffic, expansionCount }
   * @returns {Promise<Array>} 按总分降序排列的骑手列表（含各分项明细）
   */
  async scoreRidersForOrder(order, riders, context) {
    const traceId = generateTraceId();
    const weather = (context && context.weather) || await getWeatherCondition();
    const traffic = (context && context.traffic) || await getTrafficCondition();
    const hour = (context && context.hour != null) ? context.hour : new Date().getHours();
    const expansionCount = (context && context.expansionCount) || 0;

    const scoredRiders = [];

    for (const rider of riders) {
      try {
        const scores = await this.calculateScores(rider, order, {
          hour,
          weather,
          traffic,
          expansionCount,
          traceId,
        });

        scoredRiders.push({
          rider,
          scores,
          totalScore: scores.totalScore,
          tierLabel: this.getTierLabel(scores.totalScore),
        });
      } catch (err) {
        console.error(`[${traceId}] 骑手${rider.id}评分异常:`, err.message);
        // 单个骑手评分失败不影响其他骑手
        continue;
      }
    }

    // 按总分降序排列
    scoredRiders.sort((a, b) => b.totalScore - a.totalScore);

    return scoredRiders;
  }

  /**
   * 筛选候选骑手
   * @param {object} order - 订单数据
   * @param {number} [radiusMeters] - 搜索半径（米），默认2000
   * @returns {Promise<Array>} 候选骑手列表
   */
  async getCandidateRiders(order, radiusMeters) {
    const traceId = generateTraceId();
    const radius = radiusMeters || EXPANSION_CONFIG.INITIAL_RADIUS_METERS;
    const radiusKm = radius / 1000;

    const merchantLat = parseFloat(order.merchant_latitude) || parseFloat(order.pickup_latitude);
    const merchantLng = parseFloat(order.merchant_longitude) || parseFloat(order.pickup_longitude);

    try {
      let sql;
      let params;

      if (merchantLat && merchantLng) {
        // 有坐标时：使用坐标范围查询（近似距离）
        // 1度纬度 ≈ 111km, 1度经度 ≈ 111*cos(lat) km
        const latOffset = radiusKm / 111.0;
        const lngOffset = radiusKm / (111.0 * Math.cos(toRadians(merchantLat)));

        sql = `
          SELECT r.id, r.name, r.phone, r.last_latitude, r.last_longitude,
                 r.pool_type, r.status, r.total_orders, r.completed_orders,
                 r.on_time_rate, r.credit_score, r.created_at,
                 r.consecutive_dispatch_count, r.last_dispatch_at,
                 COALESCE(r.on_time_rate, 1.0) AS on_time_rate
          FROM riders r
          WHERE r.status = 'online'
            AND r.last_latitude IS NOT NULL
            AND r.last_longitude IS NOT NULL
            AND r.last_latitude BETWEEN ? AND ?
            AND r.last_longitude BETWEEN ? AND ?
            AND (r.freeze_reason IS NULL OR r.freeze_reason = '')
            -- 排除当前已满负载的骑手（≥4单视为满负载）
            AND r.id NOT IN (
              SELECT rider_id FROM rider_orders
              WHERE status IN ('assigned', 'picking', 'delivering')
              GROUP BY rider_id HAVING COUNT(*) >= 4
            )
          ORDER BY r.last_dispatch_at IS NULL DESC, r.last_dispatch_at ASC, r.created_at ASC
          LIMIT 30
        `;
        params = [
          merchantLat - latOffset,
          merchantLat + latOffset,
          merchantLng - lngOffset,
          merchantLng + lngOffset,
        ];
      } else {
        // 无坐标时：直接查询所有在线骑手
        sql = `
          SELECT r.id, r.name, r.phone, r.last_latitude, r.last_longitude,
                 r.pool_type, r.status, r.total_orders, r.completed_orders,
                 r.on_time_rate, r.credit_score, r.created_at,
                 r.consecutive_dispatch_count, r.last_dispatch_at,
                 COALESCE(r.on_time_rate, 1.0) AS on_time_rate
          FROM riders r
          WHERE r.status = 'online'
            AND (r.freeze_reason IS NULL OR r.freeze_reason = '')
            AND r.id NOT IN (
              SELECT rider_id FROM rider_orders
              WHERE status IN ('assigned', 'picking', 'delivering')
              GROUP BY rider_id HAVING COUNT(*) >= 4
            )
          ORDER BY r.last_dispatch_at IS NULL DESC, r.last_dispatch_at ASC
          LIMIT 30
        `;
        params = [];
      }

      const [riders] = await pool.query(sql, params);

      // 如果有坐标，精确计算距离并过滤
      if (merchantLat && merchantLng) {
        const filteredRiders = [];
        for (const rider of riders) {
          if (rider.last_latitude && rider.last_longitude) {
            const distKm = calculateDistance(
              merchantLat, merchantLng,
              parseFloat(rider.last_latitude), parseFloat(rider.last_longitude)
            );
            if (distKm <= radiusKm) {
              rider.distance_to_merchant_km = Math.round(distKm * 100) / 100;
              filteredRiders.push(rider);
            }
          } else {
            filteredRiders.push(rider);
          }
        }
        // 按距离从近到远排序
        filteredRiders.sort((a, b) => {
          const distA = a.distance_to_merchant_km || Infinity;
          const distB = b.distance_to_merchant_km || Infinity;
          return distA - distB;
        });
        return filteredRiders;
      }

      return riders;
    } catch (err) {
      console.error(`[${traceId}] 筛选候选骑手失败:`, err.message);
      return [];
    }
  }

  /**
   * 计算单个骑手的五维评分
   * @param {object} rider - 骑手数据
   * @param {object} order - 订单数据
   * @param {object} context - 上下文
   * @returns {Promise<object>} 五维分项 + 总分
   */
  async calculateScores(rider, order, context) {
    const traceId = context.traceId || generateTraceId();

    // 1. 距离适配分
    let distanceKm = order.distance_km || 0;
    if (rider.last_latitude && rider.last_longitude && order.merchant_latitude) {
      distanceKm = calculateDistance(
        parseFloat(order.merchant_latitude),
        parseFloat(order.merchant_longitude),
        parseFloat(rider.last_latitude),
        parseFloat(rider.last_longitude)
      );
    }
    const distanceScore = calculateDistanceScore(distanceKm);

    // 2. 骑手负载分
    const currentOrders = await getRiderCurrentOrders(pool, rider.id);
    const loadScore = calculateLoadScore(currentOrders);

    // 3. 履约质量分
    const perfData = await getRiderPerformanceData(pool, rider.id);
    const qualityScore = calculateQualityScore(perfData.onTimeRate, perfData.hasViolation);

    // 4. 时段环境分
    const timeEnvScore = calculateTimeEnvScore(
      context.hour || new Date().getHours(),
      context.weather || 'sunny',
      context.traffic || 'normal'
    );

    // 5. 公平轮循修正分
    const consecutiveAdvanced = rider.consecutive_dispatch_count || 0;
    // 判断是否新手（注册7天内）
    const isNewRider = rider.created_at &&
      (Date.now() - new Date(rider.created_at).getTime()) < 7 * 24 * 60 * 60 * 1000;
    // 判断是否弱势骑手（最近一次派单超过1小时）
    const isUnderdog = rider.last_dispatch_at &&
      (Date.now() - new Date(rider.last_dispatch_at).getTime()) > 60 * 60 * 1000;
    // 长时间等待（超过2小时未接单）
    const longWait = rider.last_dispatch_at &&
      (Date.now() - new Date(rider.last_dispatch_at).getTime()) > 2 * 60 * 60 * 1000;

    const fairnessScore = calculateFairnessScore(
      consecutiveAdvanced,
      isNewRider,
      isUnderdog,
      longWait
    );

    // 6. 加权总分
    const totalScore = calculateTotalScore(
      distanceScore,
      loadScore,
      qualityScore,
      timeEnvScore,
      fairnessScore
    );

    return {
      distanceScore: Math.round(distanceScore * 100) / 100,
      loadScore: Math.round(loadScore * 100) / 100,
      qualityScore: Math.round(qualityScore * 100) / 100,
      timeEnvScore: Math.round(timeEnvScore * 100) / 100,
      fairnessScore: Math.round(fairnessScore * 100) / 100,
      totalScore: Math.round(totalScore * 100) / 100,
    };
  }

  /**
   * 根据总分获取档位标签
   * @param {number} totalScore - 总分
   * @returns {string} 档位标签
   */
  getTierLabel(totalScore) {
    if (totalScore >= 90) return 'S';
    if (totalScore >= 80) return 'A';
    if (totalScore >= 70) return 'B';
    if (totalScore >= 60) return 'C';
    return 'D';
  }

  /**
   * 批量更新骑手AI评分缓存
   * @param {Array} scoredRiders - 评分后的骑手列表
   */
  async updateScoreCache(scoredRiders) {
    try {
      for (const item of scoredRiders) {
        await pool.query(
          `INSERT INTO rider_ai_scores
             (rider_id, current_orders, cached_load_score, cached_quality_score,
              cached_total_score, score_expire_at, updated_at)
           VALUES (?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 5 MINUTE), NOW())
           ON DUPLICATE KEY UPDATE
             current_orders = VALUES(current_orders),
             cached_load_score = VALUES(cached_load_score),
             cached_quality_score = VALUES(cached_quality_score),
             cached_total_score = VALUES(cached_total_score),
             score_expire_at = VALUES(score_expire_at),
             updated_at = NOW()`,
          [
            item.rider.id,
            item.scores.currentOrders || 0,
            item.scores.loadScore,
            item.scores.qualityScore,
            item.totalScore,
          ]
        );
      }
    } catch (err) {
      // 缓存更新失败不影响主流程
      console.error(`[ScoringEngine] 更新评分缓存失败:`, err.message);
    }
  }
}

/**
 * 角度转弧度（用于SQL距离查询）
 */
function toRadians(degrees) {
  return degrees * (Math.PI / 180);
}

module.exports = new ScoringEngine();
