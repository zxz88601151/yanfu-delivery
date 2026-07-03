'use strict';

/**
 * 盲盒配送控制器
 *
 * @module ai_modules/blind_box/controller
 */

const { success, fail, paginate } = require('../common/response');
const winston = require('winston');
const path = require('path');

const logger = winston.createLogger({
  level: process.env.KUAILV_LOG_LEVEL || 'info',
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({
      filename: path.join(process.env.KUAILV_LOG_DIR || './logs', 'blind-box.log'),
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
 * 创建盲盒订单
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function createOrder(req, res) {
  try {
    const userId = req.user ? req.user.id : req.body.user_id;
    const orderData = {
      budget_min: req.body.budget_min,
      budget_max: req.body.budget_max,
      taste_tags: req.body.taste_tags,
      district_id: req.body.district_id,
    };

    const result = await service.createOrder(userId, orderData);
    res.json(success(result, '盲盒订单创建成功'));
  } catch (err) {
    logger.error(`创建盲盒订单失败: ${err.message}`);
    if (err.code) {
      res.json(fail(err.code, err.message));
    } else {
      res.json(fail(9001, '服务器内部错误'));
    }
  }
}

/**
 * 获取盲盒订单详情
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function getOrder(req, res) {
  try {
    const orderId = parseInt(req.params.id, 10);
    if (isNaN(orderId) || orderId <= 0) {
      return res.json(fail(1001, '参数错误'));
    }

    const result = await service.getOrder(orderId);
    res.json(success(result));
  } catch (err) {
    logger.error(`获取盲盒订单失败: ${err.message}`);
    if (err.code) {
      res.json(fail(err.code, err.message));
    } else {
      res.json(fail(9001, '服务器内部错误'));
    }
  }
}

/**
 * 确认盲盒订单
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function confirmOrder(req, res) {
  try {
    const orderId = parseInt(req.params.id, 10);
    if (isNaN(orderId) || orderId <= 0) {
      return res.json(fail(1001, '参数错误'));
    }

    const result = await service.confirmOrder(orderId);
    res.json(success(result, '盲盒订单确认成功'));
  } catch (err) {
    logger.error(`确认盲盒订单失败: ${err.message}`);
    if (err.code) {
      res.json(fail(err.code, err.message));
    } else {
      res.json(fail(9001, '服务器内部错误'));
    }
  }
}

/**
 * 取消盲盒订单
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function cancelOrder(req, res) {
  try {
    const orderId = parseInt(req.params.id, 10);
    if (isNaN(orderId) || orderId <= 0) {
      return res.json(fail(1001, '参数错误'));
    }

    const result = await service.cancelOrder(orderId);
    res.json(success(result, '盲盒订单取消成功'));
  } catch (err) {
    logger.error(`取消盲盒订单失败: ${err.message}`);
    if (err.code) {
      res.json(fail(err.code, err.message));
    } else {
      res.json(fail(9001, '服务器内部错误'));
    }
  }
}

/**
 * 获取盲盒池列表
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function getPoolDishes(req, res) {
  try {
    const filters = {
      merchant_id: req.query.merchant_id ? parseInt(req.query.merchant_id, 10) : undefined,
      district_id: req.query.district_id ? parseInt(req.query.district_id, 10) : undefined,
      status: req.query.status || 'active',
      page: parseInt(req.query.page, 10) || 1,
      size: parseInt(req.query.size, 10) || 20,
    };

    const result = await service.getPoolDishes(filters);
    res.json(paginate(result.total, result.page, result.size, result.items));
  } catch (err) {
    logger.error(`获取盲盒池列表失败: ${err.message}`);
    res.json(fail(9001, '服务器内部错误'));
  }
}

/**
 * 上架/下架盲盒餐品
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function toggleDish(req, res) {
  try {
    const dishId = parseInt(req.params.id, 10);
    if (isNaN(dishId) || dishId <= 0) {
      return res.json(fail(1001, '参数错误'));
    }

    const status = req.body.status || 'inactive';
    if (!['active', 'inactive'].includes(status)) {
      return res.json(fail(1001, '状态值无效，仅支持 active/inactive'));
    }

    const result = await service.toggleDish(dishId, status);
    res.json(success(result, '餐品状态更新成功'));
  } catch (err) {
    logger.error(`切换餐品状态失败: ${err.message}`);
    if (err.code) {
      res.json(fail(err.code, err.message));
    } else {
      res.json(fail(9001, '服务器内部错误'));
    }
  }
}

/**
 * 更新盲盒餐品库存
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function updateStock(req, res) {
  try {
    const dishId = parseInt(req.params.id, 10);
    if (isNaN(dishId) || dishId <= 0) {
      return res.json(fail(1001, '参数错误'));
    }

    const stockLimit = parseInt(req.body.stock_limit, 10);
    if (isNaN(stockLimit) || stockLimit < 0) {
      return res.json(fail(1001, 'stock_limit 无效'));
    }

    const result = await service.updateStock(dishId, stockLimit);
    res.json(success(result, '库存更新成功'));
  } catch (err) {
    logger.error(`更新库存失败: ${err.message}`);
    if (err.code) {
      res.json(fail(err.code, err.message));
    } else {
      res.json(fail(9001, '服务器内部错误'));
    }
  }
}

module.exports = {
  createOrder,
  getOrder,
  confirmOrder,
  cancelOrder,
  getPoolDishes,
  toggleDish,
  updateStock,
};
