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
 * 信用护照路由
 *
 * @module ai_modules/credit_passport/router
 */

const express = require('express');
const router = express.Router();

const controller = require('./controller');
const { fail } = require('../common/response');
const { submitAppealSchema, reviewAppealSchema, getHistorySchema } = require('./validators');

/**
 * 参数校验中间件（支持 body 和 query 校验）
 *
 * @param {import('joi').ObjectSchema} schema - Joi 校验 schema
 * @param {'body'|'query'} [source='body'] - 校验来源
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

// ========== 信用护照接口 ==========

/**
 * POST /api/v2/ai/credit_passport/riders/:id/appeal
 * 提交申诉
 */
router.post('/credit_passport/riders/:id/appeal', validate(submitAppealSchema), controller.submitAppeal);

/**
 * PUT /api/v2/ai/credit_passport/appeals/:id/review
 * 复核申诉
 */
router.put('/credit_passport/appeals/:id/review', validate(reviewAppealSchema), controller.reviewAppeal);

/**
 * GET /api/v2/ai/credit_passport/riders/:id
 * 获取骑手信用分
 */
router.get('/credit_passport/riders/:id', controller.getRiderCredit);

/**
 * GET /api/v2/ai/credit_passport/riders/:id/history
 * 获取信用变动历史
 */
router.get('/credit_passport/riders/:id/history', controller.getRiderHistory);

/**
 * GET /api/v2/ai/credit_passport/appeals
 * 获取申诉列表（运营端）
 */
router.get('/credit_passport/appeals', controller.getAppeals);

module.exports = router;
