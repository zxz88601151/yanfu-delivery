'use strict';

/**
 * 骑手调度控制器
 *
 * @module ai_modules/rider_dispatch/controller
 */

const { success, fail } = require('../common/response');
const service = require('./service');
const winston = require('winston');
const path = require('path');

const logger = winston.createLogger({
  level: process.env.KUAILV_LOG_LEVEL || 'info',
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({
      filename: path.join(process.env.KUAILV_LOG_DIR || './logs', 'rider-dispatch.log'),
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
 * GET /rider/settings
 * 获取骑手调度设置
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function handleGetSettings(req, res) {
  try {
    const riderId = parseInt(req.query.rider_id, 10) || parseInt(req.body.rider_id, 10);
    if (!riderId || riderId <= 0) {
      return res.json(fail(1001, '参数错误: rider_id 无效'));
    }

    const settings = await service.getSettings(riderId);
    res.json(success(settings));
  } catch (err) {
    logger.error(`获取骑手设置失败: ${err.message}`);
    if (err.code) {
      res.json(fail(err.code, err.message));
    } else {
      res.json(fail(9001, '服务器内部错误'));
    }
  }
}

/**
 * PUT /rider/settings
 * 更新骑手调度设置
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function handleUpdateSettings(req, res) {
  try {
    const riderId = parseInt(req.body.rider_id, 10);
    if (!riderId || riderId <= 0) {
      return res.json(fail(1001, '参数错误: rider_id 无效'));
    }

    const settings = await service.updateSettings(riderId, req.body);
    res.json(success(settings, '设置更新成功'));
  } catch (err) {
    logger.error(`更新骑手设置失败: ${err.message}`);
    if (err.code) {
      res.json(fail(err.code, err.message));
    } else {
      res.json(fail(9001, '服务器内部错误'));
    }
  }
}

/**
 * PUT /rider/status
 * 更新骑手在线/离线状态
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function handleUpdateStatus(req, res) {
  try {
    const riderId = parseInt(req.body.rider_id, 10);
    if (!riderId || riderId <= 0) {
      return res.json(fail(1001, '参数错误: rider_id 无效'));
    }

    const { status } = req.body;
    const result = await service.updateStatus(riderId, status);
    res.json(success(result, status === 1 ? '已上线' : '已下线'));
  } catch (err) {
    logger.error(`更新骑手状态失败: ${err.message}`);
    if (err.code) {
      res.json(fail(err.code, err.message));
    } else {
      res.json(fail(9001, '服务器内部错误'));
    }
  }
}

/**
 * GET /rider/orders/available
 * 获取可抢订单列表
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function handleGetAvailableOrders(req, res) {
  try {
    const riderId = parseInt(req.query.rider_id, 10);
    if (!riderId || riderId <= 0) {
      return res.json(fail(1001, '参数错误: rider_id 无效'));
    }

    const orders = await service.getAvailableOrders(riderId);
    res.json(success({ orders, total: orders.length }));
  } catch (err) {
    logger.error(`获取可抢订单失败: ${err.message}`);
    if (err.code) {
      res.json(fail(err.code, err.message));
    } else {
      res.json(fail(9001, '服务器内部错误'));
    }
  }
}

/**
 * POST /rider/orders/grab
 * 骑手抢单
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function handleGrabOrder(req, res) {
  try {
    const riderId = parseInt(req.body.rider_id, 10);
    if (!riderId || riderId <= 0) {
      return res.json(fail(1001, '参数错误: rider_id 无效'));
    }

    const { order_id } = req.body;
    const result = await service.grabOrder(riderId, order_id);
    res.json(success(result, '抢单成功'));
  } catch (err) {
    logger.error(`抢单失败: ${err.message}`);
    if (err.code) {
      res.json(fail(err.code, err.message));
    } else {
      res.json(fail(9001, '服务器内部错误'));
    }
  }
}

module.exports = {
  handleGetSettings,
  handleUpdateSettings,
  handleUpdateStatus,
  handleGetAvailableOrders,
  handleGrabOrder,
};
