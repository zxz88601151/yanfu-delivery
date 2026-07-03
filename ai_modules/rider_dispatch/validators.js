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
 * 骑手调度模块 - Joi 参数校验
 *
 * @module ai_modules/rider_dispatch/validators
 */

const Joi = require('joi');

/**
 * 更新骑手调度设置校验
 */
const updateSettingsSchema = Joi.object({
  rider_id: Joi.number().integer().min(1).required()
    .label('骑手ID')
    .messages({
      'number.base': 'rider_id 必须是整数',
      'any.required': 'rider_id 是必填参数',
    }),

  max_delivery_distance: Joi.number().min(100).max(50000)
    .label('最大配送距离（米）')
    .messages({
      'number.base': 'max_delivery_distance 必须是数字',
      'number.min': '最大配送距离不能小于 100 米',
      'number.max': '最大配送距离不能超过 50000 米',
    }),

  min_order_amount: Joi.number().min(0).max(1000)
    .label('最低接单金额（元）')
    .messages({
      'number.base': 'min_order_amount 必须是数字',
      'number.min': '最低接单金额不能小于 0',
      'number.max': '最低接单金额不能超过 1000 元',
    }),

  accept_mode: Joi.string().valid('auto', 'manual')
    .label('接单模式')
    .messages({
      'string.base': 'accept_mode 必须是字符串',
      'any.only': '接单模式只能为 auto（自动）或 manual（手动）',
    }),

  max_concurrent_orders: Joi.number().min(1).max(10)
    .label('最大并行订单数')
    .messages({
      'number.base': 'max_concurrent_orders 必须是数字',
      'number.min': '最大并行订单数不能少于 1',
      'number.max': '最大并行订单数不能超过 10',
    }),

  working_time_start: Joi.string().regex(/^\d{2}:\d{2}$/)
    .label('工作开始时间')
    .messages({
      'string.base': 'working_time_start 必须是字符串',
      'string.pattern.base': '工作开始时间格式必须为 HH:mm（如 08:00）',
    }),

  working_time_end: Joi.string().regex(/^\d{2}:\d{2}$/)
    .label('工作结束时间')
    .messages({
      'string.base': 'working_time_end 必须是字符串',
      'string.pattern.base': '工作结束时间格式必须为 HH:mm（如 18:00）',
    }),

  preferred_districts: Joi.array().items(Joi.number().integer().min(1))
    .optional()
    .label('偏好区域列表')
    .messages({
      'array.base': 'preferred_districts 必须是数组',
      'number.base': 'preferred_districts 中的元素必须是整数',
    }),

  max_weight: Joi.number().min(0).max(100)
    .label('最大接单重量（kg）')
    .messages({
      'number.base': 'max_weight 必须是数字',
      'number.min': '最大接单重量不能小于 0 kg',
      'number.max': '最大接单重量不能超过 100 kg',
    }),

  vehicle_type: Joi.number().valid(1, 2, 3)
    .label('车辆类型')
    .messages({
      'number.base': 'vehicle_type 必须是数字',
      'any.only': '车辆类型只能为 1（电动车）、2（摩托车）或 3（汽车）',
    }),

  auto_grab_enabled: Joi.boolean()
    .label('是否开启自动抢单')
    .messages({
      'boolean.base': 'auto_grab_enabled 必须是布尔值',
    }),

  auto_grab_max_distance: Joi.number().min(100).max(50000)
    .label('自动抢单最大距离（米）')
    .messages({
      'number.base': 'auto_grab_max_distance 必须是数字',
      'number.min': '自动抢单最大距离不能小于 100 米',
      'number.max': '自动抢单最大距离不能超过 50000 米',
    }),

  auto_grab_min_amount: Joi.number().min(0).max(1000)
    .label('自动抢单最低金额（元）')
    .messages({
      'number.base': 'auto_grab_min_amount 必须是数字',
      'number.min': '自动抢单最低金额不能小于 0',
      'number.max': '自动抢单最低金额不能超过 1000 元',
    }),
});

/**
 * 抢单请求校验
 */
const grabOrderSchema = Joi.object({
  rider_id: Joi.number().integer().min(1).required()
    .label('骑手ID')
    .messages({
      'number.base': 'rider_id 必须是整数',
      'any.required': 'rider_id 是必填参数',
    }),
  order_id: Joi.number().integer().min(1).required()
    .label('订单ID')
    .messages({
      'number.base': 'order_id 必须是整数',
      'number.integer': 'order_id 必须是整数',
      'number.min': 'order_id 必须大于 0',
      'any.required': 'order_id 是必填参数',
    }),
});

/**
 * 更新骑手在线状态校验
 */
const updateStatusSchema = Joi.object({
  rider_id: Joi.number().integer().min(1).required()
    .label('骑手ID')
    .messages({
      'number.base': 'rider_id 必须是整数',
      'any.required': 'rider_id 是必填参数',
    }),
  status: Joi.number().valid(0, 1).required()
    .label('在线状态')
    .messages({
      'number.base': 'status 必须是数字',
      'any.only': '状态值只能为 0（离线）或 1（在线）',
      'any.required': 'status 是必填参数',
    }),
});

module.exports = {
  updateSettingsSchema,
  grabOrderSchema,
  updateStatusSchema,
};
