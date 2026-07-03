'use strict';

/**
 * 预置运力业务逻辑层（主流程编排 + cron + 降级）
 *
 * @module ai_modules/pre_position/service
 */

const mysql = require('mysql2/promise');
const { pool } = require('../../config/database');
const config = require('../../config/ai_modules');
const { getErrorByCode } = require('../../config/error_codes');
const eventBus = require('../common/event-bus');
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

const preEvents = require('./events');
const predictor = require('./predictor');
const dispatchEngine = require('./dispatch-engine');
const riderStatus = require('./rider-status');
const dashboard = require('./dashboard');

const ppConfig = config.prePosition;
const configCache = new NodeCache({ stdTTL: ppConfig.configCacheTtl || 600, checkperiod: 120 });

// ========== 缓存管理 ==========

/**
 * 获取缓存配置
 *
 * @returns {Object}
 * @private
 */
function _getCachedConfig() {
  let cached = configCache.get('pre_position:config');
  if (!cached) {
    cached = ppConfig;
    configCache.set('pre_position:config', cached);
  }
  return cached;
}

// ========== 订阅信用分变更事件 ==========
// 当信用分变更时，清除骑手信用分缓存
eventBus.on('rider.credit.changed', (payload) => {
  logger.info(`[PrePosition][service] 信用分变更事件 rider=${payload.riderId} score=${payload.newScore}`);
});

// ========== P0 业务接口 ==========

/**
 * 获取爆单预测列表
 *
 * @param {string} [districtIds] - 区域ID列表（逗号分隔）
 * @param {number} [minIntensity] - 最低强度
 * @param {number} [status] - 状态
 * @param {number} [page=1] - 页码
 * @param {number} [pageSize=20] - 每页条数
 * @returns {Promise<Object>}
 */
async function getPredictions(districtIds, minIntensity, status, page, pageSize) {
  const connection = await pool.getConnection();
  try {
    const currentPage = Math.max(1, page || 1);
    const size = Math.max(1, Math.min(100, pageSize || 20));
    const offset = (currentPage - 1) * size;

    let whereClause = 'WHERE 1=1';
    const params = [];

    if (districtIds) {
      const ids = districtIds.split(',').map(Number).filter((n) => !isNaN(n));
      if (ids.length > 0) {
        whereClause += ` AND district_id IN (${ids.map(() => '?').join(',')})`;
        params.push(...ids);
      }
    }

    if (minIntensity !== undefined && minIntensity !== null) {
      whereClause += ' AND intensity >= ?';
      params.push(minIntensity);
    }

    if (status !== undefined && status !== null) {
      whereClause += ' AND status = ?';
      params.push(status);
    }

    // 总数
    const [countResult] = await connection.query(
      `SELECT COUNT(*) AS total FROM ai_surge_predictions ${whereClause}`,
      params,
    );
    const total = countResult[0].total;

    // 查询
    const [predictions] = await connection.query(
      `SELECT * FROM ai_surge_predictions ${whereClause} ORDER BY predicted_at DESC LIMIT ? OFFSET ?`,
      [...params, size, offset],
    );

    // 统计每条预测的已调度骑手数
    const list = [];
    for (const pred of predictions) {
      const [dispatchCount] = await connection.query(
        'SELECT COUNT(*) AS cnt FROM ai_dispatch_records WHERE prediction_id = ?',
        [pred.id],
      );
      const dispatchedRiders = dispatchCount[0].cnt;
      const riderGap = Math.max(0, pred.recommended_riders - dispatchedRiders);

      list.push({
        id: pred.id,
        district_id: pred.district_id,
        district_name: `区域${pred.district_id}`,
        predicted_at: pred.predicted_at ? new Date(pred.predicted_at).toISOString() : null,
        surge_start: pred.surge_start ? new Date(pred.surge_start).toISOString() : null,
        surge_end: pred.surge_end ? new Date(pred.surge_end).toISOString() : null,
        intensity: pred.intensity,
        expected_orders: pred.expected_orders,
        baseline_orders: pred.baseline_orders,
        recommended_riders: pred.recommended_riders,
        dispatched_riders: dispatchedRiders,
        rider_gap: riderGap,
        actual_orders: pred.actual_orders,
        accuracy: pred.accuracy,
        confidence: pred.confidence,
        factors: typeof pred.factors === 'string' ? JSON.parse(pred.factors) : pred.factors,
        status: pred.status === 1 ? 'active' : pred.status === 0 ? 'pending' : 'expired',
      });
    }

    return {
      predictions: list,
      pagination: {
        page: currentPage,
        page_size: size,
        total,
      },
    };
  } finally {
    connection.release();
  }
}

