/**
 * ========================================
 * 盐阜配送 - Yanfu Delivery
 * ========================================
 * © 中哥  All Rights Reserved
 * FP_UUID_31adb5871aea40b8b0c288773f094ab2|FP_AUTHOR_中哥_SN_20260531|FP_HASH_20260531B9F3|FP_ORIGIN_2026_AUTHOR_中哥
 * ========================================
 * 严禁未经授权转载、商用，商用需联系作者授权
 * 遵循开源协议，仅限项目内部使用，商用需联系本人授权
 * ========================================
 */

'use strict';

/**
 * 活地图路由
 *
 * @module ai_modules/live_map/router
 */

const express = require('express');
const router = express.Router();

const controller = require('./controller');
const { fail } = require('../common/response');
const {
  submitReportSchema,
  listReportsSchema,
  heatmapSchema,
  listConditionsSchema,
  expireConditionSchema,
  avoidAdviceSchema,
  statsSchema,
} = require('./validators');

/**
 * 参数校验中间件
 *
 * @param {import('joi').ObjectSchema} schema - Joi 校验 schema
 * @param {'body'|'query'} [source='body'] - 校验来源
 * @returns {Function} express 中间件
 */
function validate(schema, source) {
  const target = source || 'body';
  return (req, res, next) => {
    const data = target === 'query' ? req.query : req.body;
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
 * POST /reports
 * 骑手上报路况
 */
router.post('/reports', validate(submitReportSchema), controller.handleSubmitReport);

/**
 * GET /heatmap
 * 获取配送难度热力图
 */
router.get('/heatmap', controller.handleGetHeatmap);

// ========== P1 端点 ==========

/**
 * GET /reports
 * 获取路况上报列表
 */
router.get('/reports', controller.handleListReports);

/**
 * GET /conditions
 * 获取已验证路况列表
 */
router.get('/conditions', controller.handleListConditions);

/**
 * GET /routes/avoid-advice
 * 获取路径避让建议
 */
router.get('/routes/avoid-advice', controller.handleGetAvoidAdvice);

// ========== P2 端点 ==========

/**
 * POST /conditions/:id/expire
 * 手动过期红区（admin）
 */
router.post('/conditions/:id/expire', controller.handleExpireCondition);

/**
 * GET /stats
 * 获取统计仪表盘数据
 */
router.get('/stats', controller.handleGetStats);

module.exports = router;
