'use strict';

/**
 * 爆单预测模型（5因子加权预测引擎）
 *
 * @module ai_modules/pre_position/predictor
 */

const mysql = require('mysql2/promise');
const config = require('../../config/ai_modules');
const { getErrorByCode } = require('../../config/error_codes');
const { getTimeSlot } = require('../common/date-utils');
const NodeCache = require('node-cache');
const winston = require('winston');
const path = require('path');

const logger = winston.createLogger({
  level: process.env.KUAILV_LOG_LEVEL || 'info',
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({
      filename: path.join(process.env.KUAILV_LOG_DIR || './logs', 'pre-position.log'),
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
 * 5因子权重配置
 */
const FACTORS = {
  HISTORY: { weight: 0.35, name: '历史订单趋势' },
  WEATHER: { weight: 0.20, name: '实时天气' },
  TIME_SLOT: { weight: 0.20, name: '时段特征' },
  EVENT: { weight: 0.15, name: '商圈活动' },
  REALTIME: { weight: 0.10, name: '实时订单趋势' },
};

/**
 * 爆单强度阈值
 */
const INTENSITY_THRESHOLDS = [
  { min: 3.0, level: 5 },
  { min: 2.5, level: 4 },
  { min: 2.0, level: 3 },
  { min: 1.5, level: 2 },
  { min: 1.2, level: 1 },
];

/**
 * 时段系数映射
 */
const TIME_FACTOR_MAP = {
  breakfast: 1.0,
  lunch: 1.2,
  tea_time: 0.6,
  dinner: 1.1,
  night_snack: 0.8,
  other: 1.0,
};

const ppConfig = config.prePosition;
const cache = new NodeCache({ stdTTL: ppConfig.predictionCacheTtl || 600, checkperiod: 120 });

/**
 * 计算爆单强度
 *
 * @param {number} expectedOrders - 预计订单数
 * @param {number} baselineOrders - 历史基线订单数
 * @returns {number} 强度 0~5
 */
function calcIntensity(expectedOrders, baselineOrders) {
  if (!baselineOrders || baselineOrders <= 0) {
    return 0;
  }
  const ratio = expectedOrders / baselineOrders;
  for (const threshold of INTENSITY_THRESHOLDS) {
    if (ratio >= threshold.min) {
      return threshold.level;
    }
  }
  return 0;
}

/**
 * 建议骑手数
 *
 * @param {number} expectedOrders - 预计订单数
 * @param {number} [riderCapacity] - 单骑手处理能力
 * @returns {number}
 */
function suggestRiders(expectedOrders, riderCapacity) {
  const capacity = riderCapacity || ppConfig.defaultRiderCapacity || 6;
  return Math.ceil(expectedOrders / capacity);
}

/**
 * 计算置信度
 *
 * @param {Object} factors - 因子明细
 * @returns {string} high/medium/low
 */
function calcConfidence(factors) {
  if (!factors) {
    return 'low';
  }
  // 如果关键因子缺失或用 fallback，降低置信度
  if (factors.historical <= 0 || factors.weather <= 0) {
    return 'low';
  }
  // 全部因子正常获取 → high
  if (factors.historical > 0 && factors.weather > 0 && factors.time > 0) {
    return 'high';
  }
  return 'medium';
}

/**
 * 加载历史基线数据
 * 过去30天同星期同时段订单量中位数
 * 由于无实际 orders 表，使用模拟数据
 *
 * @param {number} districtId - 区域ID
 * @returns {Promise<number>} 基线订单数
 * @private
 */
async function _loadHistoryData(districtId) {
  // 模拟数据：返回 100 + 随机 0~50
  const simulatedBaseline = 100 + Math.floor(Math.random() * 50);
  logger.info(`[PrePosition][predictor] 历史基线 district=${districtId} baseline=${simulatedBaseline} (模拟)`);
  return simulatedBaseline;
}

/**
 * 加载天气因子
 * 模拟天气数据，恶劣天气时提升因子
 *
 * @param {number} districtId - 区域ID
 * @returns {Promise<number>} 天气因子 (1.0=正常, 1.15~1.30=恶劣)
 * @private
 */
async function _loadWeatherFactor(districtId) {
  // 模拟天气因子
  const weatherTypes = [
    { factor: 1.0, desc: '晴天' },
    { factor: 1.0, desc: '多云' },
    { factor: 1.15, desc: '小雨' },
    { factor: 1.20, desc: '中雨' },
    { factor: 1.30, desc: '大雨/雪' },
  ];
  const idx = Math.floor(Math.random() * weatherTypes.length);
  const weather = weatherTypes[idx];
  logger.info(`[PrePosition][predictor] 天气因子 district=${districtId} factor=${weather.factor} (${weather.desc})`);
  return weather.factor;
}

/**
 * 加载时段因子
 *
 * @param {Date} [date] - 时间
 * @returns {number} 时段因子
 * @private
 */
function _loadTimeFactor(date) {
  const slot = getTimeSlot(date);
  const factor = TIME_FACTOR_MAP[slot] || 1.0;
  logger.info(`[PrePosition][predictor] 时段因子 slot=${slot} factor=${factor}`);
  return factor;
}

/**
 * 加载商圈活动因子
 *
 * @param {number} districtId - 区域ID
 * @returns {Promise<number>} 活动因子 (>=1.0)
 * @private
 */
async function _loadEventFactor(districtId) {
  const connection = await mysql.createConnection(config.db);
  try {
    const [events] = await connection.query(
      `SELECT expected_boost_pct FROM ai_pre_position_events
       WHERE district_id = ? AND status = 1
       AND event_date = CURDATE()
       AND event_time_start <= CURTIME()
       AND event_time_end >= CURTIME()`,
      [districtId],
    );

    if (events.length === 0) {
      return 1.0; // 无活跃活动
    }

    // 取最大加成
    let maxBoost = 0;
    for (const evt of events) {
      const boost = parseFloat(evt.expected_boost_pct);
      if (boost > maxBoost) {
        maxBoost = boost;
      }
    }
    const factor = 1.0 + maxBoost / 100;
    logger.info(`[PrePosition][predictor] 活动因子 district=${districtId} factor=${factor} events=${events.length}`);
    return factor;
  } catch (err) {
    logger.warn(`[PrePosition][predictor] 活动因子查询失败 district=${districtId}: ${err.message}`);
    return 1.0;
  } finally {
    await connection.end();
  }
}

/**
 * 加载实时订单趋势因子
 * 当前时段已接单量 / 历史同时段均值
 *
 * @param {number} districtId - 区域ID
 * @returns {Promise<number>} 实时因子
 * @private
 */
async function _loadRealtimeTrend(districtId) {
  // 模拟实时因子
  const factor = 0.9 + Math.random() * 0.3; // 0.9~1.2
  logger.info(`[PrePosition][predictor] 实时趋势 district=${districtId} factor=${factor.toFixed(4)}`);
  return parseFloat(factor.toFixed(4));
}

/**
 * 获取降级基线（新区域无历史数据时）
 *
 * @param {number} districtId - 区域ID
 * @returns {Promise<number>} 降级基线
 * @private
 */
async function _getFallbackBaseline(districtId) {
  logger.warn(`[PrePosition][predictor] 新区域无历史数据 district=${districtId} 使用同类商圈均值`);
  return 80 + Math.floor(Math.random() * 40); // 模拟同类商圈均值
}

/**
 * 预测单个区域
 *
 * @param {number} districtId - 区域ID
 * @returns {Promise<Object>} PredictionResult
 */
async function predictDistrict(districtId) {
  const now = new Date();
  const windowMinutes = ppConfig.predictionWindowMinutes || 60;
  const subWindowMinutes = ppConfig.subWindowMinutes || 30;

  // 1. 历史基线
  let baselineOrders;
  let useFallback = false;
  try {
    baselineOrders = await _loadHistoryData(districtId);
    if (!baselineOrders || baselineOrders <= 0) {
      baselineOrders = await _getFallbackBaseline(districtId);
      useFallback = true;
    }
  } catch (err) {
    logger.warn(`[PrePosition][predictor] 历史数据获取失败 district=${districtId}: ${err.message}`);
    baselineOrders = await _getFallbackBaseline(districtId);
    useFallback = true;
  }

  // 2. 天气因子
  let weatherFactor;
  try {
    weatherFactor = await _loadWeatherFactor(districtId);
  } catch (err) {
    logger.warn(`[PrePosition][predictor] 天气因子获取失败 district=${districtId}: ${err.message}`);
    weatherFactor = 1.0;
  }

  // 3. 时段因子
  const timeFactor = _loadTimeFactor(now);

  // 4. 商圈活动因子
  let eventFactor;
  try {
    eventFactor = await _loadEventFactor(districtId);
  } catch (err) {
    logger.warn(`[PrePosition][predictor] 活动因子获取失败 district=${districtId}: ${err.message}`);
    eventFactor = 1.0;
  }

  // 5. 实时趋势
  let realtimeFactor;
  try {
    realtimeFactor = await _loadRealtimeTrend(districtId);
  } catch (err) {
    logger.warn(`[PrePosition][predictor] 实时趋势获取失败 district=${districtId}: ${err.message}`);
    realtimeFactor = 1.0;
  }

  // 6. 综合计算
  const factorProduct = weatherFactor * timeFactor * eventFactor * realtimeFactor;
  const expectedOrders = Math.round(baselineOrders * factorProduct);

  // 窗口1/2预测
  const window1Orders = Math.round(expectedOrders * 0.55);
  const window2Orders = expectedOrders - window1Orders;

  // 7. 强度判定
  const intensity = calcIntensity(expectedOrders, baselineOrders);

  // 8. 建议骑手数
  const recommendedRiders = suggestRiders(expectedOrders);

  // 9. 置信度
  const confidence = useFallback ? 'low' : calcConfidence({
    historical: baselineOrders,
    weather: weatherFactor,
    time: timeFactor,
    event: eventFactor,
    realtime: realtimeFactor,
  });

  // 10. 时间窗口
  const surgeStart = new Date(now.getTime() + 10 * 60 * 1000); // 10分钟后
  const surgeEnd = new Date(surgeStart.getTime() + windowMinutes * 60 * 1000);

  const result = {
    districtId,
    expectedOrders,
    baselineOrders,
    window1Orders,
    window2Orders,
    intensity,
    recommendedRiders,
    confidence,
    factors: {
      historical: baselineOrders,
      weather: weatherFactor,
      time: timeFactor,
      event: eventFactor,
      realtime: realtimeFactor,
    },
    surgeStart: surgeStart.toISOString().replace('T', ' ').replace('Z', '').split('.')[0],
    surgeEnd: surgeEnd.toISOString().replace('T', ' ').replace('Z', '').split('.')[0],
  };

  // 写入缓存
  cache.set(`prediction_cache_${districtId}`, result);

  logger.info(
    `[PrePosition][predictor] 预测完成 district=${districtId} ` +
    `expected=${expectedOrders} baseline=${baselineOrders} ` +
    `intensity=${intensity} riders=${recommendedRiders} confidence=${confidence}`,
  );

  return result;
}

/**
 * 预测所有活跃区域
 *
 * @returns {Promise<Array<Object>>} PredictionResult[]
 */
async function predictAllDistricts() {
  const connection = await mysql.createConnection(config.db);
  try {
    // 获取所有活跃区域
    const [districts] = await connection.query(
      'SELECT id FROM ai_surge_predictions WHERE status = 1 GROUP BY district_id',
    );

    // 如果没有活跃预测区域，使用默认区域列表进行测试
    let districtIds;
    if (districts.length === 0) {
      // 模拟区域 1~20
      districtIds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
                     11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
    } else {
      districtIds = districts.map((d) => d.id);
    }

    const results = [];
    for (const districtId of districtIds) {
      try {
        const result = await predictDistrict(districtId);
        results.push(result);
      } catch (err) {
        logger.error(`[PrePosition][predictor] 区域 ${districtId} 预测失败: ${err.message}`);
        // 继续预测其他区域
      }
    }

    logger.info(`[PrePosition][predictor] 全区域预测完成 count=${results.length}`);
    return results;
  } finally {
    await connection.end();
  }
}

/**
 * 保存预测记录到数据库
 *
 * @param {Object} result - PredictionResult
 * @returns {Promise<number>} 预测记录ID
 */
async function savePrediction(result) {
  const connection = await mysql.createConnection(config.db);
  try {
    const [insertResult] = await connection.query(
      `INSERT INTO ai_surge_predictions
       (district_id, predicted_at, surge_start, surge_end,
        window1_orders, window2_orders, expected_orders, baseline_orders,
        intensity, recommended_riders, confidence, factors, status)
       VALUES (?, NOW(), ?, ?,
               ?, ?, ?, ?,
               ?, ?, ?, ?, 1)`,
      [
        result.districtId,
        result.surgeStart,
        result.surgeEnd,
        result.window1Orders || null,
        result.window2Orders || null,
        result.expectedOrders,
        result.baselineOrders,
        result.intensity,
        result.recommendedRiders,
        result.confidence,
        JSON.stringify(result.factors),
      ],
    );

    logger.info(`[PrePosition][predictor] 预测记录已保存 id=${insertResult.insertId} district=${result.districtId}`);
    return insertResult.insertId;
  } finally {
    await connection.end();
  }
}

/**
 * 效果回写（cron 5分钟触发）
 * 查询已过期的活跃预测，回写实际订单数
 *
 * @returns {Promise<number>} 回写数量
 */
async function writebackPredictions() {
  const connection = await mysql.createConnection(config.db);
  try {
    // 查询已过期的活跃预测
    const [predictions] = await connection.query(
      `SELECT * FROM ai_surge_predictions
       WHERE status = 1 AND surge_end < NOW() AND actual_orders IS NULL`,
    );

    let writebackCount = 0;
    for (const pred of predictions) {
      // 模拟实际订单数（实际应查 kuailv_orders 表）
      const actualOrders = Math.round(pred.expected_orders * (0.7 + Math.random() * 0.5));

      // 计算准确率
      const maxVal = Math.max(pred.expected_orders, actualOrders);
      const minVal = Math.min(pred.expected_orders, actualOrders);
      const accuracy = maxVal > 0 ? parseFloat(((1 - (maxVal - minVal) / maxVal) * 100).toFixed(2)) : 0;

      // 是否命中（≥80%）
      const isHit = actualOrders >= pred.expected_orders * 0.8 ? 1 : 0;

      await connection.query(
        `UPDATE ai_surge_predictions
         SET actual_orders = ?, accuracy = ?, is_hit = ?, status = 2
         WHERE id = ?`,
        [actualOrders, accuracy, isHit, pred.id],
      );

      logger.info(
        `[PrePosition][predictor] 回写预测 id=${pred.id} expected=${pred.expected_orders} ` +
        `actual=${actualOrders} accuracy=${accuracy}% is_hit=${isHit}`,
      );
      writebackCount++;
    }

    logger.info(`[PrePosition][predictor] 效果回写完成 count=${writebackCount}`);
    return writebackCount;
  } finally {
    await connection.end();
  }
}

module.exports = {
  FACTORS,
  predictAllDistricts,
  predictDistrict,
  savePrediction,
  calcIntensity,
  suggestRiders,
  calcConfidence,
  writebackPredictions,
};
