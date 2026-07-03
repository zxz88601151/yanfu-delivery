'use strict';

/**
 * 预置运力路由
 *
 * @module ai_modules/pre_position/router
 */

const express = require('express');
const router = express.Router();

const controller = require('./controller');
const { fail } = require('../common/response');
const {
  predictionsQuerySchema,
  createDispatchSchema,
  respondDispatchSchema,
  arriveDispatchSchema,
  dashboardQuerySchema,
  eventSchema,
} = require('./validators');

/**
 * 参数校验中间件
 *
 * @param {import('joi').ObjectSchema} schema - Joi 校验 schema
 * @param {'body'|'query'|'params'} [source='body'] - 校验来源
 * @returns {Function} express 中间件
 */
function validate(schema, source) {
  const target = source || 'body';
  return (req, res, next) => {
    const { error } = schema.validate(req[target], { abortEarly: false });
    if (error) {
      const details = error.details.map((d) => d.message).join('; ');
      return res.json(fail(1001, `参数错误: ${details}`));
    }
    next();
  };
}

// ========== P0 接口 ==========

/**
 * GET /api/v2/ai/pre_position/predictions
 * 获取爆单预测列表
 */
router.get('/pre_position/predictions', validate(predictionsQuerySchema, 'query'), controller.handleGetPredictions);

/**
 * POST /api/v2/ai/pre_position/dispatch
 * 发起预置调度
 */
router.post('/pre_position/dispatch', validate(createDispatchSchema, 'body'), controller.handleCreateDispatch);

/**
 * POST /api/v2/ai/pre_position/dispatch/:id/respond
 * 骑手响应调度
 */
router.post('/pre_position/dispatch/:id/respond', validate(respondDispatchSchema, 'body'), controller.handleRespondDispatch);

/**
 * PUT /api/v2/ai/pre_position/dispatch/:id/arrive
 * 骑手到达标记
 */
router.put('/pre_position/dispatch/:id/arrive', validate(arriveDispatchSchema, 'body'), controller.handleArriveDispatch);

/**
 * GET /api/v2/ai/pre_position/dashboard
 * 获取效果仪表盘
 */
router.get('/pre_position/dashboard', validate(dashboardQuerySchema, 'query'), controller.handleGetDashboard);

// ========== P1 接口 ==========

/**
 * GET /api/v2/ai/pre_position/dispatches/active
 * 获取活跃调度记录
 */
router.get('/pre_position/dispatches/active', controller.handleGetActiveDispatches);

/**
 * POST /api/v2/ai/pre_position/events
 * 创建商圈活动
 */
router.post('/pre_position/events', validate(eventSchema, 'body'), controller.handleCreateEvent);

/**
 * GET /api/v2/ai/pre_position/events
 * 获取活动列表
 */
router.get('/pre_position/events', controller.handleGetEvents);

module.exports = router;
