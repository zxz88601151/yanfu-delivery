'use strict';

/**
 * 信用护照控制器
 *
 * @module ai_modules/credit_passport/controller
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
      filename: path.join(process.env.KUAILV_LOG_DIR || './logs', 'credit-passport.log'),
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
const appealManager = require('./appeal-manager');
const { getHistorySchema, submitAppealSchema, reviewAppealSchema } = require('./validators');

/**
 * GET /credit_passport/riders/:id
 * 获取骑手信用分
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function getRiderCredit(req, res) {
  try {
    const riderId = parseInt(req.params.id, 10);
    if (isNaN(riderId) || riderId <= 0) {
      return res.json(fail(1001, '参数错误'));
    }

    const result = await service.getRiderCredit(riderId);
    res.json(success(result));
  } catch (err) {
    logger.error(`获取骑手信用分失败: ${err.message}`);
    if (err.code) {
      res.json(fail(err.code, err.message));
    } else {
      res.json(fail(9001, '服务器内部错误'));
    }
  }
}

/**
 * GET /credit_passport/riders/:id/history
 * 获取信用变动历史
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function getRiderHistory(req, res) {
  try {
    const riderId = parseInt(req.params.id, 10);
    if (isNaN(riderId) || riderId <= 0) {
      return res.json(fail(1001, '参数错误'));
    }

    // 校验查询参数
    const queryValidation = getHistorySchema.validate(req.query, { abortEarly: false });
    if (queryValidation.error) {
      const details = queryValidation.error.details.map((d) => d.message).join('; ');
      return res.json(fail(1001, `参数错误: ${details}`));
    }

    const { page, size } = queryValidation.value;

    const result = await service.getRiderHistory(riderId, page, size);
    res.json(paginate(result.total, result.page, result.size, result.items));
  } catch (err) {
    logger.error(`获取信用变动历史失败: ${err.message}`);
    if (err.code) {
      res.json(fail(err.code, err.message));
    } else {
      res.json(fail(9001, '服务器内部错误'));
    }
  }
}

/**
 * POST /credit_passport/riders/:id/appeal
 * 提交申诉
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function submitAppeal(req, res) {
  try {
    const riderId = parseInt(req.params.id, 10);
    if (isNaN(riderId) || riderId <= 0) {
      return res.json(fail(1001, '参数错误'));
    }

    // 校验请求体
    const bodyValidation = submitAppealSchema.validate(req.body, { abortEarly: false });
    if (bodyValidation.error) {
      const details = bodyValidation.error.details.map((d) => d.message).join('; ');
      return res.json(fail(1001, `参数错误: ${details}`));
    }

    const { reason, order_id: orderId } = bodyValidation.value;

    // creditRecordId 从请求体获取
    const creditRecordId = parseInt(req.body.credit_record_id, 10);
    if (isNaN(creditRecordId) || creditRecordId <= 0) {
      return res.json(fail(1001, 'credit_record_id 无效'));
    }

    const result = await appealManager.submitAppeal(riderId, creditRecordId, reason, orderId || null);
    res.json(success(result, '申诉提交成功'));
  } catch (err) {
    logger.error(`提交申诉失败: ${err.message}`);
    if (err.code) {
      res.json(fail(err.code, err.message));
    } else {
      res.json(fail(9001, '服务器内部错误'));
    }
  }
}

/**
 * GET /credit_passport/appeals
 * 获取申诉列表（运营端）
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function getAppeals(req, res) {
  let conn;
  try {
    conn = await mysql.createConnection(config.db);

    const page = parseInt(req.query.page, 10) || 1;
    const size = parseInt(req.query.size, 10) || 20;
    const status = req.query.status || null;
    const offset = (page - 1) * size;

    let whereClause = '';
    const params = [];

    if (status && ['pending', 'approved', 'rejected'].includes(status)) {
      whereClause = 'WHERE a.status = ?';
      params.push(status);
    }

    // 查询总数
    const [countResult] = await conn.query(
      `SELECT COUNT(*) AS total FROM ai_credit_appeals a ${whereClause}`,
      params,
    );
    const total = countResult[0].total;

    // 查询分页数据
    const queryParams = [...params, size, offset];
    const [items] = await conn.query(
      `SELECT a.*, c.change_amount, c.reason AS credit_reason
       FROM ai_credit_appeals a
       LEFT JOIN ai_credit_passports c ON a.credit_record_id = c.id
       ${whereClause}
       ORDER BY a.created_at DESC
       LIMIT ? OFFSET ?`,
      queryParams,
    );

    res.json(paginate(total, page, size, items));
  } catch (err) {
    logger.error(`获取申诉列表失败: ${err.message}`);
    res.json(fail(9001, '服务器内部错误'));
  } finally {
    if (conn) {
      await conn.end().catch((e) => logger.error(`关闭数据库连接异常: ${e.message}`));
    }
  }
}

/**
 * PUT /credit_passport/appeals/:id/review
 * 复核申诉
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function reviewAppeal(req, res) {
  try {
    const appealId = parseInt(req.params.id, 10);
    if (isNaN(appealId) || appealId <= 0) {
      return res.json(fail(1001, '参数错误'));
    }

    // 校验请求体
    const bodyValidation = reviewAppealSchema.validate(req.body, { abortEarly: false });
    if (bodyValidation.error) {
      const details = bodyValidation.error.details.map((d) => d.message).join('; ');
      return res.json(fail(1001, `参数错误: ${details}`));
    }

    const { action, reviewer_note: reviewerNote } = bodyValidation.value;

    const result = await appealManager.reviewAppeal(appealId, action, reviewerNote || '');
    res.json(success(result, action === 'approve' ? '申诉已通过' : '申诉已驳回'));
  } catch (err) {
    logger.error(`复核申诉失败: ${err.message}`);
    if (err.code) {
      res.json(fail(err.code, err.message));
    } else {
      res.json(fail(9001, '服务器内部错误'));
    }
  }
}

module.exports = {
  getRiderCredit,
  getRiderHistory,
  submitAppeal,
  getAppeals,
  reviewAppeal,
};
