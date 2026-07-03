'use strict';

/**
 * 骑手调度路由
 *
 * @module ai_modules/rider_dispatch/router
 */

const express = require('express');
const router = express.Router();

const controller = require('./controller');
const { fail } = require('../common/response');
const {
  updateSettingsSchema,
  updateStatusSchema,
  grabOrderSchema,
} = require('./validators');

/**
 * 参数校验中间件
 *
 * @param {import('joi').ObjectSchema} schema - Joi 校验 schema
 * @param {'body'|'query'} source - 校验来源
 * @returns {Function} express 中间件
 */
function validate(schema, source = 'body') {
  return (req, res, next) => {
    const data = source === 'query' ? req.query : req.body;
    const { error } = schema.validate(data, { abortEarly: false, allowUnknown: false });
    if (error) {
      const details = error.details.map((d) => d.message).join('; ');
      return res.json(fail(2001, `参数错误: ${details}`));
    }
    next();
  };
}

/**
 * GET /api/v2/ai/rider/settings
 * 获取骑手调度设置
 */
router.get('/rider/settings', controller.handleGetSettings);

/**
 * PUT /api/v2/ai/rider/settings
 * 更新骑手调度设置
 */
router.put('/rider/settings', validate(updateSettingsSchema), controller.handleUpdateSettings);

/**
 * PUT /api/v2/ai/rider/status
 * 更新骑手在线/离线状态
 */
router.put('/rider/status', validate(updateStatusSchema), controller.handleUpdateStatus);

/**
 * GET /api/v2/ai/rider/orders/available
 * 获取可抢订单列表
 */
router.get('/rider/orders/available', controller.handleGetAvailableOrders);

/**
 * POST /api/v2/ai/rider/orders/grab
 * 骑手抢单
 */
router.post('/rider/orders/grab', validate(grabOrderSchema), controller.handleGrabOrder);

module.exports = router;