/**
 * 发起预置调度
 *
 * @param {number} predictionId - 预测ID
 * @param {number} [dispatchType=1] - 调度类型
 * @param {Array<number>} [riderIds] - 指定骑手列表
 * @param {boolean} [force=false] - 是否强制
 * @returns {Promise<Object>}
 */
async function createDispatch(predictionId, dispatchType, riderIds, force) {
  const connection = await pool.getConnection();
  try {
    // 查询预测记录
    const [predictions] = await connection.query(
      'SELECT * FROM ai_surge_predictions WHERE id = ?',
      [predictionId],
    );

    if (predictions.length === 0) {
      const err = getErrorByCode(4003);
      throw Object.assign(new Error(err.message), { code: err.code });
    }

    const prediction = predictions[0];
    const predictionData = {
      predictionId: prediction.id,
      districtId: prediction.district_id,
      expectedOrders: prediction.expected_orders,
      baselineOrders: prediction.baseline_orders,
      intensity: prediction.intensity,
      recommendedRiders: prediction.recommended_riders,
      surgeStart: prediction.surge_start,
      surgeEnd: prediction.surge_end,
    };

    // 匹配骑手
    let matchedRiders;
    if (riderIds && riderIds.length > 0) {
      // 手动指定骑手
      matchedRiders = riderIds.map((rid) => ({
        riderId: rid,
        distance: Math.random() * 3,
        creditScore: 600,
        acceptRate: 0.7,
        status: 'idle',
        priorityScore: 0.7,
      }));
    } else {
      // 系统自动匹配
      matchedRiders = await dispatchEngine.matchRiders(predictionData);
    }

    if (matchedRiders.length === 0 && !force) {
      const err = getErrorByCode(4009);
      throw Object.assign(new Error(err.message), { code: err.code });
    }

    // 创建调度记录
    const dispatchResult = await dispatchEngine.createDispatchRecords(
      predictionData,
      matchedRiders,
      0, // 系统自动
      dispatchType || 1,
    );

    // 发布事件
    for (const item of dispatchResult.dispatches) {
      eventBus.emitEvent(preEvents.PRE_POSITION_DISPATCH_CREATED, {
        dispatchId: item.dispatchId,
        riderId: item.riderId,
        targetDistrictId: prediction.district_id,
        incentiveFee: item.incentiveFee,
        surgeStart: prediction.surge_start,
        surgeEnd: prediction.surge_end,
      });
    }

    if (dispatchResult.riderGap > 0) {
      eventBus.emitEvent(preEvents.PRE_POSITION_RIDER_SHORTAGE, {
        districtId: prediction.district_id,
        gap: dispatchResult.riderGap,
        predictionId: prediction.id,
      });
    }

    logger.info(
      `[PrePosition][service] 调度创建完成 prediction=${predictionId} ` +
      `dispatched=${dispatchResult.totalDispatched} gap=${dispatchResult.riderGap}`,
    );

    return dispatchResult;
  } finally {
    connection.release();
  }
}

/**
 * 骑手响应调度
 *
 * @param {number} dispatchId - 调度记录ID
 * @param {number} riderId - 骑手ID
 * @param {string} action - accept/reject
 * @param {string} [reason] - 拒绝原因
 * @returns {Promise<Object>}
 */
async function respondDispatch(dispatchId, riderId, action, reason) {
  if (action === 'accept') {
    return riderStatus.handleAccept(dispatchId, riderId);
  }
  if (action === 'reject') {
    await riderStatus.handleReject(dispatchId, riderId, reason);
    return {
      dispatch_id: dispatchId,
      status: 4,
      status_label: '已拒绝',
      message: '已拒绝调度邀请',
    };
  }
  const err = getErrorByCode(4007);
  throw Object.assign(new Error(err.message), { code: err.code });
}

