'use strict';

/**
 * 碳积分控制器
 *
 * @module ai_modules/carbon_credit/controller
 */

const { success, fail, paginate } = require('../common/response');
const mysql = require('mysql2/promise');
const config = require('../../config/ai_modules');
const winston = require('winston');
const path = require('path');

const logger = winston.createLogger({
  level: process.env.KUAILV_LOG_LEVEL || 'info',
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({
      filename: path.join(process.env.KUAILV_LOG_DIR || './logs', 'carbon-credit.log'),
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
 * GET /carbon_credit/users/:id/account
 * 获取碳积分账户
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function getAccount(req, res) {
  let connection;
  try {
    connection = await mysql.createConnection(config.db);
    const userId = parseInt(req.params.id, 10);
    if (isNaN(userId) || userId <= 0) {
      return res.json(fail(1001, '参数错误'));
    }

    const result = await service.getAccount(userId);
    res.json(success(result));
  } catch (err) {
    logger.error(`获取碳积分账户失败: ${err.message}`);
    if (err.code) {
      res.json(fail(err.code, err.message));
    } else {
      res.json(fail(9001, '服务器内部错误'));
    }
  } finally {
    if (connection) {
      await connection.end().catch((e) => logger.error(`关闭数据库连接异常: ${e.message}`));
    }
  }
}

/**
 * GET /carbon_credit/users/:id/history
 * 获取积分明细
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function getHistory(req, res) {
  let connection;
  try {
    connection = await mysql.createConnection(config.db);
    const userId = parseInt(req.params.id, 10);
    if (isNaN(userId) || userId <= 0) {
      return res.json(fail(1001, '参数错误'));
    }

    const page = parseInt(req.query.page, 10) || 1;
    const size = parseInt(req.query.size, 10) || 20;

    const result = await service.getHistory(userId, page, size);
    res.json(paginate(result.total, result.page, result.size, result.items));
  } catch (err) {
    logger.error(`获取积分明细失败: ${err.message}`);
    if (err.code) {
      res.json(fail(err.code, err.message));
    } else {
      res.json(fail(9001, '服务器内部错误'));
    }
  } finally {
    if (connection) {
      await connection.end().catch((e) => logger.error(`关闭数据库连接异常: ${e.message}`));
    }
  }
}

/**
 * POST /carbon_credit/exchange
 * 积分兑换
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function exchangeCredits(req, res) {
  let connection;
  try {
    connection = await mysql.createConnection(config.db);
    const { product_id: productId, user_id: userId } = req.body;

    const result = await service.exchangeCredits(userId, productId);
    res.json(success(result, '兑换成功'));
  } catch (err) {
    logger.error(`积分兑换失败: ${err.message}`);
    if (err.code) {
      res.json(fail(err.code, err.message));
    } else {
      res.json(fail(9001, '服务器内部错误'));
    }
  } finally {
    if (connection) {
      await connection.end().catch((e) => logger.error(`关闭数据库连接异常: ${e.message}`));
    }
  }
}

/**
 * GET /carbon_credit/exchange/products
 * 获取商品列表
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function getProducts(req, res) {
  let connection;
  try {
    connection = await mysql.createConnection(config.db);
    const products = service.getProducts();
    res.json(success(products));
  } catch (err) {
    logger.error(`获取商品列表失败: ${err.message}`);
    res.json(fail(9001, '服务器内部错误'));
  } finally {
    if (connection) {
      await connection.end().catch((e) => logger.error(`关闭数据库连接异常: ${e.message}`));
    }
  }
}

/**
 * GET /carbon_credit/riders/ranking
 * 获取骑手绿色排行
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function getRiderRanking(req, res) {
  let connection;
  try {
    connection = await mysql.createConnection(config.db);
    const page = parseInt(req.query.page, 10) || 1;
    const size = parseInt(req.query.size, 10) || 20;

    const result = await service.getRiderRanking(page, size);
    res.json(success(result));
  } catch (err) {
    logger.error(`获取骑手绿色排行失败: ${err.message}`);
    if (err.code) {
      res.json(fail(err.code, err.message));
    } else {
      res.json(fail(9001, '服务器内部错误'));
    }
  } finally {
    if (connection) {
      await connection.end().catch((e) => logger.error(`关闭数据库连接异常: ${e.message}`));
    }
  }
}

/**
 * GET /carbon_credit/report
 * 获取碳足迹ESG报告
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function getEsgReport(req, res) {
  let connection;
  try {
    connection = await mysql.createConnection(config.db);
    const userId = parseInt(req.query.user_id, 10);
    if (isNaN(userId) || userId <= 0) {
      return res.json(fail(1001, 'user_id 无效'));
    }

    const startDate = req.query.start_date;
    const endDate = req.query.end_date;

    if (!startDate || !endDate) {
      return res.json(fail(1001, 'start_date 和 end_date 是必填参数'));
    }

    const result = await service.getEsgReport(userId, startDate, endDate);
    res.json(success(result));
  } catch (err) {
    logger.error(`获取碳足迹报告失败: ${err.message}`);
    if (err.code) {
      res.json(fail(err.code, err.message));
    } else {
      res.json(fail(9001, '服务器内部错误'));
    }
  } finally {
    if (connection) {
      await connection.end().catch((e) => logger.error(`关闭数据库连接异常: ${e.message}`));
    }
  }
}

module.exports = {
  getAccount,
  getHistory,
  exchangeCredits,
  getProducts,
  getRiderRanking,
  getEsgReport,
};
