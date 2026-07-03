'use strict';

/**
 * 碳积分路由
 *
 * @module ai_modules/carbon_credit/router
 */

const express = require('express');
const router = express.Router();

const controller = require('./controller');
const { fail } = require('../common/response');
const { getHistorySchema, exchangeSchema, getProductsSchema } = require('./validators');

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

// ========== 碳积分接口 ==========

/**
 * GET /api/v2/ai/carbon_credit/users/:id/account
 * 获取碳积分账户
 */
router.get('/carbon_credit/users/:id/account', controller.getAccount);

/**
 * GET /api/v2/ai/carbon_credit/users/:id/history
 * 获取积分明细
 */
router.get('/carbon_credit/users/:id/history', validate(getHistorySchema, 'query'), controller.getHistory);

/**
 * POST /api/v2/ai/carbon_credit/exchange
 * 积分兑换
 */
router.post('/carbon_credit/exchange', validate(exchangeSchema, 'body'), controller.exchangeCredits);

/**
 * GET /api/v2/ai/carbon_credit/exchange/products
 * 获取商品列表
 */
router.get('/carbon_credit/exchange/products', validate(getProductsSchema, 'query'), controller.getProducts);

/**
 * GET /api/v2/ai/carbon_credit/riders/ranking
 * 获取骑手绿色排行
 */
router.get('/carbon_credit/riders/ranking', controller.getRiderRanking);

/**
 * GET /api/v2/ai/carbon_credit/report
 * 获取碳足迹ESG报告
 */
router.get('/carbon_credit/report', controller.getEsgReport);

module.exports = router;
