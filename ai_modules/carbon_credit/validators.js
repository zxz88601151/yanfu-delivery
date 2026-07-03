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
 * 碳积分模块 - Joi 参数校验
 *
 * @module ai_modules/carbon_credit/validators
 */

const Joi = require('joi');

/**
 * 获取碳积分账户 - 路径参数校验
 * GET /carbon_credit/users/:id/account
 */
const getAccountSchema = Joi.object({
  id: Joi.number().integer().positive().required()
    .label('用户ID')
    .messages({
      'number.base': '用户ID必须是整数',
      'number.integer': '用户ID必须是整数',
      'number.positive': '用户ID必须大于0',
      'any.required': '用户ID是必填参数',
    }),
});

/**
 * 获取积分明细 - 查询参数校验
 * GET /carbon_credit/users/:id/history
 */
const getHistorySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1)
    .label('页码')
    .messages({
      'number.base': 'page 必须是整数',
      'number.min': 'page 不能小于 1',
    }),

  size: Joi.number().integer().min(1).max(100).default(20)
    .label('每页条数')
    .messages({
      'number.base': 'size 必须是整数',
      'number.min': 'size 不能小于 1',
      'number.max': 'size 不能大于 100',
    }),
});

/**
 * 积分兑换 - 请求体校验
 * POST /carbon_credit/exchange
 */
const exchangeSchema = Joi.object({
  user_id: Joi.number().integer().positive().required()
    .label('用户ID')
    .messages({
      'number.base': 'user_id 必须是整数',
      'number.integer': 'user_id 必须是整数',
      'number.positive': 'user_id 必须大于0',
      'any.required': 'user_id 是必填参数',
    }),

  product_id: Joi.number().integer().positive().required()
    .label('商品ID')
    .messages({
      'number.base': 'product_id 必须是整数',
      'number.integer': 'product_id 必须是整数',
      'number.positive': 'product_id 必须大于0',
      'any.required': 'product_id 是必填参数',
    }),

  quantity: Joi.number().integer().min(1).default(1)
    .label('兑换数量')
    .messages({
      'number.base': 'quantity 必须是整数',
      'number.min': 'quantity 不能小于 1',
    }),
});

/**
 * 获取商品列表 - 查询参数校验
 * GET /carbon_credit/exchange/products
 */
const getProductsSchema = Joi.object({
  page: Joi.number().integer().min(1).default(1)
    .label('页码')
    .messages({
      'number.base': 'page 必须是整数',
      'number.min': 'page 不能小于 1',
    }),

  size: Joi.number().integer().min(1).max(100).default(20)
    .label('每页条数')
    .messages({
      'number.base': 'size 必须是整数',
      'number.min': 'size 不能小于 1',
      'number.max': 'size 不能大于 100',
    }),
});

module.exports = {
  getAccountSchema,
  getHistorySchema,
  exchangeSchema,
  getProductsSchema,
};
