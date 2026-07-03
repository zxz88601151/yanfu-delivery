'use strict';

/**
 * 动态定价路由
 *
 * @module ai_modules/dynamic_pricing/router
 */

const express = require('express');
const router = express.Router();

const controller = require('./controller');
const { fail } = require('../common/response');
const {
  estimateSchema,
  zoneQuerySchema,
  updateConfigSchema,
  logsQuerySchema,
  reportQuerySchema,
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

// ========== P0 端点 ==========

/**
 * POST /api/v2/ai/dynamic_pricing/estimate
 * 估算配送费（下单前核心接口）
 */
router.post('/dynamic_pricing/estimate', validate(estimateSchema), controller.handleEstimate);

/**
 * GET /api/v2/ai/dynamic_pricing/zone
 * 获取区域定价系数列表（热力图）
 */
router.get('/dynamic_pricing/zone', validate(zoneQuerySchema, 'query'), controller.handleZone);

// ========== P1 端点 ==========

/**
 * GET /api/v2/ai/dynamic_pricing/config
 * 获取定价配置
 */
router.get('/dynamic_pricing/config', controller.handleGetConfig);

/**
 * PUT /api/v2/ai/dynamic_pricing/config
 * 更新定价配置
 */
router.put('/dynamic_pricing/config', validate(updateConfigSchema), controller.handleUpdateConfig);

/**
 * GET /api/v2/ai/dynamic_pricing/logs
 * 获取定价日志
 */
router.get('/dynamic_pricing/logs', validate(logsQuerySchema, 'query'), controller.handleLogs);

/**
 * GET /api/v2/ai/dynamic_pricing/report
 * 获取价格影响分析报表
 */
router.get('/dynamic_pricing/report', validate(reportQuerySchema, 'query'), controller.handleReport);

module.exports = router;
