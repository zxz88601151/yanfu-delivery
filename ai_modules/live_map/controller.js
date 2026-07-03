'use strict';

/**
 * 活地图控制器
 *
 * @module ai_modules/live_map/controller
 */

const { success, fail, paginate } = require('../common/response');
const service = require('./service');
const winston = require('winston');
const path = require('path');

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

/**
 * POST /live_map/reports
 * 提交路况上报
 */
async function handleSubmitReport(req, res) {
  try {
    const {
      rider_id: riderId,
      report_type: reportType,
      location,
      gps_accuracy: gpsAccuracy,
      address,
      description,
      images,
    } = req.body;

    const result = await service.submitReport({
      rider_id: riderId,
      report_type: reportType,
      lng: location.lng,
      lat: location.lat,
      gps_accuracy: gpsAccuracy || 0,
      address: address || null,
      description: description || null,
      images: images || [],
    });

    res.json(success(result));
  } catch (err) {
    logger.error(`提交路况上报失败: ${err.message}`);
    if (err.code) {
      res.json(fail(err.code, err.message, err.data || null));
    } else {
      res.json(fail(9001, '服务器内部错误'));
    }
  }
}

/**
 * GET /live_map/reports
 * 获取路况上报列表（P1）
 */
async function handleListReports(req, res) {
  try {
    const filters = {
      page: parseInt(req.query.page, 10) || 1,
      size: parseInt(req.query.size, 10) || 20,
      status: req.query.status !== undefined ? parseInt(req.query.status, 10) : undefined,
      report_type: req.query.report_type ? parseInt(req.query.report_type, 10) : undefined,
      rider_id: req.query.rider_id ? parseInt(req.query.rider_id, 10) : undefined,
      start_date: req.query.start_date || undefined,
      end_date: req.query.end_date || undefined,
    };

    const result = await service.listReports(filters);
    res.json(paginate(result.total, result.page, result.size, result.items));
  } catch (err) {
    logger.error(`获取上报列表失败: ${err.message}`);
    res.json(fail(9001, '服务器内部错误'));
  }
}

/**
 * GET /live_map/heatmap
 * 获取配送难度热力图
 */
async function handleGetHeatmap(req, res) {
  try {
    const bounds = req.query.bounds || null;
    const zoom = req.query.zoom ? parseInt(req.query.zoom, 10) : undefined;
    const districtIds = req.query.district_ids || null;

    const result = await service.getHeatmap(bounds, zoom, districtIds);
    res.json(success(result));
  } catch (err) {
    logger.error(`获取热力图失败: ${err.message}`);
    res.json(fail(9001, '服务器内部错误'));
  }
}

/**
 * GET /live_map/conditions
 * 获取已验证路况列表（P1）
 */
async function handleListConditions(req, res) {
  try {
    const filters = {
      page: parseInt(req.query.page, 10) || 1,
      size: parseInt(req.query.size, 10) || 20,
      status: req.query.status !== undefined ? parseInt(req.query.status, 10) : undefined,
      difficulty_level: req.query.difficulty_level !== undefined ? parseInt(req.query.difficulty_level, 10) : undefined,
      district_id: req.query.district_id ? parseInt(req.query.district_id, 10) : undefined,
    };

    const result = await service.listConditions(filters);
    res.json(paginate(result.total, result.page, result.size, result.items));
  } catch (err) {
    logger.error(`获取路况列表失败: ${err.message}`);
    res.json(fail(9001, '服务器内部错误'));
  }
}

/**
 * POST /live_map/conditions/:id/expire
 * 手动过期红区（P2）
 */
async function handleExpireCondition(req, res) {
  try {
    const conditionId = parseInt(req.params.id, 10);
    if (isNaN(conditionId) || conditionId <= 0) {
      return res.json(fail(1001, '参数错误'));
    }

    const result = await service.expireCondition(conditionId);
    res.json(success(result));
  } catch (err) {
    logger.error(`过期红区失败: ${err.message}`);
    if (err.code) {
      res.json(fail(err.code, err.message));
    } else {
      res.json(fail(9001, '服务器内部错误'));
    }
  }
}

/**
 * GET /live_map/routes/avoid-advice
 * 获取路径避让建议（P1）
 */
async function handleGetAvoidAdvice(req, res) {
  try {
    const fromLng = parseFloat(req.query.from_lng);
    const fromLat = parseFloat(req.query.from_lat);
    const toLng = parseFloat(req.query.to_lng);
    const toLat = parseFloat(req.query.to_lat);
    const riderId = req.query.rider_id ? parseInt(req.query.rider_id, 10) : undefined;

    if (isNaN(fromLng) || isNaN(fromLat) || isNaN(toLng) || isNaN(toLat)) {
      return res.json(fail(1001, '参数错误: 请提供有效的经纬度'));
    }

    const result = await service.getAvoidAdvice(fromLng, fromLat, toLng, toLat, riderId);
    res.json(success(result));
  } catch (err) {
    logger.error(`获取避让建议失败: ${err.message}`);
    res.json(fail(9001, '服务器内部错误'));
  }
}

/**
 * GET /live_map/stats
 * 获取统计仪表盘数据（P2）
 */
async function handleGetStats(req, res) {
  try {
    const date = req.query.date || null;
    const result = await service.getStats(date);
    res.json(success(result));
  } catch (err) {
    logger.error(`获取统计失败: ${err.message}`);
    res.json(fail(9001, '服务器内部错误'));
  }
}

module.exports = {
  handleSubmitReport,
  handleListReports,
  handleGetHeatmap,
  handleListConditions,
  handleExpireCondition,
  handleGetAvoidAdvice,
  handleGetStats,
};
