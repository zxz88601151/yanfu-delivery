'use strict';

/**
 * 协同配送路由
 *
 * @module ai_modules/relay_delivery/router
 */

const express = require('express');
const router = express.Router();

const controller = require('./controller');
const { fail } = require('../common/response');
const {
  splitSchema,
  arriveSchema,
  handoffSchema,
  progressSchema,
  listStationsSchema,
  createStationSchema,
  getOrderSchema,
} = require('./validators');

/**
 * 参数校验中间件
 *
 * @param {import('joi').ObjectSchema} schema
 * @param {'body'|'query'|'params'} [source='body']
 * @returns {Function}
 */
function validate(schema, source = 'body') {
  return (req, res, next) => {
    const data = source === 'query' ? req.query
      : source === 'params' ? req.params
      : req.body;

    const { error } = schema.validate(data, { abortEarly: false, allowUnknown: false });
    if (error) {
      const details = error.details.map((d) => d.message).join('; ');
      return res.json(fail(5001, `参数错误: ${details}`));
    }
    next();
  };
}

// ========== P0 端点 ==========

/**
 * POST /api/v2/ai/relay_delivery/split
 * 拆单评估 + 创建接力方案
 */
router.post('/split', validate(splitSchema), controller.split);

/**
 * GET /api/v2/ai/relay_delivery/orders/:id
 * 获取接力配送详情
 */
router.get('/orders/:id', controller.getOrder);

/**
 * PUT /api/v2/ai/relay_delivery/handoffs/:id/arrive
 * 骑手到达接力点标记
 */
router.put('/handoffs/:id/arrive', validate(arriveSchema), controller.arrive);

/**
 * PUT /api/v2/ai/relay_delivery/handoffs/:id/handoff
 * 接力交接确认
 */
router.put('/handoffs/:id/handoff', validate(handoffSchema), controller.handoff);

// ========== P1 端点 ==========

/**
 * GET /api/v2/ai/relay_delivery/progress/:order_id
 * 用户端进度查询
 */
router.get('/progress/:order_id', validate(progressSchema, 'params'), controller.getProgress);

// ========== P2 端点 ==========

/**
 * GET /api/v2/ai/relay_delivery/stations
 * 获取可用接力点列表
 */
router.get('/stations', validate(listStationsSchema, 'query'), controller.listStations);

/**
 * POST /api/v2/ai/relay_delivery/stations
 * 新增接力点
 */
router.post('/stations', validate(createStationSchema), controller.createStation);

module.exports = router;
