'use strict';

/**
 * 盲盒配送路由
 *
 * @module ai_modules/blind_box/router
 */

const express = require('express');
const router = express.Router();

const controller = require('./controller');
const { fail } = require('../common/response');
const { createOrderSchema } = require('./validators');

/**
 * 参数校验中间件
 *
 * @param {import('joi').ObjectSchema} schema - Joi 校验 schema
 * @returns {Function} express 中间件
 */
function validate(schema) {
  return (req, res, next) => {
    const { error } = schema.validate(req.body || req.query, { abortEarly: false });
    if (error) {
      const details = error.details.map((d) => d.message).join('; ');
      return res.json(fail(1001, `参数错误: ${details}`));
    }
    next();
  };
}

// ========== 盲盒订单接口 ==========

/**
 * POST /api/v2/ai/blind_box/orders
 * 创建盲盒订单
 */
router.post('/blind_box/orders', validate(createOrderSchema), controller.createOrder);

/**
 * GET /api/v2/ai/blind_box/orders/:id
 * 获取盲盒订单详情
 */
router.get('/blind_box/orders/:id', controller.getOrder);

/**
 * POST /api/v2/ai/blind_box/orders/:id/confirm
 * 确认盲盒订单
 */
router.post('/blind_box/orders/:id/confirm', controller.confirmOrder);

/**
 * POST /api/v2/ai/blind_box/orders/:id/cancel
 * 取消盲盒订单
 */
router.post('/blind_box/orders/:id/cancel', controller.cancelOrder);

// ========== 盲盒池管理接口 ==========

/**
 * GET /api/v2/ai/blind_box/pool/dishes
 * 获取盲盒池列表
 */
router.get('/blind_box/pool/dishes', controller.getPoolDishes);

/**
 * POST /api/v2/ai/blind_box/pool/dishes/:id/toggle
 * 上架/下架盲盒餐品
 */
router.post('/blind_box/pool/dishes/:id/toggle', controller.toggleDish);

/**
 * POST /api/v2/ai/blind_box/pool/dishes/:id/stock
 * 更新盲盒餐品库存
 */
router.post('/blind_box/pool/dishes/:id/stock', controller.updateStock);

module.exports = router;
