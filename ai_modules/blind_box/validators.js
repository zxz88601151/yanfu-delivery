'use strict';

/**
 * 盲盒配送模块 - Joi 参数校验
 *
 * @module ai_modules/blind_box/validators
 */

const Joi = require('joi');

/**
 * 创建盲盒订单校验
 */
const createOrderSchema = Joi.object({
  budget_min: Joi.number().min(0).max(99999).precision(2)
    .required()
    .label('预算下限')
    .messages({
      'number.base': 'budget_min 必须是数字',
      'number.min': 'budget_min 不能小于 0',
      'number.max': 'budget_min 超出范围',
      'any.required': 'budget_min 是必填参数',
    }),

  budget_max: Joi.number().min(0).max(99999).precision(2)
    .greater(Joi.ref('budget_min'))
    .required()
    .label('预算上限')
    .messages({
      'number.base': 'budget_max 必须是数字',
      'number.min': 'budget_max 不能小于 0',
      'number.max': 'budget_max 超出范围',
      'number.greater': 'budget_max 必须大于 budget_min',
      'any.required': 'budget_max 是必填参数',
    }),

  taste_tags: Joi.array().items(Joi.string().max(20)).min(1).max(10)
    .required()
    .label('口味标签')
    .messages({
      'array.base': 'taste_tags 必须是数组',
      'array.min': '至少选择 1 个口味标签',
      'array.max': '最多选择 10 个口味标签',
      'any.required': 'taste_tags 是必填参数',
    }),

  district_id: Joi.number().integer().min(1).required()
    .label('区域ID')
    .messages({
      'number.base': 'district_id 必须是整数',
      'number.min': 'district_id 无效',
      'any.required': 'district_id 是必填参数',
    }),
});

/**
 * 确认盲盒订单校验
 */
const confirmOrderSchema = Joi.object({
  order_id: Joi.string().required()
    .label('订单ID')
    .messages({
      'any.required': 'order_id 是必填参数',
    }),
});

/**
 * 取消盲盒订单校验
 */
const cancelOrderSchema = Joi.object({
  order_id: Joi.string().required()
    .label('订单ID')
    .messages({
      'any.required': 'order_id 是必填参数',
    }),
});

/**
 * 商家添加餐品到盲盒池校验
 */
const poolDishSchema = Joi.object({
  dish_id: Joi.number().integer().min(1).required()
    .label('餐品ID')
    .messages({
      'number.base': 'dish_id 必须是整数',
      'any.required': 'dish_id 是必填参数',
    }),

  discount_rate: Joi.number().min(0.01).max(1.00).precision(2)
    .required()
    .label('折扣率')
    .messages({
      'number.base': 'discount_rate 必须是数字',
      'number.min': 'discount_rate 不能小于 0.01',
      'number.max': 'discount_rate 不能大于 1.00',
      'any.required': 'discount_rate 是必填参数',
    }),

  stock_limit: Joi.number().integer().min(0).max(999999)
    .default(0)
    .label('库存限制')
    .messages({
      'number.base': 'stock_limit 必须是整数',
      'number.min': 'stock_limit 不能小于 0',
    }),

  taste_tags: Joi.array().items(Joi.string().max(20)).min(1).max(10)
    .required()
    .label('口味标签')
    .messages({
      'array.base': 'taste_tags 必须是数组',
      'array.min': '至少选择 1 个口味标签',
      'any.required': 'taste_tags 是必填参数',
    }),

  district_id: Joi.number().integer().min(1).required()
    .label('区域ID')
    .messages({
      'number.base': 'district_id 必须是整数',
      'any.required': 'district_id 是必填参数',
    }),

  is_featured: Joi.boolean().default(false)
    .label('是否推荐'),

  expire_at: Joi.date().iso().allow(null)
    .default(null)
    .label('过期时间'),
});

/**
 * 更新库存校验
 */
const updateStockSchema = Joi.object({
  stock_limit: Joi.number().integer().min(0).max(999999)
    .required()
    .label('库存限制')
    .messages({
      'number.base': 'stock_limit 必须是整数',
      'number.min': 'stock_limit 不能小于 0',
      'any.required': 'stock_limit 是必填参数',
    }),
});

/**
 * 获取盲盒池列表查询参数校验
 */
const getPoolDishesSchema = Joi.object({
  merchant_id: Joi.number().integer().min(1)
    .label('商家ID'),
  district_id: Joi.number().integer().min(1)
    .label('区域ID'),
  status: Joi.string().valid('active', 'inactive', 'expired', 'depleted')
    .default('active')
    .label('状态'),
  page: Joi.number().integer().min(1).default(1)
    .label('页码'),
  size: Joi.number().integer().min(1).max(100).default(20)
    .label('每页条数'),
});

module.exports = {
  createOrderSchema,
  confirmOrderSchema,
  cancelOrderSchema,
  poolDishSchema,
  updateStockSchema,
  getPoolDishesSchema,
};
