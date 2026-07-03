'use strict';

/**
 * 预置运力请求控制器
 *
 * @module ai_modules/pre_position/controller
 */

const { success, fail } = require('../common/response');
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

const service = require('./service');

/**
 * GET /pre_position/predictions
 * 获取爆单预测列表
 */
async function handleGetPredictions(req, res) {
  try {
    const { district_ids, min_intensity, status, page, page_size } = req.query;
    const result = await service.getPredictions(
      district_ids,
      min_intensity ? parseInt(min_intensity, 10) : undefined,
      status !== undefined ? parseInt(status, 10) : undefined,
      parseInt(page, 10) || 1,
      parseInt(page_size, 10) || 20,
    );
    res.json(success(result));
  } catch (err) {
    logger.error(`[PrePosition][controller] 获取预测列表失败: ${err.message}`);
    res.json(fail(err.code || 9001, err.message || '服务器内部错误'));
  }
}

/**
 * POST /pre_position/dispatch
 * 发起预置调度
 */
async function handleCreateDispatch(req, res) {
  try {
    const { prediction_id, dispatch_type, rider_ids, force } = req.body;
    const result = await service.createDispatch(
      prediction_id,
      dispatch_type || 1,
      rider_ids || null,
      force || false,
    );
    res.json(success(result));
  } catch (err) {
    logger.error(`[PrePosition][controller] 创建调度失败: ${err.message}`);
    res.json(fail(err.code || 9001, err.message || '服务器内部错误'));
  }
}

/**
 * POST /pre_position/dispatch/:id/respond
 * 骑手响应调度
 */
async function handleRespondDispatch(req, res) {
  try {
    const dispatchId = parseInt(req.params.id, 10);
    if (isNaN(dispatchId) || dispatchId <= 0) {
      return res.json(fail(1001, '参数错误'));
    }

    const { rider_id, action, reason } = req.body;
    const result = await service.respondDispatch(dispatchId, rider_id, action, reason);
    res.json(success(result));
  } catch (err) {
    logger.error(`[PrePosition][controller] 响应调度失败: ${err.message}`);
    res.json(fail(err.code || 9001, err.message || '服务器内部错误'));
  }
}

/**
 * PUT /pre_position/dispatch/:id/arrive
 * 骑手到达标记
 */
async function handleArriveDispatch(req, res) {
  try {
    const dispatchId = parseInt(req.params.id, 10);
    if (isNaN(dispatchId) || dispatchId <= 0) {
      return res.json(fail(1001, '参数错误'));
    }

    const { rider_id, location, arrived_at } = req.body;
    const result = await service.arriveDispatch(dispatchId, rider_id, location, arrived_at);
    res.json(success(result));
  } catch (err) {
    logger.error(`[PrePosition][controller] 到达标记失败: ${err.message}`);
    res.json(fail(err.code || 9001, err.message || '服务器内部错误'));
  }
}

/**
 * GET /pre_position/dashboard
 * 获取效果仪表盘
 */
async function handleGetDashboard(req, res) {
  try {
    const { start_date, end_date, district_ids } = req.query;
    const result = await service.getDashboardData(start_date, end_date, district_ids);
    res.json(success(result));
  } catch (err) {
    logger.error(`[PrePosition][controller] 获取仪表盘失败: ${err.message}`);
    res.json(fail(err.code || 9001, err.message || '服务器内部错误'));
  }
}

/**
 * GET /pre_position/dispatches/active
 * 获取活跃调度（P1 stub）
 */
async function handleGetActiveDispatches(req, res) {
  res.json(success({
    active_dispatches: [],
    total: 0,
    by_district: {},
    message: 'P1 功能，暂未完整实现',
  }));
}

/**
 * POST /pre_position/events
 * 创建商圈活动（P1 stub）
 */
async function handleCreateEvent(req, res) {
  try {
    const connection = require('mysql2/promise').createConnection(require('../../config/ai_modules').db);
    try {
      const { district_id, event_name, event_date, event_time_start, event_time_end, expected_boost_pct, remark } = req.body;
      await connection.query(
        `INSERT INTO ai_pre_position_events
         (district_id, event_name, event_date, event_time_start, event_time_end, expected_boost_pct, remark, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
        [district_id, event_name, event_date, event_time_start, event_time_end, expected_boost_pct, remark || null],
      );
      res.json(success(null, '活动创建成功'));
    } finally {
      await connection.end();
    }
  } catch (err) {
    logger.error(`[PrePosition][controller] 创建活动失败: ${err.message}`);
    res.json(fail(err.code || 9001, err.message || '服务器内部错误'));
  }
}

/**
 * GET /pre_position/events
 * 获取活动列表（P1 stub）
 */
async function handleGetEvents(req, res) {
  try {
    const mysql = require('mysql2/promise');
    const config = require('../../config/ai_modules');
    const connection = await mysql.createConnection(config.db);
    try {
      const [events] = await connection.query(
        'SELECT * FROM ai_pre_position_events ORDER BY created_at DESC',
      );
      res.json(success(events));
    } finally {
      await connection.end();
    }
  } catch (err) {
    logger.error(`[PrePosition][controller] 获取活动列表失败: ${err.message}`);
    res.json(fail(err.code || 9001, err.message || '服务器内部错误'));
  }
}

module.exports = {
  handleGetPredictions,
  handleCreateDispatch,
  handleRespondDispatch,
  handleArriveDispatch,
  handleGetDashboard,
  handleGetActiveDispatches,
  handleCreateEvent,
  handleGetEvents,
};
