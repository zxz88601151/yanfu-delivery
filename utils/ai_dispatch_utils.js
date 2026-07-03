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
 * 盐阜配送 - AI派单工具函数
 * 包含距离计算、五维评分计算、池类型判断等工具方法
 */
const crypto = require('crypto');
const {
  DISTANCE_SCORE_TABLE,
  LOAD_SCORE_TABLE,
  QUALITY_SCORE_TABLE,
  VIOLATION_PENALTY,
  TIME_ENV_BONUS,
  FAIRNESS_ADJUSTMENT,
  SCORE_WEIGHTS,
  POOL_THRESHOLDS,
  PEAK_PERIODS,
} = require('../config/ai_dispatch');

/**
 * 使用 Haversine 公式计算两点间的距离（单位: km）
 * @param {number} lat1 - 起点纬度
 * @param {number} lng1 - 起点经度
 * @param {number} lat2 - 终点纬度
 * @param {number} lng2 - 终点经度
 * @returns {number} 距离（公里）
 */
function calculateDistance(lat1, lng1, lat2, lng2) {
  // 参数校验：如果任一坐标为null或undefined，返回无穷大表示不可计算
  if (lat1 == null || lng1 == null || lat2 == null || lng2 == null) {
    return Infinity;
  }

  const R = 6371; // 地球平均半径（km）
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * 角度转弧度
 * @param {number} degrees
 * @returns {number}
 */
function toRadians(degrees) {
  return degrees * (Math.PI / 180);
}

/**
 * 根据距离计算距离适配分（满分30分）
 * @param {number} distanceKm - 配送距离（km）
 * @returns {number} 距离评分
 */
function calculateDistanceScore(distanceKm) {
  if (distanceKm == null || distanceKm < 0) {
    return 0;
  }

  for (const tier of DISTANCE_SCORE_TABLE) {
    if (distanceKm <= tier.maxKm) {
      // 如果区间有范围，按距离比例插值
      if (tier.minScore !== tier.maxScore) {
        const prevMaxKm = tier.maxKm;
        // 计算上一个档位的最大km，用于比例插值
        const prevMax = getPreviousMaxKm(tier.maxKm);
        const ratio = (distanceKm - prevMax) / (tier.maxKm - prevMax);
        return Math.round((tier.minScore + (tier.maxScore - tier.minScore) * (1 - ratio)) * 100) / 100;
      }
      return tier.maxScore;
    }
  }
  return 10; // fallback
}

/**
 * 获取上一档的最大km值（用于插值计算）
 * @param {number} currentMaxKm
 * @returns {number}
 */
function getPreviousMaxKm(currentMaxKm) {
  let prev = 0;
  for (const tier of DISTANCE_SCORE_TABLE) {
    if (tier.maxKm >= currentMaxKm) {
      return prev;
    }
    prev = tier.maxKm;
  }
  return 0;
}

/**
 * 根据当前进行中订单数计算负载分（满分25分）
 * @param {number} currentOrders - 当前进行中订单数
 * @returns {number} 负载评分
 */
function calculateLoadScore(currentOrders) {
  if (currentOrders == null || currentOrders < 0) {
    currentOrders = 0;
  }

  for (const tier of LOAD_SCORE_TABLE) {
    if (currentOrders <= tier.maxOrders) {
      return tier.score;
    }
  }
  return 5; // fallback: ≥4单
}

/**
 * 计算时段环境分（满分15分 + 加分项）
 * @param {number} hour - 当前小时（0-23）
 * @param {string} weather - 天气条件（sunny/rain/storm/snow）
 * @param {string} traffic - 路况（smooth/normal/congested/heavy）
 * @returns {number} 时段环境评分
 */
function calculateTimeEnvScore(hour, weather, traffic) {
  let score = 10; // 基础分 10分

  // 时段加分
  if (hour >= PEAK_PERIODS.LUNCH_START && hour <= PEAK_PERIODS.LUNCH_END) {
    score += TIME_ENV_BONUS.PEAK_LUNCH;
  } else if (hour >= PEAK_PERIODS.DINNER_START && hour <= PEAK_PERIODS.DINNER_END) {
    score += TIME_ENV_BONUS.PEAK_DINNER;
  } else if (hour >= PEAK_PERIODS.NIGHT_START || hour <= PEAK_PERIODS.NIGHT_END) {
    score += TIME_ENV_BONUS.NIGHT;
  }

  // 天气加分
  const weatherMap = {
    'rain': TIME_ENV_BONUS.WEATHER_RAIN,
    'storm': TIME_ENV_BONUS.WEATHER_STORM,
    'snow': TIME_ENV_BONUS.WEATHER_SNOW,
    'heavy_rain': TIME_ENV_BONUS.WEATHER_STORM,
    'thunderstorm': TIME_ENV_BONUS.WEATHER_STORM,
  };
  if (weather && weatherMap[weather.toLowerCase()]) {
    score += weatherMap[weather.toLowerCase()];
  }

  // 路况扣分
  const trafficMap = {
    'congested': TIME_ENV_BONUS.TRAFFIC_CONGESTED,
    'heavy': TIME_ENV_BONUS.TRAFFIC_HEAVY,
    'bad': TIME_ENV_BONUS.TRAFFIC_CONGESTED,
  };
  if (traffic && trafficMap[traffic.toLowerCase()]) {
    score += trafficMap[traffic.toLowerCase()];
  }

  return Math.max(0, Math.round(score * 100) / 100);
}

/**
 * 计算履约质量分（满分20分）
 * @param {number} onTimeRate - 准时率（0-1）
 * @param {boolean} hasViolation - 是否有违规记录
 * @returns {number} 履约质量评分
 */
function calculateQualityScore(onTimeRate, hasViolation) {
  // 有违规直接0分
  if (hasViolation) {
    return VIOLATION_PENALTY;
  }

  if (onTimeRate == null) {
    onTimeRate = 1.0;
  }

  for (const tier of QUALITY_SCORE_TABLE) {
    if (onTimeRate >= tier.minRate) {
      return tier.score;
    }
  }
  return 10; // fallback
}

/**
 * 计算公平轮循修正分（满分10分，调整范围 -4 ~ +3）
 * @param {number} consecutiveAdvanced - 连续优质单数
 * @param {boolean} isNewRider - 是否新手（7天内）
 * @param {boolean} isUnderdog - 是否弱势骑手（近1小时未接单）
 * @param {boolean} longWait - 是否长时间等待
 * @returns {number} 公平轮循修正分
 */
function calculateFairnessScore(consecutiveAdvanced, isNewRider, isUnderdog, longWait) {
  let score = 10; // 基础分 10分

  // 连续优质单惩罚（让机会给其他人）
  if (consecutiveAdvanced >= 3) {
    score += FAIRNESS_ADJUSTMENT.CONSECUTIVE_ADVANCED_PENALTY;
  }

  // 新手加成（鼓励新手）
  if (isNewRider) {
    score += FAIRNESS_ADJUSTMENT.NEW_RIDER_BONUS;
  }

  // 弱势骑手加成
  if (isUnderdog) {
    score += FAIRNESS_ADJUSTMENT.UNDERDOG_BONUS;
  }

  // 长时间等待加成
  if (longWait) {
    score += FAIRNESS_ADJUSTMENT.LONG_WAIT_BONUS;
  }

  return Math.max(0, Math.round(score * 100) / 100);
}

/**
 * 计算五维加权总分
 * @param {number} distance - 距离适配分
 * @param {number} load - 骑手负载分
 * @param {number} quality - 履约质量分
 * @param {number} timeEnv - 时段环境分
 * @param {number} fairness - 公平轮循修正分
 * @returns {number} 加权总分（0-100）
 */
function calculateTotalScore(distance, load, quality, timeEnv, fairness) {
  const total =
    (distance || 0) * SCORE_WEIGHTS.DISTANCE +
    (load || 0) * SCORE_WEIGHTS.LOAD +
    (quality || 0) * SCORE_WEIGHTS.QUALITY +
    (timeEnv || 0) * SCORE_WEIGHTS.TIME_ENV +
    (fairness || 0) * SCORE_WEIGHTS.FAIRNESS;

  return Math.round(total * 100) / 100;
}

/**
 * 判断订单应入哪个池
 * @param {number} distanceKm - 配送距离
 * @param {boolean} isPeak - 是否高峰期
 * @param {boolean} isPremium - 是否溢价单
 * @param {number} orderAmount - 订单金额
 * @returns {string} poolType: 'basic' | 'advanced' | 'free'
 */
function getPoolType(distanceKm, isPeak, isPremium, orderAmount) {
  // 顺路自由池（叠单场景，由后续逻辑判断）
  // 这里只判断普惠保底池和AI择优进阶池

  // 溢价单、长途单、高峰单、高金额单 → AI择优进阶池
  if (isPremium) {
    return 'advanced';
  }

  if (distanceKm > POOL_THRESHOLDS.PREMIUM_MIN_DISTANCE_KM) {
    return 'advanced';
  }

  if (orderAmount && orderAmount >= POOL_THRESHOLDS.PREMIUM_MIN_AMOUNT) {
    return 'advanced';
  }

  if (isPeak) {
    // 高峰期的短距离单也考虑进阶池（收益更高）
    if (distanceKm > 2.0) {
      return 'advanced';
    }
  }

  // 默认：普惠保底池
  return 'basic';
}

/**
 * 判断当前是否高峰期
 * @param {number} hour - 当前小时（0-23），默认当前时间
 * @returns {boolean}
 */
function isPeakHour(hour) {
  if (hour == null) {
    hour = new Date().getHours();
  }
  return (hour >= PEAK_PERIODS.LUNCH_START && hour <= PEAK_PERIODS.LUNCH_END) ||
    (hour >= PEAK_PERIODS.DINNER_START && hour <= PEAK_PERIODS.DINNER_END);
}

/**
 * 生成唯一的追踪ID
 * @returns {string} traceId
 */
function generateTraceId() {
  const timestamp = Date.now().toString(36);
  const random = crypto.randomBytes(8).toString('hex');
  return `AI-${timestamp}-${random}`;
}

/**
 * 获取当前天气条件（从环境变量或外部API）
 * 生产环境应接入真实天气API
 * @returns {Promise<string>} 天气条件
 */
async function getWeatherCondition() {
  // 优先从环境变量读取（用于测试或手动设置）
  if (process.env.AI_WEATHER_OVERRIDE) {
    return process.env.AI_WEATHER_OVERRIDE;
  }

  // 生产环境：调用外部天气API（预留）
  // TODO: 接入第三方天气API
  // const weather = await callWeatherApi(merchantLat, merchantLng);
  // return weather;

  return 'sunny'; // 默认晴天
}

/**
 * 获取当前路况（从外部API或配置）
 * @returns {Promise<string>} 路况条件
 */
async function getTrafficCondition() {
  if (process.env.AI_TRAFFIC_OVERRIDE) {
    return process.env.AI_TRAFFIC_OVERRIDE;
  }

  // 生产环境：调用地图API获取实时路况（预留）
  // TODO: 接入地图路况API

  return 'normal'; // 默认正常
}

/**
 * 获取骑手当前进行中的订单数
 * @param {object} pool - mysql2/promise pool
 * @param {number} riderId - 骑手ID
 * @returns {Promise<number>} 当前订单数
 */
async function getRiderCurrentOrders(pool, riderId) {
  try {
    const [rows] = await pool.query(
      `SELECT COUNT(*) AS count FROM rider_orders
       WHERE rider_id = ? AND status IN ('assigned', 'picking', 'delivering')`,
      [riderId]
    );
    return rows[0].count || 0;
  } catch (err) {
    console.error(`[${generateTraceId()}] 获取骑手${riderId}当前订单数失败:`, err.message);
    return 0;
  }
}

/**
 * 获取骑手履约数据
 * @param {object} pool - mysql2/promise pool
 * @param {number} riderId - 骑手ID
 * @returns {Promise<object>} { onTimeRate, hasViolation, totalOrders, completedOrders }
 */
async function getRiderPerformanceData(pool, riderId) {
  try {
    const [rows] = await pool.query(
      `SELECT
         COALESCE(on_time_rate, 1.0) AS on_time_rate,
         total_orders,
         completed_orders
       FROM riders WHERE id = ?`,
      [riderId]
    );

    if (rows.length === 0) {
      return { onTimeRate: 1.0, hasViolation: false, totalOrders: 0, completedOrders: 0 };
    }

    const rider = rows[0];

    // 检查是否有违规记录（最近30天）
    const [violationRows] = await pool.query(
      `SELECT COUNT(*) AS cnt FROM rider_behavior_log
       WHERE rider_id = ? AND behavior_type = 'violation'
         AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`,
      [riderId]
    );

    return {
      onTimeRate: parseFloat(rider.on_time_rate) || 1.0,
      hasViolation: violationRows[0].cnt > 0,
      totalOrders: rider.total_orders || 0,
      completedOrders: rider.completed_orders || 0,
    };
  } catch (err) {
    console.error(`[${generateTraceId()}] 获取骑手${riderId}履约数据失败:`, err.message);
    return { onTimeRate: 1.0, hasViolation: false, totalOrders: 0, completedOrders: 0 };
  }
}

/**
 * 记录骑手行为日志
 * @param {object} pool - mysql2/promise pool
 * @param {object} data - 行为数据
 */
async function logRiderBehavior(pool, data) {
  try {
    await pool.query(
      `INSERT INTO rider_behavior_log
         (rider_id, behavior_type, order_id, order_no, behavior_desc,
          latitude, longitude, ip_address, risk_level, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        data.rider_id,
        data.behavior_type,
        data.order_id || null,
        data.order_no || null,
        data.behavior_desc || '',
        data.latitude || null,
        data.longitude || null,
        data.ip_address || null,
        data.risk_level || 'normal',
      ]
    );
  } catch (err) {
    console.error(`[${generateTraceId()}] 记录骑手行为日志失败:`, err.message);
  }
}

module.exports = {
  calculateDistance,
  toRadians,
  calculateDistanceScore,
  calculateLoadScore,
  calculateTimeEnvScore,
  calculateQualityScore,
  calculateFairnessScore,
  calculateTotalScore,
  getPoolType,
  isPeakHour,
  generateTraceId,
  getWeatherCondition,
  getTrafficCondition,
  getRiderCurrentOrders,
  getRiderPerformanceData,
  logRiderBehavior,
};
