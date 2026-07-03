'use strict';

/**
 * 信用护照模块 - Joi 参数校验
 *
 * @module ai_modules/credit_passport/validators
 */

const Joi = require('joi');

/**
 * 获取骑手信用分 - 查询参数校验
 */
const getCreditSchema = Joi.object({
  // GET 请求无 body，rider_id 从路径参数获取，此处仅用于未来扩展
});

/**
 * 获取信用变动历史 - 查询参数校验
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
 * 提交申诉 - 请求体校验
 */
const submitAppealSchema = Joi.object({
  reason: Joi.string().min(2).max(200).required()
    .label('申诉原因')
    .messages({
      'string.base': 'reason 必须是字符串',
      'string.min': 'reason 不能少于 2 个字符',
      'string.max': 'reason 不能超过 200 个字符',
      'any.required': 'reason 是必填参数',
    }),

  order_id: Joi.number().integer().min(1).allow(null)
    .optional()
    .label('关联订单ID')
    .messages({
      'number.base': 'order_id 必须是整数',
      'number.min': 'order_id 无效',
    }),
});

/**
 * 复核申诉 - 请求体校验
 */
const reviewAppealSchema = Joi.object({
  action: Joi.string().valid('approve', 'reject').required()
    .label('复核动作')
    .messages({
      'string.base': 'action 必须是字符串',
      'any.only': 'action 必须是 approve 或 reject',
      'any.required': 'action 是必填参数',
    }),

  reviewer_note: Joi.string().min(2).max(500).allow('').optional()
    .label('复核备注')
    .messages({
      'string.base': 'reviewer_note 必须是字符串',
      'string.min': 'reviewer_note 不能少于 2 个字符',
      'string.max': 'reviewer_note 不能超过 500 个字符',
    }),
});

module.exports = {
  getCreditSchema,
  getHistorySchema,
  submitAppealSchema,
  reviewAppealSchema,
};