/**
 * 骑手到达标记
 *
 * @param {number} dispatchId - 调度记录ID
 * @param {number} riderId - 骑手ID
 * @param {Object} location - { lng, lat }
 * @param {string} [arrivedAt] - 到达时间 ISO
 * @returns {Promise<Object>}
 */
async function arriveDispatch(dispatchId, riderId, location, arrivedAt) {
  return riderStatus.handleArrive(dispatchId, riderId, location, arrivedAt);
}

/**
 * 获取仪表盘数据
 *
 * @param {string} startDate
 * @param {string} endDate
 * @param {string} [districtIds]
 * @returns {Promise<Object>}
 */
async function getDashboardData(startDate, endDate, districtIds) {
  return dashboard.getDashboard(startDate, endDate, districtIds);
}

// ========== Cron 任务 ==========

/**
 * 运行预测周期（cron 每10分钟）
 * 1. 执行全区域预测
 * 2. 持久化预测结果
 * 3. 对 intensity ≥ 2 的区域自动调度
 * 4. 发布 surge.prediction.ready 事件
 *
 * @returns {Promise<void>}
 */
async function runPredictionCycle() {
  logger.info('[PrePosition][service] 开始预测周期');
  try {
    // 1. 执行全区域预测
    const results = await predictor.predictAllDistricts();

    if (results.length === 0) {
      logger.warn('[PrePosition][service] 预测周期无结果');
      return;
    }

    // 2. 持久化并调度
    const scheduledDistricts = [];

    for (const result of results) {
      // 保存预测记录
      const predictionId = await predictor.savePrediction(result);

      // 3. 对 intensity ≥ 2 的区域自动调度
      if (result.intensity >= 2) {
        try {
          const dispatchResult = await createDispatch(
            predictionId,
            1, // 预置调度
            null, // 系统自动匹配
            false,
          );
          scheduledDistricts.push({
            districtId: result.districtId,
            predictionId,
            intensity: result.intensity,
            dispatched: dispatchResult.totalDispatched,
            riderGap: dispatchResult.riderGap,
          });
        } catch (err) {
          logger.error(
            `[PrePosition][service] 区域 ${result.districtId} 自动调度失败: ${err.message}`,
          );
        }
      }

      // 发布单个区域预测事件
      eventBus.emitEvent(preEvents.SURGE_PREDICTION_READY, {
        predictionId,
        districtId: result.districtId,
        surgeStart: result.surgeStart,
        surgeEnd: result.surgeEnd,
        intensity: result.intensity,
        expectedOrders: result.expectedOrders,
      });
    }

    logger.info(
      `[PrePosition][service] 预测周期完成 predictions=${results.length} ` +
      `scheduled=${scheduledDistricts.length}`,
    );
  } catch (err) {
    logger.error(`[PrePosition][service] 预测周期失败: ${err.message}`);
  }
}

/**
 * 运行调度超时扫描（cron 每1分钟）
 *
 * @returns {Promise<void>}
 */
async function runTimeoutScan() {
  try {
    await riderStatus.scanTimeouts();
  } catch (err) {
    logger.error(`[PrePosition][service] 超时扫描失败: ${err.message}`);
  }
}

/**
 * 运行效果回写（cron 每5分钟）
 *
 * @returns {Promise<void>}
 */
async function runWritebackCycle() {
  try {
    const count = await predictor.writebackPredictions();
    if (count > 0) {
      eventBus.emitEvent(preEvents.PRE_POSITION_SURGE_ENDED, {
        count,
        timestamp: new Date().toISOString(),
      });
    }
  } catch (err) {
    logger.error(`[PrePosition][service] 效果回写失败: ${err.message}`);
  }
}

module.exports = {
  getPredictions,
  createDispatch,
  respondDispatch,
  arriveDispatch,
  getDashboardData,
  runPredictionCycle,
  runTimeoutScan,
  runWritebackCycle,
};
